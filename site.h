#ifndef SITE_H
#define SITE_H

#include <DNSServer.h>
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <SPIFFS.h>
#include <ArduinoJson.h>
#include <my_crypto.h>

// ── Web server ────────────────────────────────────────────────────────────────
extern AsyncWebServer server;

// ── Hardware callbacks ────────────────────────────────────────────────────────
extern void slider_setting(AsyncWebServerRequest *request);
extern void time_setting(AsyncWebServerRequest *request);
extern void set_switch(AsyncWebServerRequest *request);
extern void writeFile(fs::FS &fs, const char *path, const char *message);
extern String readFile(fs::FS &fs, const char *path);

// ── Session state (defined in site.cpp) ──────────────────────────────────────
//
//  sessionToken  — random 16-char token, valid for one active controller.
//                  Empty string = no active session.
//  SESSION_TIMEOUT_MS — milliseconds of inactivity before session expires.
//
extern String sessionToken;
extern unsigned long lastActivityMs;

static const unsigned long SESSION_TIMEOUT_MS = 5UL * 60UL * 1000UL; // 5 min

// ── Globals owned by .ino ─────────────────────────────────────────────────────
extern String defaultPassword;    // loaded from /pass.txt → used for softAP WPA2
extern String mainKey;            // kept for crypto helpers if needed later
extern bool stationConnected;
extern String wifiSSID;           // last known STA ssid
extern String wifiPass;           // last known STA password
extern IPAddress IP;              // softAP address (192.168.4.1)
extern DNSServer dnsServer;       // captive-portal DNS
extern char *ssid;                // default AP SSID (fallback)
extern void saveWifiCredentials(const String &ssid, const String &pass);
extern bool loadWifiCredentials();
extern String generateRandomKey(int len);
extern int tryAttempt;            // kept for future rate-limit use

// ── Public API ────────────────────────────────────────────────────────────────
bool isAuthorized(AsyncWebServerRequest *req);  // has a valid session cookie
bool sessionFree();                             // true when no active session
void claimSession(AsyncWebServerRequest *req);  // issue cookie to this request
void releaseSession();                          // free the session immediately
void tickSession();                             // call every second from loop/ticker
void tickWifiScan();                            // call from loop() — processes async scan result

bool isCaptiveProbe(const String &url);
void handleSite();

// ── CaptiveRequestHandler ─────────────────────────────────────────────────────
//
//  OS captive-portal probes → redirect to "/" so the system browser opens
//  the SPA directly (no separate login page — WPA2 already authenticated).
//
class CaptiveRequestHandler : public AsyncWebHandler {
public:
  explicit CaptiveRequestHandler(IPAddress ip) : apIP(ip) {}

  bool canHandle(AsyncWebServerRequest *request) {
    return isCaptiveProbe(request->url());
  }

  void handleRequest(AsyncWebServerRequest *request) {
    request->redirect("http://" + apIP.toString() + "/");
  }

private:
  IPAddress apIP;
};

#endif  // SITE_H
