// ---------- insights: training status, recovery contributors, sleep coach, weekly report ----------
// Runs after buildModel. Everything is derived from per-day load, HRV, resting HR, recovery and sleep.

const STATUS = {
  building: { label: 'Building baseline', tone: 'neutral' },
  productive: { label: 'Productive', tone: 'good' },
  maintaining: { label: 'Maintaining', tone: 'neutral' },
  ramping: { label: 'Ramping fast', tone: 'warn' },
  strained: { label: 'Strained', tone: 'warn' },
  overreaching: { label: 'Overreaching', tone: 'bad' },
  recovering: { label: 'Recovering', tone: 'neutral' },
  detraining: { label: 'Detraining', tone: 'warn' },
};

function enrichModel(M) {
  if (!M || M.empty) return M;
  const ds = M.dates, N = ds.length;
  M.idx = {}; ds.forEach((d, i) => { M.idx[d] = i; });
  // Banister fitness (42-day) and fatigue (7-day), exponentially weighted
  const kC = 1 - Math.exp(-1 / 42), kA = 1 - Math.exp(-1 / 7);
  let ctl = 0, atl = 0;
  for (let i = 0; i < N; i++) {
    const d = M.day[ds[i]], L = d.load || 0;
    ctl += (L - ctl) * kC; atl += (L - atl) * kA;
    d.ctl = ctl; d.atl = atl; d.tsb = ctl - atl;
  }
  // rolling physiology: 7-day means vs 60-day baselines (log HRV, Plews-style smallest worthwhile change)
  for (let i = 0; i < N; i++) {
    const d = M.day[ds[i]];
    const w7 = [], w60 = [], r7 = [], r60 = [], rec7 = [];
    for (let k = Math.max(0, i - 59); k <= i; k++) {
      const x = M.day[ds[k]];
      if (x.hrv != null) { w60.push(Math.log(x.hrv)); if (k > i - 7) w7.push(Math.log(x.hrv)); }
      if (x.rhr != null) { r60.push(x.rhr); if (k > i - 7) r7.push(x.rhr); }
      if (k > i - 7 && x.rec != null) rec7.push(x.rec);
    }
    d.hrv7 = w7.length >= 3 ? Math.exp(mean(w7)) : null;
    if (w60.length >= 14) { const m = mean(w60), sd = stdev(w60) || 0.05; d.hrvBand = [Math.exp(m - 0.5 * sd), Math.exp(m), Math.exp(m + 0.5 * sd)]; }
    // two-sided band (Vesterinen 2016: the 7-day average outside mean ± 0.5 SD, above OR below, is a reason to hold back;
    // Garmin's HRV Status calls both "Unbalanced"). The day counter says how long it has been outside.
    d.hrvState = d.hrv7 != null && d.hrvBand ? (d.hrv7 < d.hrvBand[0] ? 'below' : d.hrv7 > d.hrvBand[2] ? 'above' : 'inside') : null;
    const pv = i > 0 ? M.day[ds[i - 1]] : null;
    d.hrvOutDays = d.hrvState && d.hrvState !== 'inside' ? (pv && pv.hrvState === d.hrvState ? (pv.hrvOutDays || 0) + 1 : 1) : 0;
    // day-to-day spread of the last 7 nights (HRV4Training's coefficient of variation): a rising CV with a falling average = struggling to adapt
    d.hrvCv7 = w7.length >= 5 ? stdev(w7) * 100 : null;   // SD of log(HRV) × 100 ≈ CV in %
    d.rhr7 = r7.length >= 3 ? mean(r7) : null;
    if (r60.length >= 14) { const m = mean(r60), sd = stdev(r60) || 1; d.rhrBand = [m - Math.max(1, 0.5 * sd), m, m + Math.max(1, 0.5 * sd)]; }
    d.rec7 = rec7.length >= 3 ? mean(rec7) : null;
  }
  return M;
}

function dayAt(M, date, off) { return M.day[addDays(date, off)] || null; }

