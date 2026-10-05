#include "outputs.h"

// -----------------------------
#define LEDC_BASE_FREQ 15000
#define LEDC_LOW_FREQ 100
#define LEDC_MODE LEDC_HIGH_SPEED_MODE
#define LEDC_TIMER LEDC_TIMER_1
// Global outputs (definition)
/*
#define WHITE_IO    33   // White Light
#define RED_IO      15   // RED light
#define BLUE_IO     17   // Blue Light
#define UV_IO       25   // UV Light
#define FARR_IO     2    // Far Red Light
#define PUMP_IO     4    // 12VPUMP 
#define MIST_IO     18   // 24V MIST 
#define FAN_IO      22   // 5V aux1  
#define AUX_IO      19   // 5V aux2  
*/

// -----------------------------


Output OUT[OUTPUT_COUNT] = {
  Output(WHITE_IO, ID_WHITE, MODE_ANALOG_RAMP, "White Light", "/sun.svg", "background-color:lightgray;", false, 2000),  // 0
  Output(RED_IO, ID_RED, MODE_ANALOG_RAMP, "Red Light", "/sun.svg", "background-color:#ff4d4d;", true, 2000),           // 1
  Output(BLUE_IO, ID_BLUE, MODE_ANALOG_RAMP, "Blue Light", "/sun.svg", "background-color:#4738ce;", true, 2000),        // 2
  Output(UV_IO, ID_UV, MODE_ANALOG_RAMP, "UV Light", "/sun.svg", "background-color:#b543fb;", true, 2000),              // 3
  Output(FARR_IO, ID_FARR, MODE_ANALOG_RAMP, "Far Red", "/sun.svg", "background-color:#720101;", true, 2000),           // 4
  Output(PUMP_IO, ID_PUMP, MODE_SOFTSTART, "Pump", "/shower.svg", "background-color:#C7C7F1;", false),                  // 5
  Output(MIST_IO, ID_MIST, MODE_NO_RAMP, "Mist", "/mist.svg", "background-color:#C7C7F1;", false),                      // 6
  Output(FAN_IO, ID_FAN, MODE_ANALOG_RAMP, "Fan", "/fan.svg", "background-color:#C7C7F1;", false),                      // 7
  Output(AUX_IO, ID_AUX, MODE_ANALOG_RAMP, "AUX", "/aux.svg", "background-color:#C7C7F1;", false)                       // 8
};

static uint8_t nextLedcChannel = 0;

uint8_t allocateLedcChannel() {
  if (nextLedcChannel >= 8) {
    Serial.println("ERROR: No LEDC channels left!");
    return 255;  // invalid
  }
  return nextLedcChannel++;
}



void initLEDC() {
  // 1) Reconfigure timers (same as initLEDC)
  ledc_timer_config_t timerBase = {
    .speed_mode = LEDC_MODE,
    .duty_resolution = LEDC_RESOLUTION,
    .timer_num = LEDC_TIMER_BASE,
    .freq_hz = LEDC_BASE_FREQ,
    .clk_cfg = LEDC_AUTO_CLK
  };
  ledc_timer_config(&timerBase);

  ledc_timer_config_t timerSoft = {
    .speed_mode = LEDC_MODE,
    .duty_resolution = LEDC_RESOLUTION,
    .timer_num = LEDC_TIMER_SOFTSTART,
    .freq_hz = LEDC_SOFTSTART_FREQ,
    .clk_cfg = LEDC_AUTO_CLK
  };
  ledc_timer_config(&timerSoft);
  nextLedcChannel = 0;
  // 2) Reconfigure all LEDC channels for every Output that uses PWM
  for (int i = 0; i < OUTPUT_COUNT; i++) {
    Output &o = OUT[i];

    if (o.mode == MODE_NO_RAMP) {
      // pure digital, skip LEDC
      pinMode(o.gpio, OUTPUT);
      digitalWrite(o.gpio, LOW);
      continue;
    }

    // If channel was never allocated, allocate now
    if (o.ledcChannel == 100 || o.ledcChannel == 255) {
      o.ledcChannel = allocateLedcChannel();
    }

    ledc_timer_t timerSel =
      (o.mode == MODE_SOFTSTART)
        ? LEDC_TIMER_SOFTSTART
        : LEDC_TIMER_BASE;

    ledc_channel_config_t ch = {
      .gpio_num = o.gpio,
      .speed_mode = LEDC_MODE,
      .channel = (ledc_channel_t)o.ledcChannel,
      .intr_type = LEDC_INTR_DISABLE,
      .timer_sel = timerSel,
      .duty = 0,
      .hpoint = 0
    };
    ledc_channel_config(&ch);
  }
}



// -----------------------------
// LEDC initialization
// -----------------------------
/*

*/

void Output::disableLoop() {
  loopState = LOOP_IDLE;
  onSeconds = 0;
  offSeconds = 0;
  remaining = 0;
}

Output::Output(uint8_t pin,
               uint8_t ch,
               OutputMode m,
               const String &lbl,
               const String &iconFile,
               const String &bgStyle,
               bool invertFlag,
               uint32_t rampDefault)
  : gpio(pin),
    ledcChannel(100),
    id(ch),
    mode(m),
    label(lbl),
    icon(iconFile),
    style(bgStyle),
    invert(invertFlag),
    current(0),
    target(0),
    delta(0),
    ramping(false),
    rampMs(rampDefault),
    riseMs(0),
    fallMs(0),
    onSeconds(0),
    offSeconds(0),
    loopState(LOOP_IDLE),
    remaining(0),
    remainingRampSeconds(0),
    rampEndEpoch(0),
    nextDailyEpoch(0),
  changed(true) {
    if (mode == MODE_NO_RAMP) {
      pinMode(gpio, OUTPUT);
      digitalWrite(gpio, LOW);
    } else {
      ledcChannel = 255;
    }
 //   int freq = (mode == MODE_SOFTSTART) ? LEDC_BASE_FREQ : LEDC_LOW_FREQ;
  //   ledcAttach(gpio, freq, LEDC_RESOLUTION);
}

