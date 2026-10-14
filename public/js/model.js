// ---------- scoring model: everything is recomputed from stored aggregates ----------
const LOAD_PER_MIN = { run: 3.0, ride: 2.2, swim: 2.5, walk: 0.8, hike: 1.6, strength: 1.6, hiit: 3.0, mobility: 0.4, row: 2.6, snow: 2.0, cardio: 2.2, sport: 2.5, other: 1.5, rest: 0 };
const JOURNAL_ITEMS = [
  { key: 'alcohol', label: 'Alcohol', q: 'Drank alcohol' },
  { key: 'lateCaffeine', label: 'Caffeine after 2 pm', q: 'Had caffeine after 2 pm' },
  { key: 'lateMeal', label: 'Late meal', q: 'Ate within 2 h of bed' },
  { key: 'screens', label: 'Screens in bed', q: 'Used a phone or laptop in bed' },
  { key: 'stretch', label: 'Stretching / mobility', q: 'Stretched or did mobility work' },
  { key: 'meditation', label: 'Meditation / breathwork', q: 'Meditated or did breathwork' },
  { key: 'sauna', label: 'Sauna / cold', q: 'Used a sauna or cold plunge' },
  { key: 'sick', label: 'Feeling sick', q: 'Felt ill' },
  { key: 'travel', label: 'Travel', q: 'Travelled' },
];
const PLAN_INTENSITY = { rest: 0, recovery: 1, easy: 1, moderate: 2, hard: 3, key: 3, test: 3, race: 4 };

function pairKey(a, b) { return a < b ? a + '~' + b : b + '~' + a; }
function srcLabel(x) {
  if (x.srcKind === 'strava') return 'Strava';
  if (/watch/i.test(x.src) || x.hb) return 'Apple Watch';
  return x.src || 'Apple Health';
}

// --- overlap detection between Apple Health workouts and Strava activities ---
function detectOverlaps(appleW, stravaA, split) {
  const items = appleW.map(w => ({ ...w, srcKind: 'apple' })).concat(stravaA.map(a => ({ ...a, srcKind: 'strava' })))
    .filter(x => x.le > x.ls).sort((a, b) => a.ls - b.ls);
  const parent = items.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const pairs = [], splitPairs = [];
  for (let i = 0; i < items.length; i++) {
    const A = items[i];
    for (let j = i + 1; j < items.length && items[j].ls < A.le; j++) {
      const B = items[j];
      if (A.srcKind === 'apple' && B.srcKind === 'apple' && A.src === B.src) continue;
      const inter = Math.min(A.le, B.le) - Math.max(A.ls, B.ls);
      const ratio = inter / Math.min(A.le - A.ls, B.le - B.ls);
      if (!(ratio >= 0.8 || (ratio >= 0.5 && sportsCompatible(A.sport, B.sport)))) continue;
      const key = pairKey(A.id, B.id);
      const p = { a: A, b: B, ratio, key, startDiffMin: Math.abs(A.ls - B.ls) / 60000 };
      if (split && split[key]) { splitPairs.push(p); continue; }
      pairs.push(p);
      parent[find(i)] = find(j);
    }
  }
  const byRoot = new Map();
  items.forEach((x, i) => { const r = find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(x); });
  const acts = [];
  for (const group of byRoot.values()) acts.push(mergeGroup(group, pairs));
  acts.sort((a, b) => b.ls - a.ls);
  return { acts, pairs, splitPairs };
}
function mergeGroup(items, pairs) {
  const strava = items.filter(x => x.srcKind === 'strava').sort((a, b) => (b.distM || 0) - (a.distM || 0) || b.durS - a.durS);
  const apple = items.filter(x => x.srcKind === 'apple').sort((a, b) => b.durS - a.durS);
  const watch = apple.filter(x => x.hb).sort((a, b) => b.durS - a.durS)[0];
  const primary = strava[0] || watch || apple[0];
  const hrSrc = watch || strava.find(x => x.hb) || items.find(x => x.avgHr);
  const pick = (k) => { if (primary[k] != null) return primary[k]; for (const x of items) if (x[k] != null) return x[k]; return null; };
  const sources = [...new Set(items.map(srcLabel))];
  const ids = items.map(x => x.id).sort();
  return {
    gid: ids.join('~'), ids, items, merged: items.length > 1,
    pairs: items.length > 1 ? pairs.filter(p => ids.includes(p.a.id) && ids.includes(p.b.id)) : [],
    name: strava[0] ? strava[0].name : (SPORT_LABEL[primary.sport] || 'Workout') + (primary.indoor ? ' (indoor)' : ''),
    sport: primary.sport, type: primary.type, start: primary.start, ls: primary.ls, le: primary.le, date: primary.start.slice(0, 10),
    durS: primary.durS, movS: pick('movS'), distM: pick('distM'), elevM: pick('elevM'), kcal: watch && watch.kcal ? watch.kcal : pick('kcal'),
    avgHr: hrSrc ? hrSrc.avgHr : null, maxHr: hrSrc ? hrSrc.maxHr : null, hb: hrSrc && hrSrc.hb ? hrSrc.hb : null,
    hrFrom: hrSrc ? srcLabel(hrSrc) : null, hasWatchHr: !!watch, re: strava[0] ? strava[0].re : null,
    sources, stravaId: strava[0] ? strava[0].sid : null
  };
}

