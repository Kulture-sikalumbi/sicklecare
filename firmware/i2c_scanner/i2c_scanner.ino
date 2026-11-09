#include <Wire.h>

constexpr uint8_t SDA_PIN = 21;
constexpr uint8_t SCL_PIN = 22;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Wire.begin(SDA_PIN, SCL_PIN);
  Serial.println();
  Serial.println("SickleCare I2C scanner");
  Serial.println("SDA=GPIO21, SCL=GPIO22");
}

void loop() {
  uint8_t found = 0;

  Serial.println("Scanning...");
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    const uint8_t error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("Found device at 0x");
      if (address < 16) Serial.print('0');
      Serial.println(address, HEX);
      found++;
    }
  }

  if (found == 0) Serial.println("No I2C devices found");
  Serial.println("---");
  delay(3000);
}
