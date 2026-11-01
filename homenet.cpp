// homenet.cpp - see homenet.h
#include "homenet.h"
#include "netplan.h"
#include <WiFi.h>
#include <SPIFFS.h>
#include <DNSServer.h>
#include "esp_netif.h"
#include "esp_netif_net_stack.h"   // esp_netif_get_netif_impl
#include "lwip/etharp.h"
#include "lwip/tcpip.h"

extern String wifiSSID;
extern String wifiPass;
extern bool stationConnected;
extern IPAddress IP;              // farm network (AP) address, .ino
extern DNSServer dnsServer;
extern bool loadWifiCredentials();
bool wifiScanBusy();              // site.cpp

using namespace netplan;

// 0.0.0.0 - not INADDR_NONE: lwIP headers may define that as a macro
// (255.255.255.255), which would turn "use DHCP" into a broken address
static const IPAddress NO_IP(0, 0, 0, 0);

static const char *IPCFG_FILE = "/sta_ip.json";
static const char *APIP_FILE  = "/ap_ip.txt";

// Timing (ms)
static const uint32_t CONNECT_TIMEOUT = 20000;
static const uint32_t LOST_RESTART    = 60000;    // link lost this long: start over
static const uint32_t ARP_CHECK_AT    = 800;      // after the first request
static const uint32_t RETRY_DELAYS[]  = { 60000, 120000, 300000, 600000 };

// ---------------------------------------------------------------------------
//  Saved IP settings
// ---------------------------------------------------------------------------
struct IpCfg {
  bool     manual   = false;
  uint32_t ip = 0, mask = 0, gw = 0, dns1 = 0, dns2 = 0;  // manual values
  uint32_t lastAuto = 0;                                  // last automatic address
};
static IpCfg cfg;

static uint32_t u32(const IPAddress &a) { return ip4(a[0], a[1], a[2], a[3]); }
static IPAddress ipa(uint32_t v) { return IPAddress(v >> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255); }
static String ips(uint32_t v) { return v ? ipa(v).toString() : String(""); }
static uint32_t parseIp(const char *s) {
  IPAddress a;
  if (!s || !*s || !a.fromString(s)) return 0;
  return u32(a);
}

static void loadCfg() {
  cfg = IpCfg();
  if (!SPIFFS.exists(IPCFG_FILE)) return;
  File f = SPIFFS.open(IPCFG_FILE, "r");
  if (!f) return;
  StaticJsonDocument<384> d;
  if (!deserializeJson(d, f)) {
    cfg.manual   = strcmp(d["mode"] | "auto", "manual") == 0;
    cfg.ip       = parseIp(d["ip"]);
    cfg.mask     = parseIp(d["mask"]);
    cfg.gw       = parseIp(d["gw"]);
    cfg.dns1     = parseIp(d["dns1"]);
    cfg.dns2     = parseIp(d["dns2"]);
    cfg.lastAuto = parseIp(d["lastAuto"]);
  }
  f.close();
}

static void saveCfg() {
  StaticJsonDocument<384> d;
  d["mode"] = cfg.manual ? "manual" : "auto";
  if (cfg.ip)       d["ip"]       = ips(cfg.ip);
  if (cfg.mask)     d["mask"]     = ips(cfg.mask);
  if (cfg.gw)       d["gw"]       = ips(cfg.gw);
  if (cfg.dns1)     d["dns1"]     = ips(cfg.dns1);
  if (cfg.dns2)     d["dns2"]     = ips(cfg.dns2);
  if (cfg.lastAuto) d["lastAuto"] = ips(cfg.lastAuto);
  File f = SPIFFS.open(IPCFG_FILE, "w");
  if (!f) return;
  serializeJson(d, f);
  f.close();
}

// ---------------------------------------------------------------------------
//  ARP probe: "who has a.b.c.d?" - every device answers ARP, also phones
//  and PCs that ignore ping. Runs in the lwIP thread (tcpip_callback).
// ---------------------------------------------------------------------------
struct ArpJob {
  struct netif *nif = nullptr;
  ip4_addr_t    ip;
  volatile int8_t answer = -1;     // -1 pending, 0 nobody, 1 answered
};
static ArpJob arp;

static struct netif *staNetif() {
  esp_netif_t *h = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
  return h ? (struct netif *)esp_netif_get_netif_impl(h) : nullptr;
}
static void arpClearCb(void *) { if (arp.nif) etharp_cleanup_netif(arp.nif); }
static void arpSendCb(void *)  { if (arp.nif) etharp_request(arp.nif, &arp.ip); }
static void arpCheckCb(void *) {
  struct eth_addr *mac; const ip4_addr_t *ip;
  arp.answer = (arp.nif && etharp_find_addr(arp.nif, &arp.ip, &mac, &ip) >= 0) ? 1 : 0;
}

