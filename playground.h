#pragma once
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <FS.h>
#include <SPIFFS.h>
#include <scheduler.h>
#include "outputs.h"

void setupPlayground();
extern void schedulerPause();
extern void schedulerResume();

