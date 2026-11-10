-- Temperature is an optional peripheral sensor reading. Its absence must not
-- prevent otherwise valid heart-rate and SpO2 readings from being stored.
alter table public.readings
  alter column skin_temp_c drop not null;
