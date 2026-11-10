-- RLS policies do not grant table-level permissions by themselves.
-- Give signed-in users only the operations used by the patient app; existing
-- row-level policies continue to restrict every row to its owner (or an
-- explicitly authorized clinician).
grant usage on schema public to authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.devices to authenticated;
grant select on public.readings to authenticated;
grant select, insert, update, delete on public.symptom_logs to authenticated;
