#include "tasks.h"
#include "scheduler.h"
#include <algorithm>

extern Output OUT[OUTPUT_COUNT];
extern AsyncWebServer server;

// Implemented in site.cpp: true if this request comes from the control
// session owner; otherwise it has already answered 403.
bool requireSession(AsyncWebServerRequest *req);

// Room for a preset file in RAM. A schedule made in the web editor needs
// roughly 500 bytes per event once parsed; the five-stage Default (42
// events) needs about 22 KB, so this leaves room for larger presets.
static const size_t PRESET_DOC_SIZE = 32768;

// Largest POST body accepted (a preset with its schedule)
static const size_t MAX_BODY_SIZE = 16384;

// =========================================================
// BUILT-IN TEMPLATE (preset 0, "Default")
// It is written to /preset_000.json by ensureDefaultPreset() whenever the
// file is missing or differs from this definition, so it can never be lost.
// Users cannot overwrite or delete it; "Save" in the web editor always
// creates a new preset from it.
// =========================================================

// Five stages: Germination 4 d (freeze at the end), Seedling 7 d, Growth
// 21 d, Flowering 28 d (freeze at the end), Finishing (open-ended). Every
// duty value is 50 %; pump and mist are on/off. The stages also serve as
// the stage library (later: "Add stage from preset").
static const uint8_t  TPL_PCT     = 50;        // lights, UV, far-red, fan
static const uint32_t TPL_RAMP_MS = 120000;    // 2 min up and down

// One event in the web editor's format (see MachineEvent::fromJson).
// Values are numbers or string literals, so the document stores no copies.
static JsonObject tplEvent(JsonArray arr, uint8_t stage, uint8_t group,
                           const char *groupName, uint8_t ch, const char *repeat,
                           const char *time, uint8_t pct, uint32_t riseMs,
                           uint32_t fallMs, uint32_t onSec, uint32_t offSec) {
  JsonObject e = arr.createNestedObject();
  e["stageId"]         = stage;
  e["groupId"]         = group;
  e["groupName"]       = groupName;   // shown in the web editor, ignored here
  e["channelId"]       = ch;
  e["repeat"]          = repeat;
  e["time"]            = time;
  e["afterDays"]       = 0;           // from the stage's first day
  e["expireAfterDays"] = 0;           // until the stage ends
  e["duty"]            = pct;
  e["rise"]            = riseMs;
  e["fall"]            = fallMs;
  e["on"]              = onSec;
  e["off"]             = offSec;
  e["enabled"]         = true;
  return e;
}

// Lights of a group: daily on at onTime, off at offTime, with ramps
static void tplLights(JsonArray s, uint8_t stage, uint8_t &group, const char *name,
                      const uint8_t *chans, size_t n, const char *onTime, const char *offTime) {
  group++;
  for (size_t i = 0; i < n; i++) {
    tplEvent(s, stage, group, name, chans[i], "daily", onTime,  TPL_PCT, TPL_RAMP_MS, TPL_RAMP_MS, 0, 0);
    tplEvent(s, stage, group, name, chans[i], "daily", offTime, 0,       TPL_RAMP_MS, TPL_RAMP_MS, 0, 0);
  }
}

// A cycle from the stage start ("--:--"): on for onSec, then off for offSec
static void tplCycle(JsonArray s, uint8_t stage, uint8_t &group, const char *name,
                     uint8_t ch, uint32_t onSec, uint32_t offSec) {
  tplEvent(s, stage, ++group, name, ch, "custom", "--:--", 100,
           ch == ID_PUMP ? 500 : 0, 0, onSec, offSec);
}

// A steady level for the whole stage (once at 00:00 of day 0 = stage start)
static void tplSteady(JsonArray s, uint8_t stage, uint8_t &group, const char *name, uint8_t ch) {
  tplEvent(s, stage, ++group, name, ch, "once", "00:00", TPL_PCT, TPL_RAMP_MS, 0, 0, 0);
}

