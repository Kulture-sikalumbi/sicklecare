import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envExamplePath = path.join(root, '.env.example');

test('Supabase env template includes required public keys', () => {
  assert.ok(fs.existsSync(envExamplePath), 'Expected .env.example to exist');

  const contents = fs.readFileSync(envExamplePath, 'utf8');

  assert.match(contents, /NEXT_PUBLIC_SUPABASE_URL=/, 'Missing NEXT_PUBLIC_SUPABASE_URL');
  assert.match(contents, /NEXT_PUBLIC_SUPABASE_ANON_KEY=/, 'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY');
  assert.match(contents, /SUPABASE_SERVICE_ROLE_KEY=/, 'Missing SUPABASE_SERVICE_ROLE_KEY');
});
