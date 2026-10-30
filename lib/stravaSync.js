// Pull activities from Strava into the strava/{YYYY-MM} documents, the same shape the browser app writes:
// { acts: [{ id: 's<id>', sid, name, sport, type, start, ls, le, durS, movS, distM, elevM, kcal, re, avgHr, maxHr, hb, hrDone, via }], updatedAt }.
// Heart-rate streams are fetched only for activities the Watch did not cover, at most `maxStreams` per run (Strava: 100 reads / 15 min).
import { api } from './strava.js';
import { readAll, updateColl, writeDoc } from './store.js';
import { loadEngine, collsToData } from './engine.js';

const todayYmd = () => new Date().toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function streamsFor(sid) {
  const st = await api(`/activities/${sid}/streams`, { keys: 'time,heartrate', key_by_type: 'true' });
  if (!st) return null;
  const time = st.time && st.time.data, hr = st.heartrate && st.heartrate.data;
  return { time, hr };
}
// merge activities into the month documents (existing fields such as hb are kept when the new record lacks them)
export async function saveActs(acts, metaPatch) {
  if (acts.length) await updateColl('strava', docs => {
    const byMonth = {};
    for (const a of acts) (byMonth[a.start.slice(0, 7)] || (byMonth[a.start.slice(0, 7)] = [])).push(a);
    for (const m of Object.keys(byMonth)) {
      const map = new Map(((docs[m] && docs[m].acts) || []).map(a => [a.id, a]));
      for (const a of byMonth[m]) { const old = map.get(a.id); map.set(a.id, old ? { ...old, ...a } : a); }
      docs[m] = { ...(docs[m] || {}), acts: [...map.values()].sort((x, y) => x.ls - y.ls), updatedAt: new Date().toISOString() };
    }
    return docs;
  });
  if (metaPatch) await updateColl('meta', docs => { docs.strava = { ...(docs.strava || {}), ...metaPatch }; for (const k of Object.keys(docs.strava)) if (docs.strava[k] == null) delete docs.strava[k]; return docs; });
}
export async function removeAct(sid) {
  const id = 's' + sid;
  await updateColl('strava', docs => {
    let hit = false;
    for (const m of Object.keys(docs)) { const acts = (docs[m] && docs[m].acts) || []; if (acts.some(a => a.id === id)) { hit = true; docs[m] = { ...docs[m], acts: acts.filter(a => a.id !== id), updatedAt: new Date().toISOString() }; } }
    return hit ? docs : null;
  });
}
// activities the Watch already recorded with heart rate don't need a stream fetch
function needsStream(E, D, a, existing) {
  if (!a.hasHr) return false;
  const o = existing[a.id]; if (o && o.hrDone) return false;
  const day = a.start.slice(0, 10), doc = D.apple[day.slice(0, 7)], dd = doc && doc.days && doc.days[day];
  if (dd && E.slotInfo(dd, E.minOfDayLms(a.ls), a.durS / 60).cov >= 0.6) return false;
  return true;
}
function coveredByWatch(E, D, acts) {
  const appleW = []; for (const m in D.apple) for (const w of (D.apple[m] && D.apple[m].workouts) || []) if (w.hb) appleW.push(w);
  const covered = new Set();
  try { for (const g of E.detectOverlaps(appleW, acts, {}).acts) if (g.hasWatchHr) g.ids.forEach(id => covered.add(id)); } catch (e) { /* no overlap info: fetch streams */ }
  return covered;
}
async function zonesPatch(D) {
  const E = loadEngine();
  const z = await api('/athlete/zones', {}); if (!z) return null;
  const hm = E.hrMaxFromStravaZones(z);
  const zs = z && Array.isArray(z.heart_rate_zones) && z.heart_rate_zones.length >= 5 ? z.heart_rate_zones.slice(0, 4).map(x => x && x.max).filter(x => x > 0) : null;
  const p = D.profile || {}, patch = {};
  if (hm && hm !== p.stravaHrMax) patch.stravaHrMax = hm;
  if (zs && zs.length === 4 && JSON.stringify(zs) !== JSON.stringify(p.stravaZones)) patch.stravaZones = zs;
  return Object.keys(patch).length ? patch : null;
}

