#ifndef MACHINE_H
#define MACHINE_H

#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "outputs.h"
#include "helpers.h"
#include <time.h>

// Forward declaration 

// --
// Base class: MachineEvent
// --


enum EventType {
  EVENT_DAILY,
  EVENT_CUSTOM,
  EVENT_ONCE,
  EVENT_FREEZE
};

// --
// Stages of the running preset (built by buildEventsFromPreset)
// --
// Stages run one after another. A stage starts at the task start plus the
// lengths of the stages before it (offsetMin). Length 0 = open-ended: it
// runs until Stop and can only be the last stage.
struct StageInfo {
  uint8_t  id = 0;          // id from the preset file
  String   name;
  uint32_t offsetMin = 0;   // minutes from the task start
  uint32_t lenMin = 0;      // minutes, 0 = open-ended
  bool     endPause = false;  // wait for Continue at its end
  String   message;         // shown while waiting
};
extern std::vector<StageInfo> STAGES;

uint32_t stageStartEpoch(uint8_t idx);
uint32_t stageEndEpoch(uint8_t idx);       // UINT32_MAX when open-ended
int stageIndexById(uint8_t id);            // -1 when the preset has no such stage
// Local midnight "days" calendar days after the day of "epoch"
uint32_t dayMidnight(uint32_t epoch, int days);

class MachineEvent {
public:
  EventType type = EVENT_DAILY;
  uint8_t durationDays = 0;
  uint8_t channelId = 0;
  Output *out = nullptr;  // direct pointer to output
  uint8_t duty = 0;
  uint8_t hour = 0;
  uint8_t minute = 0;
  uint8_t afterDays = 0;     // day of its stage (0 = the stage's first day)
  uint8_t stageIdx = 0;      // index into STAGES
  bool enabled = true;
  String message;   // Message output: the text; pause point: its text
  bool done = false; // once event: applied (or overridden by a later one)

  uint32_t activationEpoch = 0;  // cached activation time
  // Window inside its stage, set by computeActivation():
  uint32_t beginEpoch = 0;            // not in effect before this
  uint32_t ownEndEpoch = UINT32_MAX;  // its own "expireAfterDays"
  uint32_t endEpoch = UINT32_MAX;     // own end, cut at its stage end

  // Time from which the event may act: its activation, but not before
  // its stage (or its day of the stage) begins
  uint32_t effectiveFrom() const {
    return activationEpoch > beginEpoch ? activationEpoch : beginEpoch;
  }

  virtual ~MachineEvent() = default;

  // Called when scheduler decides this event is the latest for this output
  virtual void applyAt() = 0;

  // Direct application of event state
  virtual void applyTo() = 0;

  // Compute activation time and window; each event type overrides it
  virtual void computeActivation() { computeWindow(); }
  // Begin and end inside its stage
  void computeWindow();
  // Ended: past its own end or its stage end. While the task waits at the
  // end of this event's stage, the stage end does not count.
  bool isExpired() const;
  virtual void ToNextSwitch() const;
  virtual void toJson(JsonObject &o) const;
  virtual bool fromJson(const JsonObject &o);
};


extern std::vector<MachineEvent *> EVENTS;
// --
// DailyEvent
// --
// Clock time HH:MM on the day (task start day + days)
uint32_t clockTimeOnTaskDay(uint16_t days, uint8_t hour, uint8_t minute);

class DailyEvent : public MachineEvent {
public:
  uint32_t rampMs = 0;

  DailyEvent() {
    type = EVENT_DAILY;
  }

  // Daily events recompute activation every day
  void computeActivation() override;

  void applyTo() override {
    out->rampMs = rampMs;
    out->setTarget(duty);
  }

  void applyAt() override;
  void ToNextSwitch() const override;
  void toJson(JsonObject &o) const override;
  bool fromJson(const JsonObject &o) override;

  // Move activation to the next HH:MM after now, without applying
  void advanceToNext();
};

// --
// CustomEvent
// --
class CustomEvent : public MachineEvent {
public:
  uint32_t riseMs = 0;
  uint32_t fallMs = 0;
  uint32_t onSeconds = 0;
  uint32_t offSeconds = 0;

