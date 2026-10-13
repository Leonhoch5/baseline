// ---------- Apple Shortcuts sync files (iPhone → Google Drive → Baseline) ----------
// The Shortcut writes one text file per day, e.g. baseline-2026-10-12.txt:
//   #HR-T / #HR-V        heart-rate start dates / values (one per line)
//   #HRV-T / #HRV-V      heart-rate variability (SDNN, ms)
//   #RHR-T / #RHR-V      resting heart rate
//   #RESP-T / #RESP-V    respiratory rate
//   #SPO2-T / #SPO2-V    blood oxygen
//   #SLEEP-S / #SLEEP-E / #SLEEP-V   sleep segment start, end, stage
const SC_MONTHS = { jan: 0, feb: 1, mar: 2, 'mär': 2, mae: 2, apr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, dez: 11 };
function localParts(y, mo, d, h, mi, se) { const dt = new Date(y, mo, d, h, mi, se || 0); return { ms: dt.getTime(), off: -dt.getTimezoneOffset() }; }
function parseFlexDate(str) {
  const s = String(str || '').trim().replace(/ | /g, ' ');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    if (m[7]) {
      const off = m[7] === 'Z' ? 0 : (m[7][0] === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(-2));
      return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - off * 60000, off };
    }
    return localParts(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }
  const hm = (h, ap) => { h = +h; if (ap) { const pm = /p/i.test(ap); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; } return h; };
  const yr = y => (+y < 100 ? 2000 + +y : +y);
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4}),?\s+(?:um\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?/))) return localParts(yr(m[3]), +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  if ((m = s.match(/^(\d{1,2})\.?\s+([A-Za-zÄäÖöÜü]+)\.?\s+(\d{4}),?\s+(?:um\s+|at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]\.?M\.?)?/i))) {
    const mo = SC_MONTHS[m[2].toLowerCase().slice(0, 3)]; if (mo == null) return null;
    return localParts(+m[3], mo, +m[1], hm(m[4], m[7]), +m[5], +(m[6] || 0));
  }
  if ((m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]\.?M\.?)?/i))) {
    const mo = SC_MONTHS[m[1].toLowerCase().slice(0, 3)]; if (mo == null) return null;
    return localParts(+m[3], mo, +m[2], hm(m[4], m[7]), +m[5], +(m[6] || 0));
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]\.?M\.?)?/i))) return localParts(yr(m[3]), +m[1] - 1, +m[2], hm(m[4], m[7]), +m[5], +(m[6] || 0));
  return null;
}
function parseFlexNum(str) {
  let s = String(str || '').trim().replace(/ | /g, ' ');
  const m = s.match(/-?\d[\d.,]*/); if (!m) return null;
  s = m[0];
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
  const n = parseFloat(s); return isFinite(n) ? n : null;
}
function sleepCodeOf(v) {
  const t = String(v || '').toLowerCase();
  if (/in ?bed|im bett/.test(t)) return 9;
  if (/awake|wach/.test(t)) return 0;
  if (/\brem\b|rem-|rem$|^rem/.test(t)) return 1;
  if (/deep|tief/.test(t)) return 3;
  if (/core|kern|light|leicht/.test(t)) return 2;
  if (/asleep|sleep|schlaf|unspec/.test(t)) return 4;
  if (!/^\d$/.test(t.trim())) return null;
  return ({ 0: 9, 1: 4, 2: 0, 3: 2, 4: 3, 5: 1 })[+t.trim()] ?? null;
}
function parseShortcutText(text) {
  const sec = {}; let key = null;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const l = raw.trim(); if (!l) continue;
    const m = l.match(/^#\s*([A-Z0-9]+)\s*[-–]\s*([A-Z])\b/i);
    if (m) { key = m[1].toUpperCase() + '-' + m[2].toUpperCase(); sec[key] = sec[key] || []; continue; }
    if (key) sec[key].push(l);
  }
  // tolerate a mistyped value marker (e.g. #HR-R instead of #HR-V)
  for (const k of Object.keys(sec)) {
    const [base, suf] = k.split('-');
    if (suf === 'T' && !sec[base + '-V']) { const alt = Object.keys(sec).find(x => x.startsWith(base + '-') && !['T', 'V', 'S', 'E'].includes(x.split('-')[1])); if (alt) sec[base + '-V'] = sec[alt]; }
  }
  return sec;
}
// Text of one sync file → { res (AppleParser.finalize output), counts, warnings, firstDay }
function shortcutFileToDays(text) {
  const sec = parseShortcutText(text);
  const p = new AppleParser('');
  const counts = {}, warnings = [];
  let minMs = Infinity, firstOff = 0;
  const seen = (d) => { if (d.ms < minMs) { minMs = d.ms; firstOff = d.off; } };
  const pairs = (k, label) => {
    const T = sec[k + '-T'] || [], V = sec[k + '-V'] || [];
    if (!T.length && !V.length) { counts[k] = 0; return []; }
    if (T.length !== V.length) { warnings.push(`${label}: ${T.length} dates but ${V.length} values, skipped`); counts[k] = 0; return []; }
    const out = [];
    for (let i = 0; i < T.length; i++) { const d = parseFlexDate(T[i]), v = parseFlexNum(V[i]); if (d && v != null) { out.push({ ...d, v }); seen(d); } }
    if (out.length < T.length) warnings.push(`${label}: ${T.length - out.length} of ${T.length} lines unreadable`);
    counts[k] = out.length; return out;
  };
  for (const r of pairs('HR', 'Heart rate')) if (r.v >= 25 && r.v <= 250) p.addHr(r.ms, r.off, r.v);
  for (const r of pairs('HRV', 'HRV')) p.hrv.push({ t: r.ms, off: r.off, v: r.v });
  for (const r of pairs('RESP', 'Respiratory rate')) p.resp.push({ t: r.ms, off: r.off, v: r.v });
  for (const r of pairs('SPO2', 'Blood oxygen')) p.spo2.push({ t: r.ms, off: r.off, v: r.v <= 1.5 ? r.v * 100 : r.v });
  for (const r of pairs('TEMP', 'Wrist temperature')) p.temp.push({ t: r.ms, off: r.off, te: r.ms, v: r.v > 50 ? (r.v - 32) / 1.8 : r.v });
  for (const r of pairs('RHR', 'Resting heart rate')) p.rhr[dateOfLms(r.ms + r.off * 60000)] = r.v;
  const S = sec['SLEEP-S'] || [], E = sec['SLEEP-E'] || [], V = sec['SLEEP-V'] || [];
  if (S.length !== E.length || S.length !== V.length) { if (S.length || E.length || V.length) warnings.push(`Sleep: ${S.length} starts, ${E.length} ends, ${V.length} stages, skipped`); counts.SLEEP = 0; }
  else {
    let n = 0;
    for (let i = 0; i < S.length; i++) {
      const a = parseFlexDate(S[i]), b = parseFlexDate(E[i]), c = sleepCodeOf(V[i]);
      if (!a || !b || c == null || b.ms <= a.ms) continue;
      p.sleep.push({ src: 'Apple Watch', s: a.ms, e: b.ms, c, off: a.off }); seen(a); n++;
    }
    counts.SLEEP = n;
    if (n < S.length) warnings.push(`Sleep: ${S.length - n} of ${S.length} segments unreadable`);
  }
  const res = p.finalize();
  const firstDay = isFinite(minMs) ? dateOfLms(minMs + firstOff * 60000) : null;
  return { res, counts, warnings, firstDay };
}
// Merge the days of several sync files (oldest first) into apple/{month} documents.
// The first calendar day of each file is only partly covered, so it is skipped unless nothing else exists for it.
function mergeShortcutDays(files, existingApple) {
  const touched = {};
  for (const f of files) {
    for (const m in f.res.months) for (const day in f.res.months[m].days) {
      const nd = f.res.months[m].days[day];
      const cur = (touched[m] && touched[m][day]) || (existingApple[m] && existingApple[m].days && existingApple[m].days[day]) || null;
      if (day === f.firstDay && cur) continue;
      (touched[m] || (touched[m] = {}))[day] = { ...(cur || {}), ...nd, src: 'shortcut' };
    }
  }
  const docs = {};
  for (const m in touched) {
    const base = existingApple[m] || { v: 1, month: m, days: {}, workouts: [] };
    docs[m] = { ...base, days: { ...(base.days || {}), ...touched[m] } };
  }
  return docs;
}
