#include "sensors.h"
#include "scheduler.h"
DHTNEW dht(DHTPIN);
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature waterTemperature(&oneWire);

SensorState S;   // the single shared sensor state (declared extern in sensors.h)

// Valid ranges (datasheets); readings outside them are rejected
static const float DHT_TEMP_MIN = -40.0f, DHT_TEMP_MAX = 80.0f;    // DHT22 / AM2302
static const float DHT_HUM_MIN  =   0.0f, DHT_HUM_MAX  = 100.0f;
static const float DS_TEMP_MIN  = -55.0f, DS_TEMP_MAX  = 125.0f;   // DS18B20


Sensor::Sensor(const String &n, uint32_t interval)
  : name(n), intervalMs(interval), lastUpdate(0), value(NAN), failCount(0) {}

void Sensor::update() {
  uint32_t now = millis();
  if (now - lastUpdate >= intervalMs) {
    lastUpdate = now;
    read();
  }
}

WaterTempSensor ::WaterTempSensor(DallasTemperature *d)
  : Sensor("waterTemp", 2000), ds(d) {}

// Non-blocking: read the result of the conversion started on the previous
// call, then start the next one. A blocking requestTemperatures() would stall
// the timer task for ~750 ms on every read (and with it the other tickers).
void WaterTempSensor ::read() {
  float t = ds->getTempCByIndex(0);
  ds->requestTemperatures();          // returns at once (setWaitForConversion(false))

  // -127 = DEVICE_DISCONNECTED_C; exactly 85.0 is the DS18B20 power-on value,
  // returned when a conversion did not complete. Anything outside the sensor
  // range is noise.
  if (t < DS_TEMP_MIN || t > DS_TEMP_MAX || t == 85.0f) {
    if (++failCount > 10) {
      value = NAN;
      S.waterTemp = NAN;              // show "NOK" instead of a stale value
    }
    return;
  }
  value = t;
  failCount = 0;
  S.waterTemp = value;
}


DHTSensor::DHTSensor(const String &n, uint32_t interval, DHTNEW *driver)
  : Sensor(n, interval), dht(driver), lastTemp(NAN), lastHum(NAN) {}

void DHTSensor::read() {
  int chk = dht->read();

  if (chk != DHTLIB_WAITING_FOR_READ) {
    switch (chk) {
      case DHTLIB_OK:
        break;
      case DHTLIB_ERROR_CHECKSUM:
      case DHTLIB_ERROR_TIMEOUT_A:
      case DHTLIB_ERROR_TIMEOUT_B:
      case DHTLIB_ERROR_TIMEOUT_C:
      case DHTLIB_ERROR_TIMEOUT_D:
      case DHTLIB_ERROR_SENSOR_NOT_READY:
      case DHTLIB_ERROR_BIT_SHIFT:
      default:
        if (++failCount > 10) {
          value = NAN;
          lastTemp = NAN;
          lastHum = NAN;
          extractValue();             // publishes NAN -> page shows "NOK"
        }
        return;
    }
  }

  float t = dht->getTemperature();
  float h = dht->getHumidity();

  // dhtnew returns -999 (DHTLIB_INVALID_VALUE) for a failed or not yet done
  // reading, and a noisy line can produce garbage. Accept only values inside
  // the DHT22 range; treat anything else as a failed read.
  if (isnan(t) || isnan(h) ||
      t < DHT_TEMP_MIN || t > DHT_TEMP_MAX ||
      h < DHT_HUM_MIN  || h > DHT_HUM_MAX) {
    if (++failCount > 10) {
      value = NAN;
      lastTemp = NAN;
      lastHum = NAN;
      extractValue();                 // publishes NAN -> page shows "NOK"
    }
    return;
  }
  lastTemp = t;
  lastHum = h;

  float v = extractValue();
  if (isnan(v)) {
    if (++failCount > 10) value = NAN;
    return;
  }

  value = v;
  failCount = 0;
}



LevelSensor ::LevelSensor(int lo, int hi)
  : Sensor("level", 500), pinLo(lo), pinHi(hi) {}

void LevelSensor ::read() {
  bool lo = digitalRead(pinLo);
  bool hi = digitalRead(pinHi);

  int level;
  if (lo && hi) level = 0;           // LOW
  else if (lo && !hi) level = -1;    // NOK (impossible float combination)
  else if (!lo && hi) level = 1;     // OK
  else level = 2;                    // HIGH

  if (level != S.level) {
    Serial.printf("Level: lo=%d hi=%d -> %d\n", lo, hi, level);
  }
  S.level = level;
}


AirTempSensor::AirTempSensor(DHTNEW *driver)
  : DHTSensor("airTemp", 5000, driver) {}

float AirTempSensor::extractValue() {
  S.airTemp = lastTemp;
  return lastTemp;
}

AirHumSensor::AirHumSensor(DHTNEW *driver)
  : DHTSensor("airHum", 5000, driver) {}

float AirHumSensor::extractValue() {
  S.airHum = lastHum;
  return lastHum;
}


Sensor *sensors[] = {
  new WaterTempSensor(&waterTemperature),
  new AirTempSensor(&dht),
  new AirHumSensor(&dht),
  new LevelSensor(LEVEL_LO, LEVEL_HI)
};

const int SENSOR_COUNT = sizeof(sensors) / sizeof(sensors[0]);

static int sensorIndex = 0;

void updateSensors() {
  sensors[sensorIndex]->update();

  sensorIndex++;
  if (sensorIndex >= SENSOR_COUNT)
    sensorIndex = 0;
}

Ticker sensorsTicker;

void setupSensors() {
  // Level switches. Since arduino-esp32 3.x, digitalRead() on a pin that was
  // never set up with pinMode() returns 0 (and logs "IO x is not set as GPIO"),
  // so the level never changes. Use INPUT_PULLUP instead of INPUT if the
  // switches pull to GND and the board has no external pull-up resistors.
  pinMode(LEVEL_LO, INPUT);
  pinMode(LEVEL_HI, INPUT);

  waterTemperature.begin();
  waterTemperature.setWaitForConversion(false);   // see WaterTempSensor::read()
  waterTemperature.requestTemperatures();         // first conversion
  //  dht.begin();
  sensorsTicker.attach_ms(200, []() {
    updateSensors();
    updateNow();
  });
}

void fillDashboardState(JsonDocument &resp) {
  // 1. RTC
  char buf[16];
  rtcGetTimeString(buf, sizeof(buf));
  resp["rtc"] = buf;

  // 2. Sensors
  resp["w_temp"] = isnan(S.waterTemp)
                     ? "NOK"
                     : String(S.waterTemp, 1);

  resp["a_temp"] = isnan(S.airTemp)
                     ? "NOK"
                     : String(S.airTemp, 1);

  resp["a_hum"] = isnan(S.airHum)
                    ? "NOK"
                    : String(S.airHum, 1);

  switch (S.level) {
    case 0: resp["Level"] = "LOW"; break;
    case 1: resp["Level"] = "OK"; break;
    case 2: resp["Level"] = "HIGH"; break;
    default: resp["Level"] = "NOK"; break;
  }

  // 3. Outputs
  JsonArray arr = resp.createNestedArray("outputs");

  for (int ch = 0; ch < OUTPUT_COUNT; ch++) {
    auto &o = OUT[ch];

    JsonObject obj = arr.createNestedObject();
    obj["idx"] = ch;
    obj["value"] = (int)(o.current* 100) / 255;

    // Frontend-driven countdown → send only remaining
    obj["next"] = (o.remaining > 0)
                    ? o.remaining
                    : 1;
  }
}
