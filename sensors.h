#ifndef SENSORS_H
#define SENSORS_H

#pragma once
#define ARDUINOJSON_ENABLE_HEAP 1

#include <ArduinoJson.h>
#include <Arduino.h>
#include <dhtnew.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Ticker.h>
#include "helpers.h"
#include "outputs.h"

// Forward declarations for sensor drivers
class DallasTemperature;
class DHTNEW;

#define LEVEL_LO 5
#define LEVEL_HI 16
#define DHTTYPE AM2302  // DHT 22  (AM2302), AM2321
#define DHTPIN 21
#define ONE_WIRE_BUS 23


//---
// Base Sensor class (abstract)
//---
class Sensor {
public:
    String name;            // Human-readable name
    uint32_t intervalMs;    // Update interval
    uint32_t lastUpdate;    // Last update timestamp
    float value;            // Last measured value
    int failCount;          // Consecutive failures allowed
    Sensor(const String &n, uint32_t interval);

    // Called periodically by the engine
    void update();

    // Must be implemented by each sensor type
    virtual void read() = 0;
};

//---
// Concrete sensor types
//---

//---
// Base DHT Sensor class
//---
class DHTSensor : public Sensor {
public:
    DHTNEW *dht;
    float lastTemp;
    float lastHum;

    DHTSensor(const String &n, uint32_t interval, DHTNEW *driver);

    void read() override;

protected:
    virtual float extractValue() = 0;   // implemented by children
};


// Air temperature
class AirTempSensor : public DHTSensor {
public:
    AirTempSensor(DHTNEW *driver);
protected:
    float extractValue() override;
};


// Air humidity
class AirHumSensor : public DHTSensor {
public:
    AirHumSensor(DHTNEW *driver);
protected:
    float extractValue() override;
};

// Water temperature (Dallas DS18B20)
class WaterTempSensor : public Sensor {
public:
    DallasTemperature *ds;

    WaterTempSensor(DallasTemperature *driver);

    void read() override;
};

// Water level (two digital pins)
class LevelSensor : public Sensor {
public:
    int pinLo;
    int pinHi;

    LevelSensor(int loPin, int hiPin);

    void read() override;
};

//---
// Sensor engine API
//---

void setupSensors();     // Initialize ticker + engine
void updateSensors();    // Round-robin update engine

extern Sensor* sensors[];    // Global sensor list
extern const int SENSOR_COUNT;
static String tempC = "tempC";

struct SensorState {
    float waterTemp = NAN;
    float airTemp = NAN;
    float airHum = NAN;
    int level = 0;   // 0=LOW, 1=OK, 2=HIGH, -1=NOK
    uint8_t wt_fail = 0;
    uint8_t at_fail = 0;
    uint8_t ah_fail = 0;

};
static SensorState S;
void fillDashboardState(JsonDocument &resp);
#endif