function trainingStatus(M, date) {
  const d = M.day[date]; const i = M.idx ? M.idx[date] : null;
  if (!d || i == null) return null;
  const loaded = M.dates.slice(Math.max(0, i - 41), i + 1).filter(k => (M.day[k].load || 0) > 0).length;
  const d7 = dayAt(M, date, -7), d21 = dayAt(M, date, -21), d14 = dayAt(M, date, -14);
  const ramp = d7 && d7.ctl > 1 ? (d.ctl - d7.ctl) / d7.ctl : null;
  const acwr = d.acwr;
  // physiology flags
  const hrvFlag = d.hrv7 != null && d.hrvBand ? (d.hrv7 < d.hrvBand[0] ? 'low' : d.hrv7 > d.hrvBand[2] ? 'high' : 'normal') : null;
  const rhrFlag = d.rhr7 != null && d.rhrBand ? (d.rhr7 > d.rhrBand[2] ? 'high' : d.rhr7 < d.rhrBand[0] ? 'low' : 'normal') : null;
  const physioKnown = hrvFlag != null || rhrFlag != null || d.rec7 != null;
  const physioBad = hrvFlag === 'low' || rhrFlag === 'high' || (d.rec7 != null && d.rec7 < 40);
  // sleep over the last 7 nights
  let sDebt = 0, sN = 0;
  for (let k = 0; k < 7; k++) { const x = dayAt(M, date, -k); if (x && x.sleepMin != null) { sN++; sDebt += Math.max(0, (x.need || M.prof.needBase) - x.sleepMin); } }

  const signals = [];
  signals.push({ k: 'Load ratio (7 vs 28 days)', v: acwr != null ? acwr.toFixed(2) : '–', tone: acwr == null ? 'neutral' : acwr > 1.5 ? 'bad' : acwr > 1.3 || acwr < 0.8 ? 'warn' : 'good', t: acwr == null ? 'Needs 2 weeks of data' : acwr > 1.5 ? 'Load spike' : acwr > 1.3 ? 'Well above your usual load' : acwr < 0.8 ? 'Below your usual load' : 'Close to your usual load' });
  signals.push({ k: 'Fitness trend (42-day load)', v: ramp != null ? (ramp >= 0 ? '+' : '−') + Math.abs(ramp * 100).toFixed(0) + '%/wk' : '–', tone: ramp == null ? 'neutral' : ramp > 0.12 ? 'warn' : ramp > 0.01 ? 'good' : ramp < -0.05 ? 'warn' : 'neutral', t: ramp == null ? '' : ramp > 0.12 ? 'Building quickly' : ramp > 0.01 ? 'Building' : ramp < -0.05 ? 'Dropping' : 'Holding steady' });
  const outD = d.hrvOutDays ? ` for ${d.hrvOutDays} day${d.hrvOutDays > 1 ? 's' : ''}` : '';
  signals.push({ k: 'HRV (7-day average)', v: d.hrv7 != null ? Math.round(d.hrv7) + ' ms' : '–', tone: hrvFlag === 'low' ? 'bad' : hrvFlag === 'high' ? 'warn' : hrvFlag ? 'good' : 'neutral', t: hrvFlag == null ? 'Needs 2 weeks of overnight HRV' : hrvFlag === 'low' ? `Below your normal ${Math.round(d.hrvBand[0])}–${Math.round(d.hrvBand[2])} ms${outD}` : hrvFlag === 'high' ? `Above your normal ${Math.round(d.hrvBand[0])}–${Math.round(d.hrvBand[2])} ms${outD}: unusual, not a licence to push` : 'Inside your normal range' });
  signals.push({ k: 'Resting HR (7-day average)', v: d.rhr7 != null ? Math.round(d.rhr7) + ' bpm' : '–', tone: rhrFlag === 'high' ? 'bad' : rhrFlag ? 'good' : 'neutral', t: rhrFlag == null ? 'Needs 2 weeks of data' : rhrFlag === 'high' ? `Above your normal ${Math.round(d.rhrBand[0])}–${Math.round(d.rhrBand[2])} bpm` : 'Inside your normal range' });
  signals.push({ k: 'Sleep debt (7 nights)', v: sN ? fmtHM(sDebt) + ' h' : '–', tone: !sN ? 'neutral' : sDebt > 300 ? 'bad' : sDebt > 150 ? 'warn' : 'good', t: !sN ? 'No sleep data this week' : sN < 5 ? `From ${sN} recorded nights` : sDebt > 300 ? 'Large shortfall' : sDebt > 150 ? 'Some shortfall' : 'Close to your need' });

  let key;
  if (i < 27 || loaded < 8 || d.ctl < 3) key = 'building';
  else if (acwr != null && acwr > 1.5) key = 'overreaching';
  else if (acwr != null && acwr > 1.3) key = physioBad ? 'overreaching' : 'ramping';
  else if (acwr != null && acwr >= 0.8 && physioBad) key = 'strained';
  else if (acwr != null && acwr >= 1.05 && (ramp == null || ramp > 0)) key = 'productive';
  else if (acwr != null && acwr >= 0.8) key = 'maintaining';
  else {
    const longLow = d14 && d14.acwr != null && d14.acwr < 0.85;
    const dropped = d21 && d21.ctl > 0 && d.ctl < d21.ctl * 0.85;
    key = longLow && dropped ? 'detraining' : 'recovering';
  }
  const TEXT = {
    building: ['Baseline needs about 4 weeks of training data before the app can judge your load.', 'Keep syncing workouts. The verdict appears once there is enough history.'],
    productive: ['Your recent load is above your usual level and your body is handling it. This is where fitness is built.', 'Keep going, and protect sleep. Plan a lighter week every 3–4 weeks.'],
    maintaining: ['You are training at about your usual level. Fitness holds steady but won\'t grow much.', 'To build fitness, add a little volume or one more quality session per week.'],
    ramping: ['Load has jumped well above what you are used to. Your body still looks fine, but load is rising faster than your fitness can follow.', 'Hold this level for a week before adding more, and keep easy days truly easy.'],
    strained: ['Your load is normal, but recovery signals are down. Your body isn\'t absorbing the training right now.', 'Take 1–2 easy days, prioritise sleep, and check for illness, stress or alcohol.'],
    overreaching: ['Load is far above your usual level' + (physioBad ? ', and HRV, resting heart rate or recovery show it.' : '.') + ' If this continues, fatigue is likely to keep building.', 'Cut volume by a third this week and keep only one hard session until recovery is back in the green.'],
    recovering: ['Load is below your usual level, so fatigue is clearing and you should feel fresh. Good before a test or race, or after a hard block.', 'If this isn\'t a planned easy week, get back to your normal routine soon.'],
    detraining: ['Load has been low for over 2 weeks and your fitness level is dropping.', 'Start back gradually: about 70% of your previous weekly load in the first week.'],
  };
  return { key, ...STATUS[key], summary: TEXT[key][0], advice: TEXT[key][1], signals, physioKnown, acwr, ramp, hrvFlag, rhrFlag, sleepDebt7: sN ? sDebt : null };
}

function recoveryContributors(d) {
  if (!d || !d.recParts) return [];
  const p = d.recParts, out = [];
  const add = (k, label, z, sign, weight, val) => out.push({ k, label, z: z * sign, weight, val, tone: z * sign >= 0.3 ? 'good' : z * sign <= -0.3 ? 'bad' : 'neutral' });
  if (p.hrv != null) add('hrv', 'Heart-rate variability', p.hrv, 1, 50, d.hrv != null ? Math.round(d.hrv) + ' ms' : '');
  if (p.rhr != null) add('rhr', 'Resting heart rate', p.rhr, -1, 25, d.rhr != null ? d.rhr + ' bpm' : '');
  if (p.sleep != null) add('sleep', 'Sleep performance', p.sleep, 1, 15, d.perf != null ? Math.round(d.perf * 100) + '%' : '');
  if (p.resp != null) add('resp', 'Respiratory rate', p.resp, -1, 10, d.resp != null ? d.resp.toFixed(1) + ' rpm' : '');
  return out;
}

function circMeanMin(arr) { // clock minutes, circular mean
  if (!arr.length) return null;
  let sx = 0, sy = 0; for (const m of arr) { const a = m / 1440 * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); }
  let a = Math.atan2(sy / arr.length, sx / arr.length); if (a < 0) a += 2 * Math.PI;
  return a / (2 * Math.PI) * 1440;
}
function circSdMin(arr, m) { if (arr.length < 2) return null; let s = 0; for (const x of arr) { let dlt = Math.abs(x - m) % 1440; if (dlt > 720) dlt = 1440 - dlt; s += dlt * dlt; } return Math.sqrt(s / arr.length); }

