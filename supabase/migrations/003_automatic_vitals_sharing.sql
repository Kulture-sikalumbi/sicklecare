-- A patient may opt in to automatic sharing during signup or later from the
-- patient dashboard. Only provisioned clinicians can see opted-in patients.
alter table public.profiles
  add column if not exists share_vitals_with_clinicians boolean not null default false,
  add column if not exists share_vitals_consent_at timestamptz;

create or replace function public.track_vitals_sharing_consent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.share_vitals_with_clinicians then
      new.share_vitals_consent_at := coalesce(new.share_vitals_consent_at, now());
    else
      new.share_vitals_consent_at := null;
    end if;
    return new;
  end if;

  if new.share_vitals_with_clinicians is distinct from old.share_vitals_with_clinicians then
    if new.share_vitals_with_clinicians then
      new.share_vitals_consent_at := now();
    else
      new.share_vitals_consent_at := null;
    end if;
  else
    new.share_vitals_consent_at := old.share_vitals_consent_at;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_track_vitals_sharing_consent on public.profiles;
create trigger profiles_track_vitals_sharing_consent
before insert or update
on public.profiles
for each row execute procedure public.track_vitals_sharing_consent();

-- Store the signup choice from Supabase Auth metadata. Missing consent always
-- defaults to private, including for accounts created outside this signup UI.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, share_vitals_with_clinicians)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'share_vitals_with_clinicians' = 'true', false)
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Automatic visibility supplements the existing per-patient code sharing.
-- Symptom logs remain private to the patient.
drop policy if exists "profiles_view_shared_patients" on public.profiles;
create policy "profiles_view_shared_patients" on public.profiles
for select using (
  exists (
    select 1 from public.care_shares
    where care_shares.patient_id = profiles.id
      and care_shares.clinician_id = auth.uid()
      and care_shares.status = 'active'
  )
  or (
    profiles.share_vitals_with_clinicians
    and exists (select 1 from public.clinicians where clinicians.user_id = auth.uid())
  )
);

drop policy if exists "devices_view_shared_patients" on public.devices;
create policy "devices_view_shared_patients" on public.devices
for select using (
  exists (
    select 1 from public.care_shares
    where care_shares.patient_id = devices.user_id
      and care_shares.clinician_id = auth.uid()
      and care_shares.status = 'active'
  )
  or (
    exists (
      select 1 from public.profiles
      where profiles.id = devices.user_id
        and profiles.share_vitals_with_clinicians
    )
    and exists (select 1 from public.clinicians where clinicians.user_id = auth.uid())
  )
);

drop policy if exists "readings_view_shared_patients" on public.readings;
create policy "readings_view_shared_patients" on public.readings
for select using (
  exists (
    select 1 from public.care_shares
    where care_shares.patient_id = readings.user_id
      and care_shares.clinician_id = auth.uid()
      and care_shares.status = 'active'
  )
  or (
    exists (
      select 1 from public.profiles
      where profiles.id = readings.user_id
        and profiles.share_vitals_with_clinicians
    )
    and exists (select 1 from public.clinicians where clinicians.user_id = auth.uid())
  )
);

