#warning ArduinoJson version: ARDUINOJSON_VERSION
#include <DNSServer.h>
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <SPIFFS.h>
#include "site.H"
#include "homenet.h"
//#include "DHTesp.h"
#include "ESPAsyncWebServer.h"
#include <AsyncTCP.h>
bool requireSession(AsyncWebServerRequest *req);   // site.cpp
#include <esp_task_wdt.h>
#include <Ticker.h>
#include "Wire.h"
#include "sound.h"
#include "my_crypto.h"
#include <base64.h>
#include "mbedtls/base64.h"
#include "driver/dac.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include <ArduinoJson.h>
#include <MD_DS1307.h>
#include <time.h>
#include <sys/time.h>
#include "tasks.h"
#include "scheduler.h"
#include "outputs.h"
#include "sensors.h"
#include "playground.h"
extern "C" {
#include "driver/rtc_io.h"
}

AsyncWebServer server(80);
DNSServer dnsServer;

#define SDPIN 27
#define RTC_SCL 32
#define RTC_SDA 26
char decoded[32];
char *ssid = "Premifarm-THS3-1";   // factory AP name (printed on the box)
// AP name in use: the Network Name (SSID) from the Settings page
// (/ap_ssid.txt), or the factory name. The farm's name on the home network
// is made from it (farmHostName).
String apName = ssid;

// The AP name as a network host name: lower case, letters, digits and "-"
// ("Premifarm-THS3-1" -> "premifarm-ths3-1"). Used for the router's list
// (DHCP) and for http://<name>.local/ (mDNS).
String farmHostName() {
  String h;
  for (size_t i = 0; i < apName.length() && h.length() < 32; i++) {
    char c = apName[i];
    if (c >= 'A' && c <= 'Z') c = c - 'A' + 'a';
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) h += c;
    else if (h.length() && h[h.length() - 1] != '-') h += '-';
  }
  while (h.length() && h[h.length() - 1] == '-') h.remove(h.length() - 1);
  return h.length() ? h : String("premifarm");
}
String password;

String userName;
String yourSecretPassword;
String defaultPassword = "12345";
String idString;
String mainKey;
String mainPass = "";
IPAddress authorizedIP;
bool isConnected = false;
int sessionTimeout = 0;
const unsigned long authTimeout = 2 * 60 * 1000;

struct TargetDate {
  int year, month, day, hour, minute;
};

String wifiSSID = "";
String wifiPass = "";
bool stationConnected = false;
IPAddress IP(192, 168, 4, 1);

// ─────────────────────────────────────────────────────────────────────────────
//  WiFi credentials — SPIFFS /wifi.json
// ─────────────────────────────────────────────────────────────────────────────

void saveWifiCredentials(const String &ssid, const String &pass);

// Older firmware kept the home network in /sta_ssid.txt and /sta_pass.txt
// (written by the Settings page). Read them once and move them into
// /wifi.json, the only place the home network code reads.
static bool migrateOldWifiFiles() {
  if (!SPIFFS.exists("/sta_ssid.txt")) return false;
  String ssid, pass;
  File f = SPIFFS.open("/sta_ssid.txt", "r");
  if (f) { ssid = f.readStringUntil('\n'); ssid.trim(); f.close(); }
  if (SPIFFS.exists("/sta_pass.txt")) {
    f = SPIFFS.open("/sta_pass.txt", "r");
    if (f) { pass = f.readStringUntil('\n'); f.close(); }
  }
  if (ssid.isEmpty()) return false;
  saveWifiCredentials(ssid, pass);
  SPIFFS.remove("/sta_ssid.txt");
  SPIFFS.remove("/sta_pass.txt");
  Serial.printf("WiFi: moved ssid='%s' from the old files\n", ssid.c_str());
  return true;
}

