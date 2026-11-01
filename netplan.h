// netplan.h - address arithmetic for the home network (no Wi-Fi calls here,
// so it can be tested on a PC). Addresses are host-order uint32_t:
// 192.168.1.10 = 0xC0A8010A.
#pragma once
#include <stdint.h>

namespace netplan {

// The farm's own address in the home network is chosen from this part of
// the last number: 200..249. Where to start inside it comes from the MAC,
// so two farms in one house try different addresses first.
static const uint8_t AUTO_FIRST = 200;
static const uint8_t AUTO_COUNT = 50;

inline uint32_t ip4(uint8_t a, uint8_t b, uint8_t c, uint8_t d) {
  return ((uint32_t)a << 24) | ((uint32_t)b << 16) | ((uint32_t)c << 8) | d;
}

// Number of leading one bits of a mask (255.255.255.0 -> 24); -1 if the
// mask is not a valid one (ones must be contiguous)
inline int prefixLen(uint32_t mask) {
  int n = 0;
  while (n < 32 && (mask & (0x80000000u >> n))) n++;
  uint32_t expect = n ? (0xFFFFFFFFu << (32 - n)) : 0;
  return (mask == expect) ? n : -1;
}

inline bool sameNet(uint32_t a, uint32_t b, uint32_t mask) {
  return (a & mask) == (b & mask);
}

// Can an automatic address be chosen here? Only for /24 or larger
// networks (192.168.x.0/24, 10.0.0.0/16 ...): smaller ones may not contain
// .200-.249, then the farm keeps the router's (DHCP) address
inline bool autoPossible(uint32_t mask) {
  int p = prefixLen(mask);
  return p >= 8 && p <= 24;
}

// Where in .200-.249 this farm starts: from the last two MAC bytes
inline uint8_t autoStart(const uint8_t mac[6]) {
  return (uint8_t)((((uint16_t)mac[4] << 8) | mac[5]) % AUTO_COUNT);
}

// Candidate k (0..AUTO_COUNT-1) in the /24 of the router-given address
inline uint32_t autoCandidate(uint32_t dhcpIp, uint8_t start, uint8_t k) {
  return (dhcpIp & 0xFFFFFF00u) | (uint32_t)(AUTO_FIRST + (start + k) % AUTO_COUNT);
}

// A usable host address of the network: not the network or broadcast
// address, not the router itself
inline bool usableHost(uint32_t ip, uint32_t net, uint32_t mask, uint32_t gw) {
  if (!sameNet(ip, net, mask)) return false;
  if ((ip & ~mask) == 0 || (ip & ~mask) == ~mask) return false;
  return ip != gw;
}

// Do the farm network (its /24) and the home network overlap?
inline bool overlaps(uint32_t apIp, uint32_t staIp, uint32_t staMask) {
  uint32_t m = staMask & 0xFFFFFF00u;          // the shorter of the two masks
  return sameNet(apIp, staIp, m);
}

// Farm network addresses to choose from, in order
static const uint32_t AP_CHOICES[] = {
  0xC0A80401u,   // 192.168.4.1  (the usual one)
  0xC0A84701u,   // 192.168.71.1
  0x0A470001u,   // 10.71.0.1
  0xAC1F4701u,   // 172.31.71.1
};

// The farm network address to use next to this home network: the current
// one if it does not overlap, else the first free choice
inline uint32_t chooseApIp(uint32_t current, uint32_t staIp, uint32_t staMask) {
  if (!overlaps(current, staIp, staMask)) return current;
  for (uint32_t c : AP_CHOICES)
    if (!overlaps(c, staIp, staMask)) return c;
  return current;   // cannot happen: the choices are in different /8s
}

}  // namespace netplan
