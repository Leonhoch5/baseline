// ---------- performance tests: swim, bike, run ----------
// Every test type says which inputs it needs and what threshold it gives. Results are stored in settings/tests
// as { id, date, type, values, sessionId? } and linked to the planned test session they belong to.

const TEST_TYPES = {
  swim_css: { sport: 'swim', label: 'CSS test (400 m + 200 m)', short: 'CSS test',
    fields: [{ k: 't400', label: '400 m time', kind: 'time', ph: '6:35.2' }, { k: 't200', label: '200 m time', kind: 'time', ph: '3:14.0' }],
    check: v => !(v.t400 > 200 && v.t400 < 1200 && v.t200 > 90 && v.t200 < 600) ? 'Enter both times as m:ss, e.g. 6:35.2 and 3:14.0.' : v.t400 <= v.t200 * 1.6 ? 'The 400 m time looks too fast for that 200 m time. Check both.' : null,
    derive: v => ({ css: (v.t400 - v.t200) / 2 }),
    show: v => `400 m ${fmtMSS(v.t400, 1)} · 200 m ${fmtMSS(v.t200, 1)}` },
  swim_tt: { sport: 'swim', label: 'Swim time trial (continuous)', short: 'Time trial',
    fields: [{ k: 'dist', label: 'Distance (m)', kind: 'num', def: 1600 }, { k: 'sec', label: 'Time', kind: 'time', ph: '26:40' }],
    check: v => !(v.dist >= 100 && v.dist <= 10000) ? 'Enter the distance in metres.' : !(v.sec > v.dist * 0.6 && v.sec < v.dist * 3) ? 'Enter the time as mm:ss, e.g. 26:40.' : null,
    derive: v => ({ swimPace: v.sec / v.dist * 100 }),
    show: v => `${v.dist} m in ${fmtMSS(v.sec, 1)}` },
  swim_broken: { sport: 'swim', label: 'Broken swim test (short rests)', short: 'Broken test',
    fields: [{ k: 'dist', label: 'Distance (m)', kind: 'num', def: 1600 }, { k: 'sec', label: 'Swim time, without the rests', kind: 'time', ph: '25:40' }],
    check: v => !(v.dist >= 100 && v.dist <= 10000) ? 'Enter the distance in metres.' : !(v.sec > v.dist * 0.6 && v.sec < v.dist * 3) ? 'Enter the time as mm:ss, e.g. 25:40.' : null,
    derive: v => ({ swimPace: v.sec / v.dist * 100 }),
    show: v => `${v.dist} m broken in ${fmtMSS(v.sec, 1)}` },
  bike_ftp20: { sport: 'ride', label: 'FTP test (20 min, power meter)', short: 'FTP test',
    fields: [{ k: 'p20', label: 'Average power, 20 min (W)', kind: 'num', ph: '250' }, { k: 'hr', label: 'Average heart rate (optional)', kind: 'num', opt: true }],
    check: v => !(v.p20 > 50 && v.p20 < 700) ? 'Enter the 20-minute average power in watts.' : null,
    derive: v => ({ ftp: Math.round(v.p20 * 0.95) }),
    show: v => `20 min at ${Math.round(v.p20)} W${v.hr ? ` · ${Math.round(v.hr)} bpm` : ''}` },
  bike_ramp: { sport: 'ride', label: 'Ramp test (power meter)', short: 'Ramp test',
    fields: [{ k: 'map', label: 'Best 1-minute power (W)', kind: 'num', ph: '330' }],
    check: v => !(v.map > 80 && v.map < 900) ? 'Enter the best 1-minute power in watts.' : null,
    derive: v => ({ ftp: Math.round(v.map * 0.75) }),
    show: v => `best minute ${Math.round(v.map)} W` },
  bike_hr30: { sport: 'ride', label: 'Bike 30-min time trial (heart rate)', short: '30-min TT',
    fields: [{ k: 'hr20', label: 'Average HR, last 20 min (bpm)', kind: 'num', ph: '165' }, { k: 'km', label: 'Distance (km, optional)', kind: 'num', opt: true }],
    check: v => !(v.hr20 > 100 && v.hr20 < 220) ? 'Enter the average heart rate of the last 20 minutes.' : null,
    derive: v => ({ bikeLthr: Math.round(v.hr20) }),
    show: v => `last 20 min ${Math.round(v.hr20)} bpm${v.km ? ` · ${v.km} km` : ''}` },
  run_30tt: { sport: 'run', label: 'Run 30-min time trial', short: '30-min TT',
    fields: [{ k: 'km', label: 'Distance in 30 min (km)', kind: 'num', ph: '7.2' }, { k: 'hr20', label: 'Average HR, last 20 min (optional)', kind: 'num', opt: true }],
    check: v => !(v.km > 3 && v.km < 12) ? 'Enter the distance covered in 30 minutes, in km.' : null,
    derive: v => ({ runPace: 1800 / v.km, ...(v.hr20 ? { runLthr: Math.round(v.hr20) } : {}) }),
    show: v => `${v.km} km${v.hr20 ? ` · last 20 min ${Math.round(v.hr20)} bpm` : ''}` },
  run_5k: { sport: 'run', label: 'Run 5 km time trial', short: '5 km TT',
    fields: [{ k: 'sec', label: 'Time', kind: 'time', ph: '22:30' }],
    check: v => !(v.sec > 780 && v.sec < 3000) ? 'Enter the 5 km time as mm:ss.' : null,
    derive: v => ({ runPace: v.sec / 5 * 1.04 }),
    show: v => `5 km in ${fmtMSS(v.sec)}` },
  other: { sport: 'other', label: 'Other test', short: 'Test',
    fields: [{ k: 'name', label: 'What', kind: 'text', ph: 'e.g. 100 m all-out' }, { k: 'result', label: 'Result', kind: 'text', ph: 'e.g. 1:18' }],
    check: v => !v.name || !v.result ? 'Describe the test and its result.' : null,
    derive: () => ({}),
    show: v => `${v.name}: ${v.result}` },
};
const TEST_SPORTS = [['swim', 'Swim'], ['ride', 'Bike'], ['run', 'Run'], ['other', 'Other']];
// what each threshold means and how it's shown; better = direction of improvement
const THRESHOLDS = {
  css: { sport: 'swim', label: 'Critical swim speed', fmt: v => fmtMSS(v, 1) + '/100 m', val: v => fmtMSS(v, 1), tunit: '/100 m', delta: d => Math.abs(d).toFixed(1) + ' s', better: -1 },
  ftp: { sport: 'ride', label: 'FTP', fmt: v => Math.round(v) + ' W', val: v => Math.round(v), tunit: 'W', delta: d => Math.abs(Math.round(d)) + ' W', better: 1 },
  bikeLthr: { sport: 'ride', label: 'Bike threshold HR', fmt: v => Math.round(v) + ' bpm', val: v => Math.round(v), tunit: 'bpm', delta: d => Math.abs(Math.round(d)) + ' bpm', better: 0 },
  runPace: { sport: 'run', label: 'Run threshold pace', fmt: v => fmtMSS(v) + '/km', val: v => fmtMSS(v), tunit: '/km', delta: d => Math.abs(Math.round(d)) + ' s', better: -1 },
  runLthr: { sport: 'run', label: 'Run threshold HR', fmt: v => Math.round(v) + ' bpm', val: v => Math.round(v), tunit: 'bpm', delta: d => Math.abs(Math.round(d)) + ' bpm', better: 0 },
};

