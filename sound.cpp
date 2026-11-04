// sound.cpp
//
// WAV player for the MAX98357A I2S amplifier.
// - soundPlay() queues a file and returns at once; a FreeRTOS task plays it,
//   so the web server, the scheduler and loop() never wait for a sound.
// - Files: 16-bit PCM WAV, mono (stereo is played as its left channel),
//   any sample rate. Extra chunks (LIST, metadata) are skipped.
// - Volume 0..255 scales the samples (the Sound output's duty).
// - A missing or broken file is reported on the serial port and skipped.

#include "sound.h"
#include <SPIFFS.h>

struct SoundJob {
  char    path[32];
  uint8_t volume;
};

static QueueHandle_t soundQueue = nullptr;
static volatile bool soundPlaying = false;
static int ampPin = -1;            // amplifier SD (shutdown) pin, HIGH = on

static uint32_t le32(const uint8_t *b) {
  return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
static uint16_t le16(const uint8_t *b) {
  return (uint16_t)(b[0] | (b[1] << 8));
}

// Reads the "fmt " chunk and stops at the start of the "data" chunk.
// On success the file is positioned at the first sample.
bool parseWavHeader(File &file, WavHeader &header) {
  file.seek(0);
  uint8_t b[16];
  if (file.read(b, 12) != 12 || memcmp(b, "RIFF", 4) != 0 || memcmp(b + 8, "WAVE", 4) != 0) {
    Serial.println("Sound: not a RIFF/WAVE file");
    return false;
  }
  bool haveFmt = false;
  while (file.available() >= 8) {
    if (file.read(b, 8) != 8) break;
    const uint32_t size = le32(b + 4);
    const uint32_t body = file.position();
    if (memcmp(b, "fmt ", 4) == 0) {
      if (size < 16 || file.read(b, 16) != 16) break;
      header.audio_format    = le16(b);
      header.num_channels    = le16(b + 2);
      header.sample_rate     = le32(b + 4);
      header.bits_per_sample = le16(b + 14);
      haveFmt = true;
    } else if (memcmp(b, "data", 4) == 0) {
      if (!haveFmt) break;
      header.data_size = size;
      return true;                       // positioned at the samples
    }
    file.seek(body + size + (size & 1)); // chunks are word aligned
  }
  Serial.println("Sound: WAV without fmt/data chunk");
  return false;
}

// Files up to this size are played from RAM (about 2.9 s at 22050 Hz mono)
static const uint32_t SOUND_RAM_MAX = 128UL * 1024UL;
// Heap that must stay free for the web server and the rest
static const uint32_t SOUND_HEAP_RESERVE = 32UL * 1024UL;

// Turns a block of 16-bit samples into what I2S plays: the left channel
// only, volume applied. Works in place; returns the number of samples.
static size_t prepareSamples(int16_t *buf, size_t bytes, uint16_t channels, uint8_t volume) {
  size_t n = bytes / 2;
  if (channels == 2) {
    size_t j = 0;
    for (size_t i = 0; i + 1 < n; i += 2) buf[j++] = buf[i];
    n = j;
  }
  if (volume < 255)
    for (size_t i = 0; i < n; i++) buf[i] = (int16_t)(((int32_t)buf[i] * volume) / 255);
  return n;
}

// Pushes the last samples of a sound out of the DMA buffers by writing
// silence after them. i2s_write() returns once its data is IN the buffers,
// not played; switching the amp off then cut the end of the sound, and that
// end was heard first at the next sound. Twice the buffer size (8 x 1024
// frames) is written, so it holds also if a frame takes 4 bytes.
static void flushWithSilence() {
  static const int16_t zeros[256] = {0};
  const size_t total = 2UL * 8UL * 1024UL * 2UL;   // bytes
  size_t written;
  for (size_t done = 0; done < total; done += sizeof(zeros))
    i2s_write(I2S_NUM_0, zeros, sizeof(zeros), &written, portMAX_DELAY);
}

// I2S clock now running (setup_sound starts at 44100 Hz). Changing it
// restarts the I2S peripheral, so it is changed only when a file needs
// another rate, and never while the amp is on.
static uint32_t currentRate = 44100;

// Timing of the last playback, for the log
static uint32_t longestStallMs = 0;

// Writes samples in 4 KB pieces. Once the DMA buffers are full, each piece
// returns at playback speed; a piece that takes clearly longer means the
// output stalled (that is a break you hear), so the longest one is logged.
static void writeTimed(const int16_t *samples, size_t count, uint32_t rate) {
  const size_t PIECE = 2048;               // samples (4 KB)
  size_t written;
  for (size_t i = 0; i < count; i += PIECE) {
    const size_t n = (count - i) < PIECE ? (count - i) : PIECE;
    const uint32_t t0 = millis();
    i2s_write(I2S_NUM_0, samples + i, n * 2, &written, portMAX_DELAY);
    const uint32_t took = millis() - t0;
    const uint32_t normal = (uint32_t)((n * 1000UL) / rate);
    if (took > normal + 50 && took - normal > longestStallMs) longestStallMs = took - normal;
  }
}

// Amp on, then a short silence: the MAX98357A needs a few ms after SD goes
// high, and the first samples must not be lost in that time
static void ampOnWithPreroll(uint32_t rate) {
  if (ampPin >= 0) digitalWrite(ampPin, HIGH);
  static const int16_t zeros[256] = {0};
  size_t written;
  const size_t bytes = (size_t)(rate * 30UL / 1000UL) * 2;   // 30 ms
  for (size_t done = 0; done < bytes; done += sizeof(zeros))
    i2s_write(I2S_NUM_0, zeros, sizeof(zeros), &written, portMAX_DELAY);
}

// Plays one file to the end (blocks the calling task)
static void playFile(const char *path, uint8_t volume) {
  if (volume == 0) return;
  if (!SPIFFS.exists(path)) {
    Serial.printf("Sound: %s not found\n", path);
    return;
  }
  File file = SPIFFS.open(path, "r");
  if (!file || file.isDirectory()) {
    Serial.printf("Sound: cannot open %s\n", path);
    return;
  }
  WavHeader h = {};
  if (!parseWavHeader(file, h) || h.audio_format != 1 || h.bits_per_sample != 16 ||
      h.num_channels < 1 || h.num_channels > 2 || h.sample_rate < 8000) {
    Serial.printf("Sound: %s must be 16-bit PCM WAV, mono or stereo\n", path);
    file.close();
    return;
  }
  Serial.printf("Sound: playing %s, %lu Hz, %u ch, volume %u%%\n", path,
                (unsigned long)h.sample_rate, h.num_channels, (volume * 100 + 127) / 255);

  if (h.sample_rate != currentRate) {
    i2s_set_sample_rates(I2S_NUM_0, h.sample_rate);
    currentRate = h.sample_rate;
    Serial.printf("Sound: I2S clock set to %lu Hz\n", (unsigned long)currentRate);
  }
  // Nothing of an earlier sound may be left in the DMA buffers
  i2s_zero_dma_buffer(I2S_NUM_0);
  longestStallMs = 0;
  const uint32_t tPlay = millis();
  uint32_t samplesPlayed = 0;

  // Short sounds are loaded into RAM first and played from there: reading
  // SPIFFS while playing starves the I2S buffers whenever the web server or
  // a flash write holds the flash, and the sound comes out choppy.
  uint8_t *ram = nullptr;
  if (h.data_size <= SOUND_RAM_MAX &&
      h.data_size + SOUND_HEAP_RESERVE < ESP.getMaxAllocHeap())
    ram = (uint8_t *)malloc(h.data_size);

  if (ram) {
    const uint32_t t0 = millis();
    const size_t got = file.read(ram, h.data_size);
    file.close();
    const size_t n = prepareSamples((int16_t *)ram, got, h.num_channels, volume);
    Serial.printf("Sound: %u bytes loaded in %lu ms\n", (unsigned)got,
                  (unsigned long)(millis() - t0));
    ampOnWithPreroll(h.sample_rate);
    writeTimed((int16_t *)ram, n, h.sample_rate);
    samplesPlayed = n;
    free(ram);
    flushWithSilence();
  } else {
    // Long file or little memory: stream it in 4 KB blocks
    Serial.printf("Sound: streaming from flash (free block %u bytes)\n",
                  (unsigned)ESP.getMaxAllocHeap());
    const size_t BLOCK = 4096;
    int16_t *buf = (int16_t *)malloc(BLOCK);
    if (!buf) {
      Serial.println("Sound: out of memory");
      file.close();
      return;
    }
    ampOnWithPreroll(h.sample_rate);
    uint32_t left = h.data_size;
    while (left > 0) {
      size_t got = file.read((uint8_t *)buf, left < BLOCK ? left : BLOCK);
      if (got < 2) break;
      left -= got;
      size_t n = prepareSamples(buf, got, h.num_channels, volume);
      writeTimed(buf, n, h.sample_rate);
      samplesPlayed += n;
    }
    free(buf);
    file.close();
    flushWithSilence();
  }

  // Only silence is left in the buffers now: the amp may go off
  if (ampPin >= 0) digitalWrite(ampPin, LOW);
  i2s_zero_dma_buffer(I2S_NUM_0);
  Serial.printf("Sound: done, %lu ms of sound in %lu ms, longest stall %lu ms\n",
                (unsigned long)(samplesPlayed * 1000UL / h.sample_rate),
                (unsigned long)(millis() - tPlay), (unsigned long)longestStallMs);
}

static void soundTask(void *) {
  SoundJob job;
  for (;;) {
    if (xQueueReceive(soundQueue, &job, portMAX_DELAY) == pdTRUE) {
      soundPlaying = true;
      playFile(job.path, job.volume);
      soundPlaying = false;
    }
  }
}

void setup_sound() {
  i2s_config_t i2s_config = {
      .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
      .sample_rate = 44100,
      .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
      .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
      .communication_format = I2S_COMM_FORMAT_I2S_MSB,
      .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
      .dma_buf_count = 8,
      .dma_buf_len = 1024,
      .use_apll = false,
      .tx_desc_auto_clear = true,
  };

  i2s_pin_config_t pin_config = {
      .bck_io_num = I2S_BCLK,
      .ws_io_num = I2S_LRC,
      .data_out_num = I2S_DOUT,
      .data_in_num = -1,
  };

  i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pin_config);
}

