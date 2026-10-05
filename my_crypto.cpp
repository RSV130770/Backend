#include "my_crypto.h"
const char* base64_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
bool isBase64(char c) {
  return (isalnum(c) || (c == '+') || (c == '/'));
}

String sha256(const String &input) {
    uint8_t hash[32];
    mbedtls_sha256_context ctx;

    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts(&ctx, 0); // 0 = SHA-256
    mbedtls_sha256_update(&ctx, (const unsigned char*)input.c_str(), input.length());
    mbedtls_sha256_finish(&ctx, hash);
    mbedtls_sha256_free(&ctx);

    char buf[65];
    for (int i = 0; i < 32; i++) {
        sprintf(buf + (i * 2), "%02x", hash[i]);
    }
    buf[64] = 0;

    return String(buf);
}



String base64Decode(const String& input) {
  int in_len = input.length();
  int i = 0, in_ = 0;
  unsigned char char_array_4[4], char_array_3[3];
  String output = "";
  Serial.print("Decoder income: ");
  Serial.println(input);

  while (in_len-- && (input[in_] != '=') && isBase64(input[in_])) {
    char_array_4[i++] = input[in_]; in_++;
    if (i == 4) {
      for (i = 0; i < 4; i++)
        char_array_4[i] = strchr(base64_chars, char_array_4[i]) - base64_chars;

      char_array_3[0] = (char_array_4[0] << 2) + ((char_array_4[1] & 0x30) >> 4);
      char_array_3[1] = ((char_array_4[1] & 0xf) << 4) + ((char_array_4[2] & 0x3c) >> 2);
      char_array_3[2] = ((char_array_4[2] & 0x3) << 6) + char_array_4[3];

      for (i = 0; i < 3; i++) output += (char)char_array_3[i];
      i = 0;
    }
  }

  if (i) {
    for (int j = i; j < 4; j++) char_array_4[j] = 0;
    for (int j = 0; j < 4; j++) char_array_4[j] = strchr(base64_chars, char_array_4[j]) - base64_chars;

    char_array_3[0] = (char_array_4[0] << 2) + ((char_array_4[1] & 0x30) >> 4);
    char_array_3[1] = ((char_array_4[1] & 0xf) << 4) + ((char_array_4[2] & 0x3c) >> 2);
    char_array_3[2] = ((char_array_4[2] & 0x3) << 6) + char_array_4[3];

    for (int j = 0; j < i - 1; j++) output += (char)char_array_3[j];
  }
  Serial.print("Decoder outcome: ");
  Serial.println(output);
  return output;
}

String xorMask(const String &input, const String &key) {
    String out;
    out.reserve(input.length());

    for (size_t i = 0; i < input.length(); i++) {
        char c = input[i] ^ key[i % key.length()];
        out += c;
    }
    return out;
}

String xorUnmask(const String& maskedBase64, const String& key) {
  Serial.print("Unmask input: ");
  Serial.println(maskedBase64);
  String decoded = base64Decode(maskedBase64);
  Serial.print("Unmask Key: ");
  Serial.println(key);
  Serial.print("Unmask decoded: ");
  Serial.println(decoded);
  String result = "";
  for (size_t i = 0; i < decoded.length(); i++) {
    result += (char)(decoded[i] ^ key[i % key.length()]);
  }
  Serial.print("Unmask Output: ");
  Serial.println(result);
  return result;
}

String generateRandomKey(int len) {
  String key="";
  for (int i = 0; i < len; i++) {
    key += base64_chars[random(0, 63)]; // Printable ASCII
  }
  return key;
}
