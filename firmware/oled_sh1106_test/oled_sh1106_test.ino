#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>

constexpr uint8_t SDA_PIN = 21;
constexpr uint8_t SCL_PIN = 22;
constexpr uint8_t OLED_ADDRESS = 0x3C;
Adafruit_SH1106G display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  if (!display.begin(OLED_ADDRESS, true)) {
    Serial.println("SH1106 init failed at 0x3C");
    while (true) delay(1000);
  }

  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);
  display.setTextWrap(false);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("SH1106 DISPLAY TEST");
  display.println("SickleCare ESP32");
  display.println("Address: 0x3C");
  display.println("Screen only");
  display.display();
  Serial.println("SH1106 test rendered once; no sensors are being read.");
}

void loop() {
  delay(1000);
}