function slotInfo(a, startMin, durMin) {
  // coverage of dense HR (≥6 samples per 5 min) and load already present in the day's HR curve
  if (!a || !a.cv5) return { cov: 0, load: 0 };
  const s0 = Math.max(0, Math.floor(startMin / 5)), s1 = Math.min(287, Math.floor((startMin + durMin - 0.01) / 5));
  let dense = 0, n = 0;
  for (let k = s0; k <= s1; k++) { n++; if (+a.cv5[k] >= 6) dense++; }
  return { cov: n ? dense / n : 0, s0, s1 };
}
function slotLoad(a, s0, s1, hrMax) {
  if (!a || !a.hr5) return 0; let L = 0;
  for (let k = s0; k <= s1; k++) { const v = parseInt(a.hr5.substr(k * 2, 2), 16); if (v) L += 5 * hrWeight(v, hrMax); }
  return L;
}
function hr5Array(a) { const out = new Array(288); for (let k = 0; k < 288; k++) { const v = a && a.hr5 ? parseInt(a.hr5.substr(k * 2, 2), 16) : 0; out[k] = v || null; } return out; }

function baselineOf(arr) { // arr of numbers from the prior window
  if (arr.length < 4) return null;
  return { m: mean(arr), sd: stdev(arr) || 0, n: arr.length };
}
// ---- sleep score 0–100: duration plus quality (WHOOP / Garmin style composite) ----
// Each part is scored 0–100, then combined with these weights. Parts without data are left out
// and the remaining weights are rescaled, so a night with only a total still gets a (duration-based) score.
const SLEEP_WEIGHTS = { dur: 0.40, eff: 0.15, cont: 0.10, stages: 0.10, cons: 0.15, stress: 0.10 };
const SLEEP_PART_LABEL = { dur: 'Hours vs need', eff: 'Efficiency', cont: 'Disruptions', stages: 'Deep & REM', cons: 'Consistency', stress: 'Sleep stress' };
function pw(x, pts) { // piecewise-linear through [[x, y], …] (x ascending), clamped at the ends
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts[pts.length - 1][1];
}
function sleepScoreOf(day, s, base) {
  const parts = {}, raw = {};
  // 1. hours vs need (WHOOP "hours vs needed", Garmin "duration")
  raw.dur = day.perf; parts.dur = pw(day.perf, [[0.5, 0], [0.7, 40], [0.85, 75], [0.95, 92], [1, 100]]);
  if (s) {
    const asleep = s.asleep || 0;
    // 2. efficiency: asleep / in bed (85 % is the usual clinical threshold for good efficiency)
    if (s.inBed && s.inBed >= asleep && s.inBed > 60) { raw.eff = asleep / s.inBed; parts.eff = pw(raw.eff, [[0.65, 0], [0.75, 40], [0.85, 75], [0.93, 100]]); }
    // 3. disruptions: minutes awake after falling asleep, and number of awakenings
    if (s.awake != null && s.segs && s.segs.length) {
      raw.waso = s.awake; raw.wakes = s.wake || 0;
      const w = pw(s.awake, [[10, 100], [30, 75], [60, 40], [90, 0]]), n = pw(raw.wakes, [[2, 100], [5, 70], [10, 20], [14, 0]]);
      parts.cont = 0.6 * w + 0.4 * n;
    }
    // 4. deep + REM share of sleep (adult norms: deep ~13–23 %, REM ~20–25 %; Apple Watch reports less deep sleep than lab studies, so the deep curve is set lower)
    if (asleep > 120 && (s.deep || s.rem)) {
      raw.deepPct = s.deep / asleep; raw.remPct = s.rem / asleep;
      parts.stages = 0.5 * pw(raw.deepPct, [[0.04, 0], [0.08, 50], [0.13, 100]]) + 0.5 * pw(raw.remPct, [[0.08, 0], [0.14, 55], [0.20, 100]]);
    }
    // 5. consistency: overlap of tonight's sleep window with the previous 4 nights (WHOOP uses a 4-day window)
    if (day.cons != null) { raw.cons = day.cons; parts.cons = pw(day.cons, [[0.35, 0], [0.55, 40], [0.70, 75], [0.85, 100]]); }
    // 6. sleep stress: overnight HRV and sleeping heart rate against your own 30-day baseline
    const zs = [];
    if (s.hrv != null && base.hrv && base.hrv.n >= 7) zs.push(clamp((Math.log(s.hrv) - base.hrv.m) / Math.max(base.hrv.sd, 0.08), -3, 3));
    if (s.hrAvg != null && base.shr && base.shr.n >= 7) zs.push(-clamp((s.hrAvg - base.shr.m) / Math.max(base.shr.sd, 1.5), -3, 3));
    if (zs.length) { raw.stressZ = mean(zs); parts.stress = pw(raw.stressZ, [[-2, 0], [-1, 45], [0, 85], [0.5, 100]]); }
  }
  let w = 0, sum = 0;
  for (const k in parts) { parts[k] = Math.round(clamp(parts[k], 0, 100)); sum += SLEEP_WEIGHTS[k] * parts[k]; w += SLEEP_WEIGHTS[k]; }
  const score = w ? Math.round(sum / w) : null;
  return { sleepScore: score, sleepParts: parts, sleepRaw: raw, sleepScoreBasis: Object.keys(parts).length > 1 ? 'full' : 'duration' };
}
function sleepScoreWord(x) { return x == null ? null : x >= 90 ? 'Excellent' : x >= 80 ? 'Good' : x >= 60 ? 'Fair' : 'Poor'; }
function clockIoU(a, b) { // sleep windows on a noon-anchored clock
  const pos = (ls) => (minOfDayLms(ls) - 720 + 1440) % 1440;
  const a0 = pos(a.ls), a1 = a0 + (a.le - a.ls) / 60000, b0 = pos(b.ls), b1 = b0 + (b.le - b.ls) / 60000;
  const inter = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)), uni = Math.max(a1, b1) - Math.min(a0, b0);
  return uni > 0 ? inter / uni : 0;
}
function recoveryZone(r) { return r == null ? null : r >= 67 ? 'hi' : r >= 34 ? 'mid' : 'lo'; }
function strainTarget(rec) { const z = recoveryZone(rec); return z === 'hi' ? [14, 18] : z === 'mid' ? [10, 14] : z === 'lo' ? [4, 10] : [8, 14]; }

