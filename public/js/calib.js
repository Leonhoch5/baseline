// ---------- calibration: robust personal baselines, documented load metrics, sleep regularity,
// individual responses, and leakage-free prediction with temporal validation ----------
const CAL_VERSION = 'calib-1.0';
const CAL_FLOOR = { hrv: 0.05, rhr: 1.0, shr: 1.0, sleep: 20, mid: 15, resp: 0.3, temp: 0.12 };

function robustStats(vals) {
  if (!vals.length) return null;
  const m = median(vals);
  return { med: m, mad: median(vals.map(v => Math.abs(v - m))) * 1.4826, n: vals.length };
}
function checkinOf(M, date) { const e = M.journal && M.journal[date]; return e || null; }
function sleepMidMin(d) { if (!d || !d.sleep) return null; const mid = (d.sleep.ls + d.sleep.le) / 2; return (minOfDayLms(mid) - 720 + 1440) % 1440; } // minutes after noon

// ---- 1. robust multi-window baselines (no future data: day i uses days before i) ----
function confounded(M, date) { const J = M.journal || {}, jy = J[addDays(date, -1)] || {}, jt = J[date] || {}; return !!(jy.alcohol || jt.sick || jy.sick || (M.plan && M.plan.sickOn && M.plan.sickOn(date))); }
function calBaselines(M) {
  const ds = M.dates, N = ds.length; M.calBase = true;
  const get = {
    hrv: d => d.hrv != null && d.hrv > 0 ? Math.log(d.hrv) : null,
    rhr: d => d.rhr != null ? d.rhr : null,
    sleep: d => d.sleepMin != null ? d.sleepMin : null,
    mid: d => sleepMidMin(d),
    resp: d => d.resp != null ? d.resp : null,
    shr: d => d.sleep && d.sleep.hrAvg != null ? d.sleep.hrAvg : null,
    temp: d => d.temp != null ? d.temp : null,
  };
  for (const key in get) {
    const x = ds.map(k => get[key](M.day[k]));
    const ok = x.map(v => v != null);
    for (let i = 0; i < N; i++) {
      const d = M.day[ds[i]]; d.cal = d.cal || {};
      const w28 = [], ref = [];
      for (let k = Math.max(0, i - 28); k < i; k++) if (ok[k]) w28.push(x[k]);
      for (let k = Math.max(0, i - 90); k < i - 28; k++) if (ok[k]) ref.push(x[k]);
      const s28 = w28.length >= 10 ? robustStats(w28) : null, sR = ref.length >= 20 ? robustStats(ref) : null;
      const fl = CAL_FLOOR[key];
      const r = { x: x[i], n28: w28.length };
      if (s28) { r.med = s28.med; r.mad = s28.mad; if (x[i] != null) r.z = (x[i] - s28.med) / Math.max(s28.mad, fl); }
      // likely artifact: far outside the personal distribution. Kept and shown, but excluded from later baselines.
      if (r.z != null && (key === 'hrv' || key === 'rhr') && Math.abs(r.z) > 5) { r.flag = 'outlier'; ok[i] = false; }
      // nights after alcohol or while sick are real, but they would drag the baseline: shown, not used for later baselines
      if (ok[i] && key !== 'sleep' && key !== 'mid' && confounded(M, d.date)) { r.conf = true; ok[i] = false; }
      const s7 = []; for (let k = Math.max(0, i - 6); k <= i; k++) if (ok[k]) s7.push(x[k]);
      if (s7.length >= 3) { r.s7 = mean(s7); if (s28) r.zs7 = (r.s7 - s28.med) / Math.max(s28.mad, fl); if (sR) r.zr7 = (r.s7 - sR.med) / Math.max(sR.mad, fl); }
      if (sR) { r.refMed = sR.med; if (s28) r.shift = (s28.med - sR.med) / Math.max(sR.mad, fl); }
      let c7 = 0, c28 = 0; for (let k = Math.max(0, i - 27); k <= i; k++) if (x[k] != null) { c28++; if (k > i - 7) c7++; }
      r.c7 = c7 / 7; r.c28 = c28 / 28;
      d.cal[key] = r;
    }
  }
}

