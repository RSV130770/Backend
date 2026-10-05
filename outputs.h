#ifndef OUTPUTS_H
#define OUTPUTS_H
#pragma once
#include <Arduino.h>
#include "driver/ledc.h"
#include <Ticker.h>
#include <MD_DS1307.h>
#include "ESPAsyncWebServer.h"
#define ARDUINOJSON_ENABLE_HEAP 1
#include <ArduinoJson.h>
#include "helpers.h"

#define WHITE_IO 33  // White Light
#define RED_IO 17    // RED light
#define BLUE_IO 15   // Blue Light
#define UV_IO 2     // UV Light
#define FARR_IO 25    // Far Red Light
#define PUMP_IO 4    // 12VPUMP
#define MIST_IO 18   // 24V MIST
#define FAN_IO 22    // 5V aux1
#define AUX_IO 19    // 5V aux2

#define ID_WHITE 0  // White Light
#define ID_RED 1    // RED light
#define ID_BLUE 2   // Blue Light
#define ID_UV 3     // UV Light
#define ID_FARR 4   // Far Red Light
#define ID_PUMP 5   // 12VPUMP
#define ID_MIST 6   // 24V MIST
#define ID_FAN 7    // 5V aux1
#define ID_AUX 8    // 5V aux2
#define ID_SOUND 9  // sound output


#define LEDC_RESOLUTION LEDC_TIMER_8_BIT
#define LEDC_BASE_FREQ 100
#define LEDC_SOFTSTART_FREQ 100
#define LEDC_MODE LEDC_HIGH_SPEED_MODE
#define LEDC_TIMER_BASE LEDC_TIMER_0
#define LEDC_TIMER_SOFTSTART LEDC_TIMER_1
#define OUTPUT_COUNT  9
// ---------------------------------------------
// Output operating modes
// ---------------------------------------------
enum OutputMode {
  MODE_NO_RAMP = 0,
  MODE_SOFTSTART,
  MODE_ANALOG_DIRECT,
  MODE_ANALOG_RAMP,
  MODE_SOUND
};

// ---------------------------------------------
// Loop state
// ---------------------------------------------
enum LoopState {
  LOOP_IDLE = 0,
  LOOP_ON,
  LOOP_OFF
};

class Output {
public:
  // Hardware
  uint8_t gpio;
  uint8_t id;
  OutputMode mode;

  // UI
  String label;
  String icon;
  String style;
  bool invert;

  // Duty control
  float current;
  float target;

  // Ramping
  float delta;
  bool ramping;
  uint32_t rampMs;  // used by MODE_ANALOG_RAMP and MODE_SOFTSTART
  uint32_t riseMs;  // for tasks/custom
  uint32_t fallMs;  // for tasks/custom

  // Loop engine
  uint16_t onSeconds;
  uint16_t offSeconds;
  LoopState loopState;
  uint32_t remaining;
  uint32_t remainingRampSeconds;   // time left until ramp completes
  uint32_t rampEndEpoch;           // absolute time when ramp finishes
  float frozenLevel;          
  uint32_t frozenEpoch;  
  
  // Daily event
  uint32_t nextDailyEpoch;

  // Dashboard update flag
  bool changed;
  uint8_t ledcChannel;

  //---
  // Constructor
  //---
  Output(uint8_t pin,
         uint8_t ch,
         OutputMode m,
         const String &lbl,
         const String &iconFile,
         const String &bgStyle,
         bool invertFlag,
         uint32_t rampDefault = 0);
  // -----------------------------------------
  // Core methods
  // -----------------------------------------
  void writePWM(int value);
  void setTarget(int value);
  void update();

  // Loop control
  void enableLoop(uint16_t onSec, uint16_t offSec, uint8_t duty);
 // void updateLoop(uint32_t NOW_EPOCH);
  void disableLoop();
  void freeze(uint32_t t){};
  void resume(uint32_t t){};
  // Reset to safe state
  void reset();

  //---
  // Mode → string
  //---
  String modeStr() const {
    switch (mode) {
      case MODE_NO_RAMP: return "no_ramp";
      case MODE_SOFTSTART: return "softstart";
      case MODE_ANALOG_DIRECT: return "analog_direct";
      case MODE_ANALOG_RAMP: return "analog_ramp";
      default: return "unknown";
    }
  }
};


// ---------------------------------------------
// Global outputs
// ---------------------------------------------
extern Output OUT[OUTPUT_COUNT];

// ---------------------------------------------
// Engine control
// ---------------------------------------------
void initLEDC();
void updateOutputs();
void resetOutputs();
void setupOutputs();
#endif