function buildModel(D) {
  const prof = D.profile || {};
  const metaA = D.metaApple || {};
  const age = prof.birthYear ? new Date().getFullYear() - prof.birthYear : metaA.dob ? new Date().getFullYear() - +metaA.dob.slice(0, 4) : null;
  let hrMax = 190, hrMaxSrc = 'default';
  if (prof.hrMax) { hrMax = prof.hrMax; hrMaxSrc = 'you'; }
  else if (prof.stravaHrMax) { hrMax = prof.stravaHrMax; hrMaxSrc = 'Strava zones'; }
  else if (metaA.hrMaxEst) { hrMax = metaA.hrMaxEst; hrMaxSrc = 'your Apple Watch data'; }
  else if (age) { hrMax = Math.round(208 - 0.7 * age); hrMaxSrc = 'your age'; }
  const needBase = (prof.sleepNeedH || 7.75) * 60;
  const zb = Array.isArray(prof.stravaZones) && prof.stravaZones.length >= 4 ? prof.stravaZones.map(Number) : null;

  const days = {}, appleW = [], stravaA = [];
  for (const m in D.apple) { const doc = D.apple[m]; if (!doc) continue; Object.assign(days, doc.days || {}); for (const w of doc.workouts || []) appleW.push(w); }
  for (const m in D.strava) { const doc = D.strava[m]; if (!doc) continue; for (const a of doc.acts || []) stravaA.push(a); }
  const journal = {};
  for (const m in D.journal) { const doc = D.journal[m]; if (doc && doc.entries) Object.assign(journal, doc.entries); }
  const ov = detectOverlaps(appleW, stravaA, (D.overlaps && D.overlaps.split) || {});
  const actsByDay = {};
  for (const a of ov.acts) (actsByDay[a.date] || (actsByDay[a.date] = [])).push(a);
  for (const k in actsByDay) actsByDay[k].sort((a, b) => a.ls - b.ls);

  const allDates = new Set([...Object.keys(days), ...Object.keys(actsByDay)]);
  const today = todayYmd();
  if (!allDates.size) return { empty: true, prof: { hrMax, hrMaxSrc, needBase, age, zones: zb, zoneSrc: zb ? 'Strava' : '% of max HR' }, acts: [], pairs: [], splitPairs: [], journal, dates: [], day: {}, plan: buildPlan(D, {}, today), today };
  const sorted = [...allDates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1] > today ? sorted[sorted.length - 1] : today;
  const dates = []; for (let d = first; d <= last; d = addDays(d, 1)) dates.push(d);

  const out = {};
  const hist = { hrv: [], rhr: [], resp: [], temp: [], shr: [] }; // [dayIndex, value], ascending
  const ptr = { hrv: 0, rhr: 0, resp: 0, temp: 0, shr: 0 };
  let prev = null;
  const recentWindows = [];
  for (let di = 0; di < dates.length; di++) {
    const date = dates[di];
    const a = days[date] || null;
    const acts = actsByDay[date] || [];
    const day = { date, a, acts, sleep: a && a.sleep && a.sleep.ls ? a.sleep : null, naps: a && a.sleep ? a.sleep.naps || [] : [] };
    // --- strain ---
    const base = a && a.hb ? loadFromHist(a.hb, hrMax) : 0;
    const zones = zonesFromHist(a && a.hb, hrMax, zb);
    let extra = 0;
    for (const act of acts) {
      const durMin = act.durS / 60;
      const si = slotInfo(a, minOfDayLms(act.ls), durMin);
      const covered = act.hasWatchHr || si.cov >= 0.6;
      let est, basis;
      if (act.hb) { est = loadFromHist(act.hb, hrMax); basis = 'heart rate (' + act.hrFrom + ')'; }
      else if (covered) { est = slotLoad(a, si.s0, si.s1, hrMax); basis = 'heart rate (Apple Health)'; }
      else if (act.avgHr) { est = durMin * hrWeight(act.avgHr, hrMax) * 1.1; basis = 'average heart rate'; }
      else if (act.re != null && act.re > 0) { est = act.re * 2.4; basis = 'Strava relative effort'; }
      else { est = durMin * (LOAD_PER_MIN[act.sport] ?? 1.5); basis = 'duration and sport'; }
      act.load = est; act.strain = strainOf(est); act.loadBasis = basis; act.covered = covered;
      if (!covered) {
        const already = si.s0 != null ? slotLoad(a, si.s0, si.s1, hrMax) : 0;
        const add = Math.max(0, est - already); extra += add; act.addedLoad = add;
        if (act.hb) { const z = zonesFromHist(act.hb, hrMax, zb); for (let k = 0; k < 5; k++) zones[k] += z[k] * (add / (est || 1)); }
      }
    }
    day.load = base + extra; day.baseLoad = base; day.extraLoad = extra; day.zones = zones;
    day.strain = (a && a.hb) || acts.length ? strainOf(day.load) : null;
    // --- physiology ---
    const s = day.sleep;
    day.hrv = s && s.hrv != null ? s.hrv : null;
    day.rhr = s && s.hrLow != null ? s.hrLow : a && a.rhr != null ? a.rhr : null;
    day.resp = s && s.resp != null ? s.resp : null;
    day.spo2 = s && s.spo2 != null ? s.spo2 : null;
    day.temp = s && s.temp != null ? s.temp : null;
    const win = (key) => { const arr = hist[key]; while (ptr[key] < arr.length && arr[ptr[key]][0] < di - 30) ptr[key]++; const o = []; for (let k = ptr[key]; k < arr.length; k++) o.push(arr[k][1]); return o; };
    const bH = baselineOf(win('hrv').map(Math.log)), bR = baselineOf(win('rhr')), bP = baselineOf(win('resp')), bT = baselineOf(win('temp'));
    day.base = { hrv: bH ? Math.exp(bH.m) : null, rhr: bR ? bR.m : null, resp: bP ? bP.m : null, temp: bT ? bT.m : null };
    if (day.temp != null && bT) day.tempDev = day.temp - bT.m;
    // --- sleep need & performance ---
    const p = prev && daysBetween(prev.date, date) === 1 ? prev : null;
    // need = personal baseline + extra for yesterday's strain + a share of the previous night's shortfall
    const strainAdj = p && p.strain != null ? Math.max(0, p.strain - 10) * 3 : 0;
    const debtCarry = p && p.debt ? Math.min(60, p.debt * 0.35) : 0;
    day.need = needBase + strainAdj + debtCarry; day.needParts = { base: needBase, strain: strainAdj, debt: debtCarry };
    if (!s && a && a.sleep && a.sleep.asleep && !a.sleep.ls) day.sleepSummary = a.sleep;
    if (s || day.naps.length || day.sleepSummary) {
      day.sleepMin = (s ? s.asleep : day.sleepSummary ? day.sleepSummary.asleep : 0) + (a.sleep.napMin || 0);
      day.perf = Math.min(1, day.sleepMin / day.need);
      day.debt = Math.max(0, needBase + strainAdj - day.sleepMin);
      if (s) {
        day.eff = s.inBed ? s.asleep / s.inBed : null;
        const prevW = recentWindows.filter(w => di - w.di <= 4);
        day.cons = prevW.length ? mean(prevW.map(w => clockIoU(s, w))) : null;
      }
    }
    const bS = baselineOf(win('shr'));
    if (day.sleepMin != null) Object.assign(day, sleepScoreOf(day, s, { hrv: bH, shr: bS }));
    // --- recovery ---
    let wsum = 0, score = 0;
    const parts = {};
    if (day.hrv != null && bH) { const z = clamp((Math.log(day.hrv) - bH.m) / Math.max(bH.sd, 0.08), -2.5, 2.5); parts.hrv = z; score += 0.5 * z; wsum += 0.5; }
    if (day.rhr != null && bR) { const z = clamp((day.rhr - bR.m) / Math.max(bR.sd, 1.5), -2.5, 2.5); parts.rhr = z; score -= 0.25 * z; wsum += 0.25; }
    if (wsum >= 0.25 && day.perf != null) { const z = clamp((day.perf - 0.85) / 0.1, -2.5, 1.5); parts.sleep = z; score += 0.15 * z; wsum += 0.15; }
    if (wsum >= 0.25 && day.resp != null && bP) { const z = clamp((day.resp - bP.m) / Math.max(bP.sd, 0.4), -2.5, 2.5); parts.resp = z; score -= 0.10 * Math.max(0, z); wsum += 0.10; }
    if (wsum >= 0.5) { const sc = score / wsum; day.rec = clamp(Math.round(100 / (1 + Math.exp(-(1.5 * sc + 0.4)))), 1, 99); day.recParts = parts; }
    else { day.rec = null; day.calibrating = day.hrv != null || day.rhr != null; }
    // feed baselines after scoring the day
    if (day.hrv != null) hist.hrv.push([di, day.hrv]);
    if (day.rhr != null) hist.rhr.push([di, day.rhr]);
    if (day.resp != null) hist.resp.push([di, day.resp]);
    if (day.temp != null) hist.temp.push([di, day.temp]);
    if (s && s.hrAvg != null) hist.shr.push([di, s.hrAvg]);
    if (s) { recentWindows.push({ di, ls: s.ls, le: s.le }); if (recentWindows.length > 6) recentWindows.shift(); }
    out[date] = day; prev = day;
  }
  // training load: acute (7 d) vs chronic (28 d)
  for (let i = 0; i < dates.length; i++) {
    const d = out[dates[i]];
    const L = (n) => { let s = 0; for (let k = Math.max(0, i - n + 1); k <= i; k++) s += out[dates[k]].load || 0; return s / n; };
    d.acute = L(7); d.chronic = i >= 13 ? L(28) : null; d.acwr = d.chronic ? d.acute / d.chronic : null;
  }
  const model = { prof: { hrMax, hrMaxSrc, needBase, age, zones: zb, zoneSrc: zb ? 'Strava' : '% of max HR' }, acts: ov.acts, pairs: ov.pairs, splitPairs: ov.splitPairs, journal, dates, day: out, first, last, today };
  model.plan = buildPlan(D, actsByDay, today);
  model.insights = journalInsights(journal, out);
  return model;
}