function sleepCoach(M, date, n) {
  n = n || 7;
  const nights = [];
  for (let k = n - 1; k >= 0; k--) { const x = dayAt(M, date, -k); if (x && x.sleepMin != null) nights.push(x); }
  if (!nights.length) return null;
  const detailed = nights.filter(x => x.sleep);
  const beds = detailed.map(x => minOfDayLms(x.sleep.ls)), wakes = detailed.map(x => minOfDayLms(x.sleep.le));
  const bedM = circMeanMin(beds), wakeM = circMeanMin(wakes);
  const r = {
    n: nights.length, detailed: detailed.length,
    avgAsleep: mean(nights.map(x => x.sleepMin)), avgNeed: mean(nights.map(x => x.need)),
    debt: (nights[nights.length - 1].debt14 != null ? nights[nights.length - 1].debt14 : nights.reduce((a, x) => a + Math.max(0, x.need - x.sleepMin), 0)),
    debtRaw: nights.reduce((a, x) => a + Math.max(0, x.need - x.sleepMin), 0),
    avgPerf: mean(nights.map(x => x.perf)),
    bed: bedM, wake: wakeM, bedSd: circSdMin(beds, bedM), wakeSd: circSdMin(wakes, wakeM),
    cons: detailed.filter(x => x.cons != null).length ? mean(detailed.filter(x => x.cons != null).map(x => x.cons)) : null,
    eff: detailed.filter(x => x.eff != null).length ? mean(detailed.filter(x => x.eff != null).map(x => x.eff)) : null,
    restor: detailed.length ? mean(detailed.map(x => (x.sleep.deep + x.sleep.rem) / Math.max(1, x.sleep.asleep))) : null,
    deep: detailed.length ? mean(detailed.map(x => x.sleep.deep)) : null,
    rem: detailed.length ? mean(detailed.map(x => x.sleep.rem)) : null,
  };
  // sleep vs next-day recovery over the last 90 days
  const good = [], short = [];
  for (let k = 0; k < 90; k++) { const x = dayAt(M, date, -k); if (!x || x.rec == null || x.perf == null) continue; (x.perf >= 0.9 ? good : x.perf < 0.8 ? short : []).push(x.rec); }
  if (good.length >= 3 && short.length >= 3) r.recGap = { good: mean(good), short: mean(short), n: good.length + short.length };
  const tips = [];
  if (r.debt > 180) tips.push({ tone: 'bad', t: `Sleep debt of ${fmtHM(r.debt)} h over the last two weeks. Pay it back over several nights by going to bed 30–45 minutes earlier; one long lie-in repays at most 1½ h.` });
  else if (r.debt > 60) tips.push({ tone: 'warn', t: `A small sleep debt of ${fmtHM(r.debt)} h. One earlier night would clear most of it.` });
  else tips.push({ tone: 'good', t: `You met your sleep need on average this week (${fmtHM(r.avgAsleep)} asleep vs ${fmtHM(r.avgNeed)} needed).` });
  if (r.bedSd != null && r.bedSd > 45) tips.push({ tone: 'warn', t: `Your bedtime varied by about ±${Math.round(r.bedSd)} minutes. A steady bedtime (within ±30 min) improves sleep quality and HRV.` });
  else if (r.bedSd != null) tips.push({ tone: 'good', t: `Consistent bedtime: about ${fmtClock(r.bed, true)}, varying by ±${Math.round(r.bedSd)} minutes.` });
  if (r.restor != null && r.restor < 0.35) tips.push({ tone: 'warn', t: `Restorative sleep (deep + REM) was ${Math.round(r.restor * 100)}% of the night; 40–50% is typical. Late meals, alcohol and evening hard sessions reduce it.` });
  if (r.eff != null && r.eff < 0.85) tips.push({ tone: 'warn', t: `Sleep efficiency was ${Math.round(r.eff * 100)}%: a lot of time in bed awake. Go to bed only when sleepy, and keep the phone out of bed.` });
  // time to fall asleep (Oura: 15–20 min is normal; much longer points to stress, screens or caffeine; the Watch only sees it once it detects you in bed)
  const lats = detailed.filter(x => x.latency != null).map(x => x.latency);
  if (lats.length >= 3) { r.latency = median(lats); if (r.latency >= 25) tips.push({ tone: 'warn', t: `It took you about ${Math.round(r.latency)} minutes to fall asleep most nights. 15–20 is normal; longer usually means a late screen, caffeine after 2 pm, a late hard session or a busy head. Wind down 30 min before bed.` }); }
  // a teenager's need is higher than an adult's (AASM: 8–10 h at 13–18)
  if (M.prof.age != null && M.prof.age < 18 && r.avgAsleep < 8 * 60) tips.push({ tone: r.avgAsleep < 7.5 * 60 ? 'bad' : 'warn', t: `Average ${fmtHM(r.avgAsleep)} h asleep. At ${M.prof.age} the recommendation is 8–10 h a night (AASM); for an athlete in school 8½–9½ h is the target, and short sleep is linked to more injuries in young athletes.` });
  if (r.recGap && r.recGap.good - r.recGap.short >= 5) tips.push({ tone: 'neutral', t: `When you sleep at least 90% of your need, your next-day recovery averages ${Math.round(r.recGap.good)}%, compared with ${Math.round(r.recGap.short)}% after short nights.` });
  // social jet lag: sleep midpoint on free days vs work days (Wittmann 2006); > 1 h is associated with worse sleep and metabolic health
  const mids = { wd: [], we: [] };
  for (let k = 0; k < 14; k++) { const x = dayAt(M, date, -k); if (!x || !x.sleep) continue; const wd = parseYmd(x.date).getDay(); (wd === 0 || wd === 6 ? mids.we : mids.wd).push((minOfDayLms((x.sleep.ls + x.sleep.le) / 2) - 720 + 1440) % 1440); }
  if (mids.wd.length >= 4 && mids.we.length >= 2) { r.jetlag = Math.round(mean(mids.we) - mean(mids.wd)); if (Math.abs(r.jetlag) >= 60) tips.push({ tone: 'warn', t: `Social jet lag: your sleep midpoint is ${Math.abs(r.jetlag)} min ${r.jetlag > 0 ? 'later' : 'earlier'} on weekends than on weekdays. Keep the shift under an hour; the Monday-morning lag is real.` }); }
  r.tips = tips;
  return r;
}

// ---- tonight: when to be in bed (WHOOP Sleep Planner / Garmin Sleep Coach idea) ----
// Wake time = your usual wake-up on that kind of day (school/work days Mon–Fri vs free days) over the last 3 weeks.
// Need = baseline + today's strain + a share of the 2-week debt + 15 min before a key session or test.
// Bed = wake − need ÷ efficiency − time to fall asleep. Three levels like WHOOP: all of it (100%), 85%, 70% ("get by").
function sleepPlanner(d, M) {
  const tomorrow = addDays(d.date, 1), wdT = parseYmd(tomorrow).getDay(), freeT = wdT === 0 || wdT === 6;
  const ws = [], all = [], effs = [], lats = [];
  for (let i = 0; i < 21; i++) {
    const x = M.day[addDays(d.date, -i)]; if (!x || !x.sleep) continue;
    const wd = parseYmd(x.date).getDay(), free = wd === 0 || wd === 6, w = minOfDayLms(x.sleep.le);
    all.push(w); if (free === freeT) ws.push(w);
    if (i < 7) { if (x.eff) effs.push(x.eff); if (x.latency != null) lats.push(x.latency); }
  }
  if (!all.length) return null;
  const wake = ws.length >= 3 ? median(ws) : median(all);
  const keys = M.plan && M.plan.sessions ? M.plan.sessions.filter(s => s.date === tomorrow && !s.isRest && ['hard', 'key', 'test', 'race'].includes(s.intensity)) : [];
  const keyAdj = keys.length ? 15 : 0;
  const debtPart = d.debt14 ? Math.min(60, Math.round(d.debt14 * 0.25)) : 0;
  const need = M.prof.needBase + (d.strain != null ? Math.max(0, d.strain - 10) * 3 : 0) + debtPart + keyAdj;
  const eff = effs.length ? clamp(mean(effs), 0.75, 0.98) : 0.9;
  const latency = lats.length ? clamp(median(lats), 5, 40) : 10;
  const bedFor = n => (wake - n / eff - latency + 1440 * 2) % 1440;
  return { need, wake, wakeSrc: ws.length >= 3 ? (freeT ? 'free days' : 'school days') : 'recent days', eff, latency, bed: bedFor(need),
    levels: { peak: bedFor(need), perform: bedFor(need * 0.85), getBy: bedFor(need * 0.7) }, keySession: keys[0] || null, debtPart, keyAdj };
}

