# SickleCare: Agent Instructions

I am building a NEW SickleCare web app as an installable Progressive Web App.
Do not extend or copy the old Flutter app. Anything under `docs/legacy/` is
background material only: read it for product ideas, never carry code forward.
The project proposal is in `docs/`.

## Stack

Next.js (App Router), TypeScript, Supabase Auth + Postgres + Edge Functions.
Before changing anything, verify the repo state, installed tooling, and current
framework conventions.

## Product goal

A patient-facing prototype for viewing wearable readings and recording symptoms.
It is NOT a clinically validated medical device. It must not diagnose, prescribe,
predict crises, or imply emergency monitoring. All health-related UI text is
informational only.

## MVP scope

- Authentication
- Patient dashboard with clearly labelled simulated readings
- Symptom logging
- Basic readings history
- Device status / last-seen indicator
- Accessible, responsive UI with PWA install support

## Not in MVP (do not build without asking)

- Doctor or caregiver roles, hospital triage dashboard
- Chat, location tracking, file uploads, push alerts, AI diagnosis
- BLE phone-gateway flow (phase 2)
- Alert logic (thresholds are not yet agreed with the client)

## Hardware context

- Confirmed board: ESP32-WROOM-32D (classic ESP32). The proposal names a XIAO
  ESP32-C3; the substitution is deliberate.
- Sensors (per proposal, to be verified by I2C scan): MAX30102 (HR, SpO2),
  MAX30205 (skin temperature), MPU6050 (motion), plus an OLED.
- MVP data path: the board POSTs readings over Wi-Fi/HTTPS directly to a
  Supabase Edge Function. Do not design around browser-to-board connections.
- Until real hardware is connected, use simulated readings that follow the exact
  payload below.

## Reading payload (agree before changing)

```json
{
  "device_id": "uuid",
  "seq": 1234,
  "recorded_at": "2026-11-09T12:00:00Z",
  "hr_bpm": 72,
  "spo2_pct": 97,
  "skin_temp_c": 33.4,
  "signal_ok": true
}
```

- `seq` is a per-device monotonic counter. Readings are unique on
  `(device_id, seq)` so offline-cached batches can be re-sent idempotently.
- `signal_ok = false` means the reading was motion-rejected on the device. Store
  it, show it as low quality, and never use it for trends or alerts.
- Validate ranges, units, payload shape and timestamps server-side. Reject
  timestamps unreasonably far in the future.

## Data and security requirements

- Define schema, constraints, indexes and Row Level Security for every table.
  Suggested tables: `profiles`, `devices`, `readings`, `symptom_logs`.
- Users may only access their own patient data. Write tests that prove another
  user cannot read or write it.
- Readings carry an `is_simulated` flag. Simulated data must be visibly labelled
  in the UI and kept distinct from real readings.
- Device ingestion is server-side only. Use per-device revocable tokens; store
  only hashed tokens. Never put the Supabase service-role key in the PWA,
  firmware, or Git. The service-role key is used server-side only.
- Secrets live in environment variables. Provide `.env.example` with
  placeholders only. Never commit `.env*` files with real values.

## Wording rules

- Temperature is "peripheral skin temperature", never core temperature or fever.
- SpO2 is an approximation from a low-cost sensor, not clinically accurate, and
  may be less reliable across skin tones. Say so wherever it is shown.
- Any future alert must be explainable (show why it fired) and based on the
  patient's own baseline, not universal thresholds.

## Working method

- Work in small, reviewable steps. First inspect the repo and propose a short
  plan, data model and security approach. Do not generate the whole app at once.
- Implement one tested vertical slice at a time, in this order:
  1. Auth + schema + RLS
  2. Dashboard with simulated readings
  3. Symptom logging
  4. Readings history + last-seen indicator
  5. Ingestion endpoint (test with curl)
- After each step: run the smallest relevant tests and type checks, report
  changed files and results, and commit with a clear message.
- Add input validation, useful error states, and tests for key access and data
  flows.
- Document setup, local development, tests, deployment assumptions, and how to
  configure secrets without committing them.
- Do not add features outside the agreed MVP without asking first.
- Stop and ask if a major product or hardware decision is needed.