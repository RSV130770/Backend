#include "tasks.h"
#include "scheduler.h"

extern Output OUT[OUTPUT_COUNT];
extern AsyncWebServer server;

// Implemented in site.cpp: true if this request comes from the control
// session owner; otherwise it has already answered 403.
bool requireSession(AsyncWebServerRequest *req);

// Room for a preset file in RAM. A schedule made in the web editor has
// roughly 400 bytes per event, so this covers about 60 events.
static const size_t PRESET_DOC_SIZE = 24576;

// Largest POST body accepted (a preset with its schedule)
static const size_t MAX_BODY_SIZE = 16384;

// =========================================================
// BUILT-IN TEMPLATE (preset 0, "Default")
// It is written to /preset_000.json by ensureDefaultPreset() whenever the
// file is missing or differs from this definition, so it can never be lost.
// Users cannot overwrite or delete it; "Save" in the web editor always
// creates a new preset from it.
// =========================================================

static const char *TPL_LIGHT_ON   = "06:30";
static const char *TPL_LIGHT_OFF  = "22:30";
static const uint8_t TPL_LIGHT_PCT = 50;       // all lights, percent
static const uint32_t TPL_LIGHT_RAMP_MS = 120000;  // 2 min up and down
static const uint32_t TPL_PUMP_ON_SEC  = 10;       // pump runs 10 s ...
static const uint32_t TPL_PUMP_OFF_SEC = 60 * 60;  // ... then rests 60 min

// One event in the web editor's format (see MachineEvent::fromJson)
static JsonObject addTemplateEvent(JsonArray arr, uint8_t group, uint8_t ch,
                                   const char *repeat, const char *time,
                                   uint8_t pct, uint32_t riseMs, uint32_t fallMs) {
  JsonObject e = arr.createNestedObject();
  e["groupId"]         = group;
  e["channelId"]       = ch;
  e["time"]            = time;
  e["afterDays"]       = 0;      // starts on the day the preset is started
  e["expireAfterDays"] = 0;      // never expires
  e["repeat"]          = repeat;
  e["duty"]            = pct;
  e["rise"]            = riseMs;
  e["fall"]            = fallMs;
  e["on"]              = 0;
  e["off"]             = 0;
  e["enabled"]         = true;
  return e;
}

static String buildTemplateJson() {
  DynamicJsonDocument doc(8192);
  doc["id"]      = 0;
  doc["name"]    = "Default";
  doc["builtIn"] = true;
  JsonArray s = doc.createNestedArray("schedule");

  // Group 1: all lights, daily on/off with a ramp
  const uint8_t lights[] = { ID_WHITE, ID_RED, ID_BLUE, ID_UV, ID_FARR };
  for (uint8_t ch : lights) {
    addTemplateEvent(s, 1, ch, "daily", TPL_LIGHT_ON,  TPL_LIGHT_PCT,
                     TPL_LIGHT_RAMP_MS, TPL_LIGHT_RAMP_MS);
    addTemplateEvent(s, 1, ch, "daily", TPL_LIGHT_OFF, 0,
                     TPL_LIGHT_RAMP_MS, TPL_LIGHT_RAMP_MS);
  }

  // Group 2: pump cycle, starts as soon as the preset starts ("--:--")
  JsonObject p = addTemplateEvent(s, 2, ID_PUMP, "custom", "--:--", 100, 0, 0);
  p["on"]  = TPL_PUMP_ON_SEC;
  p["off"] = TPL_PUMP_OFF_SEC;

  String out;
  serializeJson(doc, out);
  return out;
}

// -------------------------
// Helpers
// -------------------------

static void presetPath(uint8_t id, char *buf, size_t n) {
  snprintf(buf, n, "/preset_%03u.json", id);
}

static void sendError(AsyncWebServerRequest *req, int code, const char *msg) {
  String body = String("{\"error\":\"") + msg + "\"}";
  req->send(code, "application/json", body);
}

// A POST body can arrive in several TCP chunks. Collect them in a buffer
// owned by the request (freed automatically with the request).
// Returns the complete body once the last chunk is in, otherwise nullptr.
static uint8_t *collectBody(AsyncWebServerRequest *req, uint8_t *data,
                            size_t len, size_t index, size_t total) {
  if (total > MAX_BODY_SIZE) {
    if (index + len == total) sendError(req, 413, "body too large");
    return nullptr;
  }
  if (index == 0) {
    if (req->_tempObject) free(req->_tempObject);
    req->_tempObject = malloc(total + 1);
  }
  uint8_t *buf = (uint8_t *)req->_tempObject;
  if (buf) memcpy(buf + index, data, len);
  if (index + len != total) return nullptr;      // more chunks to come
  if (!buf) {
    sendError(req, 500, "out of memory");
    return nullptr;
  }
  buf[total] = 0;
  return buf;
}

