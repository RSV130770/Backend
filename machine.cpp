#include "machine.h"

std::vector<MachineEvent *> EVENTS;
std::vector<StageInfo> STAGES;

//---
// Stage times
//---
uint32_t stageStartEpoch(uint8_t idx) {
  if (idx >= STAGES.size()) return schedulerStartEpoch;
  return schedulerStartEpoch + STAGES[idx].offsetMin * 60u;
}

uint32_t stageEndEpoch(uint8_t idx) {
  if (idx >= STAGES.size() || STAGES[idx].lenMin == 0) return UINT32_MAX;
  return stageStartEpoch(idx) + STAGES[idx].lenMin * 60u;
}

int stageIndexById(uint8_t id) {
  for (size_t i = 0; i < STAGES.size(); i++)
    if (STAGES[i].id == id) return (int)i;
  return -1;
}

uint32_t dayMidnight(uint32_t epoch, int days) {
  time_t t = (time_t)epoch;
  tm d = *localtime(&t);
  d.tm_mday += days;
  d.tm_hour = 0;
  d.tm_min  = 0;
  d.tm_sec  = 0;
  return (uint32_t)mktime(&d);
}

// HH:MM on the calendar day "days" after the day of "epoch"
static uint32_t clockOnDay(uint32_t epoch, int days, uint8_t hour, uint8_t minute) {
  time_t t = (time_t)epoch;
  tm d = *localtime(&t);
  d.tm_mday += days;
  d.tm_hour = hour;
  d.tm_min  = minute;
  d.tm_sec  = 0;
  return (uint32_t)mktime(&d);
}

static uint32_t minEpoch(uint32_t a, uint32_t b) { return a < b ? a : b; }

// The event's window inside its stage. Day 0 begins when the stage begins
// (any time of day); a later day begins at its midnight. "expireAfterDays"
// ends it at midnight after its last day; the stage end cuts it in any case.
void MachineEvent::computeWindow() {
  const uint32_t ss = stageStartEpoch(stageIdx);
  beginEpoch  = afterDays ? dayMidnight(ss, afterDays) : ss;
  ownEndEpoch = durationDays ? dayMidnight(ss, (int)afterDays + durationDays) : UINT32_MAX;
  endEpoch    = minEpoch(ownEndEpoch, stageEndEpoch(stageIdx));
}

bool MachineEvent::isExpired() const {
  // Waiting for Continue at the end of this event's stage: the stage goes on
  const bool waitingHere = activeFreeze && activeFreeze->stageIdx == stageIdx;
  return NOW_EPOCH >= (waitingHere ? ownEndEpoch : endEpoch);
}
//---
// MachineEvent::toJson / fromJson (common fields)
//---
// JSON units (same as the web editor): duty in percent, rise/fall in ms,
// on/off in seconds, expireAfterDays = how many days the event is active.
void MachineEvent::toJson(JsonObject &o) const {
  o["expireAfterDays"] = durationDays;
  o["channelId"] = channelId;
  // UI-friendly time string
  writeTime(o, hour, minute);
  // Internal scheduling fields
  o["afterDays"] = afterDays;
  o["enabled"] = enabled;
  // convert raw PWM → percent
  uint8_t pct = (uint8_t)((duty * 100) / 255);
  o["duty"] = pct;
  if (message.length()) o["message"] = message;
  if (stageIdx < STAGES.size()) o["stageId"] = STAGES[stageIdx].id;
}

bool MachineEvent::fromJson(const JsonObject &o) {
  channelId = o["channelId"] | 0;
  // Parse "time": "HH:MM"
  const char *ts = o["time"] | "00:00";
  int h = 0, m = 0;
  sscanf(ts, "%d:%d", &h, &m);
  hour = h;
  minute = m;
  afterDays = o["afterDays"] | 0;
  enabled = o["enabled"] | true;
  int pct = o["duty"] | 0;
  pct = std::clamp(pct, 0, 100);
  duty = (pct * 255) / 100;
  // "expireAfterDays" from the web editor; "long" from older files
  durationDays = o["expireAfterDays"] | (int)(o["long"] | 0);
  message = (const char *)(o["message"] | "");
  return true;
}
void MachineEvent::ToNextSwitch() const {
   if (!out) return;  
    if (activationEpoch <= NOW_EPOCH) {
        out->remaining = 0;
        return;
    }
    // Daily / Once → seconds until activation
    out->remaining = activationEpoch - NOW_EPOCH;

}

