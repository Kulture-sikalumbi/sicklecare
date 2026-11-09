# SickleCare

SickleCare is a patient-facing Progressive Web App prototype for reviewing wearable readings and recording symptoms. It is informational only: it is not clinically validated, does not diagnose or predict crises, and does not provide emergency monitoring.

## Run it

```bash
npm install
copy .env.example .env.local
npm run dev
```

The dashboard runs in preview mode with clearly labelled simulated readings when Supabase values are not configured. Add the public project URL and anon key to `.env.local` to enable account sign-in and persisted patient data.

For local hardware testing, run `npm run dev` and open `http://localhost:3000`. The ESP32 sends readings directly to the Supabase Edge Function, so the local dashboard can read the same database without waiting for an Azure deployment. Sign in with a patient account and refresh the dashboard after the device uploads a reading. Keep Wi-Fi credentials and the device token in the ignored firmware `secrets.h` file.

## Supabase

The linked project is configured through the Supabase CLI. Apply the database migration with:

```bash
supabase db push --linked
```

The schema includes profiles, devices, server-only device credentials, readings, symptom logs, indexes, ownership constraints, and RLS. Authenticated patients can read and manage their own profile, device, and symptom data. Readings are read-only to clients and are written by the ingestion function using the service role.

Deploy the hardware ingestion function with:

```bash
supabase functions deploy ingest-reading --no-verify-jwt
```

The function accepts the agreed payload at `/functions/v1/ingest-reading` with an `x-device-token` header. Store only a SHA-256 hash of each device token in `device_credentials`; never place a service-role key in the PWA or ESP32 firmware.

For a first hardware demo, provision a device and token in the Supabase SQL editor. Keep the raw token only in the ESP32 device configuration and use its hash in the database:

```sql
insert into public.devices (user_id, device_name, hardware_id)
values ('patient-auth-user-uuid', 'SickleBand · Demo unit', 'esp32-wroom-32d-demo')
returning id;

insert into public.device_credentials (device_id, token_hash)
values ('device-uuid-from-previous-query', encode(digest('replace-with-a-long-random-token', 'sha256'), 'hex'));
```

The function is intentionally deployed without Supabase JWT verification because the ESP32 authenticates with its revocable per-device token instead.

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

`seq` is idempotent per device. `signal_ok: false` readings are stored and displayed as low quality but excluded from the visual summary. The function rejects malformed values and timestamps more than five minutes in the future.

## Checks

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Local Supabase commands require Docker. The remote project can be used directly with `--linked`.