// ---------------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------------
enum HnState { HN_OFF, HN_START, HN_DHCP, HN_PROBE, HN_SWITCH, HN_STATIC, HN_VERIFY, HN_UP, HN_RETRY };
static HnState  st = HN_OFF;
static uint32_t t0 = 0;              // when the current step began
static uint32_t lostAt = 0;
static uint8_t  retryN = 0;
static bool     dhcpOnly = false;    // fixed address failed: stay on DHCP this round
static String   note;                // last thing worth telling the user
static String   kind = "";           // address in use: auto / manual / dhcp
static bool     apMoved = false;
static String   hostName;

// What DHCP told us
static uint32_t dIp, dMask, dGw, dDns1, dDns2;
// Probing
static uint32_t target = 0;          // address being checked / used
static uint8_t  probeStart = 0, probeK = 0;
static bool     probeLast = false;   // try cfg.lastAuto first
static uint8_t  arpStep = 0;
static uint32_t arpT = 0;

static void setNote(const String &s) {
  if (s != note) Serial.println("HomeNet: " + s);
  note = s;
}

static bool stepDone = false;        // the first action of a step was done
static void go(HnState s) { st = s; t0 = millis(); stepDone = false; }

static void startArp(uint32_t ipHost) {
  arp.nif = staNetif();
  ip4_addr_set_u32(&arp.ip, lwip_htonl(ipHost));
  arp.answer = -1;
  arpStep = 0;
  arpT = millis();
  tcpip_callback(arpSendCb, nullptr);
}

// Advance a running probe; returns -1 while waiting, 0 free, 1 taken
static int arpPoll() {
  uint32_t dt = millis() - arpT;
  if (arpStep == 0 && dt >= 250) { tcpip_callback(arpSendCb, nullptr); arpStep = 1; }  // second request
  if (arpStep == 1 && dt >= ARP_CHECK_AT) { tcpip_callback(arpCheckCb, nullptr); arpStep = 2; }
  if (arpStep == 2 && arp.answer >= 0) return arp.answer;
  if (dt > ARP_CHECK_AT + 1000) return 0;    // lwIP thread did not answer: assume free
  return -1;
}

// The farm network must not use the home network's range
static void fixApRange() {
  uint32_t cur = u32(IP);
  uint32_t want = chooseApIp(cur, dIp, dMask);
  if (want == cur) return;
  IPAddress a = ipa(want);
  Serial.printf("HomeNet: home network uses %s - farm network moves to %s\n",
                ips(dIp).c_str(), a.toString().c_str());
  WiFi.softAPConfig(a, a, IPAddress(255, 255, 255, 0));
  dnsServer.stop();
  dnsServer.start(53, "*", a);
  IP = a;
  apMoved = true;
  File f = SPIFFS.open(APIP_FILE, "w");
  if (f) { f.print(a.toString()); f.close(); }
}

static void connectNow(bool fixed) {
  WiFi.mode(WIFI_AP_STA);
  if (fixed)
    WiFi.config(ipa(target), ipa(dGw), ipa(dMask), ipa(dDns1 ? dDns1 : dGw), ipa(dDns2));
  else
    WiFi.config(NO_IP, NO_IP, NO_IP);   // 0.0.0.0 = DHCP
  WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());
}

static void upWith(const String &k) {
  kind = k;
  retryN = 0;
  lostAt = 0;
  stationConnected = true;
  go(HN_UP);
  Serial.printf("HomeNet: connected to %s, farm at http://%s/ (%s)\n",
                wifiSSID.c_str(), WiFi.localIP().toString().c_str(), k.c_str());
}

static void retryLater(const String &why) {
  setNote(why);
  stationConnected = false;
  WiFi.disconnect(true);        // station off between tries: a searching
  WiFi.mode(WIFI_AP);           // station makes the farm network unstable
  go(HN_RETRY);
}

// Next automatic candidate (or the manual address); false when none is left
static bool nextCandidate() {
  if (cfg.manual) {
    if (probeK++ > 0) return false;
    target = cfg.ip;
    return true;
  }
  if (probeLast) {
    probeLast = false;
    target = cfg.lastAuto;
    return true;
  }
  while (probeK < AUTO_COUNT) {
    uint32_t c = autoCandidate(dIp, probeStart, probeK++);
    if (c == cfg.lastAuto) continue;               // already tried first
    if (usableHost(c, dIp, dMask, dGw)) { target = c; return true; }
  }
  return false;
}

// ---------------------------------------------------------------------------
//  Public
// ---------------------------------------------------------------------------
IPAddress homeNetLoadApIp() {
  if (SPIFFS.exists(APIP_FILE)) {
    File f = SPIFFS.open(APIP_FILE, "r");
    if (f) {
      IPAddress a;
      String s = f.readString();
      f.close();
      s.trim();
      if (a.fromString(s)) return a;
    }
  }
  return IPAddress(192, 168, 4, 1);
}

