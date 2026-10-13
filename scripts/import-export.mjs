// Load the export from the Claude version into Supabase.
// Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… USER_EMAIL=you@example.com node scripts/import-export.mjs ./export
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || './export';
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, USER_EMAIL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !USER_EMAIL) { console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and USER_EMAIL.'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: list, error: e1 } = await sb.auth.admin.listUsers({ perPage: 1000 });
if (e1) throw e1;
const user = list.users.find(u => (u.email || '').toLowerCase() === USER_EMAIL.toLowerCase());
if (!user) { console.error(`No Supabase user with ${USER_EMAIL}. Create it under Authentication › Users first.`); process.exit(1); }

const rows = [];
for (const coll of readdirSync(dir)) {
  const p = join(dir, coll); if (!statSync(p).isDirectory()) continue;
  for (const f of readdirSync(p)) if (f.endsWith('.json')) rows.push({ user_id: user.id, coll, id: f.slice(0, -5), data: JSON.parse(readFileSync(join(p, f), 'utf8')) });
}
for (let i = 0; i < rows.length; i += 50) {
  const { error } = await sb.from('docs').upsert(rows.slice(i, i + 50));
  if (error) throw error;
}
const by = rows.reduce((a, r) => (a[r.coll] = (a[r.coll] || 0) + 1, a), {});
console.log(`Imported ${rows.length} documents for ${USER_EMAIL}:`, by);
