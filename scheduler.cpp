#include "scheduler.h"
#include <Ticker.h>
#include <algorithm>
#include <SPIFFS.h>

Ticker schedulerTicker;
extern AsyncWebServer server;
extern uint32_t schedulerStartEpoch;
extern uint32_t NOW_EPOCH;
extern std::vector<MachineEvent*> EVENTS;
extern tm NOW;
static MachineEvent* lastApplied[OUTPUT_COUNT] = { nullptr };

// Must be called whenever EVENTS are deleted: lastApplied points into them,
// and a stale pointer would be read on the next tick (use after free)
FreezeEvent* activeFreeze = nullptr;

// Message output: the switch-on shown now and the last one the user
// confirmed with OK. A switch-on is known by the time it began (a daily
// message begins a new one every day, a custom one every cycle). The
// confirmed one is kept in a file, so a reboot does not show it again.
static uint32_t noticeKey = 0;
static uint32_t okKey     = 0;
static bool     okLoaded  = false;
static const char *NOTICE_OK_FILE = "/notice_ok.txt";

static void loadNoticeOk() {
  if (okLoaded) return;
  okLoaded = true;
  if (!SPIFFS.exists(NOTICE_OK_FILE)) return;
  File f = SPIFFS.open(NOTICE_OK_FILE, "r");
  if (!f) return;
  okKey = (uint32_t)strtoul(f.readString().c_str(), nullptr, 10);
  f.close();
}

void schedulerForgetEvents() {
  for (int ch = 0; ch < OUTPUT_COUNT; ch++) lastApplied[ch] = nullptr;
  activeFreeze = nullptr;
  noticeKey = 0;
}

// When the current switch-on of an event began
static uint32_t switchOnKey(const MachineEvent* ev) {
  if (ev->type == EVENT_CUSTOM) {
    const CustomEvent* c = static_cast<const CustomEvent*>(ev);
    uint32_t cycle = c->onSeconds + c->offSeconds;
    if (cycle && NOW_EPOCH > ev->activationEpoch)
      return ev->activationEpoch + ((NOW_EPOCH - ev->activationEpoch) / cycle) * cycle;
  }
  return ev->activationEpoch;
}

// Apply an event; for the Message output also set or clear the text
static void applyEvent(MachineEvent* ev) {
  const uint32_t key = switchOnKey(ev);   // before applyAt moves a daily one
  if (ev->channelId == ID_MESSAGE) loadNoticeOk();
  const bool confirmed = (ev->channelId == ID_MESSAGE && key == okKey);
  if (confirmed && ev->type == EVENT_CUSTOM) return;  // hidden this cycle
  ev->applyAt();
  if (ev->channelId != ID_MESSAGE) return;

  Output &m = OUT[ID_MESSAGE];
  if (m.target == 0) {                     // an Off event: hide the message
    m.text = "";
    noticeKey = 0;
    return;
  }
  if (confirmed) {                         // already confirmed with OK
    m.setTarget(0);
    return;
  }
  if (key != noticeKey)
    Serial.printf("Message: %s\n", ev->message.c_str());
  m.text    = ev->message.length() ? ev->message : String("Message");
  noticeKey = key;
}

const char* schedulerNotice() {
  const Output &m = OUT[ID_MESSAGE];
  return (m.target > 0 && m.text.length()) ? m.text.c_str() : nullptr;
}

void schedulerNoticeOk() {
  if (noticeKey != 0 && noticeKey != okKey) {
    okKey = noticeKey;
    File f = SPIFFS.open(NOTICE_OK_FILE, "w");   // written only on OK
    if (f) { f.print(String(okKey)); f.close(); }
  }
  noticeKey = 0;
  OUT[ID_MESSAGE].setTarget(0);
  Serial.println("Message confirmed with OK");
}