function normalizeTest(t) {
  if (!t) return null;
  if (t.type && TEST_TYPES[t.type]) return { ...t, values: t.values || {} };
  if (t.kind === 'css') return { id: t.id, date: t.date, type: 'swim_css', values: { t400: t.t400, t200: t.t200 }, sessionId: t.sessionId };
  if (t.kind === 'tt') return { id: t.id, date: t.date, type: 'swim_tt', values: { dist: t.dist, sec: t.sec }, sessionId: t.sessionId };
  return null;
}

// which test a planned session is, from its sport and wording
function sessionTestType(s) {
  if (!s || s.isRest) return null;
  const txt = (s.title || '') + ' ' + (s.details || '');
  const isTest = s.intensity === 'test' || /\b(re)?test\b|\bTT\b|time[ -]?trial|\bFTP\b|ramp test/i.test(s.title || '');
  if (!isTest) return null;
  if (s.sportKey === 'swim') return /\bcss\b/i.test(txt) || /400.{0,40}200/i.test(txt) ? 'swim_css' : /broken/i.test(txt) ? 'swim_broken' : 'swim_tt';
  if (s.sportKey === 'ride') return /ramp/i.test(txt) ? 'bike_ramp' : /ftp|20[ -]?min/i.test(txt) ? 'bike_ftp20' : 'bike_hr30';
  if (s.sportKey === 'run') return /\b5 ?k(m)?\b/i.test(txt) ? 'run_5k' : 'run_30tt';
  return 'other';
}
function sessionTestDefaults(s, type) {
  const m = ((s.title || '') + ' ' + (s.details || '')).match(/(\d{3,4})\s*m\b/);
  return (type === 'swim_tt' || type === 'swim_broken') && m ? { dist: +m[1] } : {};
}