// ---- 2. documented load metrics: Banister TRIMP (HR) and session-RPE (Foster) ----
function trimpHist(hb, hrRest, hrMax, sex) {
  if (!hb) return null;
  const [a, b] = sex === 'f' ? [0.86, 1.67] : [0.64, 1.92];
  let t = 0;
  for (let k = 0; k < hb.length; k++) {
    if (!hb[k]) continue;
    let r = (HB_BASE + 5 * k + 2.5 - hrRest) / (hrMax - hrRest); if (r <= 0) continue; r = Math.min(r, 1);
    t += hb[k] / 60 * r * a * Math.exp(b * r);
  }
  return t;
}
function trimpAvg(avgHr, minutes, hrRest, hrMax, sex) {
  const [a, b] = sex === 'f' ? [0.86, 1.67] : [0.64, 1.92];
  let r = (avgHr - hrRest) / (hrMax - hrRest); if (r <= 0) return 0; r = Math.min(r, 1);
  return minutes * r * a * Math.exp(b * r);
}
const FAMILY = s => s === 'swim' ? 'swim' : FOOT.has(s) ? 'run' : s === 'ride' ? 'ride' : (s === 'strength' || s === 'hiit') ? 'strength' : 'other';
const FAMILY_LABEL = { swim: 'Swim', run: 'Run / walk', ride: 'Ride', strength: 'Strength', other: 'Other' };
function calLoad(M, sex) {
  const ds = M.dates, hrMax = M.prof.hrMax;
  const la = 2 / (7 + 1), lc = 2 / (28 + 1); // Williams et al. 2017 EWMA decay constants
  const ew = {}; let A = 0, C = 0;
  for (let i = 0; i < ds.length; i++) {
    const d = M.day[ds[i]];
    const hrRest = (d.cal && d.cal.rhr && d.cal.rhr.med) || d.rhr || 55;
    let tr = 0, minHR = 0, minAll = 0, srpe = 0, srpeN = 0;
    const fam = {};
    for (const a of d.acts) {
      const mins = a.durS / 60; minAll += mins;
      let t = null, src = null;
      if (a.hb) { t = trimpHist(a.hb, hrRest, hrMax, sex); src = 'heart-rate stream'; }
      else if (a.covered && d.a && d.a.hr5) {
        t = 0; const s0 = Math.floor(minOfDayLms(a.ls) / 5), s1 = Math.min(287, Math.floor((minOfDayLms(a.ls) + mins) / 5));
        for (let k = s0; k <= s1; k++) { const v = parseInt(d.a.hr5.substr(k * 2, 2), 16); if (v) t += trimpAvg(v, 5, hrRest, hrMax, sex); }
        src = 'Watch 5-minute heart rate';
      } else if (a.avgHr) { t = trimpAvg(a.avgHr, mins, hrRest, hrMax, sex); src = 'average heart rate'; }
      a.trimp = t; a.trimpSrc = src;
      const j = checkinOf(M, d.date), rpe = j && j.rpe ? j.rpe[a.gid] : null;
      if (rpe != null) { a.rpe = rpe; a.srpe = rpe * mins; srpe += a.srpe; srpeN++; }
      const f = FAMILY(a.sport);
      fam[f] = fam[f] || { trimp: 0, min: 0, minHR: 0 };
      fam[f].min += mins;
      if (t != null) { tr += t; minHR += mins; fam[f].trimp += t; fam[f].minHR += mins; }
    }
    d.trimp = tr; d.trimpCov = minAll ? minHR / minAll : null; d.trainMin = minAll;
    d.srpe = srpeN ? srpe : null; d.srpeAll = srpeN === d.acts.length && srpeN > 0;
    // EWMA acute (7) and chronic (28) per modality and in total, TRIMP units
    A = A + la * (tr - A); C = C + lc * (tr - C);
    d.ewA = A; d.ewC = C;
    d.ewFam = {};
    for (const f of ['swim', 'run', 'ride', 'strength', 'other']) {
      const p = ew[f] || (ew[f] = { a: 0, c: 0, ma: 0, mc: 0 });
      const v = fam[f] ? fam[f].trimp : 0, m = fam[f] ? fam[f].min : 0;
      p.a += la * (v - p.a); p.c += lc * (v - p.c); p.ma += la * (m - p.ma); p.mc += lc * (m - p.mc);
      d.ewFam[f] = { a: p.a, c: p.c, ma: p.ma, mc: p.mc };
    }
  }
}