// ---- week shape (Foster 1998): monotony = mean ÷ SD of the daily load over 7 days, strain = weekly load × monotony.
// Illness and overtraining followed strain spikes and monotonous weeks (the same load every day), not high load as such.
// "Easy load for tomorrow" (Runalyze): the most load tomorrow can carry without form (fitness − fatigue) dropping below zero.
function weekShape(M, date) {
  const d = M.day[date]; if (!d) return null;
  const loads = []; for (let k = 6; k >= 0; k--) { const x = dayAt(M, date, -k); loads.push(x ? (x.load || 0) : 0); }
  const sum = loads.reduce((a, b) => a + b, 0), m = sum / 7, sd = stdev(loads);
  if (sum < 50) return null;
  const monotony = sd > 0 ? m / sd : (m > 0 ? 7 : 0);
  const strain = sum * monotony;
  // the last 8 weeks for context
  const hist = []; for (let w = 1; w <= 8; w++) { const end = addDays(date, -7 * w); const ls = []; for (let k = 6; k >= 0; k--) { const x = dayAt(M, end, -k); ls.push(x ? (x.load || 0) : 0); } const s2 = ls.reduce((a, b) => a + b, 0); if (s2 >= 50) { const mm = s2 / 7, sd2 = stdev(ls); hist.push({ sum: s2, monotony: sd2 > 0 ? mm / sd2 : 7, strain: s2 * (sd2 > 0 ? mm / sd2 : 7) }); } }
  const medStrain = hist.length >= 3 ? median(hist.map(h => h.strain)) : null;
  const kC = 1 - Math.exp(-1 / 42), kA = 1 - Math.exp(-1 / 7);
  const easy = d.ctl != null ? Math.max(0, (d.ctl * (1 - kC) - d.atl * (1 - kA)) / (kA - kC)) : null;
  const restDays = loads.filter(l => l < Math.max(15, m * 0.25)).length;
  let tone = 'good', word = 'varied';
  if (monotony >= 2 && (medStrain == null || strain > medStrain * 1.3)) { tone = 'bad'; word = 'monotonous and heavy'; }
  else if (monotony >= 2) { tone = 'warn'; word = 'monotonous'; }
  else if (medStrain != null && strain > medStrain * 1.5) { tone = 'warn'; word = 'a strain spike'; }
  const text = tone === 'good' ? `Load varied day to day (monotony ${monotony.toFixed(1)}, ${restDays} light day${restDays === 1 ? '' : 's'}): the shape that keeps illness away.`
    : word === 'a strain spike' ? `Weekly strain ${Math.round(strain)} is ${Math.round(strain / medStrain * 100 - 100)}% above your usual week. Spikes like this, more than high load itself, preceded illness in Foster's athletes; keep next week flat.`
    : `Monotony ${monotony.toFixed(1)}: nearly the same load every day${restDays ? '' : ', no light day'}. Above 2 is where Foster saw illness and staleness rise. Make the hard day harder and the easy days easier rather than averaging them.`;
  return { loads, sum, mean: m, sd, monotony, strain, medStrain, easy, easyStrain: easy != null ? strainOf(easy) : null, restDays, tone, word, text };
}

// ---- aerobic efficiency and durability: metres per heartbeat on steady runs, and HR drift on the long ones ----
// Efficiency factor (TrainingPeaks): speed ÷ average heart rate on steady aerobic runs; rising over a block = aerobic fitness improving.
// Decoupling / drift bands (Friel): ≤ 5 % sound aerobic endurance, 5–10 % moderate limitation or fatigue, > 10 % above the aerobic threshold or lacking endurance.
function efficiencyTrend(M, date, days) {
  days = days || 120;
  const rows = [];
  for (const a of M.acts) {
    if (a.sport !== 'run' || a.date > date || daysBetween(a.date, date) > days) continue;
    const mov = a.movS || a.durS; if (!a.avgHr || !a.distM || a.distM < 3000 || mov < 25 * 60) continue;
    const z = a.hb ? zonesFromHist(a.hb, M.prof.hrMax, M.prof.zones) : null, zt = z ? z.reduce((x, y) => x + y, 0) : 0;
    const hard = zt ? (z[3] + z[4]) / zt : null;
    if (hard != null && hard > 0.15) continue;                  // intervals and races are not steady
    if (a.an && a.an.segs && a.an.segs.length > 1) continue;     // several efforts found in the pace data
    const speed = a.distM / mov;                                 // m/s
    rows.push({ date: a.date, name: a.name, gid: a.gid, ef: speed * 60 / a.avgHr, speed, hr: a.avgHr, pace: 1000 / speed, drift: a.an ? a.an.drift : null, mins: mov / 60, km: a.distM / 1000, long: mov >= 60 * 60 });
  }
  rows.sort((a, b) => a.date < b.date ? -1 : 1);
  if (rows.length < 3) return null;
  const recent = rows.filter(r => daysBetween(r.date, date) <= 28), before = rows.filter(r => { const k = daysBetween(r.date, date); return k > 28 && k <= 56; });
  const mean_ = arr => arr.length ? mean(arr.map(r => r.ef)) : null;
  const efNow = mean_(recent), efBefore = mean_(before);
  const change = efNow != null && efBefore != null ? efNow / efBefore - 1 : null;
  const drifts = rows.filter(r => r.drift != null && r.mins >= 45);
  const driftNow = drifts.filter(r => daysBetween(r.date, date) <= 42);
  const driftMed = driftNow.length >= 2 ? median(driftNow.map(r => r.drift)) : null;
  const driftWord = driftMed == null ? null : driftMed <= 5 ? 'sound aerobic endurance' : driftMed <= 10 ? 'some aerobic limitation or fatigue' : 'the long runs are above your aerobic threshold or too long for now';
  return { rows, recent, before, efNow, efBefore, change, driftMed, driftN: driftNow.length, driftWord };
}

function intensityMix(M, date, days) {
  const z = [0, 0, 0, 0, 0]; let n = 0;
  for (let k = 0; k < days; k++) {
    const x = dayAt(M, date, -k); if (!x) continue;
    for (const a of x.acts) if (a.hb) { const zz = zonesFromHist(a.hb, M.prof.hrMax, M.prof.zones); for (let j = 0; j < 5; j++) z[j] += zz[j]; n++; }
  }
  const tot = z.reduce((a, b) => a + b, 0);
  if (n < 3 || tot < 60) return null;
  const easy = (z[0] + z[1]) / tot, mod = z[2] / tot, hard = (z[3] + z[4]) / tot;
  let t, tone;
  if (easy >= 0.75) { t = `${Math.round(easy * 100)}% of your workout time was easy (zones 1–2). That's a good base-building mix.`; tone = 'good'; }
  else if (mod >= 0.3) { t = `${Math.round(mod * 100)}% of workout time was in zone 3, the "grey zone": too hard to recover from quickly, too easy to drive big gains. Make easy sessions easier and hard sessions harder.`; tone = 'warn'; }
  else { t = `Only ${Math.round(easy * 100)}% of workout time was easy. Endurance athletes usually aim for about 80% easy and 20% hard.`; tone = 'warn'; }
  return { z, tot, n, easy, mod, hard, t, tone };
}