// all results: yours, the plan's starting test, and Strava activities named as tests
function allTests(M, D, race) {
  const out = [];
  const css = race && race.meta && race.meta.css;
  if (css && css.t400 && css.t200) out.push({ id: 'plan-css', date: css.date, type: 'swim_css', values: { t400: parseClock(css.t400), t200: parseClock(css.t200) }, src: 'plan' });
  for (const t of ((D && D.tests && D.tests.list) || [])) { const n = normalizeTest(t); if (n) out.push({ ...n, src: 'you' }); }
  const have = new Set(out.map(t => t.date + TEST_TYPES[t.type].sport));
  const sw = {};
  for (const a of M.acts || []) {
    if (!/\b(test|tt|time ?trial|css)\b/i.test(a.name || '') || !a.distM) continue;
    const t = a.movS || a.durS;
    if (a.sport === 'swim') for (const dist of [200, 400, 1500, 1600]) if (Math.abs(a.distM - dist) <= dist * 0.02) (sw[a.date] = sw[a.date] || {})[dist] = t;
    if (a.sport === 'run' && Math.abs(a.distM - 5000) <= 100 && !have.has(a.date + 'run')) out.push({ id: 'strava-' + a.gid, date: a.date, type: 'run_5k', values: { sec: t }, src: 'strava' });
  }
  for (const date in sw) {
    if (have.has(date + 'swim')) continue;
    const r = sw[date];
    if (r[400] && r[200] && r[400] > r[200]) out.push({ id: 'strava-css-' + date, date, type: 'swim_css', values: { t400: r[400], t200: r[200] }, src: 'strava' });
    for (const dist of [1500, 1600]) if (r[dist]) out.push({ id: 'strava-tt-' + date + dist, date, type: 'swim_tt', values: { dist, sec: r[dist] }, src: 'strava' });
  }
  for (const t of out) { try { t.derived = TEST_TYPES[t.type].derive(t.values) || {}; } catch (e) { t.derived = {}; } }
  return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

function currentThresholds(tests) {
  const res = {};
  for (const k in THRESHOLDS) {
    const hist = tests.filter(t => t.derived[k] != null).map(t => ({ date: t.date, v: t.derived[k], test: t }));
    if (!hist.length) continue;
    const last = hist[hist.length - 1], prev = hist[hist.length - 2] || null;
    res[k] = { ...THRESHOLDS[k], key: k, v: last.v, date: last.date, prev, hist };
  }
  return res;
}

// planned test sessions that are due (last 3 weeks, not logged) or coming up (next 3 weeks)
function testSchedule(M, tests) {
  const today = M.today, due = [], next = [], bySession = {};
  for (const t of tests) if (t.sessionId) bySession[t.sessionId] = t;
  for (const s of M.plan.sessions) {
    const type = sessionTestType(s); if (!type) continue;
    const sport = TEST_TYPES[type].sport;
    const res = bySession[s.id] || tests.find(t => t.date === s.date && TEST_TYPES[t.type].sport === sport && !t.sessionId) || null;
    s.testType = type; s.testResult = res;
    if (res || s.status === 'sick') continue;
    const k = daysBetween(s.date, today);
    if (k >= 0 && k <= 21) due.push({ s, type });
    else if (k < 0 && k >= -21) next.push({ s, type });
  }
  return { due, next };
}

// after a new CSS test, the plan's swim paces are rescaled to it (goal-pace targets stay as they are)
function applyPaceUpdate(M, tests, race) {
  const base = tests.find(t => t.src === 'plan' && t.derived.css);
  const lastCss = tests.filter(t => t.derived.css).pop();
  if (!base || !lastCss || lastCss === base || lastCss.date <= base.date) return null;
  const r = lastCss.derived.css / base.derived.css;
  if (!(r > 0.8 && r < 1.2) || Math.abs(r - 1) < 0.003) return null;
  const goal = race && race.meta && race.meta.goal ? (race.meta.goal.match(/\d:\d{2}(?:\.\d+)?(?=\s*\/\s*100)/) || [])[0] : null;
  let n = 0;
  for (const s of M.plan.sessions) {
    if (s.sportKey !== 'swim' || !s.target || s.date <= lastCss.date || (race.planId && s.planId !== race.planId)) continue;
    if (goal && s.target.includes(goal)) continue;
    const adj = scalePaceText(s.target, r);
    if (adj !== s.target) { s.targetBase = s.target; s.target = adj; n++; }
  }
  // week descriptions after the test mention paces too (goal pace itself is kept)
  for (const w of M.plan.weeks) {
    const st = w.start || (w.sessions[0] || {}).date;
    if (!w.focus || !st || st <= lastCss.date || (race.planId && w.planId !== race.planId)) continue;
    const adj = scalePaceText(w.focus, r, 60, 600, goal);
    if (adj !== w.focus) { w.focusBase = w.focus; w.focus = adj; }
  }
  return { ratio: r, from: base.derived.css, to: lastCss.derived.css, date: lastCss.date, sessions: n, goal, planId: race.planId };
}

// multiply every m:ss(.d) time in a text by r (only times between lo and hi seconds)
function scalePaceText(str, r, lo = 60, hi = 600, keep) {
  return String(str).replace(/(\d{1,2}):(\d{2})(?:\.(\d+))?/g, (m0, mm, ss, dd) => {
    if (keep && m0 === keep) return m0;
    const sec = +mm * 60 + +ss + (dd ? +('0.' + dd) : 0);
    return sec < lo || sec > hi ? m0 : fmtMSS(sec * r, dd ? 1 : 0);
  });
}
