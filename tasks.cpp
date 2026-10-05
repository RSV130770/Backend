#include "tasks.h"
#include "scheduler.h"

extern Output OUT[OUTPUT_COUNT];
extern AsyncWebServer server;

// -------------------------
// Helpers
// -------------------------

String formatStartTime() {
  if (TASK_STATUS == T_STOP) return "";
  char buf[32];
  snprintf(buf, sizeof(buf), "%04u-%02u-%02u %02u:%02u",
           START_YEAR + 2000, START_MONTH, START_DAY,
           START_HOUR, START_MIN);
  return String(buf);
}

String taskStatusToString() {
  switch (TASK_STATUS) {
    case T_START:  return "running";
    case T_PAUSE:  return "paused";
    case T_FROZEN: return "frozen";
    case T_STOP:
    default:       return "stopped";
  }
}

void deleteEvents() {
  for (auto *ev : EVENTS) delete ev;
  EVENTS.clear();
  Serial.println("All EVENTS cleared");
}

// -------------------------
// Preset file I/O
// -------------------------

bool savePresetToFile(const JsonObject& preset) {
  uint8_t id = preset["id"] | 0;

  char path[32];
  snprintf(path, sizeof(path), "/preset_%03u.json", id);

  // Serialize to buffer for CRC
  size_t jsonSize = measureJson(preset);
  std::vector<uint8_t> buf(jsonSize);
  serializeJson(preset, buf.data(), jsonSize);

  File f = SPIFFS.open(path, "w");
  if (!f) {
    Serial.printf("savePresetToFile: cannot open %s\n", path);
    return false;
  }
  f.write(buf.data(), jsonSize);
  f.close();

  Serial.printf("Preset %u saved (%u bytes)\n", id, jsonSize);
  return true;
}

bool loadPresetFromFile(uint8_t id, DynamicJsonDocument& doc) {
  char path[32];
  snprintf(path, sizeof(path), "/preset_%03u.json", id);

  File f = SPIFFS.open(path, "r");
  if (!f) {
    Serial.printf("loadPresetFromFile: cannot open %s\n", path);
    return false;
  }

  DeserializationError err = deserializeJson(doc, f);
  f.close();

  if (err) {
    Serial.printf("loadPresetFromFile: parse error %s\n", err.c_str());
    return false;
  }
  return true;
}

// -------------------------
// Start from preset
// -------------------------

bool startFromPreset(uint8_t id) {
  DynamicJsonDocument doc(8192);
  if (!loadPresetFromFile(id, doc)) return false;

  deleteEvents();
  buildEventsFromPreset(doc.as<JsonObject>());

  if (EVENTS.empty()) {
    Serial.println("startFromPreset: no events built");
    return false;
  }

  PRESET_ID   = id;
  TASK_STATUS = T_START;

  updateNow();
  PutStartTimetoRtc(NOW);
  saveTaskData();
  schedulerStart();

  Serial.printf("Started preset %u (%u events)\n", id, EVENTS.size());
  return true;
}

// -------------------------
// Default task fallback
// -------------------------

void loadDefaultTask() {
  Serial.println("loadDefaultTask: loading preset_000");
  DynamicJsonDocument doc(8192);
  if (loadPresetFromFile(0, doc)) {
    buildEventsFromPreset(doc.as<JsonObject>());
    Serial.printf("Default preset loaded (%u events)\n", EVENTS.size());
  } else {
    Serial.println("loadDefaultTask: preset_000 missing");
  }
}

// -------------------------
// Boot recovery
// -------------------------

