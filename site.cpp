#include "site.h"
#include <SPIFFS.h>
#include <WiFi.h>

// ─────────────────────────────────────────────────────────────────────────────
//  Session state
// ─────────────────────────────────────────────────────────────────────────────

String sessionToken = "";          // empty = no active session
unsigned long lastActivityMs = 0;  // millis() of last authorised request

// ─────────────────────────────────────────────────────────────────────────────
//  Async WiFi scan state
//  WiFi.scanNetworks() is blocking — calling it from an AsyncWebServer
//  callback deadlocks the FreeRTOS semaphore.  Use background scan + cache.
// ─────────────────────────────────────────────────────────────────────────────

static String   _scanJson    = "{\"networks\":[]}";
static bool     _scanPending = false;

// Call from loop() — costs nothing when idle, builds JSON when scan finishes.
void tickWifiScan() {
  if (!_scanPending) return;
  int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) return;   // still in progress
  if (n == WIFI_SCAN_FAILED)  { _scanPending = false; return; }

  String json = "{\"networks\":[";
  for (int i = 0; i < n; i++) {
    if (i) json += ",";
    // Escape any " in SSID just in case
    String s = WiFi.SSID(i);
    s.replace("\"", "\\\"");
    json += "{\"ssid\":\"" + s + "\""
            ",\"rssi\":"   + String(WiFi.RSSI(i)) +
            ",\"security\":\"" +
            (WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "none" : "WPA2") +
            "\"}";
  }
  WiFi.scanDelete();
  json += "]}";
  _scanJson    = json;
  _scanPending = false;
}