void Output::reset() {
  // Stop custom loop
  disableLoop();

  // Stop ramping
  ramping = false;
  delta = 0;

  // Reset timing
  remaining = 0;
  nextDailyEpoch = 0;

  // Reset values
  current = 0;
  target = 0;

  // Write hardware immediately
  writePWM(0);

  // Mark for dashboard update
  changed = true;
}

void Output::writePWM(int value) {
  if (mode == MODE_NO_RAMP) {
    // Simple ON/OFF
    digitalWrite(gpio, value);
    current = (value > 0 ? 255 : 0);
    target = current;
    return;
  }
  // PWM path for all other modes
  if (value < 0) value = 0;
  if (value > 255) value = 255;
  ledc_set_duty(LEDC_HIGH_SPEED_MODE, (ledc_channel_t)ledcChannel, value);
  ledc_update_duty(LEDC_HIGH_SPEED_MODE, (ledc_channel_t)ledcChannel);
}

//------------------------------
// Loop engine
//------------------------------

void Output::enableLoop(uint16_t onSec, uint16_t offSec, uint8_t duty) {
  loopState = LOOP_ON;

  onSeconds = onSec;
  offSeconds = offSec;
  target = duty;
  setTarget(duty);
  remaining = onSeconds;
  changed = true;
}

void Output::setTarget(int value) {
  if (value < 0) value = 0;
  if (value > 255) value = 255;
  if (target == value) {
    ramping = false;
    delta = 0;
    return;
  }

  target = value;
  changed = true;

  switch (mode) {

    case MODE_NO_RAMP:
      current = (value > 0 ? 255 : 0);
      target = current;
      writePWM(current);
      ramping = false;
      return;

    case MODE_ANALOG_DIRECT:
      current = target;
      writePWM(current);
      ramping = false;
      break;

    case MODE_ANALOG_RAMP:
    case MODE_SOFTSTART:
      {
        float diff = target - current;
        int duration = rampMs;  // ms

        if (duration > 0) {
          float seconds = duration / 1000.0f;
          float ticksPerSecond = 1000.0f / 50.0f;  // 50 ms ticker → 20 ticks/sec
          float totalTicks = seconds * ticksPerSecond;

          if (totalTicks < 1.0f) totalTicks = 1.0f;
          delta = diff / totalTicks;  // <-- value per tick now
          ramping = true;

          uint32_t sec = duration / 1000;
          if (sec == 0) sec = 1;
          rampEndEpoch = NOW_EPOCH + sec;
          remainingRampSeconds = sec;
        } else {
          current = target;
          writePWM((int)current);
          ramping = false;
          delta = 0;
        }
        break;
      }
  }
}
void Output::update() {
  if (mode == MODE_NO_RAMP) {
    // Nothing to update, ON/OFF already handled
    return;
  }
  // 1. Update custom loop
  //  updateLoop(NOW_EPOCH);
  // Update ramp countdown
  if (ramping) {
    if (rampEndEpoch > NOW_EPOCH)
      remainingRampSeconds = rampEndEpoch - NOW_EPOCH;
    else
      remainingRampSeconds = 0;
  }

  // 2. Apply ramping if active
  if (ramping) {
    current += delta;

    if ((delta > 0 && current >= target) || (delta < 0 && current <= target)) {
      current = target;
      ramping = false;
      delta = 0;
      remainingRampSeconds = 0;
      rampEndEpoch = 0;
    }

    writePWM((int)current);
    changed = true;
    return;
  }

  // 3. Direct mode (no ramp)
  if (current != target) {
    current = target;
    writePWM(current);
    changed = true;
  }
}


static int outIndex = 0;

void updateOutputs() {
  static int outIndex = 0;

  OUT[outIndex].update();

  outIndex++;
  if (outIndex >= OUTPUT_COUNT)
    outIndex = 0;
}

void resetOutputs() {
  for (int ch = 0; ch < OUTPUT_COUNT; ch++) {
    OUT[ch].reset();
  }
}

Ticker outputsTicker;

extern AsyncWebServer server;  // HTTP port

void serializeOutput(JsonObject obj, const Output &o) {
  obj["id"] = o.id;
  obj["label"] = o.label;
  obj["mode"] = o.modeStr();
  obj["icon"] = o.icon;
  obj["style"] = o.style;
  obj["invert"] = o.invert;
  obj["rampDefault"] = o.rampMs;
  obj["remaining"] = o.remaining;
}


void setupOutputs() {
  server.on("/api/outputs", HTTP_GET, [](AsyncWebServerRequest *req) {
    StaticJsonDocument<2048> doc;
    JsonArray arr = doc.createNestedArray("outputs");

    for (int i = 0; i < OUTPUT_COUNT; i++) {
      JsonObject o = arr.createNestedObject();
      serializeOutput(o, OUT[i]);

      // Capability flags (still needed by frontend)
      o["supportsDuty"] = (OUT[i].mode != MODE_NO_RAMP);
      o["supportsRamp"] = (OUT[i].mode == MODE_ANALOG_RAMP);
      o["supportsSoftstart"] = (OUT[i].mode == MODE_SOFTSTART);
    }

    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  });
  outputsTicker.attach_ms(50, []() {
    updateOutputs();
  });
}
