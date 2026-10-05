#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <MD_DS1307.h>
#include <time.h>
#define  RTCDATACOUNT 10 
#define  PRESET_ID rtcData[0]
#define  TASK_STATUS rtcData[1]
#define  START_YEAR rtcData[2]
#define  START_MONTH rtcData[3]
#define  START_DAY rtcData[4]
#define  START_HOUR rtcData[5]
#define  START_MIN rtcData[6]
#define  FROZEN_DAYS rtcData[7]

#define T_STOP 0
#define T_START 1
#define T_PAUSE 2
#define T_FROZEN 3
extern uint32_t schedulerStartEpoch;
extern uint32_t NOW_EPOCH;
extern tm NOW;
extern uint8_t rtcData[RTCDATACOUNT];

uint32_t convertToMs(uint16_t value, const String &unit);
uint32_t convertTimeUnit(uint16_t value, const String &unit);

uint32_t dateToEpoch(const tm &t);
void epochToDate(uint32_t epoch, tm &out);
bool parseStartTime(const String &s, tm &ts);

uint16_t crc16(const uint8_t *data, size_t len);

void parseHHMM(const String &t, uint8_t &hour, uint8_t &minute);
void rtcGetTimeString(char *buf, size_t len);
//String tmToString(const tm &t);
void tmToString(const tm &t, String &out);
String epochToStr(uint32_t epoch);
String RTCTime();
tm GetStartTimeFromRtc();
void PutStartTimetoRtc(tm t);
void ClearStartTimeInRtc();
void saveTaskData();
void loadTaskData();

void writeTime(JsonObject &o, uint8_t hour, uint8_t minute);
String printHHMM(uint8_t hour, uint8_t minute);