// ---- 3. recovery confidence (what the estimate rests on) ----
function calConfidence(M) {
  for (const date of M.dates) {
    const d = M.day[date], c = d.cal || {};
    const reasons = []; let s = 0;
    const nS = d.sleep && d.sleep.hrvN != null ? d.sleep.hrvN : null;
    if (c.hrv && c.hrv.z != null) { s += nS != null && nS <= 1 ? 1.2 : 2; if (nS != null && nS <= 1) reasons.push('Only one HRV sample last night'); } else reasons.push(c.hrv && c.hrv.x != null ? 'HRV baseline still building (' + c.hrv.n28 + ' of 10 nights)' : 'No HRV last night');
    if (d.recParts && d.recParts.hrv && d.recParts.hrv.w7 < 4) { s -= 0.5; reasons.push('Fewer than 4 HRV nights this week'); }
    if (c.rhr && c.rhr.z != null) s += 1.5; else reasons.push(c.rhr && c.rhr.x != null ? 'Resting HR baseline still building' : 'No resting heart rate');
    if (d.sleepMin != null) s += 1; else reasons.push('No sleep recorded');
    const nb = Math.min(c.hrv ? c.hrv.n28 : 0, c.rhr ? c.rhr.n28 : 0);
    if (nb >= 20) s += 1; else if (nb >= 10) { s += 0.5; reasons.push('Baseline from only ' + nb + ' days'); }
    if ((c.hrv && c.hrv.flag) || (c.rhr && c.rhr.flag)) { s -= 2; reasons.push('A reading looks like a sensor artifact'); }
    d.recConf = { level: s >= 4.5 ? 'high' : s >= 2.5 ? 'moderate' : 'low', score: s, reasons };
  }
}