static void tplStage(JsonArray st, uint8_t id, const char *name, uint8_t days,
                     bool endPause, const char *message) {
  JsonObject o = st.createNestedObject();
  o["id"]       = id;
  o["name"]     = name;
  o["days"]     = days;
  o["hours"]    = 0;
  o["endPause"] = endPause;
  o["message"]  = message;
}

static String buildTemplateJson() {
  DynamicJsonDocument doc(PRESET_DOC_SIZE);
  doc["id"]      = 0;
  doc["name"]    = "Default";
  doc["builtIn"] = true;

  JsonArray st = doc.createNestedArray("stages");
  tplStage(st, 1, "Germination", 4,  true,  "Remove the covers");
  tplStage(st, 2, "Seedling",    7,  false, "");
  tplStage(st, 3, "Growth",      21, false, "");
  tplStage(st, 4, "Flowering",   28, true,  "Check the plants before finishing");
  tplStage(st, 5, "Finishing",   0,  false, "");

  JsonArray s = doc.createNestedArray("schedule");
  uint8_t g = 0;
  const uint8_t wbr[] = { ID_WHITE, ID_BLUE, ID_RED };
  const uint8_t wrb[] = { ID_WHITE, ID_RED, ID_BLUE };
  const uint8_t all[] = { ID_WHITE, ID_RED, ID_BLUE, ID_UV, ID_FARR };

  // 1 Germination: dark; pump 10 s / 60 min, mist 30 s / 30 min
  tplCycle(s, 1, g, "Pump", ID_PUMP, 10, 3600);
  tplCycle(s, 1, g, "Mist", ID_MIST, 30, 1800);

  // 2 Seedling: 16 h light; pump 10 s / 60 min; fan
  tplLights(s, 2, g, "Light", wbr, 3, "06:00", "22:00");
  tplCycle(s, 2, g, "Pump", ID_PUMP, 10, 3600);
  tplSteady(s, 2, g, "Fan", ID_FAN);

  // 3 Growth: 16 h light, UV 10:00-12:00; pump 10 s / 45 min; fan
  tplLights(s, 3, g, "Light", wbr, 3, "06:00", "22:00");
  const uint8_t uv[] = { ID_UV };
  tplLights(s, 3, g, "UV", uv, 1, "10:00", "12:00");
  tplCycle(s, 3, g, "Pump", ID_PUMP, 10, 2700);
  tplSteady(s, 3, g, "Fan", ID_FAN);

  // 4 Flowering: 12 h light, far-red 20:00-20:15; pump 10 s / 45 min; fan
  tplLights(s, 4, g, "Light", wrb, 3, "08:00", "20:00");
  const uint8_t fr[] = { ID_FARR };
  tplLights(s, 4, g, "Far-red", fr, 1, "20:00", "20:15");
  tplCycle(s, 4, g, "Pump", ID_PUMP, 10, 2700);
  tplSteady(s, 4, g, "Fan", ID_FAN);

  // 5 Finishing (open-ended): all lights 06:30-22:30; pump 10 s / 60 min;
  // the harvest message on day 0 at 09:00 (its sound comes with the Sound
  // output)
  tplLights(s, 5, g, "Light", all, 5, "06:30", "22:30");
  tplCycle(s, 5, g, "Pump", ID_PUMP, 10, 3600);
  JsonObject m = tplEvent(s, 5, ++g, "Harvest", ID_MESSAGE, "once", "09:00", 100, 0, 0, 0, 0);
  m["message"] = "Ready to harvest";

  if (doc.overflowed()) Serial.println("buildTemplateJson: document too small");
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
    case T_FINISHED: return "finished";
    case T_STOP:
    default:       return "stopped";
  }
}

