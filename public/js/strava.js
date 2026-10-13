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
