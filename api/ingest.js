// iPhone Shortcut → Baseline, without Google Drive.
// POST /api/ingest?token=…  body: the Shortcut's text (Request Body = File)
//   → parses it like the app does, saves it to apple/{YYYY-MM}, and answers with this morning's summary,
//     so the Shortcut can show it as a notification.
// GET  /api/ingest?token=…  → only the summary (for a second "morning check" shortcut).
// Add ?format=json for a JSON answer.
//
// Env: INGEST_TOKEN and the Blob store (BLOB_READ_WRITE_TOKEN). Optional: BASELINE_TZ (default Europe/Berlin).
// The scoring code is the same file the browser runs (public/js).
import { ingestTokenOk } from '../lib/auth.js';
import { readAll, writeMany } from '../lib/store.js';
import { loadEngine, collsToData } from '../lib/engine.js';
import { loadAuth } from '../lib/strava.js';
import { syncActivities } from '../lib/stravaSync.js';
export { loadEngine };

async function upsert(rows) { if (rows.length) await writeMany(rows); }
// kept for the tests: rows [{coll, id, data}] → the app's data shape
export function docsToData(rows) { const all = {}; for (const r of rows) (all[r.coll] = all[r.coll] || {})[r.id] = r.data; return collsToData(all); }

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
    const D = collsToData(await readAll());
    let saved = null;
    if (req.method === 'POST') {
      const text = await readBody(req);
      if (!text || !text.trim()) return send(400, { error: 'empty body. In the Shortcut, set Request Body to File and pick the final Text.' });
      const { r, months, docs } = ingestText(E, D, text);
      const meta = { lastSync: new Date().toISOString(), files: (D.metaDrive && D.metaDrive.files) || {}, last: { file: 'iPhone (direct)', at: new Date().toISOString(), counts: r.counts, warnings: r.warnings.slice(0, 4) }, via: 'ingest' };
      await upsert(months.map(m => ({ coll: 'apple', id: m, data: docs[m] })).concat([{ coll: 'meta', id: 'gdrive', data: meta }]));
      saved = { months, counts: r.counts, warnings: r.warnings.slice(0, 4) };
      // the morning sync also pulls new Strava activities when Strava is connected (best effort, a few at a time)
      try { if (await loadAuth()) { const sr = await syncActivities({ maxStreams: 8 }); saved.strava = sr.fetched; const all = await readAll(['strava', 'meta']); D.strava = collsToData(all).strava; } } catch (e) { console.warn('strava during ingest', e.message); saved.stravaError = e.code || 'failed'; }
    } else if (req.method !== 'GET') return send(405, { error: 'use POST (sync) or GET (summary)' });
    const sum = summarize(E, D);
    return send(200, { ...sum, saved });
  } catch (e) {
    console.error(e);
    return send(e.status || 500, { error: e.message || 'failed' });
  }
}
