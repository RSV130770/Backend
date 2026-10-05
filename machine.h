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
extern uint32_t freezeEntryEpoch;  // when freeze began
class MachineEvent {
public:
  EventType type = EVENT_DAILY;
  uint8_t durationDays = 0;
  uint8_t channelId = 0;
  Output *out = nullptr;  // direct pointer to output
  uint8_t duty = 0;
  uint8_t hour = 0;
  uint8_t minute = 0;
  uint8_t afterDays = 0;
  bool enabled = true;

  uint32_t activationEpoch = 0;  // cached activation time

  virtual ~MachineEvent() = default;

  // Called when scheduler decides this event is the latest for this output
  virtual void applyAt() = 0;

  // Direct application of event state
  virtual void applyTo() = 0;

  // Compute activation time (Once + Custom use this directly)
  virtual void computeActivation() {
    activationEpoch =
      schedulerStartEpoch + afterDays * 86400u + hour * 3600u + minute * 60u;
  }
  virtual bool isExpired() const {
    if (durationDays == 0) return false;
    return NOW_EPOCH > activationEpoch + (uint32_t)durationDays * 86400u;
  }
  virtual void ToNextSwitch() const;
  virtual void toJson(JsonObject &o) const;
  virtual bool fromJson(const JsonObject &o);
};


extern std::vector<MachineEvent *> EVENTS;
// --
// DailyEvent
// --
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

  void toJson(JsonObject &o) const override;
  bool fromJson(const JsonObject &o) override;
};


class FreezeEvent : public MachineEvent {
public:
  FreezeEvent() {
    type = EVENT_FREEZE;
    duty = 0;
  }

  void applyTo() override {}
  void applyAt() override {
    if (TASK_STATUS != T_FROZEN)
      TASK_STATUS = T_FROZEN;
  }
  void computeActivation() override {
    activationEpoch =
      schedulerStartEpoch + afterDays * 86400u + hour * 3600u + minute * 60u;
  }
  void toJson(JsonObject &o) const override;
  bool fromJson(const JsonObject &o) override;
};

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