// full or incremental sync; returns { fetched, saved, withHr, msg }
export async function syncActivities(opts = {}) {
  const E = loadEngine();
  const all = await readAll(['apple', 'strava', 'meta', 'settings']);
  const D = collsToData(all);
  const meta = D.metaStrava || {};
  const months = opts.months || 12;
  const windowStart = months ? addDays(todayYmd(), -Math.round(months * 30.44)) : '2008-01-01';
  const since = opts.full || !meta.lastSync ? windowStart : addDays(meta.lastSync.slice(0, 10), -3);
  const after = Math.floor(new Date(since + 'T00:00:00Z').getTime() / 1000);
  const got = [];
  for (let page = 1; page <= 20; page++) {
    const list = await api('/athlete/activities', { after, page, per_page: 200 });
    if (!Array.isArray(list) || !list.length) break;
    for (const a of list) { const n = E.normStravaRaw(a); if (n) got.push(n); }
    if (list.length < 200) break;
  }
  const existing = {}; for (const m in D.strava) for (const a of (D.strava[m] && D.strava[m].acts) || []) existing[a.id] = a;
  for (const a of got) { const o = existing[a.id]; if (o && o.hrDone) { a.hrDone = true; for (const k of ['hb', 'avgHr', 'maxHr']) if (o[k] != null && a[k] == null) a[k] = o[k]; } }
  const covered = coveredByWatch(E, D, got);
  const cutoff = addDays(todayYmd(), -120);
  const need = got.filter(a => !covered.has(a.id) && a.start.slice(0, 10) >= cutoff && needsStream(E, D, a, existing)).sort((x, y) => y.ls - x.ls).slice(0, opts.maxStreams || 30);
  let withHr = 0;
  for (const a of need) {
    try {
      const s = await streamsFor(a.sid); const hr = s ? E.hrFromStream(s.time, s.hr) : null;
      a.hrDone = true; if (hr) { Object.assign(a, hr); withHr++; }
    } catch (e) { if (e.code === 'rate_limited' || e.code === 'strava_auth') throw e; }
  }
  let zones = null; try { zones = await zonesPatch(D); } catch (e) { /* optional */ }
  if (zones) await writeDoc('settings', 'profile', { ...(D.profile || {}), ...zones });
  await saveActs(got, { lastSync: new Date().toISOString(), via: 'api', count: got.length, csvAt: null });
  const msg = got.length ? `Synced ${got.length} activities${withHr ? `, with heart rate for ${withHr}` : ''}.` : 'Strava is up to date. No new activities.';
  return { fetched: got.length, withHr, streamsLeft: Math.max(0, got.filter(a => a.hasHr && !a.hrDone && !covered.has(a.id)).length), msg };
}
// one activity from a webhook event
export async function upsertActivity(sid) {
  const E = loadEngine();
  const a = await api(`/activities/${sid}`, {}); if (!a) return null;
  const n = E.normStravaRaw(a); if (!n) return null;
  if (n.hasHr) {
    const all = await readAll(['apple', 'strava']); const D = collsToData(all);
    const existing = {}; for (const m in D.strava) for (const x of (D.strava[m] && D.strava[m].acts) || []) existing[x.id] = x;
    if (needsStream(E, D, n, existing) && !coveredByWatch(E, D, [n]).has(n.id)) {
      try { const s = await streamsFor(n.sid); const hr = s ? E.hrFromStream(s.time, s.hr) : null; n.hrDone = true; if (hr) Object.assign(n, hr); } catch (e) { /* keep summary values */ }
    }
  }
  await saveActs([n], { lastEvent: new Date().toISOString() });
  return n;
}
