-- Clinician accounts are provisioned by an administrator. Patients explicitly
-- authorize a clinician by creating a short-lived, single-use sharing code.
create table if not exists public.clinicians (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.care_shares (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  clinician_id uuid references public.profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  constraint care_shares_state_consistent check (
    (status = 'pending' and clinician_id is null and accepted_at is null)
    or (status = 'active' and clinician_id is not null and accepted_at is not null)
    or status = 'revoked'
  )
);

create unique index if not exists idx_care_shares_active_pair
  on public.care_shares(patient_id, clinician_id)
  where status = 'active';
create index if not exists idx_care_shares_clinician
  on public.care_shares(clinician_id, status);
create index if not exists idx_care_shares_patient
  on public.care_shares(patient_id, created_at desc);

alter table public.clinicians enable row level security;
alter table public.care_shares enable row level security;

create policy "clinicians_view_own" on public.clinicians
for select using (auth.uid() = user_id);

create policy "care_shares_patient_view_own" on public.care_shares
for select using (auth.uid() = patient_id);

create policy "care_shares_clinician_view_assigned" on public.care_shares
for select using (auth.uid() = clinician_id and status = 'active');

create policy "care_shares_patient_create_pending" on public.care_shares
for insert with check (
  auth.uid() = patient_id
  and clinician_id is null
  and status = 'pending'
  and expires_at > now()
  and expires_at <= now() + interval '8 days'
);

create policy "care_shares_patient_revoke" on public.care_shares
for update using (auth.uid() = patient_id)
with check (auth.uid() = patient_id and status = 'revoked');

create policy "profiles_view_shared_patients" on public.profiles
for select using (
  exists (
    select 1 from public.care_shares
    where care_shares.patient_id = profiles.id
      and care_shares.clinician_id = auth.uid()
      and care_shares.status = 'active'
  )
);

create policy "devices_view_shared_patients" on public.devices
for select using (
  exists (
    select 1 from public.care_shares
    where care_shares.patient_id = devices.user_id
      and care_shares.clinician_id = auth.uid()
      and care_shares.status = 'active'
  )
);

create policy "readings_view_shared_patients" on public.readings
for select using (
  exists (
    select 1 from public.care_shares
    where care_shares.patient_id = readings.user_id
      and care_shares.clinician_id = auth.uid()
      and care_shares.status = 'active'
  )
);

-- Redeem the raw code once; only its SHA-256 hash is stored in care_shares.
create or replace function public.redeem_care_share(share_code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  matched_share public.care_shares%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before redeeming a patient share code.';
  end if;

  if not exists (
    select 1 from public.clinicians where user_id = auth.uid()
  ) then
    raise exception 'This account is not enabled for clinician access.';
  end if;

  if share_code is null or length(trim(share_code)) < 32 or length(trim(share_code)) > 128 then
    raise exception 'Enter a valid patient share code.';
  end if;

  select * into matched_share
  from public.care_shares
  where token_hash = encode(digest(trim(share_code), 'sha256'), 'hex')
    and status = 'pending'
    and expires_at > now()
  for update;

  if not found then
    raise exception 'That share code is invalid, expired, or already used.';
  end if;

  update public.care_shares
  set clinician_id = auth.uid(), status = 'active', accepted_at = now()
  where id = matched_share.id;

  return matched_share.patient_id;
end;
$$;

revoke all on function public.redeem_care_share(text) from public, anon;
grant execute on function public.redeem_care_share(text) to authenticated;
grant select on public.clinicians to authenticated;
grant select, insert, update on public.care_shares to authenticated;