// ---- 4. sleep regularity index (Phillips et al. 2017) and individual sleep-need analysis ----
function calSleepGrid(M) {
  const grid = {}; // date -> Uint8Array(288), 1 = asleep
  const mark = (ls, le) => {
    for (let t = ls; t < le; t += 300000) { const day = dateOfLms(t); const g = grid[day] || (grid[day] = new Uint8Array(288)); g[Math.floor(minOfDayLms(t) / 5)] = 1; }
  };
  const nights = new Set();
  for (const date of M.dates) {
    const d = M.day[date]; if (!d.sleep) continue;
    nights.add(date);
    for (const [off, dur, code] of d.sleep.segs || []) if (code !== 0) mark(d.sleep.ls + off * 60000, d.sleep.ls + (off + dur) * 60000);
    for (const n of d.naps || []) mark(n.ls, n.le);
  }
  return { grid, nights };
}
function sleepRegularity(M, end, days) {
  const { grid, nights } = M._sleepGrid || (M._sleepGrid = calSleepGrid(M));
  let same = 0, tot = 0, pairs = 0;
  for (let k = days - 1; k >= 1; k--) {
    const a = addDays(end, -k - 1), b = addDays(end, -k);
    // day D is fully observed when the night ending on D and the night ending on D+1 are both recorded
    if (!(nights.has(a) && nights.has(b) && nights.has(addDays(a, 1)) && nights.has(addDays(b, 1)))) continue;
    const ga = grid[a] || new Uint8Array(288), gb = grid[b] || new Uint8Array(288);
    for (let s = 0; s < 288; s++) { tot++; if (ga[s] === gb[s]) same++; }
    pairs++;
  }
  return pairs >= 3 ? { sri: -100 + 200 * same / tot, pairs } : { sri: null, pairs };
}
function hingeFit(xs, ys, k) {
  const z = xs.map(x => Math.min(x, k)), mz = mean(z), my = mean(ys);
  let sxy = 0, sxx = 0; for (let i = 0; i < z.length; i++) { sxy += (z[i] - mz) * (ys[i] - my); sxx += (z[i] - mz) ** 2; }
  const b = sxx ? sxy / sxx : 0, a = my - b * mz;
  let sse = 0; for (let i = 0; i < z.length; i++) sse += (ys[i] - a - b * z[i]) ** 2;
  return { a, b, sse };
}
function sleepNeedAnalysis(M, end) {
  const xs = [], ys = []; let outcome = null;
  const pairs = (fn) => { xs.length = 0; ys.length = 0; for (const date of M.dates) { if (date > end) break; const d = M.day[date]; if (d.sleepMin == null || d.sleepMin < 180) continue; const y = fn(d); if (y != null) { xs.push(d.sleepMin); ys.push(y); } } };
  pairs(d => { const j = checkinOf(M, d.date); return j && j.readiness != null ? j.readiness : null; });
  if (xs.length >= 30) outcome = 'morning readiness (your check-in)';
  else { pairs(d => d.cal && d.cal.hrv && d.cal.hrv.z != null ? d.cal.hrv.z : null); if (xs.length >= 30) outcome = 'next-morning HRV vs your baseline'; }
  const res = { n: xs.length, outcome, guidance: [420, 540] };
  if (!outcome) { res.status = 'insufficient'; res.text = `Needs at least 30 nights with a matching ${'morning check-in or HRV reading'}; ${xs.length} so far.`; return res; }
  const ks = []; for (let k = 360; k <= 570; k += 15) ks.push(k);
  const fitBest = (X, Y) => { let best = null; for (const k of ks) { const f = hingeFit(X, Y, k); if (!best || f.sse < best.sse) best = { ...f, k }; } return best; };
  const best = fitBest(xs, ys), my = mean(ys);
  const sst = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  const r2 = sst ? 1 - best.sse / sst : 0;
  // bootstrap the plateau point
  const R = mulberry32(42), boot = [];
  for (let b = 0; b < 200; b++) { const X = [], Y = []; for (let i = 0; i < xs.length; i++) { const j = Math.floor(R() * xs.length); X.push(xs[j]); Y.push(ys[j]); } const f = fitBest(X, Y); if (f.b > 0) boot.push(f.k); }
  boot.sort((a, b) => a - b);
  Object.assign(res, { k: best.k, slope: best.b * 60, r2, ciLo: boot.length > 50 ? boot[Math.floor(boot.length * 0.1)] : null, ciHi: boot.length > 50 ? boot[Math.floor(boot.length * 0.9)] : null, bootShare: boot.length / 200 });
  if (best.b <= 0 || r2 < 0.03 || res.bootShare < 0.7 || res.ciLo == null || res.ciHi - res.ciLo > 150) {
    res.status = 'unclear'; res.text = `No clear relationship yet between sleep duration and ${outcome} (${xs.length} nights). Keep to the 7–9 h adult guidance.`;
  } else {
    const lo = clamp(best.k - 15, 420, 540), hi = clamp(best.k + 30, 420, 540);
    res.status = 'estimated'; res.range = [lo, Math.max(hi, lo + 15)];
    res.text = `${outcome} tends to improve with more sleep up to about ${fmtHM(best.k)} h, then levels off (80% interval ${fmtHM(res.ciLo)}–${fmtHM(res.ciHi)} h, ${xs.length} nights). Suggested range ${fmtHM(res.range[0])}–${fmtHM(res.range[1])} h, kept within the 7–9 h adult guidance.`;
  }
  return res;
}

