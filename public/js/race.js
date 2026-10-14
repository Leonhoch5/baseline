// ---------- race goal: countdown, planned vs actual fitness, taper, swim pace ----------
// Fitness here is the 42-day load average (CTL) and fatigue the 7-day one (ATL), same as the Load tab.
// Planned sessions are turned into an expected load, calibrated on how your logged workouts compared with what the plan prescribed.

const INT_FACTOR = { rest: 0, recovery: 0.6, easy: 0.7, moderate: 1, hard: 1.3, key: 1.3, test: 1.25, race: 1.4 };
const GOAL_SWIM = { dist: 1600, sec: 25 * 60 };          // fallback when the plan doesn't state a swim goal

function parseClock(t) { // "25:00", "1:41.77", "6:39.46", "1:02:03" → seconds
  if (t == null) return null; if (typeof t === 'number') return t;
  const p = String(t).trim().replace(',', '.').split(':').map(Number); if (p.some(isNaN) || !p.length) return null;
  return p.reduce((a, b) => a * 60 + b, 0);
}
function fmtMSS(sec, dec) {
  if (sec == null || !isFinite(sec)) return '–';
  const neg = sec < 0; sec = Math.abs(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = dec ? s.toFixed(dec).padStart(3 + dec, '0') : String(Math.round(s)).padStart(2, '0');
  return (neg ? '−' : '') + (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + (ss === '60' ? '59' : ss);
}

// the race: the nearest plan with a future race date, or one set in Settings
function findRace(M, D) {
  const today = M.today, plans = (M.plan && M.plan.plans) || [];
  const cand = plans.map(p => ({ name: p.meta.raceName || p.meta.name || 'Race', date: p.meta.raceDate, goal: p.meta.goal || '', planId: p.id, meta: p.meta }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '')).sort((a, b) => a.date < b.date ? -1 : 1);
  const prof = (D && D.profile) || {};
  if (prof.race && /^\d{4}-\d{2}-\d{2}$/.test(prof.race.date || '')) cand.push({ name: prof.race.name || 'Race', date: prof.race.date, goal: prof.race.goal || '', planId: null, meta: {}, manual: true });
  return cand.find(r => r.date >= today) || cand[cand.length - 1] || null;
}

// expected load of a planned session, calibrated on matched sessions (actual load ÷ naive estimate)
function plannedLoadModel(M) {
  const ratios = {};
  const naive = s => (s.durationMin || 0) * (LOAD_PER_MIN[s.sportKey] ?? 1.5) * (INT_FACTOR[s.intensity] ?? 1);
  for (const s of M.plan.sessions) if (s.match && s.match.load > 0 && naive(s) > 0) (ratios[s.sportKey] = ratios[s.sportKey] || []).push(s.match.load / naive(s));
  const all = Object.values(ratios).flat();
  const g = all.length >= 5 ? clamp(median(all), 0.4, 2.5) : 1;
  const k = {}; for (const sp in ratios) k[sp] = ratios[sp].length >= 4 ? clamp(median(ratios[sp]), 0.4, 2.5) : g;
  return { est: s => s.isRest || s.intensity === 'rest' ? 0 : naive(s) * (k[s.sportKey] ?? g), k, g, n: all.length };
}

function raceModel(M, D) {
  if (!M || M.empty) return null;
  const race = findRace(M, D); if (!race) return { race: null };
  const today = M.today, days = daysBetween(today, race.date);
  const pl = plannedLoadModel(M);
  // background (non-workout) load per day: everyday movement counted in the daily load
  const bg = []; for (let k = 1; k <= 28; k++) { const d = M.day[addDays(today, -k)]; if (d && d.load != null) bg.push(Math.max(0, d.load - d.acts.reduce((a, x) => a + (x.load || 0), 0))); }
  const bgLoad = bg.length >= 7 ? median(bg) : 0;
  const plannedByDay = {};
  for (const s of M.plan.sessions) if (!race.planId || s.planId === race.planId) plannedByDay[s.date] = (plannedByDay[s.date] || 0) + pl.est(s);
  const kC = 1 - Math.exp(-1 / 42), kA = 1 - Math.exp(-1 / 7);
  // planned curve from the plan's start (seeded with the actual fitness on that day); projection from today
  const planStart = (M.plan.plans.find(p => p.id === race.planId) || {}).start || today;
  const seed = M.day[addDays(planStart, -1)] || M.day[planStart] || {};
  const series = [];
  let pc = seed.ctl || 0, pa = seed.atl || 0, xc = null, xa = null;
  const end = race.date > today ? race.date : today;
  for (let dt = planStart; dt <= end; dt = addDays(dt, 1)) {
    const L = bgLoad + (plannedByDay[dt] || 0);
    pc += (L - pc) * kC; pa += (L - pa) * kA;
    const d = M.day[dt], row = { date: dt, plan: pc, planAtl: pa, actual: d && dt <= today ? d.ctl : null, actualTsb: d && dt <= today ? d.tsb : null };
    if (dt === today && d) { xc = d.ctl; xa = d.atl; }
    else if (dt > today && xc != null) { xc += (L - xc) * kC; xa += (L - xa) * kA; row.proj = xc; row.projTsb = xc - xa; }
    if (dt === today && d) { row.proj = d.ctl; row.projTsb = d.tsb; }
    series.push(row);
  }
  const at = dt => series.find(r => r.date === dt) || null;
  const nowRow = at(today), raceRow = at(race.date);
  const vsPlan = nowRow && nowRow.actual != null && nowRow.plan > 1 ? nowRow.actual / nowRow.plan - 1 : null;
  // taper: planned load in the last 14 days before the race vs the 4 weeks before that
  const sumP = (a, b) => { let s = 0; for (let dt = a; dt <= b; dt = addDays(dt, 1)) s += plannedByDay[dt] || 0; return s; };
  // taper: planned weekly load in the last 14 days vs the heaviest 4-week block in the 10 weeks before it
  const taper14 = sumP(addDays(race.date, -14), addDays(race.date, -1)) / 2;
  let prior4 = 0, peakStart = null;
  for (let k = 15; k <= 70; k += 7) { const a = addDays(race.date, -k - 27), w = sumP(a, addDays(race.date, -k)) / 4; if (w > prior4) { prior4 = w; peakStart = a; } }
  const taperCut = prior4 > 0 ? 1 - taper14 / prior4 : null;
  // phases
  const weeks = M.plan.weeks.filter(w => !race.planId || w.planId === race.planId);
  const phases = []; for (const w of weeks) { const st = w.start || (w.sessions[0] || {}).date; const last = phases[phases.length - 1]; if (last && last.name === w.phase) { last.end = addDays(st, 6); last.weeks++; } else phases.push({ name: w.phase || 'Phase', start: st, end: addDays(st, 6), weeks: 1 }); }
  const curPhase = phases.find(p => p.start <= today && today <= p.end) || null;
  const weekNo = weeks.findIndex(w => { const st = w.start || (w.sessions[0] || {}).date; return st <= today && today <= addDays(st, 6); });
  return { race, days, peakStart, weeks: Math.floor(days / 7), weekNo: weekNo >= 0 ? weekNo + 1 : null, weekTotal: weeks.length, phases, curPhase, series, nowRow, raceRow, vsPlan, taper14, prior4, taperCut,
    raceForm: raceRow && raceRow.proj != null ? { tsb: raceRow.projTsb, ctl: raceRow.proj, rel: raceRow.proj > 0 ? raceRow.projTsb / raceRow.proj : null } : null,
    planRaceCtl: raceRow ? raceRow.plan : null, pl, bgLoad, swim: swimModel(M, D, race) };
}

// ---- swim: critical swim speed from tests, predicted goal time, training pace trend ----
function swimGoal(race) {
  const g = (race && (race.goal || '')) || '';
  const m = g.match(/(\d{3,4})\s*m\b[^.]*?(?:under|sub|<)\s*(\d{1,2}:\d{2})/i);
  return m ? { dist: +m[1], sec: parseClock(m[2]) } : (race && /swim/i.test(g + (race.meta.name || '')) ? GOAL_SWIM : null);
}
function swimTests(M, D, race) {
  const out = [];
  const css = race && race.meta && race.meta.css;
  if (css && css.t400 && css.t200) out.push({ date: css.date, kind: 'css', t400: parseClock(css.t400), t200: parseClock(css.t200), src: 'plan' });
  for (const t of ((D && D.tests && D.tests.list) || [])) out.push({ ...t, src: 'you' });
  // Strava swims named as a test / time trial with a matching distance
  for (const a of M.acts) {
    if (a.sport !== 'swim' || !a.distM || !/\b(test|tt|time ?trial|css)\b/i.test(a.name || '')) continue;
    const t = a.movS || a.durS;
    for (const dist of [200, 400, 1500, 1600]) if (Math.abs(a.distM - dist) <= dist * 0.02) out.push({ date: a.date, kind: 'tt', dist, sec: t, src: 'strava', name: a.name });
  }
  out.sort((a, b) => a.date < b.date ? -1 : 1);
  // pair loose 400 + 200 time trials within 7 days into a CSS result
  const res = [];
  for (const t of out) {
    if (t.kind === 'css') res.push({ ...t, cssPace: (t.t400 - t.t200) / 2 });
    else if (t.kind === 'tt' && (t.dist === 400 || t.dist === 200)) {
      const other = out.find(o => o !== t && o.kind === 'tt' && o.dist === (t.dist === 400 ? 200 : 400) && Math.abs(daysBetween(o.date, t.date)) <= 7);
      if (other && t.dist === 400) { const t200 = other.sec, t400 = t.sec; if (t400 > t200) res.push({ date: t.date > other.date ? t.date : other.date, kind: 'css', t400, t200, cssPace: (t400 - t200) / 2, src: t.src }); }
    } else if (t.kind === 'tt') res.push({ ...t, pace: t.sec / t.dist * 100 });
  }
  return res;
}
function swimModel(M, D, race) {
  const goal = swimGoal(race); if (!goal) return null;
  const goalPace = goal.sec / goal.dist * 100;
  const tests = swimTests(M, D, race);
  const cssTests = tests.filter(t => t.cssPace);
  const last = cssTests[cssTests.length - 1] || null;
  // CSS is roughly the pace you can hold for ~30 min, so it approximates 1500–1600 m race pace in the pool
  const pred = last ? last.cssPace * goal.dist / 100 : null;
  const gap = last ? last.cssPace - goalPace : null;
  let rate = null; // s/100 m per 30 days, from the first to the last CSS test
  if (cssTests.length >= 2) { const a = cssTests[0], b = last; const dd = daysBetween(a.date, b.date); if (dd >= 14) rate = (b.cssPace - a.cssPace) / dd * 30; }
  const daysLeft = race ? daysBetween(M.today, race.date) : null;
  const needRate = gap != null && daysLeft > 0 ? -gap / daysLeft * 30 : null;
  const projected = last && rate != null && race ? last.cssPace + rate * daysBetween(last.date, race.date) / 30 : null;
  // training pace per pool swim (moving time, includes easy work, so slower than CSS)
  const swims = M.acts.filter(a => a.sport === 'swim' && a.distM >= 400 && (a.movS || a.durS)).map(a => ({ date: a.date, name: a.name, dist: a.distM, pace: (a.movS || a.durS) / a.distM * 100, hr: a.avgHr }))
    .filter(s => s.pace >= 70 && s.pace <= 240).sort((a, b) => a.date < b.date ? -1 : 1);
  const recent = swims.filter(s => daysBetween(s.date, M.today) <= 28), before = swims.filter(s => { const k = daysBetween(s.date, M.today); return k > 28 && k <= 56; });
  const best = arr => arr.length ? Math.min(...arr.map(s => s.pace)) : null;
  const vol = arr => arr.reduce((a, s) => a + s.dist, 0);
  return { goal, goalPace, tests, cssTests, last, pred, gap, rate, needRate, projected, swims, recentBest: best(recent), beforeBest: best(before), recentVol: vol(recent), beforeVol: vol(before), recentN: recent.length,
    nextTest: race && race.meta && race.meta.paceNote ? race.meta.paceNote : null };
}