void soundBegin(int sdPin) {
  ampPin = sdPin;
  if (ampPin >= 0) {
    pinMode(ampPin, OUTPUT);
    digitalWrite(ampPin, LOW);
  }
  if (soundQueue) return;
  soundQueue = xQueueCreate(4, sizeof(SoundJob));
  // Priority above loop() (1) and the web server task (3): while it waits
  // for the I2S buffers it sleeps, so the others still get the CPU
  xTaskCreatePinnedToCore(soundTask, "sound", 6144, nullptr, 5, nullptr, 1);
}

bool soundPlay(const String &name, uint8_t volume) {
  if (!soundQueue || volume == 0 || name.length() == 0) return false;
  String path = name.startsWith("/") ? name : "/" + name;
  SoundJob job;
  if (path.length() >= sizeof(job.path)) {
    Serial.printf("Sound: name too long: %s\n", path.c_str());
    return false;
  }
  if (!SPIFFS.exists(path)) {
    Serial.printf("Sound: %s not found\n", path.c_str());
    return false;
  }
  strncpy(job.path, path.c_str(), sizeof(job.path));
  job.path[sizeof(job.path) - 1] = 0;
  job.volume = volume;
  if (xQueueSend(soundQueue, &job, 0) != pdTRUE) {
    Serial.println("Sound: queue full, skipped");
    return false;
  }
  return true;
}

bool soundBusy() {
  return soundPlaying || (soundQueue && uxQueueMessagesWaiting(soundQueue) > 0);
}

// Names of the .wav files in SPIFFS, without the leading "/"
void soundList(JsonArray arr) {
  File root = SPIFFS.open("/");
  if (!root || !root.isDirectory()) return;
  File f = root.openNextFile();
  while (f) {
    String n = f.name();
    if (n.startsWith("/")) n = n.substring(1);
    String lower = n;
    lower.toLowerCase();
    if (!f.isDirectory() && lower.endsWith(".wav")) arr.add(n);
    f = root.openNextFile();
  }
}

// Old blocking call, kept for the start-up and reset sounds. A missing file
// no longer stops the controller.
void play_sound(std::string text, fs::FS &SD) {
  (void)SD;   // always SPIFFS
  playFile(text.c_str(), 255);
}