void TryTaskStart() {
  Serial.println("TryTaskStart start");
  loadTaskData();

  uint8_t id     = PRESET_ID;
  uint8_t status = TASK_STATUS;

  Serial.printf("TryTaskStart: PRESET_ID=%u TASK_STATUS=%u\n", id, status);

  if (status == T_START || status == T_FROZEN || status == T_PAUSE) {
    Serial.printf("TryTaskStart: recovering preset %u\n", id);
    if (id == 0) {
      loadDefaultTask();
    } else {
      if (!startFromPreset(id)) {
        Serial.println("TryTaskStart: recovery failed → load default");
        loadDefaultTask();
        PRESET_ID   = 0;
        TASK_STATUS = T_STOP;
        saveTaskData();
        return;
      }
    }
    // Restore paused/frozen state — don't re-start ticker
    if (status == T_PAUSE || status == T_FROZEN) {
      schedulerTicker.detach();
      TASK_STATUS = status;
      Serial.printf("TryTaskStart: restored to %s\n",
                    taskStatusToString().c_str());
    }
  } else {
    // Stopped — just load default events into memory, don't start
    loadDefaultTask();
  }

  Serial.println("TryTaskStart done");
}

// -------------------------
// Handlers
// -------------------------

void handlePresetSave(AsyncWebServerRequest *req, uint8_t *data, size_t len) {
  Serial.println("handlePresetSave start");

  StaticJsonDocument<8192> doc;
  if (deserializeJson(doc, data, len)) {
    req->send(400, "application/json", "{\"error\":\"invalid json\"}");
    return;
  }

  // Validate CRC
  JsonObject preset  = doc["preset"].as<JsonObject>();
  uint16_t   rxCrc   = doc["crc"] | 0;

  if (preset.isNull()) {
    req->send(400, "application/json", "{\"error\":\"missing preset\"}");
    return;
  }

  size_t jsonSize = measureJson(preset);
  std::vector<uint8_t> buf(jsonSize);
  serializeJson(preset, buf.data(), jsonSize);
  uint16_t calcCrc = crc16(buf.data(), jsonSize);

  if (calcCrc != rxCrc) {
    Serial.printf("handlePresetSave: CRC mismatch calc=%u rx=%u\n",
                  calcCrc, rxCrc);
    req->send(400, "application/json", "{\"error\":\"crc mismatch\"}");
    return;
  }

  if (!savePresetToFile(preset)) {
    req->send(500, "application/json", "{\"error\":\"save failed\"}");
    return;
  }

  uint8_t id = preset["id"] | 0;
  StaticJsonDocument<128> resp;
  resp["status"] = "saved";
  resp["id"]     = id;

  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
  Serial.println("handlePresetSave done");
}

void handlePresetStart(AsyncWebServerRequest *req, uint8_t *data, size_t len) {
  Serial.println("handlePresetStart start");

  StaticJsonDocument<64> doc;
  if (deserializeJson(doc, data, len)) {
    req->send(400, "application/json", "{\"error\":\"invalid json\"}");
    return;
  }

  uint8_t id = doc["id"] | 0;

  if (TASK_STATUS != T_STOP) schedulerStop();

  if (!startFromPreset(id)) {
    req->send(404, "application/json", "{\"error\":\"preset not found\"}");
    return;
  }

  StaticJsonDocument<512> resp;
  resp["status"]    = taskStatusToString();
  resp["startTime"] = formatStartTime();
  resp["presetId"]  = id;
  fillDashboardState(resp);

  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
  Serial.println("handlePresetStart done");
}

void handlePresetStop(AsyncWebServerRequest *req) {
  Serial.println("handlePresetStop start");

  schedulerStop();
  PRESET_ID = 0;
  ClearStartTimeInRtc();

  StaticJsonDocument<256> resp;
  resp["status"]    = taskStatusToString();
  resp["startTime"] = "";
  resp["message"]   = "preset stopped";

  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
  Serial.println("handlePresetStop done");
}

void handlePresetPause(AsyncWebServerRequest *req) {
  if (TASK_STATUS != T_START) {
    req->send(400, "application/json", "{\"error\":\"not running\"}");
    return;
  }

  schedulerPause();

  StaticJsonDocument<512> resp;
  resp["status"]    = taskStatusToString();
  resp["startTime"] = formatStartTime();
  fillDashboardState(resp);

  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
}

