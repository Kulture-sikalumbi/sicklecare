#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

constexpr uint8_t SDA_PIN = 21;
constexpr uint8_t SCL_PIN = 22;
constexpr uint8_t OLED_ADDRESS = 0x3C;
Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("SSD1306 init failed at 0x3C");
    while (true) delay(1000);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(false);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("OLED DISPLAY TEST");
  display.println("SickleCare ESP32");
  display.println("Address: 0x3C");
  display.println("Screen only");
  display.display();
  Serial.println("OLED test rendered once; no sensors are being read.");
}

void loop() {
  delay(1000);
}
