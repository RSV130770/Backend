#include "scheduler.h"
#include <Ticker.h>

Ticker schedulerTicker;
extern AsyncWebServer server;
extern uint32_t schedulerStartEpoch;
extern uint32_t NOW_EPOCH;
extern std::vector<MachineEvent*> EVENTS;
extern tm NOW;
static MachineEvent* lastApplied[OUTPUT_COUNT] = { nullptr };
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
  if (TASK_STATUS == T_PAUSE || TASK_STATUS == T_FROZEN) {
    if (freezeEntryEpoch == 0)
      freezeEntryEpoch = NOW_EPOCH;  // stamp once on first update after state change
  } else {
    freezeEntryEpoch = 0;  // clear when running normally
  }
}

// -----------------------------
// Compute activationEpoch for all events
// -----------------------------
static void computeAllActivationTimes() {
  for (auto* ev : EVENTS) {
    ev->computeActivation();
  }
}

/*
void debug_event_actuate(event &ev)
{

}
  
*/
uint32_t effectiveNow=0;
static void retrospectiveApply() {
  updateNow();

  uint32_t effectiveNow = NOW_EPOCH - (uint32_t)FROZEN_DAYS * 86400u;

  MachineEvent* bestPast[OUTPUT_COUNT]     = {};
  uint32_t      bestPastTime[OUTPUT_COUNT] = {};
  MachineEvent* bestFuture[OUTPUT_COUNT]   = {};
  uint32_t      bestFutureTime[OUTPUT_COUNT];
  for (int i = 0; i < OUTPUT_COUNT; i++) bestFutureTime[i] = UINT32_MAX;

  for (auto* ev : EVENTS) {
    if (!ev->enabled) continue;
    if (ev->type == EVENT_FREEZE) continue;
    if (ev->isExpired()) continue;

    uint8_t ch = ev->channelId;
    if (ch >= OUTPUT_COUNT) continue;

    Serial.print("Event cn: ");
    Serial.print(ch);
    Serial.print("&");
    Serial.println(printHHMM(ev->hour, ev->minute));

    if (ev->activationEpoch <= effectiveNow) {
      if (ev->activationEpoch >= bestPastTime[ch]) {
        bestPast[ch]     = ev;
        bestPastTime[ch] = ev->activationEpoch;
      }
    } else {
      if (ev->activationEpoch <= bestFutureTime[ch]) {
        bestFuture[ch]     = ev;
        bestFutureTime[ch] = ev->activationEpoch;
      }
    }
  }

  for (int ch = 0; ch < OUTPUT_COUNT; ch++) {
    if (bestPast[ch]) {
      bestPast[ch]->applyAt();
      lastApplied[ch] = bestPast[ch];
      Serial.print("Event: ");
      Serial.print(printHHMM(bestPast[ch]->hour, bestPast[ch]->minute));
      Serial.print(" actuated channel:");
      Serial.print(ch);
      Serial.print(" with value: ");
      Serial.println(bestPast[ch]->duty);
    }

    MachineEvent* evForRemaining = bestFuture[ch] ? bestFuture[ch] : bestPast[ch];
    if (evForRemaining) {
      evForRemaining->ToNextSwitch();
      Serial.print("Event: ");
      Serial.print(printHHMM(evForRemaining->hour, evForRemaining->minute));
      Serial.print(" calculated channel:");
      Serial.println(ch);
    }

    Serial.printf("lastApplied[%d] = %p\n", ch, lastApplied[ch]);
    Serial.printf("remaining[%d]   = %p\n", ch, evForRemaining);
    Serial.println();
  }

  Serial.print("RTC RAW: ");
  Serial.print(RTC.yyyy); Serial.print("-");
  Serial.print(RTC.mm);   Serial.print("-");
  Serial.print(RTC.dd);   Serial.print(" ");
  Serial.print(RTC.h);    Serial.print(":");
  Serial.print(RTC.m);    Serial.print(":");
  Serial.println(RTC.s);
}
// -----------------------------
// Main scheduler tick
// -----------------------------
void schedulerTick() {
  if (TASK_STATUS != T_START && TASK_STATUS != T_FROZEN) return;

  updateNow();

  uint32_t effectiveNow = NOW_EPOCH - (uint32_t)FROZEN_DAYS * 86400u;

  // Per-channel: track best candidate
  MachineEvent* bestPast[OUTPUT_COUNT]     = {};
  uint32_t      bestPastTime[OUTPUT_COUNT] = {};
  MachineEvent* bestFuture[OUTPUT_COUNT]   = {};
  uint32_t      bestFutureTime[OUTPUT_COUNT];
  for (int i = 0; i < OUTPUT_COUNT; i++) bestFutureTime[i] = UINT32_MAX;

  for (auto* ev : EVENTS) {
    if (!ev->enabled) continue;

    // Handle freeze events separately
    if (ev->type == EVENT_FREEZE) {
      if (ev->activationEpoch <= effectiveNow)
        ev->applyAt();
      continue;
    }

    if (ev->isExpired()) continue;

    uint8_t ch = ev->channelId;
    if (ch >= OUTPUT_COUNT) continue;

    if (ev->activationEpoch <= effectiveNow) {
      if (ev->activationEpoch >= bestPastTime[ch]) {
        bestPast[ch]     = ev;
        bestPastTime[ch] = ev->activationEpoch;
      }
    } else {
      if (ev->activationEpoch <= bestFutureTime[ch]) {
        bestFuture[ch]     = ev;
        bestFutureTime[ch] = ev->activationEpoch;
      }
    }
  }

  // Apply and compute remaining per channel
  for (int ch = 0; ch < OUTPUT_COUNT; ch++) {
    if (bestPast[ch]) {
      bestPast[ch]->applyAt();
      lastApplied[ch] = bestPast[ch];
    } else if (lastApplied[ch] && lastApplied[ch]->isExpired()) {
      // Last active event just expired — zero the output
      OUT[ch].setTarget(0);
      lastApplied[ch] = nullptr;
    }

    MachineEvent* evForRemaining = bestFuture[ch] ? bestFuture[ch] : bestPast[ch];
    if (evForRemaining) evForRemaining->ToNextSwitch();
  }
}

