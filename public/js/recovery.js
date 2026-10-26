// ---------- recovery v2: strict, multi-signal, with explicit reasons ----------
// Replaces the first recovery formula (kept as d.recV1 for comparison). Runs after the robust
// baselines in calib.js exist (calBaselines) and after sleep scoring, before enrichModel.
//
// Principles (see the Methods tab for sources):
//  • neutral = 50. Green (≥ 67) needs several signals clearly better than your own normal; red (< 34) means
//    clear signs of strain, illness or missing sleep. The old formula sat at 60 for "nothing special".
//  • one night of Apple Watch HRV is 1–3 spot samples of SDNN and swings ~30% night to night, so the
//    7-night average against a 28-night baseline (Plews et al.) carries most of the HRV weight; a single
//    night only counts in proportion to how many samples it has.
//  • sleeping heart rate (whole-night average and lowest 5-minute value) is sampled all night and is the
//    steadier signal, so it gets a weight close to HRV's.
//  • sleep enters as the sleep score (quantity and quality) plus a 14-night debt.
//  • yesterday's load, breathing rate, wrist temperature, blood oxygen, alcohol and illness can only
//    subtract; nothing is rewarded for being merely normal.
//  • a score is only shown with at least HRV-or-sleeping-HR plus sleep; confidence says what it rests on.

const REC_V = 'rec-2.0';
const REC_W = { hrv: 30, shr: 25, sleep: 25 };   // weights of the three core signals
const REC_SCALE = 40;                              // score = 50 + 40 × core signal (−1.5 … +0.8), minus penalties
const REC_CAP = { hrv: 0.8, shr: 0.7, sleep: 0.9 }; // how much a signal can add when it is better than your normal
const REC_PEN = { load: 12, flags: 12 };            // points taken off per unit of penalty (load ≤ 1, flags ≤ 1.5)

function tanh(x) { const e = Math.exp(2 * x); return (e - 1) / (e + 1); }
const sat = (z, k) => tanh(z / (k || 1.5));   // soft-saturating z → (−1, 1)

// ---- overnight heart-rate curve and "recovery index" (Oura): when did the heart rate reach its night low? ----
// Uses the 5-minute averages of the night. A heart rate that settles early (≥ 6 h of sleep after the low) is the
// mark of a body that was done recovering; a low reached only shortly before waking is typical after late training,
// alcohol, late meals or oncoming illness.
function nightHrCurve(M, d) {
  const s = d && d.sleep; if (!s || !s.ls || !s.le) return null;
  const out = [];
  for (let t = s.ls; t < s.le; t += 5 * 60000) {
    const dayKey = ymd(new Date(t)), a = M.day[dayKey] && M.day[dayKey].a; if (!a || !a.hr5) { out.push(null); continue; }
    const k = Math.floor(minOfDayLms(t) / 5), v = parseInt(a.hr5.substr(k * 2, 2), 16);
    out.push(v || null);
  }
  return out;
}
function recoveryIndex(M, d) {
  const c = nightHrCurve(M, d); if (!c) return null;
  const n = c.length, have = c.filter(x => x != null).length; if (n < 36 || have < n * 0.6) return null;   // ≥ 3 h, ≥ 60% covered
  // 15-minute smoothing, then the first time within 3 bpm of the night's low
  const sm = c.map((v, i) => { const w = [c[i - 1], v, c[i + 1]].filter(x => x != null); return w.length ? mean(w) : null; });
  const lo = Math.min(...sm.filter(x => x != null)); let k = sm.findIndex(x => x != null && x <= lo + 3);
  if (k < 0) return null;
  const afterH = (n - k) * 5 / 60, toLowH = k * 5 / 60;
  return { lowHr: Math.round(lo), toLowH, afterH, pts: clamp((afterH - 3.5) / 2.5, -1, 1) };
}

// relation between HRV and sleeping heart rate over the previous 4 weeks (normally negative: lower HR, higher HRV)
function hrvHrCorr(M, i) {
  const xs = [], ys = [];
  for (let k = Math.max(0, i - 28); k < i; k++) { const x = M.day[M.dates[k]]; const h = x.sleep && x.sleep.hrAvg != null ? x.sleep.hrAvg : x.rhr; if (x.hrv != null && h != null) { xs.push(Math.log(x.hrv)); ys.push(h); } }
  return xs.length >= 12 ? pearson(xs, ys) : null;
}

