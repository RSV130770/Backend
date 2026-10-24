#include "machine.h"

std::vector<MachineEvent *> EVENTS;
uint32_t freezeEntryEpoch;   // when freeze began
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

void DailyEvent::computeActivation() {
    // Base day = scheduler start day + afterDays
    time_t base = schedulerStartEpoch + afterDays * 86400;

    // Build today's HH:MM
    tm t = NOW;
    t.tm_hour = hour;
    t.tm_min  = minute;
    t.tm_sec  = 0;

    time_t todayEvent = mktime(&t);

    // If today is before base day → schedule at base day
    if (todayEvent < base) {
        tm baseDate = *localtime(&base);
        baseDate.tm_hour = hour;
        baseDate.tm_min  = minute;
        baseDate.tm_sec  = 0;
        activationEpoch = mktime(&baseDate);
        return;
    }

    // Otherwise today's time, even if it has already passed: the scheduler
    // then applies the newest passed event of each channel (so after a
    // reboot at noon the lights come back on instead of waiting for
    // tomorrow) and moves the older ones to the next day.
    activationEpoch = todayEvent;
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

  // Schedule next day's activation at the same HH:MM
  tm next = NOW;
  next.tm_mday += 1;
  next.tm_hour = hour;
  next.tm_min  = minute;
  next.tm_sec  = 0;

  activationEpoch = mktime(&next);
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
void CustomEvent::computeActivation() {
    activationEpoch =
        schedulerStartEpoch +
        afterDays * 86400u +
        hour * 3600u +
        minute * 60u;
}

// Clock time HH:MM on the day (task start day + afterDays). The web editor
// shows once events and pause points with a clock time, not as an offset.
uint32_t clockTimeOnTaskDay(uint8_t afterDays, uint8_t hour, uint8_t minute) {
  time_t day = (time_t)schedulerStartEpoch + (time_t)afterDays * 86400;
  tm t = *localtime(&day);
  t.tm_hour = hour;
  t.tm_min  = minute;
  t.tm_sec  = 0;
  return (uint32_t)mktime(&t);
}

void OnceEvent::computeActivation() {
  activationEpoch = clockTimeOnTaskDay(afterDays, hour, minute);
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