// Start time of the current preset, as saved in the RTC memory
static uint32_t storedStartEpoch() {
  if (START_MONTH < 1 || START_MONTH > 12 || START_DAY < 1) return 0;
  tm t = {};
  t.tm_year  = (int)START_YEAR + 100;   // START_YEAR is years since 2000
  t.tm_mon   = (int)START_MONTH - 1;
  t.tm_mday  = START_DAY;
  t.tm_hour  = START_HOUR;
  t.tm_min   = START_MIN;
  t.tm_isdst = 0;
  return (uint32_t)mktime(&t);
}

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

// Writes the built-in template if /preset_000.json is missing or outdated
void ensureDefaultPreset() {
  const char *path = "/preset_000.json";
  String tpl = buildTemplateJson();

  if (SPIFFS.exists(path)) {
    File f = SPIFFS.open(path, "r");
    if (f) {
      bool same = (f.size() == tpl.length()) && (f.readString() == tpl);
      f.close();
      if (same) return;
    }
  }

  File f = SPIFFS.open(path, "w");
  if (!f) {
    Serial.println("ensureDefaultPreset: cannot write template");
    return;
  }
  f.print(tpl);
  f.close();
  Serial.printf("Default template written (%u bytes)\n", tpl.length());
}

bool savePresetToFile(const JsonObject& preset) {
  uint8_t id = preset["id"] | 0;

  char path[32];
  presetPath(id, path, sizeof(path));

  File f = SPIFFS.open(path, "w");
  if (!f) {
    Serial.printf("savePresetToFile: cannot open %s\n", path);
    return false;
  }
  size_t written = serializeJson(preset, f);
  f.close();

  Serial.printf("Preset %u saved (%u bytes)\n", id, written);
  return written > 0;
}