bool loadWifiCredentials() {
  // On the ESP32, opening a missing file does not fail: it returns an empty
  // handle that looks like a directory. So check that the file exists.
  File f;
  if (SPIFFS.exists("/wifi.json")) f = SPIFFS.open("/wifi.json", "r");
  if (!f || f.isDirectory()) {
    if (migrateOldWifiFiles()) return loadWifiCredentials();
    Serial.println("WiFi: no credentials file");
    return false;
  }

  StaticJsonDocument<256> doc;
  const size_t fsize = f.size();
  DeserializationError err = deserializeJson(doc, f);
  if (err) {
    f.close();
    Serial.printf("WiFi: credentials parse error (%s, file %u bytes)\n",
                  err.c_str(), (unsigned)fsize);
    SPIFFS.remove("/wifi.json");            // broken: do not read it again
    if (migrateOldWifiFiles()) return loadWifiCredentials();
    return false;
  }
  f.close();

  wifiSSID = doc["ssid"] | "";
  wifiPass = doc["pass"] | "";

  if (wifiSSID.isEmpty() || wifiPass.isEmpty()) {
    Serial.println("WiFi: empty credentials");
    return false;
  }
  Serial.printf("WiFi: loaded ssid='%s'\n", wifiSSID.c_str());
  return true;
}

void saveWifiCredentials(const String &ssid, const String &pass) {
  StaticJsonDocument<256> doc;
  doc["ssid"] = ssid;
  doc["pass"] = pass;

  File f = SPIFFS.open("/wifi.json", "w");
  if (!f) { Serial.println("WiFi: cannot save credentials"); return; }
  serializeJson(doc, f);
  f.close();
  Serial.printf("WiFi: credentials saved, ssid='%s', password %u chars\n",
                ssid.c_str(), (unsigned)pass.length());
}

// ─────────────────────────────────────────────────────────────────────────────
//  Misc helpers
// ─────────────────────────────────────────────────────────────────────────────

bool ask = false;

String Val(int input) {
  return digitalRead(input) ? "ON" : "OFF";
}

int anOutput = 0;

String readFile(fs::FS &fs, const char *path) {
  Serial.printf("Reading file: %s\r\n", path);
  File file = SPIFFS.open(path, "r");
  if (!file || file.isDirectory()) {
    Serial.println("- empty file or failed to open file");
    return String();
  }
  Serial.println("- read from file...");
  String fileContent;
  while (file.available()) fileContent += String((char)file.read());
  file.close();
  Serial.printf("file %s\r\n ridden", path);
  return fileContent;
}

void writeFile(fs::FS &fs, const char *path, const char *message) {
  File file = SPIFFS.open(path, "w");
  if (!file) { Serial.println("- failed to open file for writing"); return; }
  if (file.print(message)) Serial.println("- file written");
  else                      Serial.println("- write failed");
  file.close();
}

void p() {
  digitalWrite(SDPIN, HIGH);
  play_sound("/zvuk.wav", SPIFFS);
  delay(400);
  digitalWrite(SDPIN, LOW);
  Serial.println("Sound played.");
}

int pwmIndex = 0;

// ---------------------------------------------------------------------------
//  Network settings reset: hold PROG (GPIO0) for 10 s while running
// ---------------------------------------------------------------------------
// GPIO0 selects the boot mode only at power-up / reset; afterwards it is a
// plain input with its own pull-up (R1). Held down for 10 s it sets the
// network settings back to the factory values printed on the box:
// AP "Premifarm-THS3-1" with password 1234567890, no home network, automatic
// IP settings, AP address 192.168.4.1. Tasks, schedules and the clock stay.
// 10 s (not less): when flashing, PROG is held only briefly before RESET.
#define PROG_PIN 0
static const unsigned long CRED_RESET_HOLD_MS = 10000;
static const char *FACTORY_AP_PASS = "1234567890";

void resetNetworkSettings() {
  Serial.println("PROG held 10 s: network settings back to factory values");
  const char *files[] = { "/wifi.json", "/sta_ssid.txt", "/sta_pass.txt",
                          "/sta_ip.json", "/ap_ip.txt", "/ap_ssid.txt" };
  for (const char *f : files) {
    const bool had = SPIFFS.exists(f);
    const bool removed = had && SPIFFS.remove(f);
    Serial.printf("  %s: %s\n", f, !had ? "not there" : removed ? "removed" : "REMOVE FAILED");
  }
  writeFile(SPIFFS, "/pass.txt", FACTORY_AP_PASS);
  p();                       // sound: done
  delay(500);
  ESP.restart();
}