// The first pause point that is reached and not confirmed yet, or nullptr
static FreezeEvent* findDueFreeze(uint32_t effectiveNow) {
  FreezeEvent* due = nullptr;
  for (auto* ev : EVENTS) {
    if (!ev->enabled || ev->type != EVENT_FREEZE) continue;
    FreezeEvent* fe = static_cast<FreezeEvent*>(ev);
    if (fe->seq >= FREEZE_DONE && fe->activationEpoch <= effectiveNow &&
        (!due || fe->seq < due->seq))
      due = fe;
  }
  return due;
}

// -----------------------------
// RTC → NOW + NOW_EPOCH
// -----------------------------
void updateNow() {
  RTC.readTime();

  int fullYear = RTC.yyyy;
  if (fullYear < 2000 || fullYear > 2099)
    fullYear = 2000;

  NOW.tm_year = fullYear - 1900;
  NOW.tm_mon = RTC.mm - 1;
  NOW.tm_mday = RTC.dd;
  NOW.tm_hour = RTC.h;
  NOW.tm_min = RTC.m;
  NOW.tm_sec = RTC.s;
  NOW.tm_isdst = 0;

  NOW_EPOCH = mktime(&NOW);
}

// -----------------------------
// Time spent stopped (service pause or a stage-end wait)
// -----------------------------
// One rule for both: only whole days count. The task start moves forward
// by every full day spent stopped, as if those days were added to the
// current stage; daily events keep their clock times. A stop shorter than
// a day shifts nothing. "from" is when the stop began.
static void shiftStartByWholeDays(uint32_t from, const char* what) {
  if (from == 0 || from > NOW_EPOCH || from < schedulerStartEpoch) {
    Serial.printf("%s: no valid start time (%lu), task days not moved\n",
                  what, (unsigned long)from);
    return;
  }
  uint32_t days = (NOW_EPOCH - from) / 86400u;
  if (days > 0) {
    schedulerStartEpoch += days * 86400u;
    time_t st = (time_t)schedulerStartEpoch;
    tm startTm = *localtime(&st);
    PutStartTimetoRtc(startTm);
  }
  Serial.printf("%s lasted %lu s: task days moved by %lu\n", what,
                (unsigned long)(NOW_EPOCH - from), (unsigned long)days);
}

// Physical outputs off; virtual ones (Message) keep their state
static void physicalOutputsOff() {
  for (int ch = 0; ch < OUTPUT_COUNT; ch++) {
    if (OUT[ch].mode == MODE_MESSAGE) continue;
    OUT[ch].reset();
  }
}

// -----------------------------
// Compute activationEpoch for all events
// -----------------------------
static void computeAllActivationTimes() {
  for (auto* ev : EVENTS) {
    ev->done = false;
    ev->computeActivation();
  }
}

static void schedulerTickWrapper();   // defined below

// Daily events whose time has passed but that were not the newest for their
// channel (e.g. the 06:30 "on" when it is already after the 22:30 "off")
// must move to their next occurrence, or they would fire on the next tick.
// Once events are the same: applied once, when they are the newest for their
// channel; afterwards (or when a newer event won) they are done, otherwise
// an old once event would take the channel back from a daily event as soon
// as that one moves on to tomorrow. Events whose stage has not begun yet
// are left alone: they act at their stage start.
static void skipPassedDailyEvents(uint32_t now) {
  for (auto* ev : EVENTS) {
    if (now < ev->beginEpoch) continue;
    if (ev->type == EVENT_DAILY && ev->activationEpoch <= now)
      static_cast<DailyEvent*>(ev)->advanceToNext();
    else if (ev->type == EVENT_ONCE && ev->activationEpoch <= now)
      ev->done = true;
  }
}

// No stage is held back
static const uint8_t HOLD_NONE = 255;

