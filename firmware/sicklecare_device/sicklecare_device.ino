#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
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
constexpr uint32_t SAMPLE_INTERVAL_MS = 15UL * 1000UL;
constexpr uint32_t SPO2_SAMPLE_COUNT = 100;

Adafruit_SH1106G display(128, 64, &Wire, -1);
Adafruit_MPU6050 mpu;
MAX30105 max30102;
OneWire *oneWire = nullptr;
DallasTemperature *temperatureSensor = nullptr;
Preferences preferences;
WebServer setupWebServer(80);
DNSServer setupDnsServer;
String configuredWifiSsid;
String configuredWifiPassword;

uint32_t irBuffer[SPO2_SAMPLE_COUNT];
uint32_t redBuffer[SPO2_SAMPLE_COUNT];
uint32_t sampleCount = 0;
uint32_t lastPulseSampleMs = 0;
uint32_t lastUploadMs = 0;
uint32_t sequenceNumber = 0;
uint32_t lastStatusMs = 0;
uint32_t lastTemperatureRequestMs = 0;
uint32_t lastWifiRetryMs = 0;
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
  return strlen(DEVICE_ID) == 36 && strlen(DEVICE_TOKEN) >= 32;
}

bool getIsoUtc(char *output, size_t outputSize) {
  const time_t now = time(nullptr);
  if (now < 1700000000) return false;  // NTP has not provided a plausible UTC time yet.
  struct tm utc;
  gmtime_r(&now, &utc);
  return strftime(output, outputSize, "%Y-%m-%dT%H:%M:%SZ", &utc) > 0;
}