// ---- 5. individual responses: aerobic efficiency and recovery after different loads ----
function efficiencyTrends(M) {
  const out = {};
  for (const sp of ['run', 'ride', 'swim']) {
    const pts = [];
    for (const a of M.acts) {
      if (a.sport !== sp || !a.avgHr || !a.distM) continue;
      const mins = (a.movS || a.durS) / 60; if (mins < 15 || mins > 180) continue;
      const v = a.distM / mins; // metres per minute
      if (a.avgHr < 90 || a.avgHr > M.prof.hrMax * 0.92) continue; // steady aerobic sessions only
      pts.push({ date: a.date, ef: v / a.avgHr, v, hr: a.avgHr, name: a.name });
    }
    pts.sort((a, b) => a.date < b.date ? -1 : 1);
    if (pts.length < 6) { out[sp] = { n: pts.length, pts }; continue; }
    const last = pts[pts.length - 1].date;
    const rec = pts.filter(p => daysBetween(p.date, last) <= 42), old = pts.filter(p => daysBetween(p.date, last) > 42 && daysBetween(p.date, last) <= 126);
    const r = { n: pts.length, pts };
    if (rec.length >= 3 && old.length >= 3) { r.recent = median(rec.map(p => p.ef)); r.earlier = median(old.map(p => p.ef)); r.change = r.recent / r.earlier - 1; r.nRec = rec.length; r.nOld = old.length; }
    out[sp] = r;
  }
  return out;
}
function recoveryCurves(M) {
  const tr = M.dates.map(k => M.day[k].trimp || 0).filter(t => t > 0).sort((a, b) => a - b);
  if (tr.length < 15) return { n: tr.length };
  const q1 = tr[Math.floor(tr.length / 3)], q2 = tr[Math.floor(2 * tr.length / 3)];
  const cats = { easy: [], moderate: [], hard: [] };
  M.dates.forEach((date, i) => {
    const t = M.day[date].trimp || 0; if (t <= 0) return;
    const c = t < q1 ? 'easy' : t < q2 ? 'moderate' : 'hard';
    const row = [];
    for (let lag = 1; lag <= 3; lag++) {
      const n = M.day[M.dates[i + lag]]; if (!n) { row.push(null); continue; }
      const j = checkinOf(M, n.date);
      row.push({ hrv: n.cal && n.cal.hrv ? n.cal.hrv.z : null, rhr: n.cal && n.cal.rhr ? n.cal.rhr.z : null, ready: j && j.readiness != null ? j.readiness : null });
    }
    cats[c].push(row);
  });
  const summ = {};
  for (const c in cats) {
    summ[c] = [1, 2, 3].map((lag, li) => {
      const v = k => { const xs = cats[c].map(r => r[li] && r[li][k]).filter(x => x != null); return xs.length >= 5 ? { m: mean(xs), n: xs.length } : { m: null, n: xs.length }; };
      return { hrv: v('hrv'), rhr: v('rhr'), ready: v('ready') };
    });
    summ[c].count = cats[c].length;
  }
  return { n: tr.length, q1, q2, summ };
}

