#pragma once
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <FS.h>
#include <SPIFFS.h>
#include "scheduler.h"   // the sketch folder copy, not a library one
#include "outputs.h"
#include "sound.h"

void setupPlayground();
extern void schedulerPause();
extern void schedulerResume();

