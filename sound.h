#ifndef SOUND_H
#define SOUND_H

#include <SD.h>
#include <driver/i2s.h>

#define I2S_DOUT          12
#define I2S_BCLK          14
#define I2S_LRC           13

struct WavHeader {
  uint32_t sample_rate;
  uint16_t bits_per_sample;
  uint16_t num_channels;
};

bool parseWavHeader(File &file, WavHeader &header);
void setup_sound();
void play_sound(std::string text, fs::FS &SD);

#endif  // SOUND_H
