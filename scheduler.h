#pragma once
#include <vector>
#include "machine.h"
#include <Arduino.h>
#include "helpers.h"
#include "outputs.h"
#include <MD_DS1307.h>
#include "tasks.h"
#include <time.h>
void schedulerInit();
void schedulerPause();
void schedulerResume();
void schedulerStop();
void schedulerTick();
void setupScheduler(void);
void schedulerStart();
// Start with a given start time; recovering = true keeps FROZEN_DAYS
// (used after a reboot or when the running preset was edited)
void schedulerStartAt(uint32_t startEpoch, bool recovering);
void buildEventsFromPreset(const JsonObject& preset);
extern uint32_t schedulerStartEpoch;
extern uint32_t NOW_EPOCH;
extern Ticker schedulerTicker;
extern tm NOW;
void updateNow();