function weekStats(M, end) {
  const days = []; for (let k = 6; k >= 0; k--) { const x = dayAt(M, end, -k); if (x) days.push(x); }
  const avg = f => { const v = days.map(f).filter(x => x != null); return v.length ? mean(v) : null; };
  const sum = f => days.reduce((a, x) => a + (f(x) || 0), 0);
  const acts = days.flatMap(x => x.acts);
  return {
    rec: avg(x => x.rec), hrv: avg(x => x.hrv), rhr: avg(x => x.rhr), strain: avg(x => x.strain), load: sum(x => x.load),
    sleep: avg(x => x.sleepMin), need: avg(x => x.sleepMin != null ? x.need : null), perf: avg(x => x.perf),
    nights: days.filter(x => x.sleepMin != null).length, workouts: acts.length, workMin: acts.reduce((a, x) => a + x.durS / 60, 0),
    green: days.filter(x => recoveryZone(x.rec) === 'hi').length, yellow: days.filter(x => recoveryZone(x.rec) === 'mid').length, red: days.filter(x => recoveryZone(x.rec) === 'lo').length,
  };
}
function weeklyReport(M, end) {
  const cur = weekStats(M, end), prev = weekStats(M, addDays(end, -7));
  const st = trainingStatus(M, end);
  const plan = M.plan;
  const wkStart = addDays(end, -6);
  const ps = plan.sessions.filter(s => !s.isRest && !s.optional && s.date >= wkStart && s.date <= end && s.date < M.today);
  const done = ps.filter(s => s.status === 'done').length;
  const lines = [];
  if (st) lines.push({ tone: st.tone, t: `Training status: ${st.label}. ${st.summary}` });
  if (cur.load && prev.load) { const ch = (cur.load - prev.load) / prev.load; lines.push({ tone: Math.abs(ch) > 0.3 ? 'warn' : 'neutral', t: `Training load was ${Math.round(Math.abs(ch) * 100)}% ${ch >= 0 ? 'higher' : 'lower'} than the week before (${cur.workouts} workouts, ${fmtHM(cur.workMin)} h).` }); }
  if (ps.length) lines.push({ tone: done / ps.length >= 0.8 ? 'good' : done / ps.length >= 0.5 ? 'warn' : 'bad', t: `You completed ${done} of ${ps.length} planned sessions.` });
  if (cur.nights) lines.push({ tone: cur.perf >= 0.9 ? 'good' : cur.perf >= 0.8 ? 'warn' : 'bad', t: `Sleep averaged ${fmtHM(cur.sleep)} h against a need of ${fmtHM(cur.need)} h (${Math.round(cur.perf * 100)}%) over ${cur.nights} nights.` });
  if (cur.rec != null) lines.push({ tone: cur.rec >= 67 ? 'good' : cur.rec >= 34 ? 'warn' : 'bad', t: `Recovery averaged ${Math.round(cur.rec)}%: ${cur.green} green, ${cur.yellow} yellow and ${cur.red} red days.` });
  return { cur, prev, status: st, lines, start: wkStart, end };
}

// The 3–4 things worth knowing today, most important first
function dailyInsights(M, date) {
  const d = M.day[date]; if (!d) return [];
  const out = [];
  const c = recoveryContributors(d).sort((a, b) => Math.abs(b.z * b.weight) - Math.abs(a.z * a.weight))[0];
  if (c && c.tone !== 'neutral') out.push({ tone: c.tone, h: (c.tone === 'good' ? 'Helping recovery: ' : 'Holding recovery back: ') + c.label.toLowerCase(), t: `${c.val}, ${Math.abs(c.z).toFixed(1)} standard deviations ${c.z >= 0 ? 'better' : 'worse'} than your 30-day normal.`, tab: 'recovery' });
  if (d.hrvState === 'below') out.push({ tone: 'bad', h: 'HRV trending down', t: `Your 7-day HRV (${Math.round(d.hrv7)} ms) has been below your normal range for ${d.hrvOutDays} day${d.hrvOutDays > 1 ? 's' : ''}. Often a sign of accumulated fatigue, illness or stress.`, tab: 'recovery' });
  else if (d.hrvState === 'above' && d.hrvOutDays >= 2) out.push({ tone: 'warn', h: 'HRV unusually high', t: `Your 7-day HRV (${Math.round(d.hrv7)} ms) has sat above your normal range for ${d.hrvOutDays} days. Far above normal is not “extra recovered”: with a low sleeping heart rate it is deep rest; otherwise it can precede illness. Don’t add intensity because of it.`, tab: 'recovery' });
  // the one progression rule with evidence behind it: a run much longer than anything in the last 30 days
  const lg = longRunGuard(M, date);
  if (lg.length) { const g = lg[0]; out.push({ tone: g.pct > 0.25 ? 'bad' : 'warn', h: `Long-run jump: “${g.s.title}” ${g.s.date === date ? 'today' : fmtDayShort(g.s.date)}`, t: `${g.planM ? fmtKm(g.planM) : g.planMin + ' min'} planned, but your longest run in the 30 days before it is ${g.ref.distM ? fmtKm(g.ref.distM) : ''}${g.ref.durS ? ' (' + fmtDurLong(g.ref.durS / 60) + ')' : ''}: a ${Math.round(g.pct * 100)}% jump. Runs more than 10% beyond the longest of the last month are the strongest single predictor of running injuries (Frandsen 2025). Cap it at about ${g.ref.distM ? fmtKm(Math.round(g.ref.distM * 1.1 / 100) * 100) : Math.round(g.ref.durS / 60 * 1.1) + ' min'} and build from there.`, tab: 'plan' }); }
  const sc = sleepCoach(M, date, 7);
  if (sc && sc.tips.length) out.push({ tone: sc.tips[0].tone, h: 'Sleep', t: sc.tips[0].t, tab: 'sleep' });
  const ps = (M.plan && M.plan.sessions) || [];
  const missed = ps.filter(s => s.status === 'missed' && s.date < date && daysBetween(s.date, date) <= 7);
  const ra = date === M.today ? realignment(M, date) : null;
  if (missed.length && !(ra && ra.level !== 'few')) out.push({ tone: missed.length >= 3 ? 'bad' : 'warn', h: `Missed ${missed.length} planned session${missed.length > 1 ? 's' : ''} this week`, t: missed.slice(0, 3).map(s => `${s.title} (${WD[parseYmd(s.date).getDay()]})`).join(', ') + (missed.length > 3 ? ' …' : '') + '. If it was done, it may not be on Strava yet. Otherwise tap Mark done in the Plan tab or let it go; don’t cram it into the coming days.', tab: 'plan' });
  const key = ps.find(s => s.date > date && daysBetween(date, s.date) <= 10 && ['key', 'test', 'race'].includes(s.intensity));
  if (key) out.push({ tone: 'neutral', h: `${key.title} in ${daysBetween(date, key.date)} day${daysBetween(date, key.date) > 1 ? 's' : ''}`, t: `${fmtDay(key.date)}. Keep the 1–2 days before it easy and sleep well the two nights before.`, tab: 'plan' });
  const cr = creatineStatus(M, date);
  if (cr && cr.days != null && cr.days <= 6) {
    const rp = typeof racePacing === 'function' ? racePacing(M) : null;
    const raceDays = rp && rp.date ? daysBetween(cr.since, rp.date) : null;
    out.push({ tone: 'neutral', h: `Creatine, day ${cr.days + 1}${cr.dose ? ' · ' + cr.dose : ''}`, t: `At this dose the muscle stores fill over about 4 weeks, no loading phase needed: same amount every day, with a meal, any time; drink to thirst. Expect the scale to rise 0.5–2 kg in those weeks — water in the muscle, not fat (the Body panel and the coach know this).${raceDays != null && raceDays >= 0 && raceDays <= 42 ? ` The ${rp.race} falls on day ${raceDays + 1}: a kilo of water costs a little running economy over 10 km (roughly 1 %, half a minute at your pace); the gain is for the gym and the short hard work. Your call whether to keep it through race week.` : ''}`, tab: 'journal' });
  } else if (cr && cr.days != null && cr.days >= 28 && cr.days <= 34) out.push({ tone: 'good', h: 'Creatine: stores full', t: `Four weeks at ${cr.dose || 'the maintenance dose'}: the muscle stores are saturated now. Strength gains from here are yours; the weight step of the last weeks was water (Kreider 2017).`, tab: 'gym' });
  const bl = bodyLog(M, date);
  if (bl && bl.spurt) out.push({ tone: 'warn', h: `Growth spurt: ${bl.rate.toFixed(1)} cm a year`, t: `${bl.ref.v} → ${bl.hLast.v} cm since ${fmtDayShort(bl.ref.date)}. At this rate bone and growth-plate injuries run 1.5–2× higher: no long-run jumps, no new plyometrics, keep intensity steady, and 1300 mg calcium a day (IOC youth statement).`, tab: 'journal' });
  // fuel for today's long session (Jeukendrup): 1–2 h ≈ 30 g carbs/h, 2–2½ h up to 60, longer up to 90 g/h with glucose + fructose
  const long = ps.filter(s => s.date === date && !s.isRest && (s.durationMin || 0) >= 90).sort((a, b) => (b.durationMin || 0) - (a.durationMin || 0))[0];
  if (long && date >= M.today) { const h = long.durationMin / 60; out.push({ tone: 'neutral', h: `Fuel for “${long.title}” (${fmtDurLong(long.durationMin)})`, t: h < 2 ? 'About 30 g of carbohydrate an hour from the first hour (a gel, a banana or 500 ml of sports drink), plus water to thirst. Starting the session fed matters more than what you take during it.' : h < 2.5 ? 'Up to 60 g of carbohydrate an hour (two gels or a bar plus drink), starting in the first 30 minutes; 500–750 ml of fluid an hour in the heat.' : 'Up to 90 g an hour with a glucose + fructose mix: practise it, the gut has to be trained for it as much as the legs.', tab: 'plan' }); }
  const ws = weekShape(M, date);
  if (ws && ws.tone !== 'good' && date <= M.today) out.push({ tone: ws.tone, h: `Week shape: ${ws.word}`, t: ws.text, tab: 'strain' });
  const mix = intensityMix(M, date, 28);
  if (mix) out.push({ tone: mix.tone, h: 'Intensity mix, last 4 weeks', t: mix.t, tab: 'strain' });
  return out.slice(0, 6);
}

