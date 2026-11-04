#ifndef SOUND_H
#define SOUND_H

#include <SD.h>
#include <driver/i2s.h>
#include <ArduinoJson.h>

#define I2S_DOUT          12
#define I2S_BCLK          14
#define I2S_LRC           13

// Volume of the system sounds (stage end, warning): 50 %
#define SOUND_DEFAULT_VOLUME 128

struct WavHeader {
  uint32_t sample_rate;
  uint16_t bits_per_sample;
  uint16_t num_channels;
  uint16_t audio_format;   // 1 = PCM
  uint32_t data_size;      // bytes of samples
};

bool parseWavHeader(File &file, WavHeader &header);
void setup_sound();
void soundBegin(int sdPin);                       // after setup_sound()
bool soundPlay(const String &name, uint8_t volume); // queue, returns at once
bool soundBusy();
void soundList(JsonArray arr);                    // .wav files in SPIFFS
void play_sound(std::string text, fs::FS &SD);    // blocking, old call

#endif  // SOUND_H