void homeNetBegin() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  probeStart = autoStart(mac);
  char name[24];
  snprintf(name, sizeof(name), "premifarm-%02x%02x", mac[4], mac[5]);
  hostName = name;
  WiFi.setHostname(name);        // the router may list the farm by this name
  homeNetRestart();
}

void homeNetRestart() {
  loadCfg();
  dhcpOnly = false;
  retryN = 0;
  stationConnected = false;
  if (!loadWifiCredentials() || wifiSSID.isEmpty()) { homeNetStop(); return; }
  setNote("");
  go(HN_START);
}

void homeNetStop() {
  if (st != HN_OFF) {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_AP);
  }
  stationConnected = false;
  kind = "";
  setNote("");
  go(HN_OFF);
}

bool homeNetBusy() {
  return st == HN_START || st == HN_DHCP || st == HN_PROBE ||
         st == HN_SWITCH || st == HN_STATIC || st == HN_VERIFY;
}

void homeNetLoop() {
  const uint32_t dt = millis() - t0;
  switch (st) {
    case HN_OFF:
      break;

    case HN_START:
      // drop any old connection first, so it is not taken for the new one
      if (!stepDone) {
        if (wifiScanBusy()) { t0 = millis(); break; }   // scanning disturbs connecting
        if (WiFi.getMode() & WIFI_STA) WiFi.disconnect();
        stepDone = true;
        break;
      }
      if (dt < 300) break;
      connectNow(false);
      go(HN_DHCP);
      break;

    case HN_DHCP:
      if (WiFi.status() == WL_CONNECTED && WiFi.localIP() != NO_IP) {
        dIp = u32(WiFi.localIP());   dMask = u32(WiFi.subnetMask());
        dGw = u32(WiFi.gatewayIP()); dDns1 = u32(WiFi.dnsIP(0)); dDns2 = u32(WiFi.dnsIP(1));
        fixApRange();
        if (dhcpOnly) { upWith("dhcp"); break; }
        if (cfg.manual) {
          if (!cfg.ip || !sameNet(cfg.ip, dIp, cfg.mask ? cfg.mask : dMask))
            setNote("The manual address does not fit this network");
          // manual values replace what DHCP gave
          if (cfg.mask) dMask = cfg.mask;
          if (cfg.gw)   dGw   = cfg.gw;
          if (cfg.dns1) dDns1 = cfg.dns1;
          if (cfg.dns2) dDns2 = cfg.dns2;
        } else if (!autoPossible(dMask)) {
          setNote("Small network: the router's address is kept");
          upWith("dhcp");
          break;
        }
        probeK = 0;
        probeLast = !cfg.manual && cfg.lastAuto && usableHost(cfg.lastAuto, dIp, dMask, dGw);
        if (!nextCandidate()) { upWith("dhcp"); break; }
        if (target == dIp) { go(HN_SWITCH); break; }   // ours already
        arp.nif = staNetif();
        tcpip_callback(arpClearCb, nullptr);           // forget old answers
        startArp(target);
        go(HN_PROBE);
        break;
      }
      if (dt > CONNECT_TIMEOUT) {
        wl_status_t s = WiFi.status();
        if (cfg.manual && cfg.ip && cfg.gw && cfg.mask && s != WL_NO_SSID_AVAIL && s != WL_CONNECT_FAILED) {
          // a network without DHCP: use the typed address directly
          dMask = cfg.mask; dGw = cfg.gw; dDns1 = cfg.dns1; dDns2 = cfg.dns2;
          target = cfg.ip;
          go(HN_SWITCH);
          break;
        }
        retryLater(s == WL_NO_SSID_AVAIL ? "Network \"" + wifiSSID + "\" not found"
                 : s == WL_CONNECT_FAILED ? "Could not join \"" + wifiSSID + "\" (password?)"
                 : "No answer from \"" + wifiSSID + "\"");
      }
      break;

    case HN_PROBE: {
      int r = arpPoll();
      if (r < 0) break;
      if (r == 0) { go(HN_SWITCH); break; }           // free: take it
      Serial.printf("HomeNet: %s is in use\n", ips(target).c_str());
      if (cfg.manual) {
        setNote("The manual address " + ips(target) + " is used by another device");
        upWith("dhcp");
        break;
      }
      if (!nextCandidate()) {
        setNote("No free address in .200-.249: the router's address is kept");
        upWith("dhcp");
        break;
      }
      if (target == dIp) { go(HN_SWITCH); break; }
      startArp(target);
      break;
    }

    case HN_SWITCH:
      // leave the DHCP address, come back with the fixed one
      if (!stepDone) { WiFi.disconnect(); stepDone = true; break; }
      if (dt < 500) break;
      connectNow(true);
      go(HN_STATIC);
      break;

    case HN_STATIC:
      if (WiFi.status() == WL_CONNECTED && u32(WiFi.localIP()) == target) {
        startArp(dGw);                            // does the router answer us?
        go(HN_VERIFY);
        break;
      }
      if (dt > CONNECT_TIMEOUT) {
        setNote("The fixed address did not work: the router's address is used");
        dhcpOnly = true;
        go(HN_START);
      }
      break;

    case HN_VERIFY: {
      int r = arpPoll();
      if (r < 0) break;
      if (r == 1 || dGw == 0) {
        if (!cfg.manual && cfg.lastAuto != target) { cfg.lastAuto = target; saveCfg(); }
        setNote("");
        upWith(cfg.manual ? "manual" : "auto");
        break;
      }
      setNote("The router does not answer the fixed address: the router's address is used");
      dhcpOnly = true;
      go(HN_START);
      break;
    }

    case HN_UP:
      if (WiFi.status() == WL_CONNECTED) {
        if (lostAt) { lostAt = 0; setNote(""); }      // back by itself
        stationConnected = true;
        break;
      }
      stationConnected = false;
      if (!lostAt) { lostAt = millis(); setNote("Connection lost, reconnecting"); }
      if (millis() - lostAt > LOST_RESTART) { dhcpOnly = false; go(HN_START); }   // maybe a new router
      break;

    case HN_RETRY: {
      uint8_t i = retryN < 4 ? retryN : 3;
      if (dt < RETRY_DELAYS[i]) break;
      if (retryN < 255) retryN++;
      go(HN_START);
      break;
    }
  }
}