// ---- body signals: several overnight measures off at once (WHOOP "Health Monitor" style) ----
// Uses the robust personal baselines from calib.js (median / MAD of the previous 28 days).
// A single measure moving is common; several moving the wrong way together is worth a heads-up.
// It's a pattern flag, not a diagnosis.
const BODY_SIG = [
  { key: 'hrv', label: 'HRV', unit: 'ms', dir: -1, fmt: d => d.hrv != null ? Math.round(d.hrv) + ' ms' : null, typ: c => c.med != null ? Math.round(Math.exp(c.med)) + ' ms' : null },
  { key: 'rhr', label: 'Resting heart rate', unit: 'bpm', dir: 1, fmt: d => d.rhr != null ? d.rhr + ' bpm' : null, typ: c => c.med != null ? Math.round(c.med) + ' bpm' : null },
  { key: 'resp', label: 'Respiratory rate', unit: 'rpm', dir: 1, fmt: d => d.resp != null ? d.resp.toFixed(1) + ' rpm' : null, typ: c => c.med != null ? c.med.toFixed(1) + ' rpm' : null },
  { key: 'temp', label: 'Wrist temperature', unit: '°C', dir: 1, fmt: d => d.temp != null ? d.temp.toFixed(2) + ' °C' : null, typ: c => c.med != null ? c.med.toFixed(2) + ' °C' : null },
];
function bodySignals(M, date) {
  const d = M.day[date]; if (!d || !d.cal) return null;
  const rows = BODY_SIG.map(s => {
    const c = d.cal[s.key] || {};
    const z = c.z != null ? c.z * s.dir : null;            // positive = in the "worse" direction
    const state = z == null ? (c.x != null ? 'building' : 'missing') : z >= 2 ? 'off' : z >= 1.5 ? 'edge' : 'ok';
    return { ...s, z, state, now: s.fmt(d), usual: s.typ(c), n28: c.n28 || 0 };
  });
  const have = rows.filter(r => r.z != null), off = rows.filter(r => r.state === 'off'), edge = rows.filter(r => r.state === 'edge');
  const score = off.length + 0.5 * edge.length;
  const level = have.length < 2 ? 'unknown' : off.length >= 2 && score >= 2.5 ? 'alert' : score >= 2 ? 'watch' : 'ok';
  // the night before: how many signals were already drifting, and which of today's are off for the second night
  const p = M.day[addDays(date, -1)];
  const pOff = s => { const c = p && p.cal && p.cal[s.key]; return !!(c && c.z != null && c.z * s.dir >= 1.5); };
  let streak = 0;
  if (level === 'alert' || level === 'watch') { const po = BODY_SIG.filter(pOff).length; if (po >= 2) streak = 2; }
  for (const r of rows) r.again = r.state === 'off' && pOff(r);
  const J = M.journal || {}, prevJ = J[addDays(date, -1)] || {}, todayJ = J[date] || {};
  const sick = !!(todayJ.sick || prevJ.sick || (M.plan && M.plan.sickOn && M.plan.sickOn(date)));
  // graded like Oura's Symptom Radar: Minor = one signal clearly off for a second night, or several drifting on one night;
  // Major = several off at once for a second night. Major switches on Rest mode (strain target and the key session drop); being sick is handled by the plan.
  const again = rows.filter(r => r.again).length;
  const grade = have.length < 2 ? 'unknown' : level === 'alert' && (streak || again >= 2) ? 'major' : level === 'alert' || level === 'watch' || again >= 1 ? 'minor' : 'none';
  const restMode = grade === 'major' ? 'rest' : grade === 'minor' ? 'easy' : null;
  return { level, grade, restMode, rows, have: have.length, off: off.length, edge: edge.length, again, streak, sick, alcohol: !!prevJ.alcohol, hardDay: (M.day[addDays(date, -1)] || {}).strain >= 16 };
}

