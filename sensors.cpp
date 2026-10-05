#include "sensors.h"
#include "scheduler.h"
DHTNEW dht(DHTPIN);
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature waterTemperature(&oneWire);


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

void WaterTempSensor ::read() {
  ds->requestTemperatures();
  float t = ds->getTempCByIndex(0);

  if (t < -100) {
    if (++failCount > 10) value = NAN;
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
        if (++failCount > 10) value = NAN;
        return;
    }
  }

  lastTemp = dht->getTemperature();
  lastHum = dht->getHumidity();

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

  if (lo && hi) S.level = 0;         // LOW
  else if (lo && !hi) S.level = -1;  // NOK
  else if (!lo && hi) S.level = 1;   // OK
  else S.level = 2;                  // HIGH
};


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
  waterTemperature.begin();
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