// ---- 6. prediction with temporal validation ----
const TARGETS = {
  readiness: { label: 'Morning readiness', unit: '/10', short: 'readiness', def: 'Your self-reported readiness (1–10) in the next morning check-in.', y: (M, i) => { const j = checkinOf(M, M.dates[i]); return j && j.readiness != null ? +j.readiness : null; }, digits: 1 },
  hrv: { label: 'Next-morning HRV', unit: 'SD', short: 'HRV deviation', def: 'Next morning’s overnight HRV (log-transformed) relative to your 4-week median, in robust standard deviations.', y: (M, i) => { const c = M.day[M.dates[i]].cal; return c && c.hrv && c.hrv.z != null && !c.hrv.flag ? c.hrv.z : null; }, digits: 2 },
  rhr: { label: 'Next-morning resting HR', unit: 'bpm', short: 'resting HR deviation', def: 'Next morning’s resting heart rate minus your 4-week median, in beats per minute.', y: (M, i) => { const c = M.day[M.dates[i]].cal; return c && c.rhr && c.rhr.x != null && c.rhr.med != null && !c.rhr.flag ? c.rhr.x - c.rhr.med : null; }, digits: 1 },
};
const FEATURES = {
  yToday: { label: 'Today’s value of the same measure', f: (M, i, T) => T.y(M, i) },
  hrvZ: { label: 'HRV vs baseline this morning', f: (M, i) => { const c = M.day[M.dates[i]].cal; return c && c.hrv && c.hrv.z != null ? c.hrv.z : null; } },
  rhrZ: { label: 'Resting HR vs baseline this morning', f: (M, i) => { const c = M.day[M.dates[i]].cal; return c && c.rhr && c.rhr.z != null ? c.rhr.z : null; } },
  sleepH: { label: 'Sleep last night (h)', f: (M, i) => { const d = M.day[M.dates[i]]; return d.sleepMin != null ? d.sleepMin / 60 : null; } },
  sleep3: { label: 'Sleep, 3-night average (h)', f: (M, i) => { const v = []; for (let k = i - 2; k <= i; k++) { const d = M.day[M.dates[k]]; if (!d || d.sleepMin == null) return null; v.push(d.sleepMin); } return mean(v) / 60; } },
  load1: { label: 'Training load today (log TRIMP)', f: (M, i) => Math.log1p(M.day[M.dates[i]].trimp || 0) },
  load3: { label: 'Training load, last 3 days (log TRIMP)', f: (M, i) => { let s = 0; for (let k = Math.max(0, i - 2); k <= i; k++) s += M.day[M.dates[k]].trimp || 0; return Math.log1p(s); } },
  form: { label: 'Fatigue vs fitness (EWMA 7 / 28 days)', f: (M, i) => { const d = M.day[M.dates[i]]; return d.ewC > 1 ? (d.ewA - d.ewC) / d.ewC : null; } },
  fatigue: { label: 'Reported fatigue this morning', f: (M, i) => { const j = checkinOf(M, M.dates[i]); return j && j.fatigue != null ? +j.fatigue : null; } },
};
function solveRidge(X, y, lam) {
  const n = X.length, p = X[0].length;
  const mu = [], sd = [];
  for (let j = 0; j < p; j++) { const col = X.map(r => r[j]); mu[j] = mean(col); sd[j] = stdev(col) || 1; }
  const Z = X.map(r => r.map((v, j) => (v - mu[j]) / sd[j])), my = mean(y);
  const A = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => { let s = 0; for (let i = 0; i < n; i++) s += Z[i][a] * Z[i][b]; return s + (a === b ? lam : 0); }));
  const bvec = Array.from({ length: p }, (_, a) => { let s = 0; for (let i = 0; i < n; i++) s += Z[i][a] * (y[i] - my); return s; });
  for (let c = 0; c < p; c++) { // Gaussian elimination
    let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [bvec[c], bvec[piv]] = [bvec[piv], bvec[c]];
    for (let r = c + 1; r < p; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < p; k++) A[r][k] -= f * A[c][k]; bvec[r] -= f * bvec[c]; }
  }
  const beta = new Array(p).fill(0);
  for (let r = p - 1; r >= 0; r--) { let s = bvec[r]; for (let k = r + 1; k < p; k++) s -= A[r][k] * beta[k]; beta[r] = s / A[r][r]; }
  return { mu, sd, my, beta, predict: x => my + x.reduce((s, v, j) => s + beta[j] * (v - mu[j]) / sd[j], 0) };
}
function fitRidgeCV(X, y) {
  const nv = Math.max(5, Math.floor(X.length * 0.25)), nt = X.length - nv;
  let best = { lam: 4, err: Infinity };
  if (nt >= 10) for (const lam of [1, 4, 16, 64]) {
    const m = solveRidge(X.slice(0, nt), y.slice(0, nt), lam);
    let e = 0; for (let i = nt; i < X.length; i++) e += Math.abs(m.predict(X[i]) - y[i]);
    if (e < best.err) best = { lam, err: e };
  }
  const m = solveRidge(X, y, best.lam); m.lam = best.lam; return m;
}
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
function metricSet(pairs) {
  if (!pairs.length) return null;
  const e = pairs.map(p => p.pred - p.y);
  const mae = mean(e.map(Math.abs)), rmse = Math.sqrt(mean(e.map(x => x * x)));
  let r = null;
  if (pairs.length >= 5) { const mp = mean(pairs.map(p => p.pred)), my = mean(pairs.map(p => p.y)); let sxy = 0, sxx = 0, syy = 0; for (const p of pairs) { sxy += (p.pred - mp) * (p.y - my); sxx += (p.pred - mp) ** 2; syy += (p.y - my) ** 2; } r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : null; }
  const cov = pairs.filter(p => p.lo != null).length ? pairs.filter(p => p.lo != null && p.y >= p.lo && p.y <= p.hi).length / pairs.filter(p => p.lo != null).length : null;
  return { n: pairs.length, mae, rmse, r, cov };
}
const METHOD_LABEL = { mean: 'Your historical average', last: 'Same as today', roll7: 'Your 7-day average', ridge: 'Personalized model (ridge regression)' };
function runPrediction(M, key) {
  const T = TARGETS[key], ds = M.dates, N = ds.length;
  const yv = ds.map((_, i) => T.y(M, i));
  const fkeys = Object.keys(FEATURES).filter(f => !(key === 'readiness' && f === 'fatigue' ? false : false));
  const feat = (i) => { const o = {}; for (const f of fkeys) o[f] = FEATURES[f].f(M, i, T); return o; };
  const F = ds.map((_, i) => feat(i));
  const MIN_TRAIN = 21, MIN_SEL = 15;
  const oos = { mean: [], last: [], roll7: [], ridge: [], active: [] };
  const resid = { ridge: [], mean: [], last: [], roll7: [] };
  const errHist = { mean: [], last: [], roll7: [], ridge: [] };
  let featSel = null, lastModel = null;
  const allRows = []; for (let j = 0; j < N - 1; j++) if (yv[j + 1] != null) allRows.push(j);
  const rowsUpTo = (i) => { let lo = 0, hi = allRows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (allRows[m] < i) lo = m + 1; else hi = m; } return allRows.slice(0, lo); }; // outcome day j+1 <= i
  const choose = (rows) => fkeys.filter(f => rows.filter(j => F[j][f] != null).length >= 0.7 * rows.length && rows.some(j => F[j][f] !== F[rows[0]][f]));
  const qc = {};
  const pi = (method, pred) => {
    const rs = resid[method]; if (rs.length < 10) return [null, null];
    let c = qc[method];
    if (!c || rs.length - c.n >= 10) { const w = rs.slice(-200); c = qc[method] = { n: rs.length, lo: quant(w, 0.1), hi: quant(w, 0.9) }; }
    return [pred + c.lo, pred + c.hi];
  };
  let final = false;
  const predictAt = (i, rows) => {
    const out = {};
    const past = rows.map(j => yv[j + 1]);
    if (past.length) out.mean = mean(past);
    if (yv[i] != null) out.last = yv[i];
    const r7 = []; for (let k = Math.max(0, i - 6); k <= i; k++) if (yv[k] != null) r7.push(yv[k]); if (r7.length >= 3) out.roll7 = mean(r7);
    if (rows.length >= MIN_TRAIN) {
      if (!featSel || rows.length % 7 === 0) featSel = choose(rows);
      if (featSel.length) {
        const tr = rows.filter(j => featSel.every(f => F[j][f] != null));
        if (tr.length >= MIN_TRAIN && featSel.every(f => F[i][f] != null)) {
          // refit once a week (or when the feature set changes); between refits the last model is reused. Still uses past data only.
          const sig = featSel.join(',');
          if (!lastModel || lastModel.sig !== sig || tr.length - lastModel.n >= 7 || final) lastModel = { m: fitRidgeCV(tr.map(j => featSel.map(f => F[j][f])), tr.map(j => yv[j + 1])), sig, n: tr.length };
          const m = lastModel.m;
          out.ridge = m.predict(featSel.map(f => F[i][f])); out._model = m; out._feats = featSel;
        }
      }
    }
    return out;
  };
  // prequential: at each origin choose the method with the lowest out-of-sample error so far
  const activeAt = () => {
    const cand = ['mean', 'last', 'roll7'].filter(m => errHist[m].length >= MIN_SEL);
    if (!cand.length) return null;
    const mae = m => mean(errHist[m].slice(-90));
    let best = cand.sort((a, b) => mae(a) - mae(b))[0];
    if (errHist.ridge.length >= 20 && mae('ridge') < 0.95 * mae(best)) best = 'ridge';
    return best;
  };
  for (let i = 0; i < N - 1; i++) {
    if (yv[i + 1] == null) continue;
    const rows = rowsUpTo(i); if (rows.length < 5) continue;
    const p = predictAt(i, rows), act = activeAt();
    for (const m of ['mean', 'last', 'roll7', 'ridge']) if (p[m] != null) {
      const [lo, hi] = pi(m, p[m]);
      oos[m].push({ date: ds[i + 1], y: yv[i + 1], pred: p[m], lo, hi });
    }
    if (act && p[act] != null) { const [lo, hi] = pi(act, p[act]); oos.active.push({ date: ds[i + 1], y: yv[i + 1], pred: p[act], lo, hi, method: act }); }
    for (const m of ['mean', 'last', 'roll7', 'ridge']) if (p[m] != null) { errHist[m].push(Math.abs(p[m] - yv[i + 1])); resid[m].push(yv[i + 1] - p[m]); }
  }
  // tomorrow
  const iT = N - 1, rowsT = rowsUpTo(iT); final = true;
  const pT = rowsT.length >= 5 ? predictAt(iT, rowsT) : {};
  const act = activeAt();
  const res = { key, T, n: yv.filter(v => v != null).length, rows: rowsT.length, oos, metrics: {}, version: CAL_VERSION };
  for (const m in oos) res.metrics[m] = metricSet(oos[m]);
  res.recent = {}; for (const m in oos) res.recent[m] = metricSet(oos[m].slice(-60));
  if (!act) { res.status = 'insufficient'; res.need = Math.max(0, MIN_TRAIN + MIN_SEL - rowsT.length); }
  else {
    const method = pT[act] != null ? act : ['roll7', 'last', 'mean'].find(m => pT[m] != null);
    if (method) {
      const [lo, hi] = pi(method, pT[method]);
      res.current = { date: addDays(ds[iT], 1), method, pred: pT[method], lo, hi, fallback: method !== act };
      if (method === 'ridge' && pT._model) {
        const m = pT._model;
        res.current.contrib = pT._feats.map((f, j) => ({ f, label: FEATURES[f].label, v: F[iT][f], c: m.beta[j] * (F[iT][f] - m.mu[j]) / m.sd[j], w: m.beta[j] })).sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
        res.current.lam = m.lam;
      }
    }
    res.status = act === 'ridge' ? 'model' : 'baseline';
    res.active = act;
  }
  if (pT._model) res.weights = pT._feats.map((f, j) => ({ f, label: FEATURES[f].label, w: pT._model.beta[j] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  return res;
}
// genuine prospective log: predictions written on the day they were made, scored once the outcome exists
function loggedAccuracy(M, preds) {
  const out = {};
  for (const key in TARGETS) {
    const pairs = [];
    for (const date in preds) { const e = preds[date][key]; if (!e) continue; const i = M.idx[date]; if (i == null) continue; const y = TARGETS[key].y(M, i); if (y != null) pairs.push({ date, y, pred: e.pred, lo: e.lo, hi: e.hi }); }
    out[key] = metricSet(pairs);
  }
  return out;
}

function calibrate(M, D) {
  if (!M || M.empty) return M;
  const t0 = performance.now ? performance.now() : Date.now();
  const sex = (D.metaApple && D.metaApple.sex) || (D.profile && D.profile.sex) || 'm';
  if (!M.calBase) calBaselines(M);
  calLoad(M, sex);
  calConfidence(M);
  M.cal = { version: CAL_VERSION, sex };
  M.pred = {}; for (const k in TARGETS) M.pred[k] = runPrediction(M, k);
  const preds = {}; for (const m in D.preds || {}) Object.assign(preds, (D.preds[m] && D.preds[m].entries) || {});
  M.predLog = preds; M.predLogged = loggedAccuracy(M, preds);
  M.checkins = M.dates.filter(d => { const j = checkinOf(M, d); return j && j.readiness != null; }).length;
  M.cal.ms = Math.round((performance.now ? performance.now() : Date.now()) - t0);
  return M;
}