// ---- day status: green / yellow / red, and what it does to today's session (TrainerRoad's "Red Light Green Light" idea) ----
// Readiness never adds intensity. Green = train as planned. Yellow = the day's main session becomes an easy one of the same
// length. Red = rest. Inputs: recovery with the morning check-in, the two-sided HRV band, the body-signal radar, last night's
// sleep, being sick or easing back in. The change is written into the plan only when you accept it (one tap), and can be undone.
const DAY_STATUS = { green: { label: 'Green day', word: 'green' }, yellow: { label: 'Yellow day', word: 'yellow' }, red: { label: 'Red day', word: 'red' }, none: { label: 'No status yet', word: 'none' } };
function dayStatus(M, date) {
  const d = M.day[date] || { date };
  const c = coachFor(d, M);
  const b = d.cal ? bodySignals(M, date) : null;
  const z = recoveryZone(c.recUsed);
  const known = !!(z || (b && b.grade !== 'unknown') || d.hrvState || c.sick);
  // the recovery score: red zone → red; the lower half of yellow (34–49) → yellow; 50–66 only tips the day when something else holds it too
  const why = [];
  let lvl = c.hold || 0;
  if (z === 'lo') { lvl = 2; why.push(`recovery ${c.recUsed}%`); }
  else if (z === 'mid' && c.recUsed < 50) { lvl = Math.max(lvl, 1); why.push(`recovery ${c.recUsed}%`); }
  else if (z === 'mid' && lvl >= 1) why.push(`recovery ${c.recUsed}%`);
  why.push(...(c.holdWhy || []));
  const color = !known ? 'none' : lvl === 2 ? 'red' : lvl === 1 ? 'yellow' : 'green';
  // what it does to the plan
  const planned = c.planned.filter(s => !s.isRest);
  const lvlOf = s => (PLAN_INTENSITY[s.intensity] ?? 2) - (s.sportKey === 'strength' || s.sportKey === 'mobility' ? 1.5 : 0) - (s.optional ? 2 : 0);
  const P = planned.slice().sort((a, b2) => lvlOf(b2) - lvlOf(a))[0] || null;
  const swapped = M.plan.sessions.filter(s => s.date === date && s.swap);
  const race = planned.find(s => s.intensity === 'race');
  const open = planned.filter(s => s.status !== 'done' && s.status !== 'partial');   // sessions already done are left alone
  let action = null;
  if (swapped.length) action = { kind: 'swapped', sessions: swapped };
  else if (race && color !== 'green') action = { kind: 'race', session: race };
  else if (color === 'red' && open.length && !c.sick) action = { kind: 'rest', sessions: open, proposals: open.map(s => restProposal(s, why)) };
  else if (color === 'yellow' && P && open.includes(P) && (PLAN_INTENSITY[P.intensity] ?? 2) >= 2 && !(P.sportKey === 'strength' || P.sportKey === 'mobility')) action = { kind: 'easy', session: P, proposals: [easyProposal(M, P, why)] };
  const text = color === 'none' ? 'Needs a recovery score or a few nights of body signals.'
    : color === 'green' ? (planned.length ? 'Train as planned.' : c.rest ? 'Rest day as planned.' : 'Nothing planned; a normal training day is fine.')
    : color === 'yellow' ? (action && action.kind === 'easy' ? `Keep the day, lose the intensity: “${P.title}” becomes an easy ${SPORT_LABEL[P.sportKey].toLowerCase()} of the same length.` : action && action.kind === 'race' ? 'Race day: warm up properly and decide by feel in the first minutes.' : action && action.kind === 'swapped' ? 'Easy day.' : P && !open.includes(P) ? `“${P.title}” is already done; keep the rest of the day easy.` : planned.length ? 'Today is already easy; keep it that way and finish feeling fresher than you started.' : 'Keep anything you do easy.')
    : (action && action.kind === 'race' ? 'Race day on a red: start conservatively and stop if you feel ill.' : c.sick ? 'Sick: planned sessions are excused.' : action && action.kind === 'swapped' ? 'Rest today.' : open.length ? 'Rest today. The session is not lost; the plan has room for it.' : planned.length ? 'Done for today; nothing more.' : 'Rest today.');
  return { color, ...DAY_STATUS[color], why, text, action, rec: c.recUsed, radar: b ? b.grade : null, hrv: d.hrvState, hrvDays: d.hrvOutDays || 0, target: c.target, planned, hold: c.hold || 0 };
}
// "6×800 m" in the old title would make the coach look for reps in the easy run, so the structure is spelled out in words
const plainTitle = t => String(t || '').replace(/(\d)\s*[×x]\s*(\d)/g, '$1 by $2');
function easyProposal(M, s, why) {
  const run = s.sportKey === 'run', Z = M.zones && M.zones.run;
  const z2 = run && Z ? zoneRangeText(Z, 2) : null;
  const sport = (SPORT_LABEL[s.sportKey] || 'session').toLowerCase();
  return { id: s.id, title: `Easy ${sport} (was: ${plainTitle(s.title)})`, intensity: 'easy', durationMin: s.durationMin || null,
    target: z2 ? `${z2} (Z2)` : '',
    details: `Yellow day (${why.join(', ')}): same length, all in Zone 2, no intervals${s.sportKey === 'swim' ? ', drills are fine' : ''}. The hard version waits for a green day.`,
    swap: { kind: 'easy', from: s.title, fromIntensity: s.intensity, fromTarget: s.target || null, fromDetails: s.details || null, why: why.join(', ') } };
}
function restProposal(s, why) {
  return { id: s.id, title: `Rest (was: ${plainTitle(s.title)})`, intensity: 'rest', target: '', distance: '', durationMin: 0, details: `Red day (${why.join(', ')}). Sleep, eat, drink; a short walk is fine.`,
    swap: { kind: 'rest', from: s.title, fromIntensity: s.intensity, fromTarget: s.target || null, fromDetails: s.details || null, why: why.join(', ') } };
}

// ---- long-run guard: the one progression rule with injury evidence (Frandsen 2025: a run > 10% longer than the longest
// of the previous 30 days was the strongest predictor; weekly % jumps and the load ratio were not) ----
function longestRun30(M, date, excludeGid) {
  let best = null;
  for (let k = 1; k <= 30; k++) { const x = M.day[addDays(date, -k)]; if (!x) continue; for (const a of x.acts) if (a.sport === 'run' && a.gid !== excludeGid && (a.distM || 0) >= 1000 && (!best || a.distM > best.distM)) best = a; }
  return best;
}
function longRunGuard(M, date) {
  const out = [];
  const ps = (M.plan && M.plan.sessions) || [];
  for (const s of ps) {
    if (s.sportKey !== 'run' || s.isRest || s.date < date || daysBetween(date, s.date) > 7 || s.status === 'done') continue;
    const km = s.distance && String(s.distance).match(/(\d+(?:[.,]\d+)?)\s*km/i);
    const planM = km ? parseFloat(km[1].replace(',', '.')) * 1000 : null;
    const ref = longestRun30(M, s.date);
    if (!ref) continue;
    if (planM) { if (planM > ref.distM * 1.1) out.push({ s, planM, ref, pct: planM / ref.distM - 1 }); }
    else if (s.durationMin && ref.durS) { const mins = ref.durS / 60; if (s.durationMin > mins * 1.1 && s.durationMin >= 50) out.push({ s, planMin: s.durationMin, ref, pct: s.durationMin / mins - 1 }); }
  }
  return out;
}

// ---- supplements: what is taken (settings/profile.supplements [{name, dose, since, until}]) and what the data should show for it ----
// Creatine is the one with a footprint in the numbers: at a 3–5 g/day maintenance dose the muscle stores fill over about 4 weeks (no loading
// phase needed) and body mass rises 0.5–2 kg from intracellular water in that time (ISSN position stand, Kreider 2017; Antonio 2021). For a
// runner the extra kilo costs a little running economy (Balsom 1993 saw a slower 6 km after loading), so a run race in the first weeks gets a note.
function isCreatine(x) { return /creatin|kreatin/i.test((x && x.name) || ''); }
function supplementsOn(M, date) {
  return ((M.prof && M.prof.supplements) || []).filter(x => (!x.since || x.since <= date) && (!x.until || x.until >= date))
    .map(x => ({ ...x, days: x.since ? daysBetween(x.since, date) : null, creatine: isCreatine(x) }));
}
function creatineStatus(M, date) {
  const c = supplementsOn(M, date).find(x => x.creatine); if (!c) return null;
  const days = c.days;
  return { ...c, phase: days == null ? 'on' : days < 28 ? 'filling' : 'saturated', waterWindow: days == null || days <= 42 };
}
// ---- body log: height and weight from the journal; growth rate as the youth guard-rail ----
// Adolescent athletes growing faster than their peers had ×1.47 the bone-injury rate and ×2.14 the growth-plate injuries per 1 SD of
// extra stature growth (Manchester Met 2023, mean age 13.4); peak height velocity in boys is about 8–10 cm a year.
function bodyLog(M, date) {
  const J = M.journal || {}, hs = [], ws = [];
  for (const k of Object.keys(J).sort()) { if (k > date) continue; const e = J[k]; if (e.height > 0) hs.push({ date: k, v: +e.height }); if (e.weight > 0) ws.push({ date: k, v: +e.weight }); }
  if (!hs.length && !ws.length) return null;
  const hLast = hs[hs.length - 1] || null, wLast = ws[ws.length - 1] || null;
  // growth rate: latest height vs the last entry at least 60 days earlier, as cm per year
  let rate = null, ref = null;
  if (hLast) { ref = [...hs].reverse().find(h => daysBetween(h.date, hLast.date) >= 60) || null; if (ref) rate = (hLast.v - ref.v) / daysBetween(ref.date, hLast.date) * 365; }
  const spurt = rate != null && rate >= 7;
  let wRef = null, wChange = null;
  if (wLast) { wRef = [...ws].reverse().find(w => daysBetween(w.date, wLast.date) >= 28) || null; if (wRef) wChange = wLast.v - wRef.v; }
  // a weight step across the creatine start is water in the muscle first (0.5–2 kg over the first 4–6 weeks), not fat and not growth
  const cr = creatineStatus(M, date);
  const creatine = cr && cr.since && wLast && wChange != null && wChange > 0 && wRef.date < cr.since && daysBetween(cr.since, wLast.date) <= 42 ? { since: cr.since, dose: cr.dose || '' } : null;
  return { hs, ws, hLast, wLast, rate, ref, spurt, wRef, wChange, creatine, stale: hLast ? daysBetween(hLast.date, date) > 45 : true };
}

