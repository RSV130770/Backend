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
void buildEventsFromPreset(const JsonObject& preset);
extern uint32_t schedulerStartEpoch;
extern uint32_t NOW_EPOCH;
extern Ticker schedulerTicker;
extern tm NOW;
void updateNow();

