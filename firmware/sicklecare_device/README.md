# SickleCare ESP32 firmware

This sketch targets the classic ESP32 board detected as `ESP32-D0WD-V3` on `COM9` and uses the confirmed I2C devices at `0x3C` (SH1106 OLED), `0x57` (HW-058/MAX30102), and `0x68` (MPU6050). It scans safe GPIOs for a DS18B20 one-wire device at boot.

The sketch displays readings locally even before Wi-Fi credentials are entered. It samples MAX30102 data, estimates HR/SpO2 with the SparkFun example algorithm, reads the DS18B20, and marks the packet low quality when the MPU6050 detects movement. Values are informational prototype measurements, not clinical readings.

## Build and upload

Arduino CLI, ESP32 core 3.3.12, and the required libraries are installed on the development computer. From the repository root:

```powershell
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/sicklecare_device
arduino-cli upload -p COM9 --fqbn esp32:esp32:esp32 firmware/sicklecare_device
arduino-cli monitor -p COM9 --config baudrate=115200
```

Installed libraries: Adafruit MPU6050, Adafruit SH110X, SparkFun MAX3010x, DallasTemperature, and OneWire (plus their dependencies).

## Connect to Supabase

The ignored local `secrets.h` is already prepared with this device's generated UUID and raw token. Enter only your Wi-Fi SSID and password in that file; do not paste them into chat. `secrets.h` is excluded from Git. `supabase_root_ca.h` contains the public root certificate from the Supabase TLS chain; the firmware validates HTTPS and refuses insecure TLS.

Create or sign in to a patient account at `http://localhost:3000/login`. In Supabase Dashboard → Authentication → Users, copy that patient's **User ID** and replace `REPLACE-WITH-PATIENT-AUTH-USER-UUID` in `provision_device.sql`. Run that SQL in the Supabase SQL Editor. It creates the profile/device and stores only SHA-256(token) as `device_credentials.token_hash`. The raw token belongs only in the local secrets file / device firmware. Never use a service-role key in the firmware.

After Wi-Fi and SQL provisioning are ready, compile and upload the firmware again so the board receives the Wi-Fi settings, then verify the ingestion result in Serial Monitor at 115200 baud.

The function expects the agreed JSON payload and `x-device-token`. Sequence state is kept in ESP32 NVS and incremented after successful ingestion.

## Hardware notes

- I2C SDA/SCL: GPIO21/GPIO22.
- The DS18B20 wire pin is auto-detected across GPIO4, 16, 17, 18, 19, 23, 25, 26, 27, 32, and 33.
- DS18B20 is the component shown in the current diagnostic screen; it differs from the MAX30205 listed in the proposal.
- The demo attempts an upload every 60 seconds after boot when fresh pulse estimates, temperature, Wi-Fi, valid UTC time, and credentials are available.
