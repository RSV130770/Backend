#include "playground.h"
extern Output OUT[OUTPUT_COUNT];
extern AsyncWebServer server;


//handle outputs patams
void handlePlaygroundParams(AsyncWebServerRequest *req, uint8_t *data, size_t len) {
  StaticJsonDocument<256> doc;

  //---
  // 0. Parse JSON body
  //---
  DeserializationError err = deserializeJson(doc, data, len);
  if (err) {
    req->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
    return;
  }

  //---
  // 1. Validate channel ID
  //---
  int id = doc["id"] | -1;
  if (id < 0 || id >= OUTPUT_COUNT) {
    req->send(400, "application/json", "{\"error\":\"Invalid ID\"}");
    return;
  }

  Output &ch = OUT[id];
  
  //---
  // 2. Apply rise/fall times (ms)
  //---
  if (doc.containsKey("rise")) {
    ch.riseMs = doc["rise"].as<uint32_t>();
  }

  if (doc.containsKey("fall")) {
    ch.fallMs = doc["fall"].as<uint32_t>();
  }

  //---
  // 3. Apply loop engine parameters (seconds)
  //---
  if (doc.containsKey("on")) {
    ch.onSeconds = doc["on"].as<uint32_t>();
  }

  if (doc.containsKey("off")) {
    ch.offSeconds = doc["off"].as<uint32_t>();
  }

  //---
  // 4. Mark output as changed
  //---
  ch.changed = true;

  //---
  // 5. Respond
  //---
  req->send(200, "application/json", "{\"status\":\"OK\"}");
}
//handle output manipulations
void handlePlaygroundControl(AsyncWebServerRequest *req, uint8_t *data, size_t len) {
  StaticJsonDocument<128> doc;

  if (deserializeJson(doc, data, len)) {
    req->send(400, "application/json", "{\"error\":\"Bad JSON\"}");
    Serial.println("Bad JSON");
    return;
  }
  int id = doc["id"] | -1;
  if (id < 0 || id >= OUTPUT_COUNT) {
    req->send(400, "application/json", "{\"error\":\"Invalid ID\"}");
    Serial.println("Invalid ID");
    return;
  }

  int dutyPct = doc["duty"] | -1;
  if (dutyPct < 0 || dutyPct > 100) {
    req->send(400, "application/json", "{\"error\":\"Invalid duty\"}");
    Serial.print("Invalid duty");
    Serial.println(dutyPct);

    return;
  }

  String source = doc["source"] | "slider";
  uint8_t duty255 = (dutyPct * 255) / 100;

  Output &ch = OUT[id];

  // Playground disables loop completely
  ch.disableLoop();

  //---
  // SLIDER = direct manual override
  //---
  if (source == "slider") {
    // Stop ramp
    ch.ramping = false;
    ch.delta = 0;
    ch.remainingRampSeconds = 0;
    ch.rampEndEpoch = 0;

    // Override target + current
    ch.target = duty255;
    ch.current = duty255;
    ch.writePWM(duty255);

    ch.changed = true;
    req->send(200, "application/json", "{\"status\":\"OK\"}");
    return;
  }

  //---
  // ON/OFF BUTTONS → use ramp logic but still keep target in sync
  //---
  switch (ch.mode) {

    case MODE_SOFTSTART:
      ch.ramping = true;
      ch.rampMs = ch.riseMs;
      ch.setTarget(duty255);
      Serial.print("Button SOFTSTART Val= ");
      Serial.println(duty255);
      break;

    case MODE_ANALOG_RAMP:
      ch.ramping = true;
      if (duty255 > ch.current) {
        ch.rampMs = ch.riseMs;
      } else {
        ch.rampMs = ch.fallMs;
      }
      ch.setTarget(duty255);
      break;

    case MODE_ANALOG_DIRECT:
    case MODE_NO_RAMP:
    default:
      ch.ramping = false;
      ch.target = duty255;
      ch.current = duty255;
      ch.writePWM(duty255);
      Serial.print("Button MODE_NO_RAMP Val= ");
      Serial.println(duty255);
      break;
  }

  ch.changed = true;
  req->send(200, "application/json", "{\"status\":\"OK\"}");
}
void setupPlayground() {
  // Playground: direct output control
  server.on(
    "/playground/control", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index, size_t total) {
      handlePlaygroundControl(req, data, len);
    });

  // Playground: output parameters
  server.on(
    "/playground/params", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index, size_t total) {
      handlePlaygroundParams(req, data, len);
    });
}