// Load an export (one folder per collection, one JSON file per document) into the deployed app.
// Usage: BASE_URL=https://your-app.vercel.app INGEST_TOKEN=… node scripts/import-export.mjs ./export
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || './export';
const { BASE_URL, INGEST_TOKEN } = process.env;
if (!BASE_URL || !INGEST_TOKEN) { console.error('Set BASE_URL and INGEST_TOKEN.'); process.exit(1); }

const writes = [];
for (const coll of readdirSync(dir)) {
  const p = join(dir, coll); if (!statSync(p).isDirectory()) continue;
  for (const f of readdirSync(p)) if (f.endsWith('.json')) writes.push({ coll, id: f.slice(0, -5), data: JSON.parse(readFileSync(join(p, f), 'utf8')) });
}
const url = BASE_URL.replace(/\/$/, '') + '/api/db?token=' + encodeURIComponent(INGEST_TOKEN);
let n = 0;
for (let i = 0; i < writes.length; i += 100) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'batch', writes: writes.slice(i, i + 100) }) });
  if (!r.ok) { console.error('failed', r.status, await r.text()); process.exit(1); }
  n += Math.min(100, writes.length - i);
}
const by = writes.reduce((a, w) => (a[w.coll] = (a[w.coll] || 0) + 1, a), {});
console.log(`Imported ${n} documents:`, by);
