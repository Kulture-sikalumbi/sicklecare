-- The server-only ingestion function authenticates as service_role. Grant it
-- only the table operations it uses; client roles retain their existing RLS.
grant usage on schema public to service_role;
grant select on public.device_credentials to service_role;
grant select, update on public.devices to service_role;
grant select, insert on public.readings to service_role;

