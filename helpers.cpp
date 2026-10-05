#include "helpers.h"

 uint32_t schedulerStartEpoch;
 uint32_t NOW_EPOCH;
 uint8_t rtcData[RTCDATACOUNT];
 tm NOW;

void saveTaskData() {
  RTC.writeRAM(0x0A, rtcData, RTCDATACOUNT);
}
void loadTaskData() {
  RTC.readRAM(0x0A, rtcData, RTCDATACOUNT);
}


uint32_t convertToMs(uint16_t value, const String &unit) {
  if (unit == "ms")  return value;
  if (unit == "s")   return value * 1000UL;
  if (unit == "min") return value * 60000UL;
  return value;
}

uint32_t convertTimeUnit(uint16_t value, const String &unit) {
  if (unit == "ms") return value;
  if (unit == "s")  return value * 1000UL;
  if (unit == "m")  return value * 60000UL;
  return value;
}

uint32_t dateToEpoch(const tm &t) {
  struct tm tm {};
  tm.tm_year = t.tm_year;    // tm_year = years since 1900
  tm.tm_mon  = t.tm_mon;
  tm.tm_mday = t.tm_mday;
  tm.tm_hour = t.tm_hour;
  tm.tm_min  = t.tm_min;
  tm.tm_sec  = 0;
  tm.tm_isdst = 0;

  return mktime(&tm);
}

void epochToDate(uint32_t epoch, tm &out) {
    time_t t = epoch;
    gmtime_r(&t, &out);   // convert epoch → UTC tm
}



bool parseStartTime(const String &s, tm &ts) {
  if (s.length() < 16) return false;

  ts.tm_year  = s.substring(0, 4).toInt();
  ts.tm_mon = s.substring(5, 7).toInt();
  ts.tm_mday   = s.substring(8, 10).toInt();
  ts.tm_hour  = s.substring(11, 13).toInt();
  ts.tm_min   = s.substring(14, 16).toInt();
  ts.tm_sec   =0;
  return true;
}

int daysInMonth(int year, int month) {
  static const int days[] = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
  int d = days[month - 1];
  // leap year check
  if (month == 2 && ((year % 4 == 0 && year % 100 != 0) || (year % 400 == 0))) d = 29;
  return d;
}



uint16_t crc16(const uint8_t *data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >> 1) ^ 0xA001;
      else crc >>= 1;
    }
  }
  return crc;
}

void parseHHMM(const String &t, uint8_t &hour, uint8_t &minute) {
  hour   = t.substring(0, 2).toInt();
  minute = t.substring(3, 5).toInt();
}




void rtcGetTimeString(char *buf, size_t len) {
    snprintf(buf, len, "%02d:%02d:%02d",
             NOW.tm_hour,
             NOW.tm_min,
             NOW.tm_sec);
}

void tmToString(const tm &t, String &out) {
  char buf[20]; // "YYYY-MM-DD HH:MM" + null
  snprintf(buf, sizeof(buf),
           "%04d-%02d-%02d %02d:%02d",
           t.tm_year + 1900,
           t.tm_mon + 1,
           t.tm_mday,
           t.tm_hour,
           t.tm_min);
  out = buf;
}

String epochToStr(uint32_t epoch)
{
    time_t t = epoch;
    tm *tmPtr = localtime(&t);

    char buf[20]; // "YYYY-MM-DD HH:MM:SS"
    snprintf(buf, sizeof(buf),
             "%04d-%02d-%02d %02d:%02d:%02d",
             tmPtr->tm_year + 1900,
             tmPtr->tm_mon + 1,
             tmPtr->tm_mday,
             tmPtr->tm_hour,
             tmPtr->tm_min,
             tmPtr->tm_sec);

    return String(buf);
}

String RTCTime() {
    // Read current RTC values
    RTC.readTime();

    int year = RTC.yyyy;     // full year (e.g., 2026)
    int month = RTC.mm;
    int day = RTC.dd;
    int hour = RTC.h;
    int minute = RTC.m;
    int second = RTC.s;

    char buf[25];
    snprintf(buf, sizeof(buf),
             "%04d-%02d-%02dT%02d:%02d:%02d",
             year, month, day, hour, minute, second);

    return String(buf);
}

tm GetStartTimeFromRtc() {
  loadTaskData();
  tm t{};
  // START_YEAR is 26 for 2026
  int fullYear = START_YEAR + 2000;
  t.tm_year = fullYear - 1900;  // years since 1900
  t.tm_mon = START_MONTH - 1;   // 0–11
  t.tm_mday = START_DAY;
  t.tm_hour = START_HOUR;
  t.tm_min = START_MIN;
  t.tm_sec = 0;
  return t;
}

void PutStartTimetoRtc(tm t) {
  int fullYear = t.tm_year + 1900;  // back to full year
  START_YEAR = fullYear - 2000;  // store as 0–99
  START_MONTH = t.tm_mon + 1;    // back to 1–12
  START_DAY = t.tm_mday;
  START_HOUR = t.tm_hour;
  START_MIN = t.tm_min;
  saveTaskData();
}

void ClearStartTimeInRtc() {
  START_YEAR = 0;
  START_MONTH = 0;
  START_DAY = 0;
  START_HOUR = 0;
  START_MIN = 0;
  FROZEN_DAYS = 0;
  saveTaskData();
}

void writeTime(JsonObject &o, uint8_t hour, uint8_t minute) {
  char buf[6];
  snprintf(buf, sizeof(buf), "%02u:%02u", hour, minute);
  o["time"] = buf;
}

String printHHMM(uint8_t hour, uint8_t minute)
{
      char tbuf[6];
      snprintf(tbuf, sizeof(tbuf), "%02d:%02d", hour, minute);
      return tbuf;
}