String makeSetupPassword() {
  const char alphabet[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  String result;
  result.reserve(12);
  for (uint8_t i = 0; i < 12; i++) {
    result += alphabet[esp_random() % (sizeof(alphabet) - 1)];
  }
  return result;
}

void startWifiSetupPortal() {
  const String deviceSuffix = String(DEVICE_ID).substring(32, 36);
  const String accessPointName = "SickleCare-" + deviceSuffix;
  String accessPointPassword = preferences.getString("setup_key", "");
  if (accessPointPassword.length() < 8) {
    accessPointPassword = makeSetupPassword();
    preferences.putString("setup_key", accessPointPassword);
  }

  WiFi.mode(WIFI_AP);
  const IPAddress portalIp(192, 168, 4, 1);
  WiFi.softAPConfig(portalIp, portalIp, IPAddress(255, 255, 255, 0));
  if (!WiFi.softAP(accessPointName.c_str(), accessPointPassword.c_str())) {
    Serial.println("Could not start Wi-Fi setup access point; retrying in 5 seconds.");
    delay(5000);
    ESP.restart();
  }

  setupWebServer.on("/", HTTP_GET, []() {
    setupWebServer.send(200, "text/html",
      "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>SickleCare Wi-Fi setup</title><style>body{font:16px system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#123f4a}"
      "label{display:block;margin:1rem 0 .3rem}input,button{box-sizing:border-box;width:100%;padding:.8rem;border:1px solid #b8cfcb;border-radius:.6rem;font:inherit}"
      "button{margin-top:1.3rem;background:#123f4a;color:white;font-weight:700}</style></head><body>"
      "<h1>Connect SickleCare to Wi-Fi</h1><p>Enter the 2.4 GHz Wi-Fi details for this location. The device will save them and reconnect automatically.</p>"
      "<form method='post' action='/save'><label for='ssid'>Wi-Fi name</label><input id='ssid' name='ssid' maxlength='32' required autocomplete='off'>"
      "<label for='password'>Wi-Fi password</label><input id='password' name='password' type='password' maxlength='63' autocomplete='new-password'>"
      "<button type='submit'>Save and connect</button></form></body></html>");
  });
  setupWebServer.on("/save", HTTP_POST, []() {
    const String ssid = setupWebServer.arg("ssid");
    const String password = setupWebServer.arg("password");
    if (ssid.isEmpty() || ssid.length() > 32 || password.length() > 63) {
      setupWebServer.send(400, "text/plain", "Enter a valid Wi-Fi name and password, then try again.");
      return;
    }
    preferences.putString("wifi_ssid", ssid);
    preferences.putString("wifi_password", password);
    setupWebServer.send(200, "text/html",
      "<!doctype html><html><meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<body style='font:16px system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#123f4a'>"
      "<h1>Wi-Fi details saved</h1><p>SickleCare is restarting and connecting to the network. You can close this page.</p></body></html>");
    delay(1200);
    ESP.restart();
  });
  setupWebServer.onNotFound([]() {
    setupWebServer.sendHeader("Location", "http://192.168.4.1/", true);
    setupWebServer.send(302, "text/plain", "Open the SickleCare setup page.");
  });
  setupWebServer.begin();
  setupDnsServer.start(53, "*", portalIp);

  Serial.println("Wi-Fi setup mode is active.");
  Serial.printf("Connect to %s with setup key %s, then open http://192.168.4.1\n",
                accessPointName.c_str(), accessPointPassword.c_str());
  showStatus("Wi-Fi setup", accessPointName.c_str(), accessPointPassword.c_str());
  while (true) {
    setupDnsServer.processNextRequest();
    setupWebServer.handleClient();
    delay(2);
  }
}

void connectWifi(bool forceSetup = false) {
  configuredWifiSsid = preferences.getString("wifi_ssid", "");
  configuredWifiPassword = preferences.getString("wifi_password", "");
  if (configuredWifiSsid.isEmpty() && strlen(WIFI_SSID) > 0 && strlen(WIFI_PASSWORD) > 0) {
    configuredWifiSsid = WIFI_SSID;
    configuredWifiPassword = WIFI_PASSWORD;
    preferences.putString("wifi_ssid", configuredWifiSsid);
    preferences.putString("wifi_password", configuredWifiPassword);
    Serial.println("Imported the existing Wi-Fi settings into device storage.");
  }
  if (forceSetup || configuredWifiSsid.isEmpty()) startWifiSetupPortal();

  WiFi.mode(WIFI_STA);
  WiFi.onEvent([](arduino_event_id_t event, arduino_event_info_t info) {
    if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
      Serial.printf("Wi-Fi disconnect reason=%u\n",
                    static_cast<unsigned>(info.wifi_sta_disconnected.reason));
    }
  });
  WiFi.setAutoReconnect(true);

  const int16_t networkCount = WiFi.scanNetworks(false, true);
  bool targetVisible = false;
  int32_t targetRssi = -127;
  int32_t targetChannel = 0;
  for (int16_t i = 0; i < networkCount; i++) {
    if (WiFi.SSID(i) == configuredWifiSsid) {
      targetVisible = true;
      targetRssi = WiFi.RSSI(i);
      targetChannel = WiFi.channel(i);
      break;
    }
  }
  Serial.printf("Wi-Fi scan: configured network %s; channel=%ld RSSI=%ld dBm\n",
                targetVisible ? "visible" : "not visible",
                static_cast<long>(targetChannel), static_cast<long>(targetRssi));
  WiFi.scanDelete();

  WiFi.begin(configuredWifiSsid.c_str(), configuredWifiPassword.c_str());
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
    Serial.println("Saved Wi-Fi could not be reached; starting setup portal.");
    startWifiSetupPortal();
  }
  lastWifiRetryMs = millis();
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
      !heartRateValid || !spo2Valid) {
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
  char temperatureJson[16];
  if (isfinite(temperatureC)) {
    snprintf(temperatureJson, sizeof(temperatureJson), "%.2f", temperatureC);
  } else {
    strcpy(temperatureJson, "null");
  }
  snprintf(payload, sizeof(payload),
           "{\"device_id\":\"%s\",\"seq\":%lu,\"recorded_at\":\"%s\",\"hr_bpm\":%ld,\"spo2_pct\":%ld,\"skin_temp_c\":%s,\"signal_ok\":%s}",
           DEVICE_ID, static_cast<unsigned long>(nextSequence), recordedAt,
           static_cast<long>(heartRateBpm), static_cast<long>(spo2Percent),
           temperatureJson, signalOk ? "true" : "false");

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
  pinMode(0, INPUT_PULLUP);
  const bool forceWifiSetup = digitalRead(0) == LOW;
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

  connectWifi(forceWifiSetup);
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
    postReading(peripheralTempC);
    lastUploadMs = now;
  }

  if (WiFi.status() != WL_CONNECTED && !configuredWifiSsid.isEmpty() &&
      now - lastWifiRetryMs >= 15000) {
    lastWifiRetryMs = now;
    Serial.println("Retrying Wi-Fi connection.");
    WiFi.reconnect();
  }
  delay(2);
}
