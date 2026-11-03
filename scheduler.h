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
bool schedulerSetStage(uint8_t stageId);   // make a stage active now
int  schedulerStageIndex();                // current stage, -1 = none
void schedulerRestorePause();   // after a reboot during a service pause
void schedulerResume();
void schedulerStop();
void schedulerTick();
void setupScheduler(void);
void schedulerStart();
void schedulerForgetEvents();   // call when EVENTS are deleted
const char* schedulerNotice();  // text of the Message output, or nullptr
void schedulerNoticeOk();       // the user confirmed the message (OK)
// Start with a given start time; recovering = true after a reboot or when
// the running preset was edited (folds an old FROZEN_DAYS into the start)
void schedulerStartAt(uint32_t startEpoch, bool recovering);
void buildEventsFromPreset(const JsonObject& preset);
extern uint32_t schedulerStartEpoch;
extern uint32_t NOW_EPOCH;
extern Ticker schedulerTicker;
extern tm NOW;
void updateNow();