// Per output: the event in effect now (the newest one that may act) and the
// next one ahead; apply the first, count down to the second.
// restore = true after a start, reboot, resume or stage change: an output
// that no event drives is switched off (the Message output keeps its text).
// holdStage: while the task waits at the end of a stage, the stages after it
// stay held back.
static void evaluate(bool restore, uint8_t holdStage) {
  const uint32_t now = NOW_EPOCH;

  MachineEvent* bestPast[OUTPUT_COUNT]     = {};
  uint32_t      bestPastTime[OUTPUT_COUNT] = {};
  MachineEvent* bestFuture[OUTPUT_COUNT]   = {};
  uint32_t      bestFutureTime[OUTPUT_COUNT];
  for (int i = 0; i < OUTPUT_COUNT; i++) bestFutureTime[i] = UINT32_MAX;

  for (auto* ev : EVENTS) {
    if (!ev->enabled) continue;
    if (ev->type == EVENT_FREEZE) continue;
    if (ev->done) continue;                    // once event already applied
    if (ev->stageIdx > holdStage) continue;    // waits for Continue
    if (ev->isExpired()) continue;

    uint8_t ch = ev->channelId;
    if (ch >= OUTPUT_COUNT) continue;

    // Newest by its own time; but it cannot act before its stage begins
    const uint32_t when = ev->effectiveFrom();
    if (when <= now) {
      if (ev->activationEpoch >= bestPastTime[ch]) {
        bestPast[ch]     = ev;
        bestPastTime[ch] = ev->activationEpoch;
      }
    } else if (when <= bestFutureTime[ch]) {
      bestFuture[ch]     = ev;
      bestFutureTime[ch] = when;
    }
  }

  for (int ch = 0; ch < OUTPUT_COUNT; ch++) {
    if (bestPast[ch]) {
      applyEvent(bestPast[ch]);
      lastApplied[ch] = bestPast[ch];
    } else if (restore) {
      if (ch != ID_MESSAGE) OUT[ch].setTarget(0);   // no event drives it
      lastApplied[ch] = nullptr;
    } else if (lastApplied[ch] && lastApplied[ch]->isExpired()) {
      // Its last event ended (e.g. at a stage end): switch it off
      OUT[ch].setTarget(0);
      lastApplied[ch] = nullptr;
    }

    MachineEvent* evForRemaining = bestFuture[ch] ? bestFuture[ch] : bestPast[ch];
    if (evForRemaining) evForRemaining->ToNextSwitch();
  }
  skipPassedDailyEvents(now);
}

static void retrospectiveApply() {
  updateNow();

  // Waiting at a stage end (e.g. after a reboot): the ending stage goes on,
  // the stages after it stay held back
  FreezeEvent* due = findDueFreeze(NOW_EPOCH);
  if (due) activeFreeze = due;

  evaluate(true, due ? due->stageIdx : HOLD_NONE);

  Serial.printf("Schedule applied at %s, stage %d\n",
                epochToStr(NOW_EPOCH).c_str(), schedulerStageIndex());
}

// The last stage has a length and it has ended: the task is finished
static bool lastStageEnded() {
  if (STAGES.empty() || STAGES.back().lenMin == 0) return false;
  return NOW_EPOCH >= stageEndEpoch((uint8_t)(STAGES.size() - 1));
}

// Task finished: outputs off, events kept so the page can still show the
// stages; Start runs it again from stage 1
static void schedulerFinish() {
  TASK_STATUS = T_FINISHED;
  activeFreeze = nullptr;
  setPauseStart(0);
  saveTaskData();
  physicalOutputsOff();
  for (int ch = 0; ch < OUTPUT_COUNT; ch++) lastApplied[ch] = nullptr;
  Serial.println("Task finished: the last stage has ended");
}