void deleteEvents() {
  schedulerForgetEvents();      // the scheduler keeps pointers into EVENTS
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

  // The full comparison (build + read ~2 KB) runs once per boot; after that
  // only a missing file is recreated. This keeps the web handlers light.
  static bool checked = false;
  if (checked && SPIFFS.exists(path)) return;

  String tpl = buildTemplateJson();

  if (SPIFFS.exists(path)) {
    File f = SPIFFS.open(path, "r");
    if (f) {
      bool same = (f.size() == tpl.length()) && (f.readString() == tpl);
      f.close();
      if (same) { checked = true; return; }
    }
  }

  File f = SPIFFS.open(path, "w");
  if (!f) {
    Serial.println("ensureDefaultPreset: cannot write template");
    return;
  }
  f.print(tpl);
  f.close();
  checked = true;
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

// Numbers of all stored presets, sorted. One pass over the directory:
// asking SPIFFS.exists() for 256 possible names takes seconds and blocks
// the web server task.
static std::vector<uint8_t> listPresetIds() {
  std::vector<uint8_t> ids;
  File root = SPIFFS.open("/");
  if (!root) return ids;
  File f = root.openNextFile();
  while (f) {
    const char *n = f.name();
    if (*n == '/') n++;                      // older cores return "/name"
    unsigned id = 0;
    char tail[8] = "";
    if (sscanf(n, "preset_%3u.%5s", &id, tail) == 2 &&
        strcmp(tail, "json") == 0 && id <= 255)
      ids.push_back((uint8_t)id);
    f.close();
    f = root.openNextFile();
  }
  root.close();
  std::sort(ids.begin(), ids.end());
  return ids;
}

// First unused preset number (1..255), 0 if all are taken
static uint8_t findFreePresetId() {
  std::vector<uint8_t> ids = listPresetIds();
  uint8_t id = 1;
  for (uint8_t used : ids) {
    if (used < id) continue;
    if (used > id) break;
    if (id == 255) return 0;
    id++;
  }
  return id;
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
    FREEZE_DONE = 0;              // a new run: no pause point confirmed yet
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
  if (status == T_FROZEN) {
    // Waiting at a pause point: processes keep running, so the ticker stays
    TASK_STATUS = status;
    Serial.println("continuePreset: still waiting at a pause point");
  } else if (status == T_PAUSE) {
    schedulerRestorePause();     // ticker stopped, physical outputs off
  }
  return true;
}

// -------------------------
// Default task fallback
// -------------------------

// Loads a preset's events into memory without starting them
static bool loadPresetEvents(uint8_t id) {
  DynamicJsonDocument doc(PRESET_DOC_SIZE);
  if (!loadPresetFromFile(id, doc)) return false;
  buildEventsFromPreset(doc.as<JsonObject>());
  Serial.printf("Preset %u loaded, not started (%u events)\n", id, EVENTS.size());
  return true;
}

// Loads the template's events into memory without starting them
void loadDefaultTask() {
  Serial.println("loadDefaultTask: loading preset_000");
  if (!loadPresetEvents(0)) Serial.println("loadDefaultTask: preset_000 missing");
}

// Loads the selected preset (number kept in RTC memory as PRESET_ID) without
// starting it; falls back to the template if that preset no longer exists
static void loadSelectedPreset() {
  if (PRESET_ID != 0 && loadPresetEvents(PRESET_ID)) return;
  if (PRESET_ID != 0) {
    Serial.printf("Selected preset %u missing -> template\n", PRESET_ID);
    PRESET_ID = 0;
    saveTaskData();
  }
  loadDefaultTask();
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
    // Stopped: load the last selected preset (or the template), don't start
    loadSelectedPreset();
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
  if (id == PRESET_ID && (TASK_STATUS == T_START || TASK_STATUS == T_PAUSE ||
                          TASK_STATUS == T_FROZEN)) {
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
  bool wasSelected = (id == PRESET_ID);
  if (wasSelected && TASK_STATUS != T_STOP) schedulerStop();

  SPIFFS.remove(path);
  ensureDefaultPreset();

  // The selected preset is gone: select the template
  if (wasSelected) {
    PRESET_ID = 0;
    saveTaskData();
    loadDefaultTask();
  }
  Serial.printf("Preset %u deleted\n", id);

  StaticJsonDocument<128> resp;
  resp["status"] = "deleted";
  resp["id"]     = id;
  String out;
  serializeJson(resp, out);
  req->send(200, "application/json", out);
}

// The user picked a preset in the dashboard box (nothing running): remember
// it in RTC memory and load its events, so it survives a reboot
void handlePresetSelect(AsyncWebServerRequest *req, uint8_t *data, size_t len) {
  StaticJsonDocument<64> doc;
  if (deserializeJson(doc, data, len)) {
    sendError(req, 400, "invalid json");
    return;
  }
  uint8_t id = doc["id"] | 0;

  if (TASK_STATUS != T_STOP && TASK_STATUS != T_FINISHED) {
    sendError(req, 409, "stop the running preset first");
    return;
  }
  if (TASK_STATUS == T_FINISHED) {       // a finished task: back to stopped
    TASK_STATUS = T_STOP;
    ClearStartTimeInRtc();
  }
  char path[32];
  presetPath(id, path, sizeof(path));
  if (id != 0 && !SPIFFS.exists(path)) {
    sendError(req, 404, "preset not found");
    return;
  }

  PRESET_ID = id;
  saveTaskData();
  deleteEvents();
  loadSelectedPreset();
  Serial.printf("Preset %u selected\n", id);

  StaticJsonDocument<96> resp;
  resp["status"]   = "selected";
  resp["presetId"] = PRESET_ID;
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
  int stageId = doc["stageId"] | -1;     // optional: start at this stage

  if (TASK_STATUS != T_STOP) schedulerStop();

  if (!startFromPreset(id, false)) {
    sendError(req, 404, "preset not found");
    return;
  }
  if (stageId >= 0 && !schedulerSetStage((uint8_t)stageId))
    Serial.printf("handlePresetStart: no stage %d, started at stage 1\n", stageId);

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

  // The preset stays selected (PRESET_ID is kept in RTC memory), so the
  // page and the next boot show it again; it is only no longer running
  schedulerStop();
  ClearStartTimeInRtc();
  loadSelectedPreset();

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

  // POST /preset/pause?source=playground: Playground pause (ends by itself
  // when the session ends); anything else is a Dashboard pause
  const bool fromPlayground = req->hasParam("source") &&
                              req->getParam("source")->value() == "playground";
  schedulerPause(fromPlayground ? PAUSE_SRC_PLAYGROUND : PAUSE_SRC_DASHBOARD);

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

// Make a stage of the running task active now: {"stageId": 2}
void handlePresetStage(AsyncWebServerRequest *req, uint8_t *data, size_t len) {
  StaticJsonDocument<64> doc;
  if (deserializeJson(doc, data, len)) {
    sendError(req, 400, "invalid json");
    return;
  }
  if (TASK_STATUS != T_START && TASK_STATUS != T_PAUSE && TASK_STATUS != T_FROZEN) {
    sendError(req, 409, "no task running");
    return;
  }
  int stageId = doc["stageId"] | -1;
  if (stageId < 0 || !schedulerSetStage((uint8_t)stageId)) {
    sendError(req, 404, "stage not found");
    return;
  }

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
  uint32_t t0 = millis();
  ensureDefaultPreset();

  // The answer is written entry by entry straight into the response, so its
  // size does not depend on the number of presets (up to 255)
  AsyncResponseStream *res = req->beginResponseStream("application/json");
  res->addHeader("Cache-Control", "no-store");

  // Read only the descriptive fields; the schedule itself can be large.
  // The documents live on the heap: the web server task has a small stack.
  DynamicJsonDocument filter(512);
  const char *fields[] = { "id", "name", "nameRu", "latin", "category",
                           "totalDays", "difficulty", "recommendedMethod",
                           "builtIn", "germinationDays" };
  for (const char *k : fields) filter[k] = true;
  DynamicJsonDocument meta(1024);

  res->print("{\"presets\":[");
  unsigned count = 0;
  for (uint8_t id : listPresetIds()) {
    char path[32];
    presetPath(id, path, sizeof(path));

    File f = SPIFFS.open(path, "r");
    if (!f) continue;
    meta.clear();
    DeserializationError err =
      deserializeJson(meta, f, DeserializationOption::Filter(filter));
    f.close();
    if (err) {
      Serial.printf("handlePresetList: %s: %s\n", path, err.c_str());
      continue;
    }

    meta["id"] = id;                            // the file number counts
    if (!meta.containsKey("name"))    meta["name"]    = "";
    if (!meta.containsKey("builtIn")) meta["builtIn"] = false;
    if (count++) res->print(",");
    serializeJson(meta, *res);
  }

  // Current preset info
  StaticJsonDocument<256> cur;
  cur["presetId"]  = PRESET_ID;
  cur["status"]    = taskStatusToString();
  cur["startTime"] = formatStartTime();
  if (TASK_STATUS == T_FROZEN && activeFreeze)
    cur["pauseMessage"] = activeFreeze->message;
  res->print("],\"current\":");
  serializeJson(cur, *res);
  res->print("}");

  req->send(res);
  Serial.printf("handlePresetList done: %u presets, %lu ms, free heap %u\n",
                count, (unsigned long)(millis() - t0), ESP.getFreeHeap());
}

// Current stage and the stage list, while a task is running, paused or
// waiting at a stage end
static void fillStageState(JsonDocument &resp) {
  if (TASK_STATUS != T_START && TASK_STATUS != T_PAUSE && TASK_STATUS != T_FROZEN) return;
  const int idx = schedulerStageIndex();
  if (idx < 0) return;
  const StageInfo &st = STAGES[idx];
  JsonObject s = resp.createNestedObject("stage");
  s["id"]    = st.id;
  s["index"] = idx;
  s["count"] = STAGES.size();
  s["name"]  = st.name.c_str();
  const uint32_t start = stageStartEpoch((uint8_t)idx);
  s["elapsedMin"] = NOW_EPOCH > start ? (NOW_EPOCH - start) / 60u : 0;
  s["lengthMin"]  = st.lenMin;
  JsonArray list = resp.createNestedArray("stages");
  for (const StageInfo &x : STAGES) {
    JsonObject o = list.createNestedObject();
    o["id"]   = x.id;
    o["name"] = x.name.c_str();
  }
}

void handleApiState(AsyncWebServerRequest *req) {
  DynamicJsonDocument resp(2560);   // 10 outputs + sensors + messages + stages
  fillDashboardState(resp);
  // Task status for the page, and the message of a reached pause point
  resp["taskStatus"] = taskStatusToString();
  fillStageState(resp);
  if (TASK_STATUS == T_FROZEN && activeFreeze)
    resp["pauseMessage"] = activeFreeze->message;
  // Text of the Message output (confirmed with OK on the dashboard)
  if (const char *n = schedulerNotice()) resp["notice"] = n;
  if (resp.overflowed()) Serial.println("handleApiState: document too small");
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

  // The user tapped OK on the message
  server.on("/api/notice/ok", HTTP_POST,
    [](AsyncWebServerRequest *req) {
      if (!requireSession(req)) return;
      schedulerNoticeOk();
      req->send(200, "application/json", "{\"status\":\"ok\"}");
    });

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

  server.on("/preset/select", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len,
       size_t index, size_t total) {
      uint8_t *body = collectBody(req, data, len, index, total);
      if (!body) return;
      if (!requireSession(req)) return;
      handlePresetSelect(req, body, total);
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

  server.on("/preset/stage", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len,
       size_t index, size_t total) {
      uint8_t *body = collectBody(req, data, len, index, total);
      if (!body) return;
      if (!requireSession(req)) return;
      handlePresetStage(req, body, total);
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
