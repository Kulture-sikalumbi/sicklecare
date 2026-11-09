#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include <Preferences.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <MAX30105.h>
#include "spo2_algorithm.h"
#include <OneWire.h>
#include <DallasTemperature.h>
#include "secrets.h"

// Confirmed by the uploaded I2C scan: OLED 0x3C, MAX30102 0x57, MPU6050 0x68.
// The DS18B20 uses OneWire, so it does not appear in the I2C scan.
constexpr uint8_t I2C_SDA_PIN = 21;
constexpr uint8_t I2C_SCL_PIN = 22;
constexpr uint8_t OLED_ADDRESS = 0x3C;
constexpr uint32_t SAMPLE_INTERVAL_MS = 60UL * 1000UL;
constexpr uint32_t SPO2_SAMPLE_COUNT = 100;

Adafruit_SH1106G display(128, 64, &Wire, -1);
Adafruit_MPU6050 mpu;
MAX30105 max30102;
OneWire *oneWire = nullptr;
DallasTemperature *temperatureSensor = nullptr;
Preferences preferences;

uint32_t irBuffer[SPO2_SAMPLE_COUNT];
uint32_t redBuffer[SPO2_SAMPLE_COUNT];
uint32_t sampleCount = 0;
uint32_t lastPulseSampleMs = 0;
uint32_t lastUploadMs = 0;
uint32_t sequenceNumber = 0;
uint32_t lastStatusMs = 0;
uint32_t lastTemperatureRequestMs = 0;
int32_t heartRateBpm = -1;
int32_t spo2Percent = -1;
bool heartRateValid = false;
bool spo2Valid = false;
bool oledReady = false;
bool mpuReady = false;
bool pulseOximeterReady = false;
bool temperatureReady = false;
uint8_t ds18b20DataPin = 255;
bool temperatureConversionPending = false;
float peripheralTempC = NAN;
float accelMagnitudeG = 1.0f;
float previousAxG = NAN;
float previousAyG = NAN;
float previousAzG = NAN;
bool signalOk = false;

void showStatus(const char *line1, const char *line2 = "", const char *line3 = "") {
  if (!oledReady) return;
  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("SICKLECARE DEVICE");
  display.println(line1);
  display.println(line2);
  display.println(line3);
  display.display();
}

bool hasDeviceCredentials() {
  return strlen(DEVICE_ID) == 36 && strlen(DEVICE_TOKEN) >= 32 &&
         strlen(WIFI_SSID) > 0 && strlen(WIFI_PASSWORD) > 0;
}

bool getIsoUtc(char *output, size_t outputSize) {
  const time_t now = time(nullptr);
  if (now < 1700000000) return false;  // NTP has not provided a plausible UTC time yet.
  struct tm utc;
  gmtime_r(&now, &utc);
  return strftime(output, outputSize, "%Y-%m-%dT%H:%M:%SZ", &utc) > 0;
}

void connectWifi() {
  if (strlen(WIFI_SSID) == 0) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected; IP: ");
    Serial.println(WiFi.localIP());
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  } else {
    Serial.println("Wi-Fi not connected; sensor display continues.");
  }
}

uint8_t findDs18b20DataPin() {
  // Avoid I2C, UART, flash-connected, and boot-strapping pins.
  const uint8_t candidates[] = {4, 16, 17, 18, 19, 23, 25, 26, 27, 32, 33};
  for (uint8_t pin : candidates) {
    OneWire candidateBus(pin);
    uint8_t address[8];
    candidateBus.reset_search();
    if (candidateBus.search(address) && address[0] == 0x28 &&
        OneWire::crc8(address, 7) == address[7]) {
      Serial.printf("DS18B20 found on GPIO %u\n", pin);
      return pin;
    }
  }
  Serial.println("DS18B20 not found on candidate GPIO pins.");
  return 255;
}

void updatePulseOximeter() {
  max30102.check();
  while (max30102.available()) {
    redBuffer[sampleCount] = max30102.getRed();
    irBuffer[sampleCount] = max30102.getIR();
    max30102.nextSample();
    sampleCount++;

    if (sampleCount == SPO2_SAMPLE_COUNT) {
      int8_t validHeart = 0;
      int8_t validOxygen = 0;
      maxim_heart_rate_and_oxygen_saturation(
          irBuffer, SPO2_SAMPLE_COUNT, redBuffer, &spo2Percent, &validOxygen,
          &heartRateBpm, &validHeart);
      heartRateValid = validHeart == 1 && heartRateBpm >= 30 && heartRateBpm <= 220;
      spo2Valid = validOxygen == 1 && spo2Percent >= 70 && spo2Percent <= 100;
      sampleCount = 0;
      lastPulseSampleMs = millis();
      Serial.printf("Pulse estimate: HR=%ld valid=%d SpO2=%ld valid=%d\n",
                    static_cast<long>(heartRateBpm), heartRateValid,
                    static_cast<long>(spo2Percent), spo2Valid);
    }
  }
}

