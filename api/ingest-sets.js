// Gym sets delivered by the nightly Claude task (Strava's public API has no sets endpoint and its MCP server only admits
// allow-listed apps, so a scheduled Claude session reads them through the Strava connector and posts them here).
//   POST /api/ingest-sets?token=INGEST_TOKEN  { items: [{ sid, sets: [{e, kg?, r?, s?}], mg: {exercise: [groups]} }] }
//   → { ok, applied: n, pending: n }   (activities not synced yet keep their sets in meta/pendingSets until they arrive)
import { callerOk } from '../lib/auth.js';
import { updateColl } from '../lib/store.js';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
const NAME = /^[A-Za-z0-9_-]{1,40}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, obj) => res.status(status).json(obj);
  try {
    if (!callerOk(req)) return send(401, { error: { code: 'unauthenticated', message: 'token?' } });
    if (req.method !== 'POST') return send(405, { error: { code: 'method', message: 'use POST' } });
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
    const items = b && Array.isArray(b.items) ? b.items : [];
    const clean = [];
    for (const it of items) {
      const sid = String(it.sid || '').replace(/^s/, ''); if (!/^\d{5,}$/.test(sid)) continue;
      const sets = Array.isArray(it.sets) ? it.sets.filter(s => s && typeof s.e === 'string' && s.e.length <= 80).map(s => { const o = { e: s.e.slice(0, 80) }; if (s.kg != null && isFinite(+s.kg)) o.kg = +s.kg; if (s.r != null && isFinite(+s.r)) o.r = Math.round(+s.r); if (s.s != null && isFinite(+s.s)) o.s = Math.round(+s.s); return o; }).slice(0, 400) : [];
      const mg = {}; if (it.mg && typeof it.mg === 'object') for (const k of Object.keys(it.mg).slice(0, 60)) if (Array.isArray(it.mg[k])) mg[k.slice(0, 80)] = it.mg[k].map(String).slice(0, 8);
      clean.push({ sid, sets, mg, src: 'connector', at: new Date().toISOString() });
    }
    if (!clean.length) return send(400, { error: { code: 'bad_request', message: 'items: [{ sid, sets, mg }]' } });
    const bySid = Object.fromEntries(clean.map(c => [c.sid, c]));
    const applied = [];
    await updateColl('strava', docs => {
      let hit = false;
      for (const m of Object.keys(docs)) {
        const acts = (docs[m] && docs[m].acts) || [];
        let changed = false;
        const next = acts.map(a => {
          const c = a && a.sid ? bySid[String(a.sid)] : null; if (!c) return a;
          applied.push(c.sid); changed = true;
          if (a.setsSrc === 'manual' && a.sets && a.sets.length) return a;          // typed-in sets win
          const n = { ...a, setsDone: true }; if (c.sets.length) { n.sets = c.sets; n.mg = c.mg; n.setsSrc = 'connector'; } else { delete n.sets; delete n.mg; delete n.setsSrc; }
          return n;
        });
        if (changed) { hit = true; docs[m] = { ...docs[m], acts: next, updatedAt: new Date().toISOString() }; }
      }
      return hit ? docs : null;
    });
    const left = clean.filter(c => !applied.includes(c.sid));
    await updateColl('meta', docs => {
      const p = { ...((docs.pendingSets && docs.pendingSets.items) || {}) };
      for (const c of left) p[c.sid] = c;
      for (const sid of applied) delete p[sid];
      // keep it small: at most 60 pending, newest first
      const keys = Object.keys(p).sort((x, y) => (p[y].at || '').localeCompare(p[x].at || '')).slice(0, 60);
      docs.pendingSets = { items: Object.fromEntries(keys.map(k => [k, p[k]])), updatedAt: new Date().toISOString() };
      docs.sets = { lastDelivery: new Date().toISOString(), delivered: clean.length, applied: applied.length };
      return docs;
    });
    return send(200, { ok: true, applied: applied.length, pending: left.length, sids: { applied, pending: left.map(c => c.sid) } });
  } catch (e) {
    console.error('ingest-sets', e);
    return send(e.status || 500, { error: { code: e.code || 'storage', message: e.message || 'failed' } });
  }
}
