#ifndef MY_CRYPTO_H
#define MY_CRYPTO_H
#endif  // MY_CRYPTO_H
#include <Arduino.h>
#include <base64.h>
#include "mbedtls/base64.h"
#include "mbedtls/sha256.h"
extern const char* base64_chars;
bool isBase64(char c);
String base64Decode(const String& input);
String xorMask(const String &input, const String &key);
String xorUnmask(const String& maskedBase64, const String& key);
String generateRandomKey(int len);
String sha256(const String &input);