  CustomEvent() {
    type = EVENT_CUSTOM;
  }

  void applyTo() override {
    out->riseMs = riseMs;
    out->fallMs = fallMs;
    out->onSeconds = onSeconds;
    out->offSeconds = offSeconds;
    out->setTarget(duty);
  }
  void ToNextSwitch() const override;
  void applyAt() override {
    uint32_t cycle = onSeconds + offSeconds;
    if (cycle == 0) {
      applyTo();
      return;
    }

    uint32_t since = NOW_EPOCH - activationEpoch;
    uint32_t pos = since % cycle;

    if (pos < onSeconds) {
      out->setTarget(duty);
    } else {
      out->setTarget(0);
    }
  }
  void computeActivation() override;
  void toJson(JsonObject &o) const override;
  bool fromJson(const JsonObject &o) override;
};

// --
// OnceEvent
// --
class OnceEvent : public MachineEvent {
public:
  uint32_t rampMs = 0;

  OnceEvent() {
    type = EVENT_ONCE;
  }

  void applyTo() override {
    out->rampMs = rampMs;
    out->setTarget(duty);
  }

  void applyAt() override {
    if (NOW_EPOCH >= activationEpoch)
      applyTo();
  }

  // Clock time HH:MM on the task's day "afterDays" (as shown in the editor)
  void computeActivation() override;

  void toJson(JsonObject &o) const override;
  bool fromJson(const JsonObject &o) override;
};



// A pause point: when it is reached the task waits for the user ("frozen"):
// running processes (daily cycles, custom cycles) go on, only the task's own
// timing (day counter, delays, offsets of later events) stands still until
// the user presses Continue. "message" is shown on the dashboard meanwhile.
class FreezeEvent : public MachineEvent {
public:
  uint8_t seq = 0;   // index of its stage (FREEZE_DONE counts confirmed ones)

  FreezeEvent() {
    type = EVENT_FREEZE;
    duty = 0;
  }

  void applyTo() override {}
  void applyAt() override {
    if (TASK_STATUS != T_FROZEN)
      TASK_STATUS = T_FROZEN;
  }
  // At the end of its stage (made from the stage's endPause)
  void computeActivation() override {
    computeWindow();
    activationEpoch = stageEndEpoch(stageIdx);
    beginEpoch = activationEpoch;
  }
  void toJson(JsonObject &o) const override;
  bool fromJson(const JsonObject &o) override;
};

// The pause point the task is waiting at (nullptr when not waiting).
// Defined in scheduler.cpp.
extern FreezeEvent* activeFreeze;

// Pause points already confirmed with Continue: RTC memory byte 8, so a
// reboot does not ask again (bytes 0..7 are PRESET_ID .. FROZEN_DAYS in
// helpers.h). Defined here only if helpers.h does not define it.
#ifndef FREEZE_DONE
#define FREEZE_DONE rtcData[8]
#endif

// --
// Factory helper for JSON → MachineEvent*
// --

inline MachineEvent *createEventFromJson(const JsonObject &o) {
  const char *t = o["repeat"] | "";

  MachineEvent *ev = nullptr;

  if (strcmp(t, "daily") == 0) {
    ev = new DailyEvent();
  } else if (strcmp(t, "custom") == 0) {
    ev = new CustomEvent();
  } else if (strcmp(t, "once") == 0) {
    ev = new OnceEvent();
  } else if (strcmp(t, "freeze") == 0) {
    ev = new FreezeEvent();
  } else {
    return nullptr;
  }

  // Parse fields (channelId, time, afterDays, duty, enabled)
  if (!ev->fromJson(o)) {
    delete ev;
    return nullptr;
  }

  // Assign output pointer immediately
  if (ev->type != EVENT_FREEZE) {
    if (ev->channelId < OUTPUT_COUNT) {
      ev->out = &OUT[ev->channelId];
    } else {
      Serial.printf("ERROR: event channelId=%u out of range\n", ev->channelId);
      delete ev;
      return nullptr;
    }
  }
  return ev;
}

#endif