void updateTemperature() {
  const uint32_t now = millis();
  if (!temperatureReady || temperatureSensor == nullptr) return;

  if (!temperatureConversionPending && now - lastTemperatureRequestMs >= 2000) {
    temperatureSensor->requestTemperatures();
    temperatureConversionPending = true;
    lastTemperatureRequestMs = now;
  } else if (temperatureConversionPending && now - lastTemperatureRequestMs >= 800) {
    const float value = temperatureSensor->getTempCByIndex(0);
    temperatureConversionPending = false;
    if (value != DEVICE_DISCONNECTED_C && value >= -20 && value <= 80) {
      peripheralTempC = value;
    }
  }
}

void updateMotionQuality() {
  if (!mpuReady) {
    signalOk = heartRateValid && spo2Valid;
    return;
  }

  sensors_event_t acceleration, gyro, sensorTemperature;
  mpu.getEvent(&acceleration, &gyro, &sensorTemperature);
  const float ax = acceleration.acceleration.x / 9.80665f;
  const float ay = acceleration.acceleration.y / 9.80665f;
  const float az = acceleration.acceleration.z / 9.80665f;
  accelMagnitudeG = sqrtf(ax * ax + ay * ay + az * az);
  const bool havePrevious = isfinite(previousAxG);
  const float movementG = havePrevious
      ? sqrtf((ax - previousAxG) * (ax - previousAxG) +
              (ay - previousAyG) * (ay - previousAyG) +
              (az - previousAzG) * (az - previousAzG))
      : 1.0f;
  previousAxG = ax;
  previousAyG = ay;
  previousAzG = az;
  const bool lowMotion = havePrevious && movementG < 0.12f;
  signalOk = heartRateValid && spo2Valid && lowMotion &&
             millis() - lastPulseSampleMs < 10000;
}

void drawDashboard() {
  if (!oledReady) return;
  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);
  display.setTextSize(1);
  display.setTextWrap(false);
  display.setCursor(0, 0);
  display.print("SICKLECARE");
  display.setCursor(0, 8);
  display.print("HR: ");
  if (heartRateValid) {
    display.print(heartRateBpm);
    display.print(" bpm");
  } else {
    display.print("wait finger");
  }
  display.setCursor(0, 16);
  display.print("SpO2: ");
  if (spo2Valid) {
    display.print(spo2Percent);
    display.print("% approx");
  } else {
    display.print("wait finger");
  }
  display.setCursor(0, 24);
  display.print("Temp: ");
  if (isfinite(peripheralTempC)) {
    display.print(peripheralTempC, 1);
    display.print(" C");
  } else {
    display.print("sensor missing");
  }
  display.setCursor(0, 32);
  display.print("MPU: ");
  display.print(mpuReady ? "ready" : "missing");
  display.setCursor(0, 40);
  display.print("Signal: ");
  display.print(signalOk ? "good" : "low quality");
  display.setCursor(0, 48);
  display.print("WiFi: ");
  display.print(WiFi.status() == WL_CONNECTED ? "connected" : "offline");
  display.display();

  Serial.printf("Status | MAX30102=%s HR=%ld/%s SpO2=%ld/%s | DS18B20=%s temp=%.2f C | MPU6050=%s motion=%.2f g signal_ok=%s | Wi-Fi=%s\n",
                pulseOximeterReady ? "ready" : "missing",
                static_cast<long>(heartRateBpm), heartRateValid ? "valid" : "invalid",
                static_cast<long>(spo2Percent), spo2Valid ? "valid" : "invalid",
                temperatureReady ? "ready" : "missing", peripheralTempC,
                mpuReady ? "ready" : "missing", accelMagnitudeG,
                signalOk ? "true" : "false",
                WiFi.status() == WL_CONNECTED ? "connected" : "offline");
}

