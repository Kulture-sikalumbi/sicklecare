create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_name text not null check (length(trim(device_name)) between 1 and 80),
  device_type text not null default 'esp32' check (length(trim(device_type)) between 1 and 40),
  hardware_id text not null unique,
  last_seen_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

-- Device tokens are only used by the server-side ingestion function. They are
-- intentionally kept in a table with no client RLS policies.
create table if not exists public.device_credentials (
  device_id uuid primary key references public.devices(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  seq bigint not null,
  recorded_at timestamptz not null,
  hr_bpm numeric(5,2) not null check (hr_bpm between 0 and 300),
  spo2_pct numeric(5,2) not null check (spo2_pct between 0 and 100),
  skin_temp_c numeric(5,2) not null check (skin_temp_c between 0 and 60),
  signal_ok boolean not null default true,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (device_id, seq),
  foreign key (device_id, user_id) references public.devices(id, user_id)
);

create table if not exists public.symptom_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  recorded_at timestamptz not null default now(),
  severity integer not null check (severity between 1 and 10),
  symptom text not null check (length(trim(symptom)) between 1 and 80),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (device_id, user_id) references public.devices(id, user_id)
);

create index if not exists idx_devices_user_id on public.devices(user_id);
create index if not exists idx_readings_user_id on public.readings(user_id);
create index if not exists idx_readings_device_id on public.readings(device_id, recorded_at desc);
create index if not exists idx_symptom_logs_user_id on public.symptom_logs(user_id, recorded_at desc);

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create trigger profiles_updated_at
before update on public.profiles
for each row execute procedure public.handle_updated_at();

create trigger devices_updated_at
before update on public.devices
for each row execute procedure public.handle_updated_at();

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.readings enable row level security;
alter table public.symptom_logs enable row level security;
alter table public.device_credentials enable row level security;

create policy "profiles_view_own" on public.profiles
for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "devices_view_own" on public.devices
for select using (auth.uid() = user_id);

create policy "devices_insert_own" on public.devices
for insert with check (auth.uid() = user_id);

create policy "devices_update_own" on public.devices
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "devices_delete_own" on public.devices
for delete using (auth.uid() = user_id);

create policy "readings_view_own" on public.readings
for select using (auth.uid() = user_id);

-- Readings are written only by the server-side ingestion function with the
-- Supabase service role. Authenticated clients can read their own readings.

create policy "symptom_logs_view_own" on public.symptom_logs
for select using (auth.uid() = user_id);

create policy "symptom_logs_insert_own" on public.symptom_logs
for insert with check (auth.uid() = user_id);

create policy "symptom_logs_update_own" on public.symptom_logs
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "symptom_logs_delete_own" on public.symptom_logs
for delete using (auth.uid() = user_id);

-- No policies are created for device_credentials: the client must never read
-- or write device token hashes.
