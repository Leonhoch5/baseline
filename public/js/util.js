// ---------- util ----------
const DAY_MS = 86400000;
const HB_BASE = 70;      // histogram: 5-bpm bins starting at 70 bpm
const HB_BINS = 28;      // 70..209
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function parseYmd(s) { const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / DAY_MS); }
function todayYmd() { return ymd(new Date()); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function round1(x) { return Math.round(x * 10) / 10; }
function mean(a) { if (!a.length) return null; let s = 0; for (const v of a) s += v; return s / a.length; }
function stdev(a) { if (a.length < 2) return null; const m = mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m); return Math.sqrt(s / (a.length - 1)); }
function median(a) { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function decodeXml(s) { return s.indexOf('&') < 0 ? s : s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => { const l = e.toLowerCase(); if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'quot') return '"'; if (l === 'apos') return "'"; if (l[1] === 'x') return String.fromCodePoint(parseInt(l.slice(2), 16)); return String.fromCodePoint(parseInt(l.slice(1), 10)); }); }

// "Local wall-clock ms": a local date-time string read as if it were UTC.
// Every activity source is compared on this axis, so Strava (which only reports
// local start times) and Apple Health (which reports times with offsets) line up.
function lmsOf(localIso) { // 'YYYY-MM-DDTHH:MM[:SS]'
  return Date.UTC(+localIso.slice(0, 4), +localIso.slice(5, 7) - 1, +localIso.slice(8, 10), +localIso.slice(11, 13) || 0, +localIso.slice(14, 16) || 0, +localIso.slice(17, 19) || 0);
}
function isoOfLms(lms) { return new Date(lms).toISOString().slice(0, 19); }
function dateOfLms(lms) { return new Date(lms).toISOString().slice(0, 10); }
function minOfDayLms(lms) { const d = new Date(lms); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; }

function fmtHM(min) { if (min == null || isNaN(min)) return '–'; const m = Math.round(min); return Math.floor(m / 60) + ':' + pad2(m % 60); }
function fmtDurLong(min) { if (min == null) return '–'; const m = Math.round(min); const h = Math.floor(m / 60); return h ? h + 'h ' + pad2(m % 60) + 'm' : m + ' min'; }
function fmtClock(lmsOrMin, isMin) { const m = isMin ? lmsOrMin : minOfDayLms(lmsOrMin); const mm = Math.round(m) % 1440; return pad2(Math.floor(mm / 60)) + ':' + pad2(mm % 60); }
function fmtKm(m) { if (!m) return null; return (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km'; }
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(s, withWd = true) { const d = parseYmd(s); return (withWd ? WD[d.getDay()] + ', ' : '') + d.getDate() + ' ' + MO[d.getMonth()]; }
function fmtDayShort(s) { const d = parseYmd(s); return d.getDate() + ' ' + MO[d.getMonth()]; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Sport families shared by Apple Health, Strava and the training plan.
function sportOf(raw) {
  const t = String(raw || '').toLowerCase().replace(/^hkworkoutactivitytype/, '');
  if (/hike|hiking|wander/.test(t)) return 'hike';
  if (/run|lauf|jog/.test(t)) return 'run';
  if (/ride|cycl|bike|radfahrt|^rad|velomobile|handcycle|spinning/.test(t)) return 'ride';
  if (/swim|schwimm/.test(t)) return 'swim';
  if (/walk|spazier|gehen/.test(t)) return 'walk';
  if (/strength|weight|kraft|crossfit|functional|core/.test(t)) return 'strength';
  if (/hiit|highintensity|interval/.test(t)) return 'hiit';
  if (/yoga|pilates|mind|flexib|stretch|cooldown|mobility|mobil/.test(t)) return 'mobility';
  if (/row|rudern/.test(t)) return 'row';
  if (/ski|snow/.test(t)) return 'snow';
  if (/elliptical|stair|crosstrainer|stepper|cardio|aerobic/.test(t)) return 'cardio';
  if (/soccer|football|fu(ß|ss)ball|tennis|basket|squash|padel|badminton|volley|hockey|handball|golf|climb|kletter|boulder/.test(t)) return 'sport';
  if (/rest|ruhe/.test(t)) return 'rest';
  return 'other';
}
const SPORT_LABEL = { run: 'Run', ride: 'Ride', swim: 'Swim', walk: 'Walk', hike: 'Hike', strength: 'Strength', hiit: 'HIIT', mobility: 'Mobility', row: 'Row', snow: 'Snow sports', cardio: 'Cardio', sport: 'Sport', other: 'Workout', rest: 'Rest' };
const FOOT = new Set(['run', 'walk', 'hike']);
const GYM = new Set(['strength', 'hiit', 'cardio', 'mobility', 'other']);
function sportsCompatible(a, b) {
  if (a === b || a === 'other' || b === 'other') return true;
  if (FOOT.has(a) && FOOT.has(b)) return true;
  if (GYM.has(a) && GYM.has(b)) return true;
  return false;
}

// Strain: cardiovascular load → 0–21 scale (saturating, like Borg-style effort scales).
const STRAIN_K = 260;
function hrWeight(hr, hrMax) { const p = hr / hrMax; return p <= 0.45 ? 0 : (p - 0.45) * 10; }
function loadFromHist(hb, hrMax) { if (!hb) return 0; let L = 0; for (let k = 0; k < hb.length; k++) if (hb[k]) L += hb[k] / 60 * hrWeight(HB_BASE + 5 * k + 2.5, hrMax); return L; }
function strainOf(load) { return 21 * (1 - Math.exp(-Math.max(0, load) / STRAIN_K)); }
// HR zones as % of max: Z1 50–60, Z2 60–70, Z3 70–80, Z4 80–90, Z5 90+
// Zone boundaries: Strava's heart-rate zones when known (upper bounds of Z1–Z4), else 50/60/70/80/90 % of max.
// Time below 50 % of max (sitting, sleeping) is never counted as zone 1.
function zonesFromHist(hb, hrMax, bounds) {
  const z = [0, 0, 0, 0, 0]; if (!hb) return z;
  const b = bounds && bounds.length >= 4 ? bounds : null;
  for (let k = 0; k < hb.length; k++) {
    if (!hb[k]) continue;
    const hr = HB_BASE + 5 * k + 2.5; if (hr < hrMax * 0.5) continue;
    const zi = b ? (hr <= b[0] ? 0 : hr <= b[1] ? 1 : hr <= b[2] ? 2 : hr <= b[3] ? 3 : 4) : Math.min(4, Math.floor((hr / hrMax - 0.5) * 10));
    z[zi] += hb[k] / 60;
  }
  return z;
}
function zoneLabels(hrMax, bounds) {
  const lo = Math.round(hrMax * 0.5);
  if (bounds && bounds.length >= 4) return [`${lo}–${bounds[0]}`, `${bounds[0] + 1}–${bounds[1]}`, `${bounds[1] + 1}–${bounds[2]}`, `${bounds[2] + 1}–${bounds[3]}`, `${bounds[3] + 1}+`];
  const f = p => Math.round(hrMax * p);
  return [`${lo}–${f(0.6)}`, `${f(0.6) + 1}–${f(0.7)}`, `${f(0.7) + 1}–${f(0.8)}`, `${f(0.8) + 1}–${f(0.9)}`, `${f(0.9) + 1}+`];
}
