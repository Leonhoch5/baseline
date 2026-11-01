// ---------- Strava: bulk-export CSV parser + connector normalizer ----------
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (q) {
      if (ch === 34) { if (text.charCodeAt(i + 1) === 34) { f += '"'; i++; } else q = false; }
      else f += text[i];
    } else if (ch === 34) q = true;
    else if (ch === 44) { row.push(f); f = ''; }
    else if (ch === 10) { row.push(f); rows.push(row); row = []; f = ''; }
    else if (ch !== 13) f += text[i];
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const STRAVA_COLS = {
  id: ['activity id', 'aktivitäts-id', 'aktivitats-id', 'id der aktivität'],
  date: ['activity date', 'aktivitätsdatum', 'datum der aktivität'],
  name: ['activity name', 'name der aktivität', 'aktivitätsname'],
  type: ['activity type', 'aktivitätsart', 'aktivitätstyp', 'sportart'],
  elapsed: ['elapsed time', 'verstrichene zeit', 'gesamtzeit'],
  moving: ['moving time', 'bewegungszeit'],
  distance: ['distance', 'distanz', 'strecke'],
  maxhr: ['max heart rate', 'max. herzfrequenz', 'maximale herzfrequenz', 'max herzfrequenz'],
  avghr: ['average heart rate', 'durchschnittliche herzfrequenz', 'durchschn. herzfrequenz', 'ø herzfrequenz'],
  elev: ['elevation gain', 'höhenzuwachs', 'höhenmeter', 'anstieg'],
  kcal: ['calories', 'kalorien'],
  re: ['relative effort', 'relative leistung', 'relativer aufwand'],
};
const MONTHS3 = { jan: 0, feb: 1, mar: 2, mär: 2, mae: 2, apr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, dez: 11 };
function parseStravaDate(str) { // CSV dates are UTC → epoch ms
  const s = String(str || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/))) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if ((m = s.match(/^([A-Za-zÄäÖöÜü]+)\.? (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?/i))) {
    const mo = MONTHS3[m[1].toLowerCase().slice(0, 3)]; if (mo == null) return null;
    let h = +m[4]; if (m[7]) { const pm = /p/i.test(m[7]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return Date.UTC(+m[3], mo, +m[2], h, +m[5], +(m[6] || 0));
  }
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?/))) return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  if ((m = s.match(/^(\d{1,2})\.? ([A-Za-zÄäÖöÜü]+)\.? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?/))) {
    const mo = MONTHS3[m[2].toLowerCase().slice(0, 3)]; if (mo == null) return null;
    return Date.UTC(+m[3], mo, +m[1], +m[4], +m[5], +(m[6] || 0));
  }
  return null;
}
function localIsoFromUtc(ms) { const d = new Date(ms); return ymd(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function numOf(v) { if (v == null) return null; let s = String(v).trim(); if (!s) return null; if (s.indexOf('.') < 0 && /,\d+$/.test(s)) s = s.replace(',', '.'); s = s.replace(/[^\d.\-]/g, ''); const n = parseFloat(s); return isFinite(n) ? n : null; }

function parseStravaCsv(text) {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('The CSV file is empty.');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const find = (key, last) => { const names = STRAVA_COLS[key]; let idx = -1; head.forEach((h, i) => { if (names.includes(h) && (last || idx < 0)) idx = i; }); return idx; };
  const col = {};
  for (const k in STRAVA_COLS) col[k] = find(k, k === 'elapsed' || k === 'distance' || k === 'maxhr');
  const fallback = { id: 0, date: 1, name: 2, type: 3, elapsed: 5, distance: 6 };
  for (const k in fallback) if (col[k] < 0) col[k] = fallback[k];
  const distCols = head.filter(h => STRAVA_COLS.distance.includes(h)).length;
  if (!/\d/.test(rows[1][col.id] || '') || parseStravaDate(rows[1][col.date]) == null) throw new Error("This doesn't look like Strava's activities.csv. Use the file from your Strava account export.");
  const acts = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (row.length < 6) continue;
    const utc = parseStravaDate(row[col.date]); if (utc == null) continue;
    const start = localIsoFromUtc(utc);
    const durS = numOf(row[col.elapsed]); if (!durS) continue;
    let dist = numOf(row[col.distance]); if (dist != null && distCols < 2) dist *= 1000;
    const type = (row[col.type] || '').trim();
    const sid = String(row[col.id]).trim();
    acts.push(clean({
      id: 's' + sid, sid, name: (row[col.name] || '').trim().slice(0, 120), sport: sportOf(type), type, start, ls: lmsOf(start), le: lmsOf(start) + durS * 1000,
      durS: Math.round(durS), movS: col.moving >= 0 ? Math.round(numOf(row[col.moving]) || 0) || null : null, distM: dist ? Math.round(dist) : null,
      elevM: col.elev >= 0 ? Math.round(numOf(row[col.elev]) || 0) || null : null, avgHr: col.avghr >= 0 ? Math.round(numOf(row[col.avghr]) || 0) || null : null,
      maxHr: col.maxhr >= 0 ? Math.round(numOf(row[col.maxhr]) || 0) || null : null, kcal: col.kcal >= 0 ? Math.round(numOf(row[col.kcal]) || 0) || null : null,
      re: col.re >= 0 ? Math.round(numOf(row[col.re]) || 0) || null : null, via: 'csv'
    }));
  }
  return acts;
}
async function parseStravaFile(file) {
  if (await isZipFile(file)) {
    const entries = await zipEntries(file);
    const e = entries.find(x => /(^|\/)activities\.csv$/i.test(x.name)) || entries.find(x => /\.csv$/i.test(x.name) && /activ|aktiv/i.test(x.name));
    if (!e) throw new Error("This zip doesn't contain activities.csv. Use the archive from Strava's “Download your data”.");
    return parseStravaCsv(await zipEntryText(file, e));
  }
  return parseStravaCsv(await file.text());
}

// Connector (Strava list_activities) → internal activity
function normStravaApi(a) {
  const sm = a.summary || {};
  const start = String(a.start_local || '').slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start)) return null;
  const durS = Math.round(sm.elapsed_time || sm.moving_time || 0); if (!durS) return null;
  const type = a.sport_type || '';
  return clean({
    id: 's' + a.id, sid: String(a.id), name: String(a.name || '').slice(0, 120), sport: sportOf(type), type, start,
    ls: lmsOf(start), le: lmsOf(start) + durS * 1000, durS, movS: sm.moving_time ? Math.round(sm.moving_time) : null,
    distM: sm.distance ? Math.round(sm.distance) : null, elevM: sm.elevation_gain ? Math.round(sm.elevation_gain) : null,
    kcal: sm.total_calories ? Math.round(sm.total_calories) : null, re: sm.relative_effort != null ? Math.round(sm.relative_effort) : null, via: 'api'
  });
}
// Strava's own REST API (SummaryActivity / DetailedActivity, used by the standalone server) → internal activity
function normStravaRaw(a) {
  const start = String(a.start_date_local || '').slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start)) return null;
  const durS = Math.round(a.elapsed_time || a.moving_time || 0); if (!durS) return null;
  const type = a.sport_type || a.type || '';
  return clean({
    id: 's' + a.id, sid: String(a.id), name: String(a.name || '').slice(0, 120), sport: sportOf(type), type, start,
    ls: lmsOf(start), le: lmsOf(start) + durS * 1000, durS, movS: a.moving_time ? Math.round(a.moving_time) : null,
    distM: a.distance ? Math.round(a.distance) : null, elevM: a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null,
    kcal: a.calories ? Math.round(a.calories) : null, re: a.suffer_score != null ? Math.round(a.suffer_score) : null,
    avgHr: a.has_heartrate && a.average_heartrate ? Math.round(a.average_heartrate) : null, maxHr: a.has_heartrate && a.max_heartrate ? Math.round(a.max_heartrate) : null,
    hasHr: a.has_heartrate ? true : null, via: 'api'
  });
}
// Heart-rate stream (time[], heart_rate[]) → avg / max / time-in-HR histogram
function hrFromStream(time, hr) {
  if (!Array.isArray(time) || !Array.isArray(hr) || time.length !== hr.length || time.length < 3) return null;
  const hb = new Array(HB_BINS).fill(0); let sum = 0, dur = 0, mx = 0;
  for (let i = 0; i < time.length - 1; i++) {
    const v = hr[i]; if (!(v >= 30 && v <= 240)) continue;
    const dt = Math.min(Math.max(0, time[i + 1] - time[i]), 120);
    const k = Math.floor((v - HB_BASE) / 5); if (k >= 0) hb[k < HB_BINS ? k : HB_BINS - 1] += dt;
    sum += v * dt; dur += dt; if (v > mx) mx = v;
  }
  if (dur < 60) return null;
  return { avgHr: Math.round(sum / dur), maxHr: mx, hb: hb.map(Math.round) };
}
// HR max implied by Strava's default max-HR zones (Z4 tops out at 97 % of max)
function hrMaxFromStravaZones(z) {
  if (!z || z.heart_rate_zone_source !== 'MaxHeartRate' || !Array.isArray(z.heart_rate_zones) || z.heart_rate_zones.length < 4) return null;
  const top = z.heart_rate_zones[3] && z.heart_rate_zones[3].max;
  return top ? Math.round(top / 0.97) : null;
}