function journalInsights(journal, days) {
  const res = [];
  for (const it of JOURNAL_ITEMS.concat([{ key: 'stress', label: 'High stress (4–5)' }])) {
    const yes = [], no = [], yesS = [], noS = [];
    for (const date in journal) {
      const e = journal[date]; const nx = days[addDays(date, 1)];
      if (!nx || nx.rec == null) continue;
      let v = e[it.key];
      if (it.key === 'stress') v = e.stress == null ? undefined : e.stress >= 4 ? true : e.stress <= 2 ? false : undefined;
      if (v === true) { yes.push(nx.rec); if (nx.perf != null) yesS.push(nx.perf); }
      else if (v === false) { no.push(nx.rec); if (nx.perf != null) noS.push(nx.perf); }
    }
    res.push({ ...it, nYes: yes.length, nNo: no.length, ready: yes.length >= 3 && no.length >= 3, delta: yes.length && no.length ? mean(yes) - mean(no) : null, sleepDelta: yesS.length && noS.length ? (mean(yesS) - mean(noS)) * 100 : null });
  }
  return res;
}

const ENDURANCE = new Set(['run', 'ride', 'swim', 'walk', 'hike', 'row', 'snow', 'cardio']);
// Plans: the original one (plan/meta + planWeeks without a plan id) plus any added ones (plans/{id} + planWeeks with plan: id).
// A plan that starts later takes over from its start date; the earlier plan's remaining sessions are dropped.
function collectPlans(D) {
  const allWeeks = (D.planWeeks || []).filter(w => w && Array.isArray(w.sessions));
  const plans = [];
  const legacy = allWeeks.filter(w => !w.plan);
  if (legacy.length || (D.planSessions || []).length) plans.push({ id: 'main', meta: D.planMeta || {}, weeks: legacy, extra: D.planSessions || [] });
  for (const p of D.plans || []) if (p && p.id) plans.push({ id: p.id, meta: p, weeks: allWeeks.filter(w => w.plan === p.id), extra: [] });
  for (const p of plans) {
    p.weeks.sort((a, b) => (a.week ?? 0) - (b.week ?? 0));
    const ds = p.weeks.flatMap(w => w.sessions.map(s => s.date)).concat(p.extra.map(s => s.date)).filter(Boolean).sort();
    p.start = p.meta.startDate || ds[0] || null; p.end = ds[ds.length - 1] || p.meta.endDate || p.start;
  }
  plans.sort((a, b) => (a.start || '') < (b.start || '') ? -1 : 1);
  for (let i = 0; i < plans.length; i++) plans[i].cutoff = plans[i + 1] ? plans[i + 1].start : null;
  return plans;
}
function buildPlan(D, actsByDay, today) {
  const plans = collectPlans(D);
  const raw = [], weeks = [];
  for (const p of plans) {
    for (const w of p.weeks) {
      const ss = w.sessions.filter(s => !p.cutoff || s.date < p.cutoff);
      if (!ss.length) continue;
      weeks.push({ ...w, planId: p.id, sessions: ss });
      ss.forEach((s, i) => raw.push({ ...s, planId: p.id, week: w.week, phase: w.phase, weekStart: w.start, order: s.order ?? i }));
    }
    for (const s of p.extra) if (!p.cutoff || s.date < p.cutoff) raw.push({ ...s, planId: p.id });
  }
  const checks = (D.planChecks && D.planChecks.done) || {};
  const sessions = raw.filter(s => s && /^\d{4}-\d{2}-\d{2}$/.test(s.date || '')).map(s => ({ ...s, sportKey: sportOf(s.sport || s.title || ''), intensity: String(s.intensity || 'moderate').toLowerCase() }));
  sessions.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.order || 0) - (b.order || 0));
  const used = new Set();
  // match non-optional sessions first, so an optional extra never takes the workout a main session needs
  const ordered = sessions.filter(s => !s.optional).concat(sessions.filter(s => s.optional));
  for (const s of ordered) {
    const isRest = s.intensity === 'rest' || s.sportKey === 'rest';
    s.isRest = isRest;
    let m = null;
    if (!isRest) {
      const cands = (actsByDay[s.date] || []).filter(a => !used.has(a.gid) && (s.sportKey === 'other' || sportsCompatible(s.sportKey, a.sport))
        && (!s.durationMin || !ENDURANCE.has(s.sportKey) || a.durS / 60 >= 0.5 * s.durationMin));
      cands.sort((a, b) => b.durS - a.durS);
      m = cands[0] || null;
    }
    if (m) { used.add(m.gid); s.match = m; }
    const chk = checks[s.id];
    if (isRest) s.status = s.date < today ? 'rest' : s.date === today ? 'today' : 'upcoming';
    else if (m) { const r = s.durationMin ? (m.durS / 60) / s.durationMin : 1; s.ratio = r; s.status = r >= 0.7 || !ENDURANCE.has(s.sportKey) ? 'done' : 'partial'; }
    else if (chk) { s.status = 'done'; s.checked = chk; }
    else if (s.date < today) s.status = s.optional ? 'skipped' : 'missed';
    else s.status = s.date === today ? 'today' : 'upcoming';
  }
  const past = sessions.filter(s => !s.isRest && !s.optional && s.date < today && daysBetween(s.date, today) <= 28);
  const done = past.filter(s => s.status === 'done').length, partial = past.filter(s => s.status === 'partial').length;
  const curWeek = weeks.find(w => w.start <= today && (w.end || addDays(w.start, 6)) >= today) || null;
  for (const p of plans) {
    const end = p.cutoff && p.cutoff <= p.end ? addDays(p.cutoff, -1) : p.end;
    p.effEnd = end;
    p.status = p.start > today ? 'next' : end < today ? 'past' : 'current';
    p.count = sessions.filter(s => s.planId === p.id && !s.isRest).length;
    p.totalWeeks = weeks.filter(w => w.planId === p.id).reduce((a, w) => Math.max(a, w.week || 0), 0);
  }
  const curPlan = plans.find(p => p.status === 'current') || plans.find(p => p.status === 'next') || plans[plans.length - 1] || null;
  return { meta: curPlan ? curPlan.meta : null, plans, curPlan, weeks, curWeek, sessions, compliance: past.length ? (done + 0.5 * partial) / past.length : null, pastCount: past.length };
}