void homeNetStatus(JsonObject o) {
  static const char *names[] = { "off", "connecting", "connecting", "checking", "switching",
                                 "switching", "checking", "connected", "retry" };
  o["state"]    = names[st];
  o["ssid"]     = wifiSSID;
  o["hostname"] = hostName;
  o["mode"]     = cfg.manual ? "manual" : "auto";
  if (st == HN_UP && WiFi.status() == WL_CONNECTED) {
    o["ip"]   = WiFi.localIP().toString();
    o["mask"] = WiFi.subnetMask().toString();
    o["gw"]   = WiFi.gatewayIP().toString();
    o["dns1"] = WiFi.dnsIP(0).toString();
    o["dns2"] = WiFi.dnsIP(1).toString();
    o["kind"] = kind;
  }
  if (st == HN_RETRY) {
    uint8_t i = retryN < 4 ? retryN : 3;
    uint32_t left = RETRY_DELAYS[i] - (millis() - t0);
    o["retryIn"] = left / 1000;
  }
  JsonObject m = o.createNestedObject("manual");
  m["ip"] = ips(cfg.ip); m["mask"] = ips(cfg.mask); m["gw"] = ips(cfg.gw);
  m["dns1"] = ips(cfg.dns1); m["dns2"] = ips(cfg.dns2);
  o["apIp"]    = IP.toString();
  o["apMoved"] = apMoved;
  if (note.length()) o["note"] = note;
}

String homeNetSaveIpConfig(JsonVariantConst in) {
  const char *mode = in["mode"] | "auto";
  loadCfg();
  if (strcmp(mode, "manual") != 0) {
    cfg.manual = false;              // the typed values are kept for later
    saveCfg();
    return "";
  }
  uint32_t ip = parseIp(in["ip"]), mask = parseIp(in["mask"]), gw = parseIp(in["gw"]);
  const char *d1 = in["dns1"] | "", *d2 = in["dns2"] | "";
  uint32_t dns1 = parseIp(d1), dns2 = parseIp(d2);
  int p = prefixLen(mask);
  if (!ip)                 return "Address: enter four numbers, like 192.168.1.210";
  if (!mask || p < 8 || p > 30) return "Mask: like 255.255.255.0";
  if (!gw)                 return "Gateway: the router's address, like 192.168.1.1";
  if (!sameNet(ip, gw, mask)) return "Address and gateway are not in the same network";
  if (!usableHost(ip, gw, mask, gw)) return "This address cannot be used in the network";
  if (*d1 && !dns1)        return "DNS 1: four numbers, or leave it empty";
  if (*d2 && !dns2)        return "DNS 2: four numbers, or leave it empty";
  cfg.manual = true;
  cfg.ip = ip; cfg.mask = mask; cfg.gw = gw;
  cfg.dns1 = dns1 ? dns1 : gw;       // the router usually answers DNS
  cfg.dns2 = dns2;
  saveCfg();
  return "";
}
