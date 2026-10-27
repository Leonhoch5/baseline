// The app's storage API (private Vercel Blob behind the app login).
//   GET  /api/db?colls=apple,strava,…      → { colls: { apple: { id: data, … }, … } }   (all of the app's collections when colls is omitted)
//   GET  /api/db?coll=journal              → { docs: { id: data, … } }
//   POST /api/db  { op: 'set', coll, id, data }      → { ok: true }
//   POST /api/db  { op: 'delete', coll, id }         → { ok: true }
//   POST /api/db  { op: 'batch', writes: [{ coll, id, data|null }, …] } → { ok: true, written: { coll: n } }
// Auth: Authorization: Bearer <session token from /api/login>, or ?token=INGEST_TOKEN (used by the import script).
import { callerOk } from '../lib/auth.js';
import { COLLS, readAll, readColl, writeDoc, deleteDoc, writeMany, checkName, etagTest } from '../lib/store.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, obj) => res.status(status).json(obj);
  const fail = (status, code, message) => send(status, { error: { code, message } });
  try {
    if (!callerOk(req)) return fail(401, 'unauthenticated', 'sign in first');
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET') {
      if (url.searchParams.get('op') === 'etagtest') return send(200, await etagTest());
      const one = url.searchParams.get('coll');
      if (one) return send(200, { docs: (await readColl(checkName(one, 'collection'))).docs });
      const colls = (url.searchParams.get('colls') || '').split(',').map(s => s.trim()).filter(Boolean);
      return send(200, { colls: await readAll(colls.length ? colls : COLLS) });
    }
    if (req.method !== 'POST') return fail(405, 'method', 'use GET or POST');
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return fail(400, 'bad_request', 'body is not JSON'); } }
    if (!b || typeof b !== 'object') return fail(400, 'bad_request', 'missing body');
    if (b.op === 'set') { if (b.data === undefined || b.data === null || typeof b.data !== 'object') return fail(400, 'bad_request', 'data must be an object'); await writeDoc(checkName(b.coll, 'collection'), checkName(b.id, 'id'), b.data); return send(200, { ok: true }); }
    if (b.op === 'delete') { await deleteDoc(checkName(b.coll, 'collection'), checkName(b.id, 'id')); return send(200, { ok: true }); }
    if (b.op === 'batch') {
      const writes = Array.isArray(b.writes) ? b.writes : [];
      if (!writes.length || writes.length > 500) return fail(400, 'bad_request', '1–500 writes');
      const out = await writeMany(writes.map(w => ({ coll: w.coll, id: w.id, data: w.data === undefined ? null : w.data })));
      return send(200, { ok: true, written: Object.fromEntries(Object.entries(out).map(([c, d]) => [c, Object.keys(d).length])) });
    }
    return fail(400, 'bad_request', 'op must be set, delete or batch');
  } catch (e) {
    console.error('db', e);
    return fail(e.status || 500, e.code || 'storage', e.message || 'storage failed');
  }
}