// Wrapper for Ticker
static void schedulerTickWrapper() {
  schedulerTick();
}
// -----------------------------
// Start scheduler
// -----------------------------
void schedulerStart() {
  schedulerStartEpoch = NOW_EPOCH;
  computeAllActivationTimes();
  retrospectiveApply();
  schedulerTicker.detach();
  schedulerTicker.attach_ms(1000, schedulerTickWrapper);
  FROZEN_DAYS = 0;
  freezeEntryEpoch = 0;
  TASK_STATUS = T_START;
}

// -----------------------------
// Pause
// -----------------------------
void schedulerPause() {
  if (TASK_STATUS != T_START) return;
  schedulerTicker.detach();
  TASK_STATUS = T_PAUSE;
  updateNow();
  for (int ch = 0; ch < OUTPUT_COUNT; ch++) {
    OUT[ch].freeze(NOW_EPOCH);
  }
  Serial.println("Scheduler paused");
}

// -----------------------------
// Resume
// -----------------------------
void schedulerResume() {
  if (TASK_STATUS != T_PAUSE && TASK_STATUS != T_FROZEN) return;
  // 1) Refresh time
  updateNow();
  //  1.1) froze handler
  if (freezeEntryEpoch != 0) {
    uint32_t elapsed = NOW_EPOCH - freezeEntryEpoch;
    if (elapsed >= 86400u) {
      uint8_t days = (uint8_t)(elapsed / 86400u);
      FROZEN_DAYS += days;  // accumulates across multiple freezes
      saveTaskData();
    }
    freezeEntryEpoch = 0;
    TASK_STATUS = T_START;
  }
  // 2) Recompute activationEpoch for all events (in case time changed)

  computeAllActivationTimes();
  // 3) Re-apply schedule state as of NOW (overwrites Playground changes)
  retrospectiveApply();
  // 4) Unfreeze outputs timeline
  for (int ch = 0; ch < OUTPUT_COUNT; ch++) {
    OUT[ch].resume(NOW_EPOCH);
  }
  // 5) Restart periodic tick
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
  freezeEntryEpoch = 0;

  for (int ch = 0; ch < OUTPUT_COUNT; ch++)
    OUT[ch].reset();

  deleteEvents();
  ClearStartTimeInRtc();  // zeros PRESET_ID, FROZEN_DAYS, START_* in RTC RAM

  Serial.println("Scheduler stopped");
}

void buildEventsFromPreset(const JsonObject& preset) {
  deleteEvents();

  // Germination warning only
  uint8_t darkDays  = preset["germinationDarkDays"]  | 0;
  uint8_t lightDays = preset["germinationLightDays"] | 0;
  if (darkDays > 0 || lightDays > 0) {
    Serial.printf("Germination: %u dark days, %u light days — not scheduled\n",
                  darkDays, lightDays);
  }

  uint8_t dayOffset = 0;

  for (JsonObjectConst phase : preset["phases"].as<JsonArrayConst>()) {
    uint8_t phaseDays = phase["days"] | 0;
    bool    frozen    = phase["froze"] | false;

    // FreezeEvent at start of phase if flagged
    if (frozen) {
      FreezeEvent* fe = new FreezeEvent();
      fe->afterDays = dayOffset;
      fe->hour      = 0;
      fe->minute    = 0;
      fe->enabled   = true;
      EVENTS.push_back(fe);
    }

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
        on->afterDays   = dayOffset;
        on->durationDays = phaseDays;
        on->hour        = startH;
        on->minute      = startM;
        on->duty        = (uint8_t)((pct * 255) / 100);
        on->rampMs      = 120000;
        on->out         = &OUT[lc.ch];
        EVENTS.push_back(on);

        // OFF event
        DailyEvent* off  = new DailyEvent();
        off->channelId   = lc.ch;
        off->afterDays   = dayOffset;
        off->durationDays = phaseDays;
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
        ce->afterDays    = dayOffset;
        ce->durationDays = phaseDays;
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
        ce->afterDays    = dayOffset;
        ce->durationDays = phaseDays;
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
        ce->afterDays    = dayOffset;
        ce->durationDays = phaseDays;
        ce->hour         = 0;
        ce->minute       = 0;
        ce->duty         = 255;
        ce->onSeconds    = fogger["onSec"]  | 0;
        ce->offSeconds   = (fogger["offMin"] | 0) * 60;
        ce->out          = &OUT[ID_MIST];
        EVENTS.push_back(ce);
      }
    }

    dayOffset += phaseDays;
  }

  Serial.printf("Built %u events from preset %s\n",
                EVENTS.size(), preset["name"] | "unknown");
}


void setupScheduler() {
}