// ---------- within-activity analysis from streams: km splits, efforts (intervals), HR drift, best efforts ----------
// Input arrays are parallel samples: time (s), dist (m, cumulative), hr (bpm or null), vel (m/s or null), moving (bool or null).
// Output is small enough to live on the activity record: { km: [{t, hr, d?}], segs: [{s, t, d, p, hr, mx}], drift, half, v }.
function analyzeStreams(time, dist, hr, vel, moving) {
  if (!Array.isArray(time) || !Array.isArray(dist) || time.length !== dist.length || time.length < 10) return null;
  const n = time.length, hasHr = Array.isArray(hr) && hr.length === n, hasVel = Array.isArray(vel) && vel.length === n;
  const mv = i => !Array.isArray(moving) || moving.length !== n || moving[i] !== false;
  // speed per sample: velocity_smooth when present, else from the distance delta
  const spd = new Array(n).fill(0);
  for (let i = 1; i < n; i++) { const dt = time[i] - time[i - 1], dd = dist[i] - dist[i - 1]; spd[i] = hasVel && vel[i] != null ? vel[i] : dt > 0 ? dd / dt : 0; }
  // 1. km splits (moving time per km, average HR over the samples of that km)
  const km = [];
  let kStart = 0, kT = 0, hrS = 0, hrN = 0, nextKm = 1000;
  for (let i = 1; i < n; i++) {
    const dt = time[i] - time[i - 1];
    if (mv(i)) kT += dt;
    if (hasHr && hr[i] > 30) { hrS += hr[i]; hrN++; }
    if (dist[i] >= nextKm) {
      // interpolate the exact boundary inside this sample
      const over = dist[i] - nextKm, dd = dist[i] - dist[i - 1], f = dd > 0 ? over / dd : 0;
      const t = kT - (mv(i) ? dt * f : 0);
      km.push({ t: Math.round(t), hr: hrN ? Math.round(hrS / hrN) : null });
      kT = mv(i) ? dt * f : 0; hrS = 0; hrN = 0; nextKm += 1000; kStart = i;
      if (km.length >= 60) break;
    }
  }
  const lastD = dist[n - 1] - (nextKm - 1000);
  if (lastD >= 200 && km.length < 60) km.push({ t: Math.round(kT), hr: hrN ? Math.round(hrS / hrN) : null, d: Math.round(lastD) });
  // 2. efforts: stretches clearly faster than the run's typical pace (intervals, strides, hill reps)
  const movingSpd = []; for (let i = 1; i < n; i++) if (mv(i) && spd[i] > 0.5) movingSpd.push(spd[i]);
  movingSpd.sort((a, b) => a - b);
  const med = movingSpd.length ? movingSpd[Math.floor(movingSpd.length / 2)] : 0;
  const segs = [];
  if (med > 0.5) {
    const thr = Math.max(med * 1.12, med + 0.3);
    let s0 = -1, lastFast = -1, nFast = 0;
    const close = (i0, i1) => {
      if (i0 < 0 || i1 <= i0 || nFast < 2) return;
      const t = time[i1] - time[i0]; if (t < 15) return;
      const d = dist[i1] - dist[i0]; let hs = 0, hc = 0, mx = 0;
      for (let k = i0; k <= i1; k++) if (hasHr && hr[k] > 30) { hs += hr[k]; hc++; if (hr[k] > mx) mx = hr[k]; }
      segs.push({ s: Math.round(time[i0]), t: Math.round(t), d: Math.round(d), p: d > 20 ? Math.round(t / d * 1000) : null, hr: hc ? Math.round(hs / hc) : null, mx: mx || null });
    };
    for (let i = 1; i < n; i++) {
      const fast = spd[i] >= thr && mv(i);
      if (fast) { if (s0 < 0) { s0 = i - 1; nFast = 0; } lastFast = i; nFast++; }
      else if (s0 >= 0 && time[i] - time[lastFast] > 15) { close(s0, lastFast); s0 = -1; }
    }
    if (s0 >= 0) close(s0, lastFast);
  }
  // 3. aerobic decoupling: speed/HR of the second half vs the first (after a 5-minute warm-up), steady efforts only
  let drift = null, half = null;
  const tEnd = time[n - 1];
  if (hasHr && tEnd >= 1200 && segs.length <= 1) {
    const t0 = 300, mid = t0 + (tEnd - t0) / 2;
    let a = [0, 0, 0], b = [0, 0, 0]; // [sum speed, sum hr, count]
    for (let i = 1; i < n; i++) { if (time[i] < t0 || !mv(i) || !(hr[i] > 30) || spd[i] <= 0.5) continue; const acc = time[i] < mid ? a : b; acc[0] += spd[i]; acc[1] += hr[i]; acc[2]++; }
    if (a[2] > 20 && b[2] > 20) { const r1 = (a[0] / a[2]) / (a[1] / a[2]), r2 = (b[0] / b[2]) / (b[1] / b[2]); drift = Math.round((r1 - r2) / r1 * 1000) / 10; }
  }
  if (km.length >= 4) { const full = km.filter(k => k.d == null), h = Math.floor(full.length / 2); if (h >= 2) { const p1 = full.slice(0, h).reduce((x, y) => x + y.t, 0) / h, p2 = full.slice(h, 2 * h).reduce((x, y) => x + y.t, 0) / h; half = Math.round((p2 - p1) / p1 * 1000) / 10; } }
  return { v: 1, km, segs: segs.slice(0, 40), drift, half };
}
// best efforts from Strava (performance/detail) → { k1, k5, k10 } seconds
function bestEffortsOf(list) {
  const out = {};
  for (const b of list || []) { const k = { Fastest1k: 'k1', Fastest5k: 'k5', Fastest10k: 'k10', FastestHalfMarathon: 'half' }[b.type_value || b.name]; const v = b.value != null ? b.value : b.elapsed_time; if (k && v > 0) out[k] = Math.round(v); }
  return Object.keys(out).length ? out : null;
}
