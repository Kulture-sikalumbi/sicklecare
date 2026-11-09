-- Replace the patient UUID below with the id from Supabase Authentication > Users.
-- This script is safe to re-run for this device ID.
insert into public.profiles (id)
values ('REPLACE-WITH-PATIENT-AUTH-USER-UUID'::uuid)
on conflict (id) do nothing;

with provisioned_device as (
  insert into public.devices (id, user_id, device_name, device_type, hardware_id)
  values (
    '3c2aa0e1-493a-419d-b2e4-16e2c8ed9d97'::uuid,
    'REPLACE-WITH-PATIENT-AUTH-USER-UUID'::uuid,
    'SickleCare ESP32 Prototype',
    'esp32-wroom-32d',
    'esp32-582abd7d30ac'
  )
  on conflict (id) do update set
    user_id = excluded.user_id,
    device_name = excluded.device_name,
    hardware_id = excluded.hardware_id,
    is_active = true
  returning id
)
insert into public.device_credentials (device_id, token_hash, revoked_at)
select id, '46d456e4b05f80f242800ed7255a611d8db8c8fcd0b26d3584adcd113ae1c7fb', null from provisioned_device
on conflict (device_id) do update set
  token_hash = excluded.token_hash,
  revoked_at = null;
