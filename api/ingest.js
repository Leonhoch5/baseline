// iPhone Shortcut → Baseline, without Google Drive.
// POST /api/ingest?token=…  body: the Shortcut's text (Request Body = File)
//   → parses it like the app does, saves it to apple/{YYYY-MM}, and answers with this morning's summary,
//     so the Shortcut can show it as a notification.
// GET  /api/ingest?token=…  → only the summary (for a second "morning check" shortcut).
// Add ?format=json for a JSON answer.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN, and BASELINE_USER_ID or USER_EMAIL.
// Optional: BASELINE_TZ (default Europe/Berlin). The scoring code is the same file the browser runs (public/js).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

process.env.TZ = process.env.BASELINE_TZ || 'Europe/Berlin'; // the app works in local wall-clock time

const ENGINE_FILES = ['util.js', 'apple.js', 'shortcut.js', 'strava.js', 'model.js', 'insights.js', 'calib.js', 'tests.js', 'race.js'];
let engine = null;
export function loadEngine(dir = path.join(process.cwd(), 'public', 'js')) {
  if (engine) return engine;
  const ctx = vm.createContext({ console, performance: { now: () => Date.now() }, TextDecoder, TextEncoder });
  const src = ENGINE_FILES.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  vm.runInContext(src, ctx, { filename: 'baseline-engine.js' });
  engine = ctx;
  return ctx;
}

// ---- Supabase REST (service role: bypasses row-level security, so every query filters on the user) ----
function sbHeaders(extra) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', ...(extra || {}) };
}
async function sbFetch(p, init) {
  const r = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + p, { ...init, headers: sbHeaders(init && init.headers) });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
let cachedUser = null;
async function userId() {
  if (process.env.BASELINE_USER_ID) return process.env.BASELINE_USER_ID;
  if (cachedUser) return cachedUser;
  const email = String(process.env.USER_EMAIL || '').toLowerCase();
  if (!email) throw new Error('Set BASELINE_USER_ID or USER_EMAIL');
  for (let page = 1; page <= 10; page++) {
    const r = await sbFetch(`/auth/v1/admin/users?page=${page}&per_page=100`);
    const u = (r.users || []).find(x => String(x.email || '').toLowerCase() === email);
    if (u) return (cachedUser = u.id);
    if (!r.users || r.users.length < 100) break;
  }
  throw new Error('No Supabase user with USER_EMAIL');
}
export async function loadDocs(uid) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await sbFetch(`/rest/v1/docs?user_id=eq.${encodeURIComponent(uid)}&select=coll,id,data&order=coll,id`, { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}
async function upsert(uid, rows) {
  if (!rows.length) return;
  const now = new Date().toISOString();
  await sbFetch('/rest/v1/docs?on_conflict=user_id,coll,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.map(r => ({ user_id: uid, coll: r.coll, id: r.id, data: r.data, updated_at: now }))) });
}

// same shape the browser app builds from its collections (app.js initDb)
export function docsToData(rows) {
  const D = { apple: {}, strava: {}, journal: {}, planMeta: null, planSessions: [], planWeeks: [], plans: [], planChecks: {}, preds: {}, profile: {}, tests: { list: [] }, overlaps: { split: {} }, metaApple: null, metaStrava: null, metaDrive: null };
  for (const { coll, id, data } of rows) {
    if (coll === 'apple' || coll === 'strava' || coll === 'journal' || coll === 'preds') D[coll][id] = data;
    else if (coll === 'planSessions' || coll === 'planWeeks') D[coll].push({ id, ...data });
    else if (coll === 'plans') D.plans.push({ ...data, id });
    else if (coll === 'plan') { if (id === 'meta') D.planMeta = data; if (id === 'checks') D.planChecks = data; }
    else if (coll === 'settings') { if (id === 'profile') D.profile = data; if (id === 'overlaps') D.overlaps = data; if (id === 'tests') D.tests = data; }
    else if (coll === 'meta') { if (id === 'apple') D.metaApple = data; if (id === 'strava') D.metaStrava = data; if (id === 'gdrive') D.metaDrive = data; }
  }
  return D;
}

export function ingestText(E, D, text) {
  const r = E.shortcutFileToDays(text);
  const docs = E.mergeShortcutDays([r], D.apple);
  for (const m in docs) D.apple[m] = docs[m];
  return { r, months: Object.keys(docs).sort(), docs };
}
export function summarize(E, D) {
  const M = E.calibrate(E.enrichModel(E.buildModel(D)), D);
  return E.morningSummary(M, M.today);
}

async function readBody(req) {
  // Vercel parses text, JSON and form bodies into req.body; anything else is read from the stream
  let b; try { b = req.body; } catch (e) { b = undefined; }
  if (typeof b === 'string') return b;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  if (b && typeof b === 'object') return String(b.data || b.text || b.file || '');
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 8 * 1024 * 1024) throw Object.assign(new Error('Body too large'), { status: 413 }); chunks.push(c); }
  let s = Buffer.concat(chunks).toString('utf8');
  const type = String(req.headers['content-type'] || '');
  if (/x-www-form-urlencoded/i.test(type)) { const p = new URLSearchParams(s); s = p.get('data') || p.get('text') || p.get('file') || ''; }
  else if (/application\/json/i.test(type)) { try { const j = JSON.parse(s); s = j.data || j.text || ''; } catch (e) { /* keep raw */ } }
  else if (/multipart\/form-data/i.test(type)) { const m = s.match(/name="(?:data|file|text)"[^\r\n]*\r\n(?:[^\r\n]+\r\n)*\r\n([\s\S]*?)\r\n--/); s = m ? m[1] : ''; }
  return s;
}
function tokenOk(given) {
  const want = process.env.INGEST_TOKEN || '';
  if (want.length < 16) return false; // refuse to run without a real secret
  const a = Buffer.from(String(given || '')), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const send = (status, obj) => {
    res.setHeader('Cache-Control', 'no-store');
    if (url.searchParams.get('format') === 'json') return res.status(status).json(obj);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(status).send(obj.error ? 'Baseline: ' + obj.error : obj.title + '\n' + obj.body);
  };
  if (!tokenOk(url.searchParams.get('token') || req.headers['x-baseline-token'])) return send(401, { error: 'wrong or missing token' });
  try {
    const E = loadEngine(), uid = await userId();
    const D = docsToData(await loadDocs(uid));
    let saved = null;
    if (req.method === 'POST') {
      const text = await readBody(req);
      if (!text || !text.trim()) return send(400, { error: 'empty body. In the Shortcut, set Request Body to File and pick the final Text.' });
      const { r, months, docs } = ingestText(E, D, text);
      const meta = { lastSync: new Date().toISOString(), files: (D.metaDrive && D.metaDrive.files) || {}, last: { file: 'iPhone (direct)', at: new Date().toISOString(), counts: r.counts, warnings: r.warnings.slice(0, 4) }, via: 'ingest' };
      await upsert(uid, months.map(m => ({ coll: 'apple', id: m, data: docs[m] })).concat([{ coll: 'meta', id: 'gdrive', data: meta }]));
      saved = { months, counts: r.counts, warnings: r.warnings.slice(0, 4) };
    } else if (req.method !== 'GET') return send(405, { error: 'use POST (sync) or GET (summary)' });
    const sum = summarize(E, D);
    return send(200, { ...sum, saved });
  } catch (e) {
    console.error(e);
    return send(e.status || 500, { error: e.message || 'failed' });
  }
}