// Called from loop(): counts how long PROG is held down
void checkProgButton() {
  static unsigned long downSince = 0;
  static bool down = false, fired = false;
  if (digitalRead(PROG_PIN) == LOW) {
    if (!down) { down = true; fired = false; downSince = millis(); }
    else if (!fired && millis() - downSince >= CRED_RESET_HOLD_MS) {
      fired = true;          // once per press
      resetNetworkSettings();
    }
  } else {
    down = false;
  }
}

void restartServer() {
  dnsServer.stop();
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_OFF);
  delay(100);
  WiFi.mode(WIFI_AP);
  delay(50);
  WiFi.softAPConfig(IP, IP, IPAddress(255, 255, 255, 0));
  WiFi.softAP(apName.c_str());
  delay(100);
  Serial.println("Setting soft-AP configuration ...");
  if (!dnsServer.start(53, "*", IP)) Serial.println("DNS fail");
  newSession();
}

// ─────────────────────────────────────────────────────────────────────────────
//  RTC
// ─────────────────────────────────────────────────────────────────────────────

void setupRTC() {
  Serial.println("Checking DS1307...");
  if (!RTC.isRunning()) {
    Serial.println("Clock is NOT running. Starting...");
    RTC.control(DS1307_CLOCK_HALT, DS1307_OFF);
  } else {
    Serial.println("Clock is running.");
  }
  Serial.println("Reading DS1307...");
  RTC.readTime();
  Serial.printf("Time: %02d:%02d:%02d\n", RTC.h, RTC.m, RTC.s);

  server.on("/api/time", HTTP_GET, [](AsyncWebServerRequest *request) {
    String t = RTCTime();
    request->send(200, "application/json", "{\"time\":\"" + t + "\"}");
  });

  server.on("/api/time", HTTP_POST,
    [](AsyncWebServerRequest *request) {},
    NULL,
    [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t, size_t) {
      if (!requireSession(request)) return;   // only the session owner sets the clock
      StaticJsonDocument<100> doc;
      if (deserializeJson(doc, data, len)) {
        request->send(400, "application/json", "{\"error\":\"bad json\"}");
        return;
      }
      const char *t = doc["time"];
      if (!t) {
        request->send(400, "application/json", "{\"error\":\"missing time\"}");
        return;
      }
      int Y, M, D, h, m, dow;
      if (sscanf(t, "%d-%d-%dT%d:%d-%d", &Y, &M, &D, &h, &m, &dow) != 6) {
        request->send(400, "application/json", "{\"error\":\"bad format\"}");
        return;
      }
      Serial.printf("Frontend sent: Y:%d M:%d D:%d h:%d m:%d dow:%d\n", Y, M, D, h, m, dow);
      RTC.yyyy = Y; RTC.mm = M; RTC.dd = D;
      RTC.h = h;   RTC.m  = m; RTC.s  = 0;
      RTC.dow = dow;
      RTC.writeTime();
      RTC.control(DS1307_CLOCK_HALT, DS1307_OFF);
      Serial.println("RTC Time was set to: " + RTCTime());
      request->send(200, "application/json", "{\"status\":\"ok\"}");
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Legacy session (password-hash based) — kept for compatibility
//  The new cookie-based session lives in site.cpp (sessionToken / tickSession).
// ─────────────────────────────────────────────────────────────────────────────

String storedPasswordHash;
int tryAttempt;
unsigned long lastAuthTime;

void newSession() {
  mainKey = generateRandomKey(16);
  isConnected = false;
  tryAttempt = random(3, 6);

  String masked = defaultPassword + mainKey;
  storedPasswordHash = sha256(masked);

  Serial.println("New session started");
  Serial.println("Key: " + mainKey);
  Serial.println("Stored hash: " + storedPasswordHash);
}

void autorize(AsyncWebServerRequest *request) {
  lastAuthTime  = millis();
  sessionTimeout = int(authTimeout - (millis() - lastAuthTime));
  Serial.println("Redirecting...");
  authorizedIP = request->client()->remoteIP();
  isConnected  = true;
}

void trigTimeout() {
  if (isConnected) {
    sessionTimeout = int(authTimeout - (millis() - lastAuthTime));
    if (sessionTimeout < 10) {
      newSession();
      Serial.println("Session Expired");
    }
  }
  Serial.print("session timeout= ");
  Serial.println(sessionTimeout);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Playground slider
// ─────────────────────────────────────────────────────────────────────────────

void slider_setting(AsyncWebServerRequest *request) {
  if (!request->hasParam("channel", true) || !request->hasParam("value", true)) {
    request->send(400, "text/plain", "Missing parameters");
    return;
  }
  int ch    = request->getParam("channel", true)->value().toInt();
  int value = request->getParam("value",   true)->value().toInt();

  if (ch < 0 || ch >= OUTPUT_COUNT || OUT[ch].isVirtual() || value < 0 || value > 100) {
    request->send(400, "text/plain", "Invalid parameters");
    return;
  }
  Serial.printf("Playground slider: channel=%d, value=%d\n", ch, value);
  OUT[ch].mode = MODE_ANALOG_DIRECT;
  OUT[ch].setTarget(value);
  request->send(200, "text/plain", "OK");
  Serial.printf("Channel %d target set to %d\n", ch, value);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ticker for session timeout (every 1 s)
// ─────────────────────────────────────────────────────────────────────────────

Ticker sessionTicker;

void everySecond() {
  tickSession();   // cookie-based session (site.cpp)
  trigTimeout();   // legacy session (kept for compatibility)
}

// ─────────────────────────────────────────────────────────────────────────────
//  setup / loop
// ─────────────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  Serial.println("Firmware: stages + wifi fix + PROG reset, 2026-11-03");

  if (!SPIFFS.begin(true)) {
    Serial.println("An Error has occurred while mounting SPIFFS");
    return;
  }
  Wire.begin(RTC_SDA, RTC_SCL);
  Serial.println("SPIFFS initialized");

  // Clear any leftover session state from previous run
  sessionToken   = "";
  lastActivityMs = 0;

  defaultPassword = readFile(SPIFFS, "/pass.txt");
  idString        = readFile(SPIFFS, "/register.txt");

  // AP name from the Settings page, else the factory name
  if (SPIFFS.exists("/ap_ssid.txt")) {
    File f = SPIFFS.open("/ap_ssid.txt", "r");
    if (f && !f.isDirectory()) {
      String n = f.readStringUntil('\n');
      n.trim();
      if (n.length() > 0 && n.length() <= 32) apName = n;
    }
    if (f) f.close();
  }

  // Start Access Point (its address may have been moved out of the home
  // network's range before: homenet.cpp)
  IP = homeNetLoadApIp();
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IP, IP, IPAddress(255, 255, 255, 0));
  // Use password from /pass.txt if >= 8 chars, otherwise open network
  if (defaultPassword.length() >= 8)
    WiFi.softAP(apName.c_str(), defaultPassword.c_str());
  else
    WiFi.softAP(apName.c_str());
  delay(100);
  if (!dnsServer.start(53, "*", IP))
    Serial.println("DNS fail");
  Serial.printf("AP started: '%s'  IP: %s\n", apName.c_str(), WiFi.softAPIP().toString().c_str());

  newSession();
  handleSite();   // register all endpoints including /wifi/*

  if (idString == "false;") yourSecretPassword = defaultPassword;
  initLEDC();

  setupRTC();
  setupOutputs();
  setupSensors();

  delay(100);
  setupTasks();
  setupScheduler();
  setupPlayground();

  server.begin();
  TryTaskStart();

  sessionTicker.attach(1.0f, everySecond);

  delay(100);
  pinMode(SDPIN, OUTPUT);
  pinMode(PROG_PIN, INPUT_PULLUP);   // PROG button (external pull-up R1 too)
  setup_sound();
  soundBegin(SDPIN);   // playback task for scheduled and Playground sounds
  p();
}

// A Playground pause ends when its user is gone (Leave, page closed, phone
// left the network, idle timeout, reboot); a warning sound tells it.
void checkAutoResume() {
  if (!sessionFree()) return;
  if (schedulerAutoResume()) soundPlay("warning.wav", SOUND_DEFAULT_VOLUME);
}

void loop() {
  dnsServer.processNextRequest();
  tickWifiScan();   // completes async scan and updates cache without blocking
  homeNetLoop();    // joins / watches the home network in the background
  checkProgButton();  // PROG held 10 s: network settings to factory values
  checkAutoResume();  // Playground pause with nobody in control: continue
  delay(1);
}