void handlePresetResume(AsyncWebServerRequest *req) {
  if (TASK_STATUS != T_PAUSE && TASK_STATUS != T_FROZEN) {
    req->send(400, "application/json", "{\"error\":\"not paused\"}");
    return;
  }

  schedulerResume();

  StaticJsonDocument<512> resp;
  resp["status"]    = taskStatusToString();
  resp["startTime"] = formatStartTime();
  fillDashboardState(resp);

  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
}

void handlePresetContent(AsyncWebServerRequest *req) {
  if (!req->hasParam("id")) {
    req->send(400, "application/json", "{\"error\":\"missing id\"}");
    return;
  }

  uint8_t id = req->getParam("id")->value().toInt();

  DynamicJsonDocument doc(8192);
  if (!loadPresetFromFile(id, doc)) {
    req->send(404, "application/json", "{\"error\":\"preset not found\"}");
    return;
  }

  String out;
  serializeJson(doc, out);
  req->send(200, "application/json", out);
}

void handlePresetList(AsyncWebServerRequest *req) {
  Serial.println("handlePresetList start");

  StaticJsonDocument<4096> doc;
  JsonArray arr = doc.createNestedArray("presets");

  for (uint16_t id = 0; id <= 255; id++) {
    char path[32];
    snprintf(path, sizeof(path), "/preset_%03u.json", id);
    if (!SPIFFS.exists(path)) continue;

    File f = SPIFFS.open(path, "r");
    if (!f) continue;

    StaticJsonDocument<512> meta;
    DeserializationError err = deserializeJson(meta, f);
    f.close();
    if (err) continue;

    JsonObject o      = arr.createNestedObject();
    o["id"]           = meta["id"]                | id;
    o["name"]         = meta["name"]              | "";
    o["nameRu"]       = meta["nameRu"]            | "";
    o["latin"]        = meta["latin"]             | "";
    o["category"]     = meta["category"]          | "";
    o["totalDays"]    = meta["totalDays"]         | 0;
    o["difficulty"]   = meta["difficulty"]        | "";
    o["recommendedMethod"] = meta["recommendedMethod"] | "";
    o["builtIn"]      = meta["builtIn"]           | false;
    o["germinationDays"] = meta["germinationDays"]| 0;
  }

  // Current running preset info
  JsonObject cur   = doc.createNestedObject("current");
  cur["presetId"]  = PRESET_ID;
  cur["status"]    = taskStatusToString();
  cur["startTime"] = formatStartTime();

  String out;
  serializeJson(doc, out);
  req->send(200, "application/json", out);
  Serial.println("handlePresetList done");
}

void handleApiState(AsyncWebServerRequest *req) {
  StaticJsonDocument<1024> resp;
  fillDashboardState(resp);
  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
}

// -------------------------
// Setup
// -------------------------

void setupTasks() {
  server.on("/api/state", HTTP_GET,
    [](AsyncWebServerRequest *req) { handleApiState(req); });

  server.on("/preset/list", HTTP_GET,
    [](AsyncWebServerRequest *req) { handlePresetList(req); });

  server.on("/preset/content", HTTP_GET,
    [](AsyncWebServerRequest *req) { handlePresetContent(req); });

  server.on("/preset/save", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len,
       size_t index, size_t total) {
      handlePresetSave(req, data, len);
    });

  server.on("/preset/start", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len,
       size_t index, size_t total) {
      handlePresetStart(req, data, len);
    });

  server.on("/preset/pause", HTTP_POST,
    [](AsyncWebServerRequest *req) { handlePresetPause(req); });

  server.on("/preset/resume", HTTP_POST,
    [](AsyncWebServerRequest *req) { handlePresetResume(req); });

  server.on("/preset/stop", HTTP_POST,
    [](AsyncWebServerRequest *req) { handlePresetStop(req); });
}