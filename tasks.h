#ifndef TASKS_H
#define TASKS_H

#pragma once
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <AsyncTCP.h>
#include <FS.h>
#include <SPIFFS.h>
#include <MD_DS1307.h>
#include "driver/ledc.h"
#include "outputs.h"
#include "helpers.h"
#include "sensors.h"
#include "machine.h"
#include "scheduler.h"
extern std::vector<MachineEvent *> EVENTS;
// remove:
// struct TaskInfo, extern std::vector<TaskInfo> TASK_LIST
// buildTaskList(), loadTaskFromFile(), saveTaskToFile()
// findFirstFreeTaskIndex(), handleTasks(), handleTaskContent()
// handleTaskStart/Stop/Pause/Resume/Save()

// add:
bool savePresetToFile(const JsonObject& preset);
bool loadPresetFromFile(uint8_t id, DynamicJsonDocument& doc);
bool startFromPreset(uint8_t id);
void loadDefaultTask();
void deleteEvents();
void TryTaskStart();
void handlePresetList(AsyncWebServerRequest *req);
void handlePresetContent(AsyncWebServerRequest *req);
void handlePresetSave(AsyncWebServerRequest *req, uint8_t *data, size_t len);
void handlePresetStart(AsyncWebServerRequest *req, uint8_t *data, size_t len);
void handlePresetStop(AsyncWebServerRequest *req);
void handlePresetPause(AsyncWebServerRequest *req);
void handlePresetResume(AsyncWebServerRequest *req);
void handleApiState(AsyncWebServerRequest *req);
String formatStartTime();
String taskStatusToString();
void setupTasks();
#endif