// ---- realignment after missed sessions (Runna's rules): 1–3 missed in a week → drop them, keep the key sessions;
// more than 3, or a whole week → don't stack them, make the coming days easier and rebuild from there;
// most of 4 weeks missed → re-test before any quality work, the old paces no longer apply ----
function realignment(M, date) {
  const ps = (M.plan && M.plan.sessions) || []; if (!ps.length) return null;
  const inWin = (s, a, b) => s.date >= a && s.date <= b && !s.isRest && !s.optional && s.status !== 'sick';
  const w0 = addDays(date, -7), w1 = addDays(date, -1);
  const week = ps.filter(s => inWin(s, w0, w1)), wMissed = week.filter(s => s.status === 'missed');
  const m0 = addDays(date, -28);
  const month = ps.filter(s => inWin(s, m0, w1)), mMissed = month.filter(s => s.status === 'missed');
  const sickDays = M.plan.blocks ? M.plan.blocks.filter(b => b.kind === 'sick' && b.start <= w1 && (b.endEff || b.start) >= m0).length : 0;
  let level = null;
  if (month.length >= 8 && mMissed.length / month.length >= 0.7) level = 'month';
  else if (week.length >= 2 && (wMissed.length > 3 || wMissed.length === week.length)) level = 'week';
  else if (wMissed.length >= 1 && wMissed.length <= 3) level = 'few';
  if (!level) return null;
  const next = ps.filter(s => s.date >= date && daysBetween(date, s.date) <= 6 && !s.isRest && !s.optional);
  const keys = next.filter(s => ['hard', 'key', 'test', 'race'].includes(s.intensity));
  const text = level === 'month' ? `${mMissed.length} of ${month.length} planned sessions in the last 4 weeks were missed${sickDays ? ' (some while sick)' : ''}. After a gap like that the paces in the plan no longer fit: start with two easy weeks and a re-test (CSS, 5 km) before any quality session.`
    : level === 'week' ? `${wMissed.length} of ${week.length} planned sessions last week were missed. Don’t stack them on top of this week: replace the coming days with an easier version of the plan and rebuild from there${keys.length ? `; keep “${keys[0].title}” as the one quality session if the first days go well` : ''}.`
    : `${wMissed.length} session${wMissed.length > 1 ? 's' : ''} missed last week: let ${wMissed.length > 1 ? 'them' : 'it'} go. This week’s key session${keys.length > 1 ? 's' : ''} ${keys.length ? `(${keys.map(k => k.title).join(', ')}) ` : ''}stay${keys.length === 1 ? 's' : ''}; the missed ones are not added back.`;
  return { level, week: week.length, wMissed: wMissed.length, month: month.length, mMissed: mMissed.length, keys, text, weeks: level === 'month' ? 2 : 1 };
}

// ---- short morning summary (iPhone notification after the Shortcut syncs; standalone /api/ingest) ----
function morningSummary(M, date) {
  if (!M || M.empty) return { title: 'Baseline', body: 'No data yet.' };
  date = date || M.today;
  const d = M.day[date] || { date }, c = coachFor(d, M);
  const zw = { hi: 'green', mid: 'yellow', lo: 'red' }[recoveryZone(d.rec)];
  const hm = m => m == null ? '–' : Math.floor(m / 60) + ':' + String(Math.round(m % 60)).padStart(2, '0');
  const l1 = [d.rec != null ? `Recovery ${d.rec}% (${zw})` : 'Recovery: no score yet', d.sleepScore != null ? `Sleep ${d.sleepScore}% · ${hm(d.sleepMin)} h` : d.sleepMin != null ? `Sleep ${hm(d.sleepMin)} h` : 'No sleep recorded'].join(' · ');
  const l2 = [d.hrv != null ? `HRV ${Math.round(d.hrv)} ms` : null, d.rhr != null ? `RHR ${d.rhr}` : null].filter(Boolean).join(' · ');
  const P = c.planned[0];
  const l3 = P ? `Today: ${P.title}${P.durationMin ? ' · ' + P.durationMin + ' min' : ''}${c.planned.length > 1 ? ` (+${c.planned.length - 1} more)` : ''}` : c.rest ? 'Today: rest day' : 'Nothing planned today';
  let l4 = `${c.head}. Strain target ${c.target[0]}–${c.target[1]}.`;
  const b = typeof bodySignals === 'function' && M.day[date] && M.day[date].cal ? bodySignals(M, date) : null;
  if (b && b.level === 'alert') l4 = 'Several body signals are off (HRV, resting HR, breathing, temperature). Keep today easy. ' + l4;
  else if (b && b.level === 'watch') l4 = 'Some body signals are drifting; take it easy if you feel off. ' + l4;
  // the day status and what it would change
  const ds = typeof dayStatus === 'function' ? dayStatus(M, date) : null;
  const l5 = ds && ds.color !== 'none' ? `${ds.label}${ds.why.length ? ' (' + ds.why.join(', ') + ')' : ''}: ${ds.text}${ds.action && (ds.action.kind === 'easy' || ds.action.kind === 'rest') ? ' Open Baseline to accept the change.' : ''}` : null;
  // tonight
  const tn = typeof sleepPlanner === 'function' && M.day[date] ? sleepPlanner(M.day[date], M) : null;
  const l6 = tn ? `Tonight: in bed by ${fmtClock(tn.bed, true)} for ${fmtHM(tn.need)} h${tn.keySession ? ` before “${tn.keySession.title}”` : ''}.` : null;
  return { title: d.rec != null ? `Recovery ${d.rec}% · ${ds && ds.color !== 'none' ? ds.label : c.head}` : c.head, body: [l1, l2, l3, l5, l4, l6].filter(Boolean).join('\n'), rec: d.rec, sleepScore: d.sleepScore, head: c.head, bodySignals: b ? b.level : null, dayStatus: ds ? ds.color : null };
}