// Kick off a new async scan (safe to call from any context).
static void startWifiScan() {
  if (_scanPending) return;
  WiFi.scanNetworks(/*async=*/true, /*show_hidden=*/false);
  _scanPending = true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

bool sessionFree() {
  return sessionToken.length() == 0;
}

bool isAuthorized(AsyncWebServerRequest *req) {
  if (sessionFree()) return false;
  if (!req->hasHeader("Cookie")) return false;

  String cookie = req->header("Cookie");
  int start = cookie.indexOf("session=");
  if (start == -1) return false;
  start += 8;
  int end = cookie.indexOf(";", start);
  String token = (end == -1) ? cookie.substring(start)
                              : cookie.substring(start, end);
  token.trim();

  return token == sessionToken;
}

void claimSession(AsyncWebServerRequest *req) {
  if (isAuthorized(req)) {
    lastActivityMs = millis();
    return;
  }
  sessionToken   = generateRandomKey(16);
  lastActivityMs = millis();
  Serial.println("Session claimed, token=" + sessionToken);
}

void releaseSession() {
  Serial.println("Session released");
  sessionToken = "";
  lastActivityMs = 0;
}

// Called every second (from Ticker / loop).
// Expires the session after SESSION_TIMEOUT_MS of inactivity.
void tickSession() {
  if (sessionFree()) return;
  unsigned long idle = millis() - lastActivityMs;
  if (idle >= SESSION_TIMEOUT_MS) {
    Serial.printf("Session timed out after %lu ms idle\n", idle);
    releaseSession();
  }
}

// ─── Captive probe list ────────────────────────────────────────────────────────

bool isCaptiveProbe(const String &url) {
  return url == "/hotspot-detect.html"  // iOS / macOS
      || url == "/generate_204"         // Android
      || url == "/gen_204"              // Android alt
      || url == "/ncsi.txt"             // Windows
      || url == "/connecttest.txt"      // Windows alt
      || url == "/success.html"         // iOS / macOS
      || url == "/check.html";          // ChromeOS
}

// ─── Cookie helper ─────────────────────────────────────────────────────────────

static void attachCookie(AsyncWebServerResponse *res) {
  res->addHeader("Set-Cookie",
    "session=" + sessionToken
    + "; Path=/; HttpOnly; SameSite=Lax");
}

// ─── Busy page ─────────────────────────────────────────────────────────────────

static const char BUSY_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MiniFarm — Busy</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       display:flex;align-items:center;justify-content:center;
       min-height:100vh;margin:0;background:#f0f4f8;}
  .card{background:#fff;border-radius:12px;
        box-shadow:0 4px 24px rgba(0,0,0,.10);
        padding:2rem;width:min(320px,90vw);text-align:center;}
  h2{font-size:1.1rem;color:#1a1a2e;margin:.5rem 0 1.25rem;}
  .icon{font-size:2.5rem;margin-bottom:.5rem;}
  #timer{font-size:2rem;font-weight:700;color:#007bff;font-variant-numeric:tabular-nums;}
  p{font-size:.85rem;color:#666;margin-top:1rem;}
</style>
</head>
<body>
<div class="card">
  <div class="icon">⏳</div>
  <h2>Device is busy</h2>
  <div id="timer">--:--</div>
  <p>Another user is controlling the device.<br>
     Page will refresh automatically when the session is released.</p>
</div>
<script>
function fmt(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
function poll(){
  fetch('/api/session').then(r=>r.json()).then(d=>{
    if(!d.busy){location.replace('/');return;}
    document.getElementById('timer').textContent=fmt(d.remainSec);
    setTimeout(poll,2000);
  }).catch(()=>setTimeout(poll,3000));
}
poll();
</script>
</body>
</html>
)rawliteral";

// ─────────────────────────────────────────────────────────────────────────────
//  Route setup
// ─────────────────────────────────────────────────────────────────────────────

void handleSite() {

  // AP already started in setup() before handleSite() is called.
  // Try STA connection if credentials saved.
  if (loadWifiCredentials()) {
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 10000) delay(200);
    if (WiFi.status() == WL_CONNECTED) {
      stationConnected = true;
      Serial.printf("STA connected: %s  IP: %s\n",
                    wifiSSID.c_str(), WiFi.localIP().toString().c_str());
    } else {
      Serial.println("STA connect failed — staying in AP-only mode");
      WiFi.disconnect(true);
      WiFi.mode(WIFI_AP);
    }
  }

  startWifiScan();

  server.addHandler(new CaptiveRequestHandler(WiFi.softAPIP()));

  // Root / index.html
  auto serveIndex = [](AsyncWebServerRequest *req) {
    if (isAuthorized(req)) {
      lastActivityMs = millis();
      req->send(SPIFFS, "/index.html", "text/html");
      return;
    }
    if (!sessionFree()) {
      req->redirect("/busy");
      return;
    }
    claimSession(req);
    AsyncWebServerResponse *res =
      req->beginResponse(SPIFFS, "/index.html", "text/html");
    attachCookie(res);
    req->send(res);
  };

  server.on("/",           HTTP_GET, serveIndex);
  server.on("/index.html", HTTP_GET, serveIndex);

  server.on("/busy", HTTP_GET, [](AsyncWebServerRequest *req) {
    req->send_P(200, "text/html", BUSY_HTML);
  });

  server.on("/api/release", HTTP_POST, [](AsyncWebServerRequest *req) {
    if (isAuthorized(req)) {
      releaseSession();
      AsyncWebServerResponse *res =
        req->beginResponse(200, "application/json", "{\"status\":\"released\"}");
      res->addHeader("Set-Cookie",
        "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      req->send(res);
    } else {
      req->send(200, "application/json", "{\"status\":\"not_owner\"}");
    }
  });

  // Session status — polled by busy page every 2 s
  server.on("/api/session", HTTP_GET, [](AsyncWebServerRequest *req) {
    bool busy = !sessionFree();
    long remain = 0;
    if (busy) {
      long idle = (long)(millis() - lastActivityMs);
      remain = max(0L, (long)(SESSION_TIMEOUT_MS / 1000) - idle / 1000);
    }
    String json = "{\"busy\":";
    json += busy ? "true" : "false";
    json += ",\"remainSec\":";
    json += String(remain);
    json += "}";
    req->send(200, "application/json", json);
  });

  server.on("/api/ping", HTTP_GET, [](AsyncWebServerRequest *req) {
    req->send(200, "application/json", "{\"status\":\"ok\"}");
  });

  server.on("/api/ping", HTTP_POST, [](AsyncWebServerRequest *req) {
    if (isAuthorized(req)) lastActivityMs = millis();
    req->send(200, "application/json", "{\"status\":\"ok\"}");
  });

  server.on("/status", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!isAuthorized(req)) { req->send(403); return; }
    lastActivityMs = millis();
    req->send(200, "application/json", "{\"isConnected\":true}");
  });

  server.on("/slider_set", HTTP_POST, [](AsyncWebServerRequest *req) {
    if (!isAuthorized(req)) { req->send(403, "text/plain", "Access denied"); return; }
    lastActivityMs = millis();
    slider_setting(req);
  });

  // GET /wifi/scan  →  200 { "networks":[...] }  (cached) + kicks next scan
  //                 →  202 { "status":"scanning" }  if first scan pending
  server.on("/wifi/scan", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!isAuthorized(req)) { req->send(403); return; }
    lastActivityMs = millis();

    if (_scanPending) {
      // Still scanning — tell the client to retry in a moment
      req->send(202, "application/json", "{\"status\":\"scanning\"}");
      return;
    }

    // Return cached result and kick off the next scan in the background.
    req->send(200, "application/json", _scanJson);
    startWifiScan();
  });

  server.on("/wifi/status", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!isAuthorized(req)) { req->send(403); return; }
    lastActivityMs = millis();
    String json;
    if (stationConnected && WiFi.status() == WL_CONNECTED) {
      json = "{\"mode\":\"client\",\"connected\":true"
             ",\"ssid\":\"" + WiFi.SSID() + "\""
             ",\"ip\":\""   + WiFi.localIP().toString() + "\""
             ",\"rssi\":"   + String(WiFi.RSSI()) + "}";
    } else {
      json = "{\"mode\":\"ap\",\"connected\":false}";
    }
    req->send(200, "application/json", json);
  });

  // POST /wifi/connect  body: { "ssid":"...", "password":"..." }
  // delay() up to 12 s is acceptable here — user is waiting for the result.
  server.on("/wifi/connect", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
      if (!isAuthorized(req)) { req->send(403); return; }

      StaticJsonDocument<256> doc;
      if (deserializeJson(doc, data, len)) {
        req->send(400, "application/json", "{\"error\":\"invalid json\"}");
        return;
      }
      String ssid = doc["ssid"] | "";
      String pass = doc["password"] | "";
      if (ssid.isEmpty() || pass.isEmpty()) {
        req->send(400, "application/json", "{\"error\":\"missing fields\"}");
        return;
      }

      WiFi.disconnect(true);
      delay(100);
      WiFi.mode(WIFI_AP_STA);
      WiFi.begin(ssid.c_str(), pass.c_str());

      uint32_t t0 = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) delay(200);

      if (WiFi.status() != WL_CONNECTED) {
        WiFi.disconnect(true);
        WiFi.mode(WIFI_AP);
        req->send(401, "application/json", "{\"error\":\"Wrong password\"}");
        return;
      }

      stationConnected = true;
      saveWifiCredentials(ssid, pass);
      lastActivityMs = millis();

      String out = "{\"ip\":\"" + WiFi.localIP().toString() + "\"}";
      req->send(200, "application/json", out);
    });

  server.on("/wifi/disconnect", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
      if (!isAuthorized(req)) { req->send(403); return; }
      stationConnected = false;
      saveWifiCredentials("", "");
      WiFi.disconnect(true);
      delay(100);
      WiFi.mode(WIFI_AP);
      req->send(200, "application/json", "{\"status\":\"disconnected\"}");
    });

  server.on("/api/settings", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!isAuthorized(req)) { req->send(403); return; }
    lastActivityMs = millis();

    String apSsid = "";
    if (SPIFFS.exists("/ap_ssid.txt")) {
      File f = SPIFFS.open("/ap_ssid.txt", "r");
      if (f) { apSsid = f.readStringUntil('\n'); apSsid.trim(); f.close(); }
    }

    String staSsid = "";
    bool staSaved = false;
    if (SPIFFS.exists("/sta_ssid.txt")) {
      File f = SPIFFS.open("/sta_ssid.txt", "r");
      if (f) { staSsid = f.readStringUntil('\n'); staSsid.trim(); f.close(); }
      staSaved = staSsid.length() > 0;
    }
    bool staConnected = stationConnected && (WiFi.status() == WL_CONNECTED);

    String json = "{";
    json += "\"ap_ssid\":\"" + apSsid + "\"";
    json += ",\"sta_ssid\":\"" + staSsid + "\"";
    json += ",\"sta_saved\":"     + String(staSaved     ? "true" : "false");
    json += ",\"sta_connected\":" + String(staConnected ? "true" : "false");
    json += "}";
    req->send(200, "application/json", json);
  });

  server.on("/api/settings", HTTP_POST,
    [](AsyncWebServerRequest *req) {},
    nullptr,
    [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t, size_t) {
      if (!isAuthorized(req)) { req->send(403); return; }
      lastActivityMs = millis();

      StaticJsonDocument<256> doc;
      if (deserializeJson(doc, data, len)) {
        req->send(400, "application/json", "{\"error\":\"invalid json\"}");
        return;
      }

      String apSsid = doc["ap_ssid"] | "";
      apSsid.trim();
      if (apSsid.length() > 32) {
        req->send(400, "application/json", "{\"error\":\"ap_ssid too long\"}");
        return;
      }

      String apPass = doc["ap_pass"] | "";
      if (apPass.length() > 0 && apPass.length() < 8) {
        req->send(400, "application/json", "{\"error\":\"ap_pass must be >= 8 chars\"}");
        return;
      }

      if (apSsid.length() > 0) {
        File f = SPIFFS.open("/ap_ssid.txt", "w");
        if (f) { f.print(apSsid); f.close(); }
      }
      if (apPass.length() >= 8) {
        File f = SPIFFS.open("/pass.txt", "w");
        if (f) { f.print(apPass); f.close(); }
      }

      String staSsid = doc["sta_ssid"] | "";
      String staPass = doc["sta_pass"] | "";
      staSsid.trim();
      if (staSsid.length() > 0) {
        File f = SPIFFS.open("/sta_ssid.txt", "w");
        if (f) { f.print(staSsid); f.close(); }
      }
      if (staPass.length() > 0) {
        File f = SPIFFS.open("/sta_pass.txt", "w");
        if (f) { f.print(staPass); f.close(); }
      }

      req->send(200, "application/json", "{\"status\":\"ok\",\"restart\":true}");
      delay(500);
      ESP.restart();
    });

  server.serveStatic("/", SPIFFS, "/").setCacheControl("max-age=86400");
}
