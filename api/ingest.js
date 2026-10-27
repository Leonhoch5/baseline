// iPhone Shortcut → Baseline, without Google Drive.
// POST /api/ingest?token=…  body: the Shortcut's text (Request Body = File)
//   → parses it like the app does, saves it to apple/{YYYY-MM}, and answers with this morning's summary,
//     so the Shortcut can show it as a notification.
// GET  /api/ingest?token=…  → only the summary (for a second "morning check" shortcut).
// Add ?format=json for a JSON answer.
//
// Env: INGEST_TOKEN and the Blob store (BLOB_READ_WRITE_TOKEN). Optional: BASELINE_TZ (default Europe/Berlin).
// The scoring code is the same file the browser runs (public/js).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ingestTokenOk } from '../lib/auth.js';
import { readAll, writeMany } from '../lib/store.js';

process.env.TZ = process.env.BASELINE_TZ || 'Europe/Berlin'; // the app works in local wall-clock time

const ENGINE_FILES = ['util.js', 'apple.js', 'shortcut.js', 'strava.js', 'model.js', 'insights.js', 'calib.js', 'recovery.js', 'tests.js', 'race.js', 'coach.js', 'planedit.js'];
let engine = null;
export function loadEngine(dir = path.join(process.cwd(), 'public', 'js')) {
  if (engine) return engine;
  const ctx = vm.createContext({ console, performance: { now: () => Date.now() }, TextDecoder, TextEncoder });
  const src = ENGINE_FILES.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  vm.runInContext(src, ctx, { filename: 'baseline-engine.js' });
  engine = ctx;
  return ctx;
}

// rows [{coll, id, data}] from the stored collections
export async function loadDocs() {
  const all = await readAll();
  const rows = [];
  for (const coll of Object.keys(all)) for (const id of Object.keys(all[coll])) rows.push({ coll, id, data: all[coll][id] });
  return rows;
}
async function upsert(rows) { if (rows.length) await writeMany(rows); }

// same shape the browser app builds from its collections (app.js initDb)
export function docsToData(rows) {
  const D = { apple: {}, strava: {}, journal: {}, planMeta: null, planSessions: [], planWeeks: [], plans: [], planChecks: {}, planEdits: {}, preds: {}, profile: {}, tests: { list: [] }, overlaps: { split: {} }, metaApple: null, metaStrava: null, metaDrive: null };
  for (const { coll, id, data } of rows) {
    if (coll === 'apple' || coll === 'strava' || coll === 'journal' || coll === 'preds') D[coll][id] = data;
    else if (coll === 'planSessions' || coll === 'planWeeks') D[coll].push({ id, ...data });
    else if (coll === 'plans') D.plans.push({ ...data, id });
    else if (coll === 'plan') { if (id === 'meta') D.planMeta = data; if (id === 'checks') D.planChecks = data; if (id === 'edits') D.planEdits = data; }
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
  const M = E.calibrate(E.enrichModel(E.scoreModel(E.buildModel(D), D)), D);
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
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const send = (status, obj) => {
    res.setHeader('Cache-Control', 'no-store');
    if (url.searchParams.get('format') === 'json') return res.status(status).json(obj);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(status).send(obj.error ? 'Baseline: ' + obj.error : obj.title + '\n' + obj.body);
  };
  if (!ingestTokenOk(url.searchParams.get('token') || req.headers['x-baseline-token'])) return send(401, { error: 'wrong or missing token' });
  try {
    const E = loadEngine();
    const D = docsToData(await loadDocs());
    let saved = null;
    if (req.method === 'POST') {
      const text = await readBody(req);
      if (!text || !text.trim()) return send(400, { error: 'empty body. In the Shortcut, set Request Body to File and pick the final Text.' });
      const { r, months, docs } = ingestText(E, D, text);
      const meta = { lastSync: new Date().toISOString(), files: (D.metaDrive && D.metaDrive.files) || {}, last: { file: 'iPhone (direct)', at: new Date().toISOString(), counts: r.counts, warnings: r.warnings.slice(0, 4) }, via: 'ingest' };
      await upsert(months.map(m => ({ coll: 'apple', id: m, data: docs[m] })).concat([{ coll: 'meta', id: 'gdrive', data: meta }]));
      saved = { months, counts: r.counts, warnings: r.warnings.slice(0, 4) };
    } else if (req.method !== 'GET') return send(405, { error: 'use POST (sync) or GET (summary)' });
    const sum = summarize(E, D);
    return send(200, { ...sum, saved });
  } catch (e) {
    console.error(e);
    return send(e.status || 500, { error: e.message || 'failed' });
  }
}
