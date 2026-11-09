import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type ReadingPayload = {
  device_id: string;
  seq: number;
  recorded_at: string;
  hr_bpm: number;
  spo2_pct: number;
  skin_temp_c: number;
  signal_ok: boolean;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validate(payload: unknown): payload is ReadingPayload {
  if (!payload || typeof payload !== "object") return false;
  const reading = payload as Record<string, unknown>;
  const recordedAt = typeof reading.recorded_at === "string"
    ? Date.parse(reading.recorded_at)
    : Number.NaN;

  return isUuid(reading.device_id) &&
    typeof reading.seq === "number" && Number.isSafeInteger(reading.seq) && reading.seq >= 0 &&
    Number.isFinite(recordedAt) && recordedAt <= Date.now() + 5 * 60 * 1000 &&
    typeof reading.hr_bpm === "number" && reading.hr_bpm >= 0 && reading.hr_bpm <= 300 &&
    typeof reading.spo2_pct === "number" && reading.spo2_pct >= 0 && reading.spo2_pct <= 100 &&
    typeof reading.skin_temp_c === "number" && reading.skin_temp_c >= 0 && reading.skin_temp_c <= 60 &&
    typeof reading.signal_ok === "boolean";
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ error: "Only POST is supported" }, 405);

  const token = request.headers.get("x-device-token");
  if (!token) return json({ error: "Missing device token" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  if (!validate(payload)) {
    return json({ error: "Invalid reading payload or timestamp" }, 400);
  }

  const tokenHash = await sha256(token);
  const { data: credential, error: credentialError } = await supabase
    .from("device_credentials")
    .select("device_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (credentialError) return json({ error: "Credential lookup failed" }, 500);
  if (!credential || credential.revoked_at || credential.device_id !== payload.device_id) {
    return json({ error: "Invalid or revoked device token" }, 401);
  }

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id, user_id, is_active")
    .eq("id", payload.device_id)
    .maybeSingle();

  if (deviceError) return json({ error: "Device lookup failed" }, 500);
  if (!device) return json({ error: "Device not found" }, 404);
  if (!device.is_active) return json({ error: "Device is inactive" }, 403);

  const { data: existing } = await supabase
    .from("readings")
    .select("id, device_id, seq, recorded_at, hr_bpm, spo2_pct, skin_temp_c, signal_ok, is_simulated")
    .eq("device_id", payload.device_id)
    .eq("seq", payload.seq)
    .maybeSingle();

  await supabase.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);

  if (existing) return json({ ok: true, duplicate: true, reading: existing });

  const { data: reading, error: insertError } = await supabase
    .from("readings")
    .insert({
      user_id: device.user_id,
      device_id: payload.device_id,
      seq: payload.seq,
      recorded_at: payload.recorded_at,
      hr_bpm: payload.hr_bpm,
      spo2_pct: payload.spo2_pct,
      skin_temp_c: payload.skin_temp_c,
      signal_ok: payload.signal_ok,
      is_simulated: false,
    })
    .select("id, device_id, seq, recorded_at, hr_bpm, spo2_pct, skin_temp_c, signal_ok, is_simulated")
    .single();

  if (insertError) return json({ error: "Reading could not be stored" }, insertError.code === "23505" ? 200 : 500);
  return json({ ok: true, duplicate: false, reading });
});
