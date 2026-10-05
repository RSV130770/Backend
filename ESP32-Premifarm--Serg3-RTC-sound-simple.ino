#warning ArduinoJson version: ARDUINOJSON_VERSION
#include <DNSServer.h>
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <SPIFFS.h>
#include "site.H"
//#include "DHTesp.h"
#include "ESPAsyncWebServer.h"
#include <AsyncTCP.h>
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
char *ssid = "Premifarm-THS3-1";
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

bool loadWifiCredentials() {
  File f = SPIFFS.open("/wifi.json", "r");
  if (!f) { Serial.println("WiFi: no credentials file"); return false; }

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, f)) {
    f.close();
    Serial.println("WiFi: credentials parse error");
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
  Serial.println("WiFi: credentials saved");
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

void restartServer() {
  dnsServer.stop();
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_OFF);
  delay(100);
  WiFi.mode(WIFI_AP);
  delay(50);
  WiFi.softAPConfig(IP, IP, IPAddress(255, 255, 255, 0));
  WiFi.softAP(ssid);
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

  if (ch < 0 || ch >= OUTPUT_COUNT || value < 0 || value > 100) {
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

  // Start Access Point
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IP, IP, IPAddress(255, 255, 255, 0));
  // Use password from /pass.txt if >= 8 chars, otherwise open network
  if (defaultPassword.length() >= 8)
    WiFi.softAP(ssid, defaultPassword.c_str());
  else
    WiFi.softAP(ssid);
  delay(100);
  if (!dnsServer.start(53, "*", IP))
    Serial.println("DNS fail");
  Serial.printf("AP started: '%s'  IP: %s\n", ssid, WiFi.softAPIP().toString().c_str());

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
  setup_sound();
  p();
}

void loop() {
  dnsServer.processNextRequest();
  tickWifiScan();   // completes async scan and updates cache without blocking
  delay(1);
}