//---
// DailyEvent::toJson / fromJson
//---
void DailyEvent::toJson(JsonObject &o) const {
  MachineEvent::toJson(o);
  o["repeat"] = "daily";
  o["rise"] = rampMs;
  o["fall"] = rampMs;
}

bool DailyEvent::fromJson(const JsonObject &o) {
  if (!MachineEvent::fromJson(o)) return false;
  // A daily event has one ramp: an "off" event (duty 0) ramps down with
  // "fall", any other event ramps with "rise"
  uint32_t rise = o["rise"] | 0u;
  uint32_t fall = o["fall"] | rise;
  rampMs = (duty == 0) ? fall : rise;
  return true;
}

void DailyEvent::advanceToNext() {
  tm t = NOW;
  t.tm_hour = hour;
  t.tm_min  = minute;
  t.tm_sec  = 0;
  time_t next = mktime(&t);
  if (next <= (time_t)NOW_EPOCH) {
    t = NOW;
    t.tm_mday += 1;
    t.tm_hour = hour;
    t.tm_min  = minute;
    t.tm_sec  = 0;
    next = mktime(&t);
  }
  activationEpoch = next;
}

// A daily event counts from midnight of its first day (stage start day +
// afterDays). Its activation is the most recent occurrence of HH:MM since
// then, so the scheduler applies the state that should be in effect now
// (after a start, a reboot, a stage change or the clock set back). Before
// its stage begins it is measured at the stage start: e.g. a stage started
// at 14:37 applies its 06:30 "on" at 14:37. If its first day has not come
// yet, its first occurrence.
void DailyEvent::computeActivation() {
  computeWindow();
  const uint32_t dayBase = dayMidnight(stageStartEpoch(stageIdx), afterDays);
  const uint32_t ref = NOW_EPOCH > beginEpoch ? NOW_EPOCH : beginEpoch;

  uint32_t latest = clockOnDay(ref, 0, hour, minute);
  if (latest > ref) latest = clockOnDay(ref, -1, hour, minute);

  activationEpoch = (latest >= dayBase) ? latest
                                        : clockOnDay(latest, 1, hour, minute);
}

void DailyEvent::ToNextSwitch() const {
    if (!out) return;

    // Build today's event time
    tm today = NOW;
    today.tm_hour = hour;
    today.tm_min  = minute;
    today.tm_sec  = 0;

    time_t todayEvent = mktime(&today);

    time_t nextEvent;

    if (todayEvent > NOW_EPOCH) {
        // Event is still ahead today
        nextEvent = todayEvent;
    } else {
        // Event already passed → schedule for tomorrow
        tm tomorrow = NOW;
        tomorrow.tm_mday += 1;
        tomorrow.tm_hour = hour;
        tomorrow.tm_min  = minute;
        tomorrow.tm_sec  = 0;
        nextEvent = mktime(&tomorrow);
    }

    out->remaining = nextEvent - NOW_EPOCH;
}

void DailyEvent::applyAt() {
  // Apply today's state
  applyTo();

  // Next occurrence of HH:MM after now. Not simply "tomorrow": when the
  // state is restored after a reboot or a clock change at 05:00, the
  // last-night 22:30 "off" applied now must still switch off today at 22:30.
  advanceToNext();
}

//---
// CustomEvent::toJson / fromJson
//---
void CustomEvent::toJson(JsonObject &o) const {
  MachineEvent::toJson(o);
  o["repeat"] = "custom";
  o["on"] = onSeconds;
  o["off"] = offSeconds;
  o["rise"] = riseMs;
  o["fall"] = fallMs;
}

