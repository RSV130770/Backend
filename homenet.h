// homenet.h - connection to the home Wi-Fi (station) in the background.
//
// At boot (and after Settings) the farm gets an address from the router
// (DHCP), then moves to a fixed address of its own:
//   automatic: x.x.x.200-249 (start from the MAC), checked to be free (ARP)
//   manual:    the address typed in Settings > IP settings
// The router may be off or far away: the farm keeps trying in the
// background, and its own network (AP) stays on. If the home network uses
// the farm network's range (192.168.4.x), the farm network moves aside.
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>        // IPAddress

void homeNetBegin();            // from handleSite(): start (non-blocking)
void homeNetLoop();             // from loop()
void homeNetRestart();          // credentials or IP settings changed
void homeNetStop();             // Disconnect in Settings
bool homeNetBusy();             // connecting / checking: no Wi-Fi scan now
void homeNetStatus(JsonObject o);        // for /api/settings and /wifi/status
String homeNetSaveIpConfig(JsonVariantConst cfg);  // "" or error text
IPAddress homeNetLoadApIp();    // farm network address to start the AP with
