// default_task.h
// Built-in template schedule (task index 0, "Default").
// It is never stored in SPIFFS, so it cannot be deleted: whenever no user
// task exists, this one is listed and run. Saving it under a new name in the
// web editor creates a normal user task based on it.
//   Group 1: all lights (ch 0..4) 50 %, daily 06:30 on / 22:30 off, 2 min ramp
//   Group 2: pump (ch 5) custom cycle, 10 s on / 60 min off, starts at once
// rise/fall are in milliseconds, on/off in seconds.
#pragma once
#include <Arduino.h>

static const char DEFAULT_TASK_JSON[] PROGMEM = R"JSON(
{
 "name": "Default",
 "schedule": [
  {
   "groupId": 1,
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 0,
   "repeat": "daily",
   "rise": 120000,
   "fall": 120000,
   "on": 0,
   "off": 0,
   "enabled": true,
   "time": "06:30",
   "duty": 50
  },
  {
   "groupId": 1,
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 0,
   "repeat": "daily",
   "rise": 120000,
   "fall": 120000,
   "on": 0,
   "off": 0,
   "enabled": true,
   "time": "22:30",
   "duty": 0
  },
  {
   "groupId": 1,
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 1,
   "repeat": "daily",
   "rise": 120000,
   "fall": 120000,
   "on": 0,
   "off": 0,
   "enabled": true,
   "time": "06:30",
   "duty": 50
  },
  {
   "groupId": 1,
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 1,
   "repeat": "daily",
   "rise": 120000,
   "fall": 120000,
   "on": 0,
   "off": 0,
   "enabled": true,
   "time": "22:30",
   "duty": 0
  },
  {
   "groupId": 1,
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 2,
   "repeat": "daily",
   "rise": 120000,
   "fall": 120000,
   "on": 0,
   "off": 0,
   "enabled": true,
   "time": "06:30",
   "duty": 50
  },
  {
   "groupId": 1,
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 2,
   "repeat": "daily",
   "rise": 120000,
   "fall": 120000,
   "on": 0,
   "off": 0,
   "enabled": true,
   "time": "22:30",
   "duty": 0
  },
  {
   "groupId": 1,
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 3,
   "repeat": "daily",
   "rise": 120000,
   "fall": 120000,
   "on": 0,
   "off": 0,
   "enabled": true,
   "time": "06:30",
   "duty": 50
  },
  {
   "groupId": 1,
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 3,
   "repeat": "daily",
   "rise": 120000,
   "fall": 120000,
   "on": 0,
   "off": 0,
   "enabled": true,
   "time": "22:30",
   "duty": 0
  },
  {
   "groupId": 1,
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 4,
   "repeat": "daily",
   "rise": 120000,
   "fall": 120000,
   "on": 0,
   "off": 0,
   "enabled": true,
   "time": "06:30",
   "duty": 50
  },
  {
   "groupId": 1,
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 4,
   "repeat": "daily",
   "rise": 120000,
   "fall": 120000,
   "on": 0,
   "off": 0,
   "enabled": true,
   "time": "22:30",
   "duty": 0
  },
  {
   "groupId": 2,
   "time": "--:--",
   "afterDays": 0,
   "expireAfterDays": 0,
   "channelId": 5,
   "repeat": "custom",
   "duty": 100,
   "rise": 500,
   "fall": 0,
   "on": 10,
   "off": 3600,
   "enabled": true
  }
 ]
}
)JSON";