bool postReading(float temperatureC) {
  if (!hasDeviceCredentials() || WiFi.status() != WL_CONNECTED ||
      !heartRateValid || !spo2Valid || !isfinite(temperatureC)) {
    return false;
  }

  char recordedAt[25];
  if (!getIsoUtc(recordedAt, sizeof(recordedAt))) {
    Serial.println("Waiting for NTP time before sending readings.");
    return false;
  }

  WiFiClientSecure tlsClient;
  if (strlen(SUPABASE_ROOT_CA) < 100) {
    Serial.println("Supabase root CA is not configured; refusing insecure HTTPS.");
    return false;
  }
  tlsClient.setCACert(SUPABASE_ROOT_CA);

  HTTPClient https;
  if (!https.begin(tlsClient, INGEST_URL)) return false;
  https.addHeader("content-type", "application/json");
  https.addHeader("x-device-token", DEVICE_TOKEN);

  const uint32_t nextSequence = sequenceNumber + 1;
  char payload[320];
  snprintf(payload, sizeof(payload),
           "{\"device_id\":\"%s\",\"seq\":%lu,\"recorded_at\":\"%s\",\"hr_bpm\":%ld,\"spo2_pct\":%ld,\"skin_temp_c\":%.2f,\"signal_ok\":%s}",
           DEVICE_ID, static_cast<unsigned long>(nextSequence), recordedAt,
           static_cast<long>(heartRateBpm), static_cast<long>(spo2Percent),
           temperatureC, signalOk ? "true" : "false");

  const int status = https.POST(reinterpret_cast<uint8_t *>(payload), strlen(payload));
  const String response = https.getString();
  https.end();

  Serial.printf("Ingestion response: HTTP %d %s\n", status, response.c_str());
  if (status >= 200 && status < 300) {
    sequenceNumber = nextSequence;
    preferences.putUInt("seq", sequenceNumber);
    return true;
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  oledReady = display.begin(OLED_ADDRESS, true);
  showStatus("Starting sensors...");

  mpuReady = mpu.begin(0x68, &Wire);
  if (mpuReady) {
    mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }

  pulseOximeterReady = max30102.begin(Wire, I2C_SPEED_FAST);
  if (pulseOximeterReady) {
    // Averaging 4 samples at 100 Hz gives the algorithm's expected 25 samples/s.
    max30102.setup(60, 4, 2, 100, 411, 4096);
    max30102.setPulseAmplitudeGreen(0);
  }

  // Restore the fast shared bus used by the OLED and sensor modules.
  Wire.setClock(400000);

  ds18b20DataPin = findDs18b20DataPin();
  if (ds18b20DataPin != 255) {
    oneWire = new OneWire(ds18b20DataPin);
    temperatureSensor = new DallasTemperature(oneWire);
    temperatureSensor->begin();
    temperatureReady = temperatureSensor->getDeviceCount() > 0;
    temperatureSensor->setWaitForConversion(false);
  }
  if (temperatureReady) {
    temperatureSensor->requestTemperatures();
    temperatureConversionPending = true;
    lastTemperatureRequestMs = millis();
  }

  preferences.begin("sicklecare", false);
  sequenceNumber = preferences.getUInt("seq", 0);

  Serial.printf("OLED: %s | MAX30102: %s | MPU6050: %s | DS18B20: %s on GPIO %u\n",
                oledReady ? "ready" : "missing",
                pulseOximeterReady ? "ready" : "missing",
                mpuReady ? "ready" : "missing",
                temperatureReady ? "ready" : "missing", ds18b20DataPin);

  connectWifi();
  showStatus(pulseOximeterReady ? "Pulse sensor ready" : "Pulse sensor missing",
             temperatureReady ? "DS18B20 ready" : "DS18B20 missing",
             WiFi.status() == WL_CONNECTED ? "Wi-Fi connected" : "Wi-Fi offline");
}

void loop() {
  if (pulseOximeterReady) updatePulseOximeter();
  updateTemperature();
  updateMotionQuality();

  const uint32_t now = millis();
  if (now - lastStatusMs >= 5000) {
    drawDashboard();
    lastStatusMs = now;
  }

  if (now - lastUploadMs >= SAMPLE_INTERVAL_MS) {
    if (isfinite(peripheralTempC)) postReading(peripheralTempC);
    lastUploadMs = now;
  }

  if (WiFi.status() != WL_CONNECTED && strlen(WIFI_SSID) > 0) {
    WiFi.reconnect();
  }
  delay(2);
}