bool loadPresetFromFile(uint8_t id, DynamicJsonDocument& doc) {
  if (id == 0) ensureDefaultPreset();

  char path[32];
  presetPath(id, path, sizeof(path));

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

// First unused preset number (1..255), 0 if all are taken
static uint8_t findFreePresetId() {
  char path[32];
  for (uint16_t id = 1; id <= 255; id++) {
    presetPath(id, path, sizeof(path));
    if (!SPIFFS.exists(path)) return id;
  }
  return 0;
}

// -------------------------
// Start from preset
// -------------------------

// recover = false: a new start, the start time is "now".
// recover = true : continue a preset that was already running (after a
//                  reboot or after its schedule was edited), keeping its
//                  original start time so day counters do not restart.
bool startFromPreset(uint8_t id, bool recover) {
  DynamicJsonDocument doc(PRESET_DOC_SIZE);
  if (!loadPresetFromFile(id, doc)) return false;

  deleteEvents();
  buildEventsFromPreset(doc.as<JsonObject>());

  if (EVENTS.empty()) {
    Serial.println("startFromPreset: no events built");
    return false;
  }

  PRESET_ID = id;
  updateNow();

  if (recover) {
    uint32_t startEpoch = storedStartEpoch();
    if (startEpoch == 0 || startEpoch > NOW_EPOCH) startEpoch = NOW_EPOCH;
    schedulerStartAt(startEpoch, true);
  } else {
    TASK_STATUS = T_START;
    PutStartTimetoRtc(NOW);
    saveTaskData();
    schedulerStart();
  }

  Serial.printf("%s preset %u (%u events)\n",
                recover ? "Recovered" : "Started", id, EVENTS.size());
  return true;
}

// Re-run the current preset with its original start time and restore the
// paused/frozen state if it was paused.
static bool continuePreset(uint8_t id, uint8_t status) {
  if (!startFromPreset(id, true)) return false;
  if (status == T_PAUSE || status == T_FROZEN) {
    schedulerTicker.detach();
    TASK_STATUS = status;
    Serial.printf("continuePreset: restored to %s\n",
                  taskStatusToString().c_str());
  }
  return true;
}

// -------------------------
// Default task fallback
// -------------------------

// Loads the template's events into memory without starting them
void loadDefaultTask() {
  Serial.println("loadDefaultTask: loading preset_000");
  DynamicJsonDocument doc(PRESET_DOC_SIZE);
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
  ensureDefaultPreset();
  loadTaskData();

  uint8_t id     = PRESET_ID;
  uint8_t status = TASK_STATUS;

  Serial.printf("TryTaskStart: PRESET_ID=%u TASK_STATUS=%u\n", id, status);

  if (status == T_START || status == T_FROZEN || status == T_PAUSE) {
    Serial.printf("TryTaskStart: recovering preset %u\n", id);
    if (!continuePreset(id, status)) {
      Serial.println("TryTaskStart: recovery failed -> load default");
      loadDefaultTask();
      PRESET_ID   = 0;
      TASK_STATUS = T_STOP;
      saveTaskData();
    }
  } else {
    // Stopped: just load the template's events into memory, don't start
    loadDefaultTask();
  }

  Serial.println("TryTaskStart done");
}

// -------------------------
// Handlers
// -------------------------

void handlePresetSave(AsyncWebServerRequest *req, uint8_t *data, size_t len) {
  Serial.println("handlePresetSave start");

  DynamicJsonDocument doc(PRESET_DOC_SIZE);
  DeserializationError err = deserializeJson(doc, data, len);
  if (err) {
    Serial.printf("handlePresetSave: %s\n", err.c_str());
    sendError(req, 400, err == DeserializationError::NoMemory
                          ? "preset too large" : "invalid json");
    return;
  }

  JsonObject preset = doc["preset"].as<JsonObject>();
  if (preset.isNull()) {
    sendError(req, 400, "missing preset");
    return;
  }

  // CRC is optional: checked only when the client sends one
  if (doc.containsKey("crc")) {
    uint16_t rxCrc = doc["crc"] | 0;
    size_t jsonSize = measureJson(preset);
    std::vector<uint8_t> buf(jsonSize);
    serializeJson(preset, buf.data(), jsonSize);
    uint16_t calcCrc = crc16(buf.data(), jsonSize);
    if (calcCrc != rxCrc) {
      Serial.printf("handlePresetSave: CRC mismatch calc=%u rx=%u\n",
                    calcCrc, rxCrc);
      sendError(req, 400, "crc mismatch");
      return;
    }
  }

  const char *name = preset["name"] | "";
  if (!*name) {
    sendError(req, 400, "missing name");
    return;
  }
  if (strcmp(name, "Default") == 0) {
    sendError(req, 400, "name reserved for the template");
    return;
  }

  // Preset 0 is the template: saving it always creates a new preset
  uint8_t id = preset["id"] | 0;
  if (id == 0) {
    id = findFreePresetId();
    if (id == 0) {
      sendError(req, 507, "no free preset slot");
      return;
    }
  }
  preset["id"]      = id;
  preset["builtIn"] = false;

  if (!savePresetToFile(preset)) {
    sendError(req, 500, "save failed");
    return;
  }

  // The preset that is running now was edited: apply the new schedule
  // right away, keeping its start time
  if (id == PRESET_ID && TASK_STATUS != T_STOP) {
    uint8_t status = TASK_STATUS;
    if (!continuePreset(id, status))
      Serial.println("handlePresetSave: could not reload running preset");
  }

  StaticJsonDocument<192> resp;
  resp["status"] = "saved";
  resp["id"]     = id;
  resp["name"]   = name;

  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
  Serial.println("handlePresetSave done");
}

void handlePresetDelete(AsyncWebServerRequest *req, uint8_t *data, size_t len) {
  StaticJsonDocument<64> doc;
  if (deserializeJson(doc, data, len)) {
    sendError(req, 400, "invalid json");
    return;
  }

  uint8_t id = doc["id"] | 0;
  if (id == 0) {
    sendError(req, 400, "the template cannot be deleted");
    return;
  }

  char path[32];
  presetPath(id, path, sizeof(path));
  if (!SPIFFS.exists(path)) {
    sendError(req, 404, "preset not found");
    return;
  }

  // Deleting the running preset stops it first
  if (id == PRESET_ID && TASK_STATUS != T_STOP) {
    schedulerStop();
    PRESET_ID = 0;
    loadDefaultTask();
  }

  SPIFFS.remove(path);
  ensureDefaultPreset();
  Serial.printf("Preset %u deleted\n", id);

  StaticJsonDocument<128> resp;
  resp["status"] = "deleted";
  resp["id"]     = id;
  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
}

void handlePresetStart(AsyncWebServerRequest *req, uint8_t *data, size_t len) {
  Serial.println("handlePresetStart start");

  StaticJsonDocument<128> doc;
  if (deserializeJson(doc, data, len)) {
    sendError(req, 400, "invalid json");
    return;
  }

  uint8_t id = doc["id"] | 0;

  if (TASK_STATUS != T_STOP) schedulerStop();

  if (!startFromPreset(id, false)) {
    sendError(req, 404, "preset not found");
    return;
  }

  StaticJsonDocument<1024> resp;
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
    sendError(req, 400, "not running");
    return;
  }

  schedulerPause();

  StaticJsonDocument<1024> resp;
  resp["status"]    = taskStatusToString();
  resp["startTime"] = formatStartTime();
  fillDashboardState(resp);

  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
}