// Day guidance that combines recovery with the planned session
function coachFor(day, model) {
  const rec = day ? day.rec : null, z = recoveryZone(rec);
  const target = strainTarget(rec);
  const planned = model.plan.sessions.filter(s => s.date === (day && day.date) && !s.isRest);
  const rest = model.plan.sessions.find(s => s.date === (day && day.date) && s.isRest);
  const lvlOf = s => (PLAN_INTENSITY[s.intensity] ?? 2) - (s.sportKey === 'strength' || s.sportKey === 'mobility' ? 1.5 : 0) - (s.optional ? 2 : 0);
  const P = planned.slice().sort((a, b) => lvlOf(b) - lvlOf(a))[0], lvl = P ? (PLAN_INTENSITY[P.intensity] ?? 2) : null;
  let head, body;
  if (rec == null) {
    head = day && day.calibrating ? 'Calibrating your baseline' : 'No recovery score yet';
    body = day && day.calibrating ? 'Recovery needs at least 4 nights of heart-rate variability and resting heart rate. Keep wearing your Watch to sleep.' : 'Recovery comes from last night’s HRV and resting heart rate. Wear your Watch to sleep; once the iPhone Shortcut has synced the night, your score appears here.';
    if (P) body += lvl >= 3 ? ` Today’s plan has “${P.title}”: go by feel and keep the warm-up long.` : ` Today’s plan: “${P.title}”.`;
  } else if (z === 'hi') {
    head = 'Primed to perform';
    body = P ? (lvl >= 3 ? `Green light for “${P.title}”. Your body is ready for the hard work.` : `“${P.title}” is on the plan. You have room to push a little more if you feel good.`) : rest ? 'Planned rest day. Recovery is high, so an easy walk or mobility session fits well.' : 'A good day for a hard or long session.';
  } else if (z === 'mid') {
    head = 'Maintain';
    body = P ? (lvl >= 3 ? `“${P.title}” is doable. Keep the warm-up long and stop the hard reps if heart rate climbs faster than usual.` : `“${P.title}” fits today. Stay in the planned zones.`) : 'Moderate training is fine. Keep intensity in check.';
  } else {
    head = 'Prioritise recovery';
    body = P ? (lvl >= 3 ? `Recovery is low for “${P.title}”. Swap it with an easier day this week, or do it as a Zone 2 session.` : `Keep “${P.title}” truly easy, or replace it with mobility.`) : 'Low recovery. Rest, sleep early, and keep any movement light.';
  }
  return { head, body, target, planned, rest };
}