function recoveryV2(M) {
  const ds = M.dates, N = ds.length;
  for (let i = 0; i < N; i++) {
    const d = M.day[ds[i]], c = d.cal || {}, s = d.sleep, prev = M.day[ds[i - 1]] || null;
    d.recV1 = d.rec; d.recPartsV1 = d.recParts;
    const parts = {}, why = [], miss = [];
    const night = n => (n != null ? M.day[ds[i - n]] : null);

    // ---- 1. HRV: 7-night mean vs 28-night robust baseline (SWC band = 0.5 MAD), plus the night itself ----
    let hrvPts = null;
    if (c.hrv && c.hrv.med != null && c.hrv.n28 >= 10) {
      const mad = Math.max(c.hrv.mad, CAL_FLOOR.hrv);
      const w7 = []; for (let k = Math.max(0, i - 6); k <= i; k++) { const x = M.day[ds[k]]; if (x.hrv != null && !(x.cal && x.cal.hrv && x.cal.hrv.flag)) w7.push(Math.log(x.hrv)); }
      const z7 = w7.length >= 3 ? (mean(w7) - c.hrv.med) / (0.5 * mad) : null;   // 1 = one smallest-worthwhile-change
      // day-to-day variability of HRV (HRV4Training): rising spread with a falling average = struggling to adapt; falling spread = coping
      let cvState = null;
      if (w7.length >= 5) { const w28 = []; for (let k = Math.max(0, i - 27); k < i - 6; k++) { const x = M.day[ds[k]]; if (x.hrv != null) w28.push(Math.log(x.hrv)); }
        if (w28.length >= 10) { const cv7 = stdev(w7), cv28 = stdev(w28) || 0.05; cvState = cv7 > 1.3 * cv28 && z7 != null && z7 < -0.5 ? 'strain' : cv7 < 0.7 * cv28 && z7 != null && z7 >= -0.3 ? 'coping' : 'normal'; } }
      const nS = (s && s.hrvN) || (d.hrv != null ? 1 : 0);
      const zN = d.hrv != null && !c.hrv.flag ? (Math.log(d.hrv) - c.hrv.med) / mad : null;
      // a single Apple Watch night (1–3 SDNN spot samples, ICC ≈ 0.67 vs ECG) modulates, the 7-night mean decides
      const wN = zN == null ? 0 : nS >= 4 ? 0.3 : nS === 3 ? 0.25 : nS === 2 ? 0.2 : 0.1;
      let p7 = z7 != null ? sat(z7, 1.2) : null, pN = zN != null ? sat(zN, 1.5) : null;
      // parasympathetic saturation (Kiviniemi, Buchheit 2014): HRV down while sleeping HR is clearly below normal and
      // HRV no longer rises as HR falls (flat or positive HRV–HR relation over the last 4 weeks) is not fatigue
      const shrZ = c.shr && c.shr.z != null ? c.shr.z : (c.rhr && c.rhr.z != null ? c.rhr.z : null);
      let satNote = false;
      const sc = hrvHrCorr(M, i);
      const satOk = shrZ != null && shrZ <= -1 && (sc == null || sc >= -0.1);
      if (pN != null && pN < 0 && satOk) { pN *= 0.5; satNote = true; }
      if (p7 != null && p7 < 0 && satOk && shrZ <= -1.5) { p7 *= 0.6; satNote = true; }
      // far above the band is not "more recovered" (Vesterinen 2016 treats both sides as a reason to hold back)
      let highNote = false;
      if (p7 != null && z7 > 2.5) { p7 = 0.3; highNote = true; }
      if (p7 != null || pN != null) {
        const w7w = p7 != null ? 1 - wN : 0;
        let pts = ((p7 || 0) * w7w + (pN || 0) * wN) / ((w7w + wN) || 1);
        if (pts > 0) pts = Math.min(pts, REC_CAP.hrv);   // high HRV is not a licence: capped bonus
        hrvPts = pts;
        parts.hrv = { pts, z7, zN, n: nS, w7: w7.length, sat: satNote, cv: cvState };
        why.push({ k: 'hrv', label: 'HRV', pts, val: d.hrv != null ? Math.round(d.hrv) + ' ms' : (w7.length ? 'no reading last night' : '–'),
          text: z7 == null ? 'Not enough nights this week for a trend.' : `7-night average ${z7 >= 1 ? 'above' : z7 <= -1 ? 'below' : 'inside'} your normal band${zN != null ? `; last night ${zN >= 1 ? 'high' : zN <= -1 ? 'low' : 'normal'} (${nS} sample${nS === 1 ? '' : 's'}, ${Math.round(wN * 100)}% weight)` : ''}${satNote ? '. Low HRV with a low sleeping heart rate: treated as rest, not fatigue' : ''}${highNote ? '. Far above your normal: unusual, not a licence to push' : ''}${cvState === 'strain' ? '. HRV is also swinging more than usual while trending down: a pattern of struggling to adapt' : cvState === 'coping' ? '. Steadier than usual: coping well with the load' : ''}.` });
      }
    }
    if (hrvPts == null) miss.push(c.hrv && c.hrv.x != null ? 'HRV baseline still building' : 'no HRV');

    // ---- 2. sleeping heart rate: whole-night average (60%) and lowest 5 min (40%) vs 28-night baseline ----
    let shrPts = null;
    { const za = c.shr && c.shr.z != null ? c.shr.z : null, zl = c.rhr && c.rhr.z != null && !c.rhr.flag ? c.rhr.z : null;
      if (za != null || zl != null) {
        const pa = za != null ? -sat(za, 1.5) : null, pl = zl != null ? -sat(zl, 1.5) : null;
        let pts = pa != null && pl != null ? 0.6 * pa + 0.4 * pl : (pa ?? pl);
        const ri = recoveryIndex(M, d);
        if (ri) pts = 0.8 * pts + 0.2 * ri.pts;              // when the low was reached: early = settled, late = still working
        if (pts > 0) pts = Math.min(pts, REC_CAP.shr);
        shrPts = pts; parts.shr = { pts, za, zl, ri };
        d.recIdx = ri;
        const bad = (za != null && za >= 1) || (zl != null && zl >= 1);
        const lateH = prev && prev.acts && prev.acts.length && s ? Math.min(...prev.acts.map(a => (s.ls - a.le) / 3600000)) : null;
        const lateTxt = lateH != null && lateH >= -0.5 && lateH < 4 && bad ? ` Training ended ${lateH < 1 ? 'under an hour' : lateH.toFixed(1) + ' h'} before bed; a raised sleeping heart rate is expected after that (effect gone when a session ends ≥ 4 h before sleep).` : '';
        const riTxt = (ri ? (ri.afterH >= 6 ? ` Lowest point reached early (${ri.afterH.toFixed(1)} h of sleep after it).` : ri.afterH <= 2 ? ` It only reached its low ${ri.afterH.toFixed(1)} h before you woke: the body was still working for most of the night.` : ` Low reached with ${ri.afterH.toFixed(1)} h of sleep left.`) : '') + lateTxt;
        why.push({ k: 'shr', label: 'Sleeping heart rate', pts, val: `${s && s.hrAvg != null ? s.hrAvg + ' avg' : ''}${d.rhr != null ? (s && s.hrAvg != null ? ' · ' : '') + d.rhr + ' low' : ''} bpm`,
          text: (bad ? `Higher than your normal (${za != null ? 'average +' + za.toFixed(1) : 'lowest +' + zl.toFixed(1)} SD): the usual mark of a hard day, alcohol, heat or oncoming illness.` : pts > 0.2 ? 'Lower than usual: your heart is settling well at night.' : 'Within your normal range.') + riTxt });
      }
    }
    if (shrPts == null) miss.push(c.rhr && c.rhr.x != null ? 'sleeping-HR baseline still building' : 'no sleeping heart rate');

    // ---- 3. sleep: score (quantity + quality) and 14-night debt ----
    let sleepPts = null;
    if (d.sleepMin != null) {
      const sc = d.sleepScore != null ? d.sleepScore : Math.round(clamp(d.perf, 0, 1) * 100);
      let pts = clamp((sc - 78) / 20, -1.5, 1);             // 98 → +1, 78 → 0, 58 → −1, ≤ 48 → −1.5
      if (pts > 0) pts = Math.min(pts, REC_CAP.sleep);
      const debtH = (d.debt14 || 0) / 60;
      const debtPen = debtH > 1 ? -Math.min(0.6, (debtH - 1) * 0.15) : 0;   // −0.15 per hour beyond 1 h behind
      pts = Math.max(-1.5, pts + debtPen);
      sleepPts = pts; parts.sleep = { pts, score: sc, debtH, debtPen };
      why.push({ k: 'sleep', label: 'Sleep', pts, val: `${fmtHM(d.sleepMin)} h · score ${sc}`,
        text: `${sc >= 90 ? 'A full, good night.' : sc >= 80 ? 'A decent night.' : sc >= 65 ? 'Short or broken sleep.' : 'Clearly too little or poor sleep.'}${debtPen < 0 ? ` You are ${fmtHM(d.debt14)} h behind over the last 2 weeks.` : ''}` });
    } else miss.push('no sleep recorded');

    // ---- 4. yesterday's load vs your average day over the last 4 weeks (rest days included), lingering for 2 days ----
    let loadPts = 0;
    { let sum = 0, n = 0; for (let k = Math.max(0, i - 28); k < i; k++) { const x = M.day[ds[k]]; if (x.a || x.acts.length) { sum += x.load || 0; n++; } }
      const avg = n >= 10 ? sum / n : null;
      const yl = prev && prev.load != null ? prev.load : null, y2 = night(2) && night(2).load != null ? night(2).load : null;
      if (avg != null && avg > 20 && yl != null) {
        const r1 = yl / avg, r2 = y2 != null ? y2 / avg : 0;
        const pen = r => r > 2 ? -Math.min(1, (r - 2) / 2.5) : 0;      // 2× an average day starts to count; 4.5× is the full penalty
        loadPts = Math.max(-1, pen(r1) + 0.4 * pen(r2));
        parts.load = { pts: loadPts, r1, r2, yStrain: prev.strain };
        if (loadPts < 0) why.push({ k: 'load', label: 'Yesterday’s load', pts: loadPts, val: prev.strain != null ? 'strain ' + prev.strain.toFixed(1) : '', text: `${r1 > 2 ? `Yesterday carried ${r1.toFixed(1)}× your average day’s load` : 'The day before yesterday was heavy'}; the body is still paying for it.` });
      }
    }

    // ---- 5. flags: breathing rate, wrist temperature, SpO2, alcohol, illness ----
    let flagPts = 0; const flags = [];
    if (c.resp && c.resp.z != null && c.resp.z >= 1.5) { const p = -Math.min(1, 0.2 + (c.resp.z - 1.5) / 2); flagPts += p; flags.push({ k: 'resp', label: 'Breathing rate', pts: p, val: d.resp.toFixed(1) + ' rpm', text: `Up ${c.resp.z.toFixed(1)} SD on your usual: a common early sign of illness or heavy fatigue.` }); }
    if (c.temp && c.temp.z != null && c.temp.z >= 2 && d.tempDev != null && d.tempDev >= 0.25) { const p = -Math.min(1, (d.tempDev - 0.2) / 0.5); flagPts += p; flags.push({ k: 'temp', label: 'Wrist temperature', pts: p, val: '+' + d.tempDev.toFixed(2) + ' °C', text: 'Clearly above your baseline overnight.' }); }
    if (d.spo2 != null && d.spo2 < 93) { const p = -Math.min(0.8, (93 - d.spo2) / 4); flagPts += p; flags.push({ k: 'spo2', label: 'Blood oxygen', pts: p, val: Math.round(d.spo2) + '%', text: 'Lower than normal during sleep.' }); }
    const J = M.journal || {}, jy = J[addDays(d.date, -1)] || {}, jt = J[d.date] || {};
    if (jy.alcohol) { flagPts -= 0.35; flags.push({ k: 'alcohol', label: 'Alcohol', pts: -0.35, val: 'last night', text: 'Alcohol raises sleeping heart rate and cuts HRV for most of the night, even when the numbers look only slightly off.' }); }
    const sickPlan = M.plan && M.plan.sickOn ? M.plan.sickOn(d.date) : null;
    const sick = !!(jt.sick || jy.sick || sickPlan);
    const sickNow = !!(jt.sick || sickPlan), sickYday = !sickNow && !!jy.sick;
    if (sickNow) flags.push({ k: 'sick', label: sickPlan && sickPlan.type === 'injury' ? 'Injured' : 'Sick', pts: -1, val: '', text: 'Marked sick or injured: recovery is capped at red regardless of the numbers.' });
    else if (sickYday) flags.push({ k: 'sick', label: 'Sick yesterday', pts: -0.5, val: '', text: 'The day after being sick: capped at yellow. Ease back in.' });
    if (jt.stress >= 5 || jy.stress >= 5) { flagPts -= 0.2; flags.push({ k: 'stress', label: 'Stress', pts: -0.2, val: '5/5', text: 'Very high reported stress.' }); }
    flagPts = Math.max(-1.5, flagPts);
    why.push(...flags);

    // ---- combine: nominal weights, re-normalised over what is present; nothing scored without physiology + sleep ----
    const have = { hrv: hrvPts != null, shr: shrPts != null, sleep: sleepPts != null };
    const physio = have.hrv || have.shr;
    if (!physio || !have.sleep) {
      d.rec = null; d.recParts = null; d.recWhy = null; d.recMissing = miss; d.calibrating = physio || have.sleep;
      continue;
    }
    // core: weighted mean of HRV, sleeping HR and sleep. If HRV is missing its weight moves to sleeping HR (and vice versa).
    const core = (REC_W.hrv * (have.hrv ? hrvPts : shrPts) + REC_W.shr * (have.shr ? shrPts : hrvPts) + REC_W.sleep * sleepPts) / (REC_W.hrv + REC_W.shr + REC_W.sleep);
    const penalty = REC_PEN.load * loadPts + REC_PEN.flags * flagPts;   // both ≤ 0
    let rec = clamp(Math.round(50 + REC_SCALE * core + penalty), 3, 97);
    if (sickNow) rec = Math.min(rec, 30); else if (sickYday) rec = Math.min(rec, 45);
    d.rec = rec; d.recCore = core; d.recPenalty = penalty; d.recParts = parts; d.recWhy = why.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)); d.recMissing = miss; d.calibrating = false;
    d.recParts.flags = flagPts;
  }
  M.recVersion = REC_V;
  return M;
}