bool CustomEvent::fromJson(const JsonObject &o) {
  if (!MachineEvent::fromJson(o)) return false;
  onSeconds = o["on"] | 0;
  offSeconds = o["off"] | 0;
  riseMs = o["rise"] | 0u;
  fallMs = o["fall"] | 0u;
  return true;
}

void CustomEvent::ToNextSwitch() const {
   if (!out) return;  
    // Not started yet (start offset): count down to the first switch-on
    if (NOW_EPOCH < activationEpoch) {
      out->remaining = activationEpoch - NOW_EPOCH;
      return;
    }

    uint32_t cycle = onSeconds + offSeconds;
    if (cycle == 0) { out->remaining = 0; return; }

    uint32_t since = NOW_EPOCH - activationEpoch;
    uint32_t pos = since % cycle;

    if (pos < onSeconds)
        out->remaining = onSeconds - pos;
    else
        out->remaining = cycle - pos;
}
// A cycle starts at its stage start + afterDays + its time offset
void CustomEvent::computeActivation() {
  computeWindow();
  activationEpoch = stageStartEpoch(stageIdx) + afterDays * 86400u +
                    hour * 3600u + minute * 60u;
  beginEpoch = activationEpoch;
  if (durationDays) {
    ownEndEpoch = activationEpoch + (uint32_t)durationDays * 86400u;
    endEpoch = minEpoch(ownEndEpoch, stageEndEpoch(stageIdx));
  }
}

// Clock time HH:MM on the day (task start day + afterDays). The web editor
// shows once events and pause points with a clock time, not as an offset.
uint32_t clockTimeOnTaskDay(uint16_t days, uint8_t hour, uint8_t minute) {
  time_t day = (time_t)schedulerStartEpoch + (time_t)days * 86400;
  tm t = *localtime(&day);
  t.tm_hour = hour;
  t.tm_min  = minute;
  t.tm_sec  = 0;
  return (uint32_t)mktime(&t);
}

// HH:MM on its day of the stage. A time before the stage start (e.g. 00:00
// on day 0 of a stage started at 14:37) acts at the stage start.
void OnceEvent::computeActivation() {
  computeWindow();
  activationEpoch = clockOnDay(stageStartEpoch(stageIdx), afterDays, hour, minute);
  if (durationDays) {
    ownEndEpoch = activationEpoch + (uint32_t)durationDays * 86400u;
    endEpoch = minEpoch(ownEndEpoch, stageEndEpoch(stageIdx));
  }
}

//---
// OnceEvent::toJson / fromJson
//---
void OnceEvent::toJson(JsonObject &o) const {
  MachineEvent::toJson(o);
  o["repeat"] = "once";
  o["rise"] = rampMs;
  o["fall"] = 0;
  o["enabled"] = enabled;
}

bool OnceEvent::fromJson(const JsonObject &o) {
  if (!MachineEvent::fromJson(o)) return false;
  rampMs = o["rise"] | 0u;
  enabled = o["enabled"] | true;
  return true;
}

void FreezeEvent::toJson(JsonObject &o) const {
  o["channelId"] = channelId;   // kept for schema compat, ignored at runtime
  writeTime(o, hour, minute);
  o["afterDays"] = afterDays;
  o["enabled"]   = enabled;
  o["repeat"]    = "freeze";
  o["message"]   = message;
  // no duty, no rise/fall
}

bool FreezeEvent::fromJson(const JsonObject &o) {
  // Only the fields that matter
  const char *ts = o["time"] | "00:00";
  int h = 0, m = 0;
  sscanf(ts, "%d:%d", &h, &m);
  hour     = h;
  minute   = m;
  afterDays = o["afterDays"] | 0;
  enabled   = o["enabled"]   | true;
  duty      = 0;
  channelId = 0;   // doesn't route to any channel
  message   = (const char *)(o["message"] | "");
  return true;
}

