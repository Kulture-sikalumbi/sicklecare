import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '001_initial_schema.sql'), 'utf8');
const ingestion = fs.readFileSync(path.join(root, 'supabase', 'functions', 'ingest-reading', 'index.ts'), 'utf8');

test('database contract protects server-only reading ingestion', () => {
  assert.match(migration, /create table if not exists public\.device_credentials/);
  assert.match(migration, /alter table public\.device_credentials enable row level security/);
  assert.doesNotMatch(migration, /readings_insert_own/);
  assert.match(migration, /unique \(device_id, seq\)/);
});

test('ingestion contract validates and preserves the agreed payload', () => {
  for (const field of ['device_id', 'seq', 'recorded_at', 'hr_bpm', 'spo2_pct', 'skin_temp_c', 'signal_ok']) {
    assert.match(ingestion, new RegExp(field));
  }
  assert.match(ingestion, /x-device-token/);
  assert.match(ingestion, /is_simulated: false/);
  assert.match(ingestion, /Date\.now\(\) \+ 5 \* 60 \* 1000/);
});