void handlePresetResume(AsyncWebServerRequest *req) {
  if (TASK_STATUS != T_PAUSE && TASK_STATUS != T_FROZEN) {
    sendError(req, 400, "not paused");
    return;
  }

  schedulerResume();

  StaticJsonDocument<1024> resp;
  resp["status"]    = taskStatusToString();
  resp["startTime"] = formatStartTime();
  fillDashboardState(resp);

  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
}

// Sends the preset file as it is (no parsing, so size does not matter)
void handlePresetContent(AsyncWebServerRequest *req) {
  if (!req->hasParam("id")) {
    sendError(req, 400, "missing id");
    return;
  }

  uint8_t id = req->getParam("id")->value().toInt();
  if (id == 0) ensureDefaultPreset();

  char path[32];
  presetPath(id, path, sizeof(path));
  if (!SPIFFS.exists(path)) {
    sendError(req, 404, "preset not found");
    return;
  }

  AsyncWebServerResponse *r = req->beginResponse(SPIFFS, path, "application/json");
  r->addHeader("Cache-Control", "no-store");
  req->send(r);
}

void handlePresetList(AsyncWebServerRequest *req) {
  Serial.println("handlePresetList start");
  ensureDefaultPreset();

  DynamicJsonDocument doc(8192);
  JsonArray arr = doc.createNestedArray("presets");

  // Read only the descriptive fields; the schedule itself can be large
  StaticJsonDocument<512> filter;
  const char *fields[] = { "id", "name", "nameRu", "latin", "category",
                           "totalDays", "difficulty", "recommendedMethod",
                           "builtIn", "germinationDays" };
  for (const char *k : fields) filter[k] = true;

  for (uint16_t id = 0; id <= 255; id++) {
    char path[32];
    presetPath(id, path, sizeof(path));
    if (!SPIFFS.exists(path)) continue;

    File f = SPIFFS.open(path, "r");
    if (!f) continue;

    StaticJsonDocument<1024> meta;
    DeserializationError err =
      deserializeJson(meta, f, DeserializationOption::Filter(filter));
    f.close();
    if (err) {
      Serial.printf("handlePresetList: %s: %s\n", path, err.c_str());
      continue;
    }

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
      uint8_t *body = collectBody(req, data, len, index, total);
      if (!body) return;
      if (!requireSession(req)) return;
      handlePresetSave(req, body, total);
    });

  server.on("/preset/delete", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len,
       size_t index, size_t total) {
      uint8_t *body = collectBody(req, data, len, index, total);
      if (!body) return;
      if (!requireSession(req)) return;
      handlePresetDelete(req, body, total);
    });

  server.on("/preset/start", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len,
       size_t index, size_t total) {
      uint8_t *body = collectBody(req, data, len, index, total);
      if (!body) return;
      if (!requireSession(req)) return;
      handlePresetStart(req, body, total);
    });

  server.on("/preset/pause", HTTP_POST,
    [](AsyncWebServerRequest *req) {
      if (!requireSession(req)) return;
      handlePresetPause(req);
    });

  server.on("/preset/resume", HTTP_POST,
    [](AsyncWebServerRequest *req) {
      if (!requireSession(req)) return;
      handlePresetResume(req);
    });

  server.on("/preset/stop", HTTP_POST,
    [](AsyncWebServerRequest *req) {
      if (!requireSession(req)) return;
      handlePresetStop(req);
    });
}