// -----------------------------
// Main scheduler tick
// -----------------------------
void schedulerTick() {
  if (TASK_STATUS != T_START && TASK_STATUS != T_FROZEN) return;

  updateNow();

  // The clock was set back (e.g. synchronised with the phone): the daily
  // switch times ahead are now wrong, so work out the state again
  static uint32_t lastTickEpoch = 0;
  if (lastTickEpoch != 0 && NOW_EPOCH + 60 < lastTickEpoch) {
    Serial.printf("Clock moved back by %lu s - schedule re-applied\n",
                  (unsigned long)(lastTickEpoch - NOW_EPOCH));
    lastTickEpoch = NOW_EPOCH;
    computeAllActivationTimes();
    retrospectiveApply();
    return;
  }
  lastTickEpoch = NOW_EPOCH;

  // A stage end with a pause reached: wait for the user. The ending stage
  // goes on; the stages after it are held back.
  FreezeEvent* dueFreeze = findDueFreeze(NOW_EPOCH);
  if (dueFreeze) {
    activeFreeze = dueFreeze;
    if (TASK_STATUS != T_FROZEN) {
      TASK_STATUS = T_FROZEN;
      setPauseStart(dueFreeze->activationEpoch);   // fallback for Continue
      saveTaskData();
      Serial.printf("Task waits at the end of stage %u: %s\n",
                    dueFreeze->seq + 1, dueFreeze->message.c_str());
    }
  } else if (lastStageEnded()) {
    schedulerFinish();
    return;
  }

  const uint8_t hold =
    (TASK_STATUS == T_FROZEN && activeFreeze) ? activeFreeze->stageIdx : HOLD_NONE;
  evaluate(false, hold);
}

// -----------------------------
// Stages: current stage, manual change
// -----------------------------
// Index of the current stage: while waiting, the stage that ended; else the
// last stage that has begun. -1 when nothing is loaded.
int schedulerStageIndex() {
  if (STAGES.empty()) return -1;
  if (activeFreeze) return activeFreeze->stageIdx;
  int idx = 0;
  for (size_t i = 0; i < STAGES.size(); i++)
    if (stageStartEpoch((uint8_t)i) <= NOW_EPOCH) idx = (int)i;
  return idx;
}

// Make a stage active now (Dashboard): the task start moves so that this
// stage begins now. Pauses at the end of this stage and later ones are
// asked again; a wait or a service pause ends.
bool schedulerSetStage(uint8_t stageId) {
  const int idx = stageIndexById(stageId);
  if (idx < 0) return false;
  if (TASK_STATUS != T_START && TASK_STATUS != T_PAUSE && TASK_STATUS != T_FROZEN)
    return false;

  updateNow();
  uint32_t start = NOW_EPOCH - STAGES[idx].offsetMin * 60u;
  start -= start % 60u;                 // the RTC keeps the start to the minute
  schedulerStartEpoch = start;
  time_t st = (time_t)start;
  tm startTm = *localtime(&st);
  PutStartTimetoRtc(startTm);

  FREEZE_DONE  = (uint8_t)idx;          // re-arm the pauses from this stage on
  activeFreeze = nullptr;
  setPauseStart(0);
  TASK_STATUS  = T_START;
  saveTaskData();

  computeAllActivationTimes();
  retrospectiveApply();
  schedulerTicker.detach();
  schedulerTicker.attach_ms(1000, schedulerTickWrapper);
  Serial.printf("Stage %d (%s) set active\n", idx + 1, STAGES[idx].name.c_str());
  return true;
}

// Wrapper for Ticker
static void schedulerTickWrapper() {
  schedulerTick();
}
// -----------------------------
// Start scheduler
// -----------------------------
void schedulerStart() {
  schedulerStartAt(NOW_EPOCH, false);
}

void schedulerStartAt(uint32_t startEpoch, bool recovering) {
  // FROZEN_DAYS is retired: days paused now move the task start instead.
  // A value left by the old firmware is folded into the start once.
  if (recovering && FROZEN_DAYS > 0 && FROZEN_DAYS < 255) {
    startEpoch += (uint32_t)FROZEN_DAYS * 86400u;
    Serial.printf("Old FROZEN_DAYS=%u moved into the task start\n", FROZEN_DAYS);
    FROZEN_DAYS = 0;
    schedulerStartEpoch = startEpoch;
    time_t st = (time_t)startEpoch;
    tm startTm = *localtime(&st);
    PutStartTimetoRtc(startTm);           // also saves FROZEN_DAYS = 0
  }
  FROZEN_DAYS = 0;
  if (!recovering) setPauseStart(0);    // a new run has no pause behind it
  saveTaskData();                       // a stale FROZEN_DAYS must not survive
  schedulerStartEpoch = startEpoch;
  computeAllActivationTimes();
  retrospectiveApply();
  schedulerTicker.detach();
  schedulerTicker.attach_ms(1000, schedulerTickWrapper);
  TASK_STATUS = T_START;
}