// buildModel → scoreModel → enrichModel → calibrate
function scoreModel(M, D) {
  if (!M || M.empty) return M;
  calBaselines(M);
  recoveryV2(M);
  M.insights = journalInsights(M.journal, M.day);   // journal effects use the recovery score
  return M;
}

// ---- how the recovery score relates to how you actually felt (morning check-ins) ----
function pearson(xs, ys) { const n = xs.length; if (n < 3) return null; const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null; }
function recoveryEval(M, days) {
  days = days || 60;
  const rows = [];
  for (const k of M.dates) { const d = M.day[k], j = M.journal && M.journal[k]; if (d.rec != null && j && j.readiness != null) rows.push({ k, rec: d.rec, v1: d.recV1, ready: +j.readiness, fat: j.fatigue != null ? +j.fatigue : null, sore: j.soreness != null ? +j.soreness : null }); }
  const R = rows.map(r => r.ready);
  const out = { n: rows.length, r2: pearson(rows.map(r => r.rec), R), r1: rows.some(r => r.v1 == null) ? null : pearson(rows.map(r => r.v1), R) };
  const wf = rows.filter(r => r.fat != null); out.nFat = wf.length; out.r2fat = pearson(wf.map(r => r.rec), wf.map(r => -r.fat)); out.r1fat = wf.some(r => r.v1 == null) ? null : pearson(wf.map(r => r.v1), wf.map(r => -r.fat));
  // agreement of bands: green days with readiness ≥ 7, red days with readiness ≤ 4
  const z = r => recoveryZone(r.rec);
  const g = rows.filter(r => z(r) === 'hi'), rd = rows.filter(r => z(r) === 'lo');
  out.greenOk = g.length ? g.filter(r => r.ready >= 7).length / g.length : null; out.nGreen = g.length;
  out.redOk = rd.length ? rd.filter(r => r.ready <= 4).length / rd.length : null; out.nRed = rd.length;
  // distribution over the last N days
  const rec = M.dates.filter(k => daysBetween(k, M.today) < days).map(k => M.day[k].rec).filter(x => x != null);
  out.dist = { n: rec.length, green: rec.filter(x => x >= 67).length, yellow: rec.filter(x => x >= 34 && x < 67).length, red: rec.filter(x => x < 34).length, median: rec.length ? median(rec) : null };
  const v1 = M.dates.filter(k => daysBetween(k, M.today) < days).map(k => M.day[k].recV1).filter(x => x != null);
  out.distV1 = { n: v1.length, green: v1.filter(x => x >= 67).length, yellow: v1.filter(x => x >= 34 && x < 67).length, red: v1.filter(x => x < 34).length, median: v1.length ? median(v1) : null };
  return out;
}