// -----------------------------
// Pause
// -----------------------------
// Service pause: the schedule stops and every physical output goes off
// (Playground may still drive them by hand). The pause start is kept in RTC
// memory, so the days paused are counted right after a reboot too.
void schedulerPause() {
  if (TASK_STATUS != T_START) return;
  schedulerTicker.detach();
  updateNow();
  TASK_STATUS = T_PAUSE;
  setPauseStart(NOW_EPOCH);
  saveTaskData();
  physicalOutputsOff();
  Serial.println("Scheduler paused, outputs off");
}

// After a reboot during a service pause: the preset was rebuilt and its
// state applied; go back to the paused state with the outputs off.
void schedulerRestorePause() {
  schedulerTicker.detach();
  TASK_STATUS = T_PAUSE;
  uint32_t ps = getPauseStart();
  if (ps == 0 || ps > NOW_EPOCH || ps < schedulerStartEpoch) {
    // Unknown (e.g. first boot after the update): count from now
    setPauseStart(NOW_EPOCH);
  }
  saveTaskData();
  physicalOutputsOff();
  Serial.println("Scheduler restored to paused, outputs off");
}

// -----------------------------
// Resume
// -----------------------------
void schedulerResume() {
  if (TASK_STATUS != T_PAUSE && TASK_STATUS != T_FROZEN) return;
  const bool wasWaiting = (TASK_STATUS == T_FROZEN);   // at a pause point
  // 1) Refresh time
  updateNow();
  //  1.1) time spent stopped: whole days move the task start. A wait at a
  //  pause point is measured from the pause point itself, a service pause
  //  from its start in RTC memory, so a reboot does not shorten either.
  if (wasWaiting) {
    uint32_t from = activeFreeze ? activeFreeze->activationEpoch : getPauseStart();
    shiftStartByWholeDays(from, "Wait at pause point");
  } else {
    shiftStartByWholeDays(getPauseStart(), "Service pause");
  }
  setPauseStart(0);
  if (wasWaiting) {
    // This pause point is confirmed; a reboot must not ask again
    FREEZE_DONE = activeFreeze ? activeFreeze->seq + 1 : FREEZE_DONE + 1;
    activeFreeze = nullptr;
  }
  TASK_STATUS = T_START;
  saveTaskData();
  // 2) Recompute activationEpoch for all events (in case time changed)

  computeAllActivationTimes();
  // 3) Re-apply schedule state as of NOW. After a service pause start from
  // all off, so a channel Playground switched on but no event drives does
  // not stay on. (A wait at a pause point kept the outputs running.)
  if (!wasWaiting) physicalOutputsOff();
  retrospectiveApply();
  // 4) Restart periodic tick
  schedulerTicker.detach();
  schedulerTicker.attach_ms(1000, schedulerTickWrapper);
  Serial.println("Scheduler resumed");
}


// -----------------------------
// Stop
// -----------------------------
void schedulerStop() {
  schedulerTicker.detach();
  TASK_STATUS  = T_STOP;
  FROZEN_DAYS  = 0;

  for (int ch = 0; ch < OUTPUT_COUNT; ch++)
    OUT[ch].reset();

  deleteEvents();
  ClearStartTimeInRtc();  // zeros START_*, FROZEN_DAYS and the pause bytes

  Serial.println("Scheduler stopped");
}

// One stage of the running preset
static void addStage(uint8_t id, const char* name, uint32_t lenMin,
                     bool endPause, const char* message, uint32_t& offsetMin) {
  StageInfo si;
  si.id        = id;
  si.name      = name;
  si.offsetMin = offsetMin;
  si.lenMin    = lenMin;
  si.endPause  = endPause;
  si.message   = message;
  STAGES.push_back(si);
  offsetMin += lenMin;
}

// A pause at the end of every stage that asks for one (open-ended stages
// have no end). seq = stage index, so FREEZE_DONE counts confirmed stages.
static void addStageEndPauses() {
  for (size_t i = 0; i < STAGES.size(); i++) {
    if (!STAGES[i].endPause || STAGES[i].lenMin == 0) continue;
    FreezeEvent* fe = new FreezeEvent();
    fe->stageIdx = (uint8_t)i;
    fe->seq      = (uint8_t)i;
    fe->message  = STAGES[i].message;
    fe->enabled  = true;
    EVENTS.push_back(fe);
  }
}

void buildEventsFromPreset(const JsonObject& preset) {
  deleteEvents();
  STAGES.clear();
  uint32_t offsetMin = 0;

  // Event-list preset (made in the web schedule editor, and the built-in
  // template): "schedule" is an array of events, see MachineEvent::fromJson.
  // "stages" lists the stages in run order; each event names its stage with
  // "stageId". A preset without stages runs as one open-ended stage.
  JsonArray schedule = preset["schedule"].as<JsonArray>();
  if (!schedule.isNull()) {
    JsonArray stages = preset["stages"].as<JsonArray>();
    if (!stages.isNull() && stages.size() > 0) {
      for (JsonObject s : stages) {
        uint32_t lenMin = ((uint32_t)(s["days"] | 0) * 24u + (uint32_t)(s["hours"] | 0)) * 60u;
        addStage(s["id"] | 0, s["name"] | "Stage", lenMin,
                 s["endPause"] | false, s["message"] | "", offsetMin);
        if (lenMin == 0 && STAGES.size() < stages.size()) {
          Serial.println("Open-ended stage before the last one: later stages ignored");
          break;
        }
      }
    } else {
      addStage(1, preset["name"] | "Task", 0, false, "", offsetMin);
    }

    uint16_t dropped = 0;
    for (JsonObject e : schedule) {
      // Old pause points inside a schedule are dropped: stage ends pause now
      if (strcmp(e["repeat"] | "", "freeze") == 0) { dropped++; continue; }
      const int idx = stageIndexById(e["stageId"] | STAGES[0].id);
      if (idx < 0) { dropped++; continue; }
      MachineEvent* ev = createEventFromJson(e);
      if (!ev) continue;
      ev->stageIdx = (uint8_t)idx;
      EVENTS.push_back(ev);
    }
    addStageEndPauses();
    Serial.printf("Built %u events in %u stages from preset %s (%u dropped)\n",
                  EVENTS.size(), STAGES.size(), preset["name"] | "unknown", dropped);
    return;
  }

  // Otherwise a plant preset described by growth phases

  // Germination warning only
  uint8_t darkDays  = preset["germinationDarkDays"]  | 0;
  uint8_t lightDays = preset["germinationLightDays"] | 0;
  if (darkDays > 0 || lightDays > 0) {
    Serial.printf("Germination: %u dark days, %u light days — not scheduled\n",
                  darkDays, lightDays);
  }

  // Every phase becomes a stage; its events last the whole stage. The old
  // "froze" flags are dropped.
  for (JsonObjectConst phase : preset["phases"].as<JsonArrayConst>()) {
    uint8_t phaseDays = phase["days"] | 0;
    char stageName[16];
    snprintf(stageName, sizeof(stageName), "Phase %u", (unsigned)(STAGES.size() + 1));
    addStage((uint8_t)(STAGES.size() + 1), phase["name"] | (const char*)stageName,
             (uint32_t)phaseDays * 1440u, false, "", offsetMin);
    const uint8_t stageIdx = (uint8_t)(STAGES.size() - 1);

    // --- LIGHT ---
    JsonObjectConst light = phase["light"];
    if (!light.isNull()) {
      uint8_t startH = 6, startM = 0, endH = 22, endM = 0;
      const char* dayStart = light["dayStart"] | "06:00";
      const char* dayEnd   = light["dayEnd"]   | "22:00";
      sscanf(dayStart, "%hhu:%hhu", &startH, &startM);
      sscanf(dayEnd,   "%hhu:%hhu", &endH,   &endM);

      struct { const char* key; uint8_t ch; } lightChannels[] = {
        { "white",  ID_WHITE },
        { "red",    ID_RED   },
        { "blue",   ID_BLUE  },
        { "farRed", ID_FARR  }
      };

      for (auto& lc : lightChannels) {
        int pct = light[lc.key] | 0;
        if (pct == 0) continue;

        // ON event
        DailyEvent* on  = new DailyEvent();
        on->channelId   = lc.ch;
        on->stageIdx   = stageIdx;
        on->hour        = startH;
        on->minute      = startM;
        on->duty        = (uint8_t)((pct * 255) / 100);
        on->rampMs      = 120000;
        on->out         = &OUT[lc.ch];
        EVENTS.push_back(on);

        // OFF event
        DailyEvent* off  = new DailyEvent();
        off->channelId   = lc.ch;
        off->stageIdx   = stageIdx;
        off->hour        = endH;
        off->minute      = endM;
        off->duty        = 0;
        off->rampMs      = 120000;
        off->out         = &OUT[lc.ch];
        EVENTS.push_back(off);
      }
    }

    // --- UV ---
    JsonObjectConst uv = phase["uv"];
    if (!uv.isNull()) {
      int pct = uv["uv"] | 0;
      if (pct > 0) {
        CustomEvent* ce  = new CustomEvent();
        ce->channelId    = ID_UV;
        ce->stageIdx    = stageIdx;
        ce->hour         = 0;
        ce->minute       = 0;
        ce->duty         = (uint8_t)((pct * 255) / 100);
        ce->onSeconds    = uv["onSec"]  | 0;
        ce->offSeconds   = (uv["offMin"] | 0) * 60;
        ce->out          = &OUT[ID_UV];
        EVENTS.push_back(ce);
      }
    }

    // --- PUMP ---
    JsonObjectConst pump = phase["pump"];
    if (!pump.isNull()) {
      bool enabled = pump["enabled"] | true;
      if (enabled) {
        CustomEvent* ce  = new CustomEvent();
        ce->channelId    = ID_PUMP;
        ce->stageIdx    = stageIdx;
        ce->hour         = 0;
        ce->minute       = 0;
        ce->duty         = 255;
        ce->onSeconds    = pump["onSec"]  | 0;
        ce->offSeconds   = (pump["offMin"] | 0) * 60;
        ce->out          = &OUT[ID_PUMP];
        EVENTS.push_back(ce);
      }
    }

    // --- FOGGER ---
    JsonObjectConst fogger = phase["fogger"];
    if (!fogger.isNull()) {
      bool enabled = fogger["enabled"] | true;
      if (enabled) {
        CustomEvent* ce  = new CustomEvent();
        ce->channelId    = ID_MIST;
        ce->stageIdx    = stageIdx;
        ce->hour         = 0;
        ce->minute       = 0;
        ce->duty         = 255;
        ce->onSeconds    = fogger["onSec"]  | 0;
        ce->offSeconds   = (fogger["offMin"] | 0) * 60;
        ce->out          = &OUT[ID_MIST];
        EVENTS.push_back(ce);
      }
    }

    if (phaseDays == 0) break;          // open-ended: the last stage
  }

  Serial.printf("Built %u events in %u stages from phases of preset %s\n",
                EVENTS.size(), STAGES.size(), preset["name"] | "unknown");
}


void setupScheduler() {
}
