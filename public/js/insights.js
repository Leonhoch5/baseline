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
  signals.push({ k: 'Load ratio (7 vs 28 days)', v: acwr != null ? acwr.toFixed(2) : '–', tone: acwr == null ? 'neutral' : acwr > 1.5 ? 'bad' : acwr > 1.3 || acwr < 0.8 ? 'warn' : 'good', t: acwr == null ? 'Needs 2 weeks of data' : acwr > 1.5 ? 'Load spike' : acwr > 1.3 ? 'Above the safe range' : acwr < 0.8 ? 'Below your usual load' : 'In the 0.8–1.3 range' });
  signals.push({ k: 'Fitness trend (42-day load)', v: ramp != null ? (ramp >= 0 ? '+' : '−') + Math.abs(ramp * 100).toFixed(0) + '%/wk' : '–', tone: ramp == null ? 'neutral' : ramp > 0.12 ? 'warn' : ramp > 0.01 ? 'good' : ramp < -0.05 ? 'warn' : 'neutral', t: ramp == null ? '' : ramp > 0.12 ? 'Building quickly' : ramp > 0.01 ? 'Building' : ramp < -0.05 ? 'Dropping' : 'Holding steady' });
  signals.push({ k: 'HRV (7-day average)', v: d.hrv7 != null ? Math.round(d.hrv7) + ' ms' : '–', tone: hrvFlag === 'low' ? 'bad' : hrvFlag ? 'good' : 'neutral', t: hrvFlag == null ? 'Needs 2 weeks of overnight HRV' : hrvFlag === 'low' ? `Below your normal ${Math.round(d.hrvBand[0])}–${Math.round(d.hrvBand[2])} ms` : hrvFlag === 'high' ? 'Above your normal range' : 'Inside your normal range' });
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
    ramping: ['Load has jumped well above what you are used to. Your body still looks fine, but this pace raises injury risk.', 'Hold this level for a week before adding more, and keep easy days truly easy.'],
    strained: ['Your load is normal, but recovery signals are down. Your body isn\'t absorbing the training right now.', 'Take 1–2 easy days, prioritise sleep, and check for illness, stress or alcohol.'],
    overreaching: ['Load is far above your usual level' + (physioBad ? ', and HRV, resting heart rate or recovery show it.' : '.') + ' Keep this up and you risk illness, injury or burnout.', 'Cut volume by a third this week and keep only one hard session until recovery is back in the green.'],
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
    debt: nights.reduce((a, x) => a + Math.max(0, x.need - x.sleepMin), 0),
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
  if (r.debt > 180) tips.push({ tone: 'bad', t: `You are ${fmtHM(r.debt)} h short of your sleep need over the last ${r.n} nights. Pay it back over several nights by going to bed 30–45 minutes earlier, rather than sleeping in.` });
  else if (r.debt > 60) tips.push({ tone: 'warn', t: `A small sleep debt of ${fmtHM(r.debt)} h this week. One earlier night would clear most of it.` });
  else tips.push({ tone: 'good', t: `You met your sleep need on average this week (${fmtHM(r.avgAsleep)} asleep vs ${fmtHM(r.avgNeed)} needed).` });
  if (r.bedSd != null && r.bedSd > 45) tips.push({ tone: 'warn', t: `Your bedtime varied by about ±${Math.round(r.bedSd)} minutes. A steady bedtime (within ±30 min) improves sleep quality and HRV.` });
  else if (r.bedSd != null) tips.push({ tone: 'good', t: `Consistent bedtime: about ${fmtClock(r.bed, true)}, varying by ±${Math.round(r.bedSd)} minutes.` });
  if (r.restor != null && r.restor < 0.35) tips.push({ tone: 'warn', t: `Restorative sleep (deep + REM) was ${Math.round(r.restor * 100)}% of the night; 40–50% is typical. Late meals, alcohol and evening hard sessions reduce it.` });
  if (r.eff != null && r.eff < 0.85) tips.push({ tone: 'warn', t: `Sleep efficiency was ${Math.round(r.eff * 100)}%: a lot of time in bed awake. Go to bed only when sleepy, and keep the phone out of bed.` });
  if (r.recGap && r.recGap.good - r.recGap.short >= 5) tips.push({ tone: 'neutral', t: `When you sleep at least 90% of your need, your next-day recovery averages ${Math.round(r.recGap.good)}%, compared with ${Math.round(r.recGap.short)}% after short nights.` });
  r.tips = tips;
  return r;
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
  if (d.hrvBand && d.hrv7 != null && d.hrv7 < d.hrvBand[0]) out.push({ tone: 'bad', h: 'HRV trending down', t: `Your 7-day HRV (${Math.round(d.hrv7)} ms) is below your normal range. Often a sign of accumulated fatigue, illness or stress.`, tab: 'recovery' });
  const sc = sleepCoach(M, date, 7);
  if (sc && sc.tips.length) out.push({ tone: sc.tips[0].tone, h: 'Sleep', t: sc.tips[0].t, tab: 'sleep' });
  const ps = (M.plan && M.plan.sessions) || [];
  const missed = ps.filter(s => s.status === 'missed' && s.date < date && daysBetween(s.date, date) <= 7);
  if (missed.length) out.push({ tone: missed.length >= 3 ? 'bad' : 'warn', h: `Missed ${missed.length} planned session${missed.length > 1 ? 's' : ''} this week`, t: missed.slice(0, 3).map(s => `${s.title} (${WD[parseYmd(s.date).getDay()]})`).join(', ') + (missed.length > 3 ? ' …' : '') + '. If it was done, it may not be on Strava yet. Otherwise tap Mark done in the Plan tab or let it go; don’t cram it into the coming days.', tab: 'plan' });
  const key = ps.find(s => s.date > date && daysBetween(date, s.date) <= 10 && ['key', 'test', 'race'].includes(s.intensity));
  if (key) out.push({ tone: 'neutral', h: `${key.title} in ${daysBetween(date, key.date)} day${daysBetween(date, key.date) > 1 ? 's' : ''}`, t: `${fmtDay(key.date)}. Keep the 1–2 days before it easy and sleep well the two nights before.`, tab: 'plan' });
  const mix = intensityMix(M, date, 28);
  if (mix) out.push({ tone: mix.tone, h: 'Intensity mix, last 4 weeks', t: mix.t, tab: 'strain' });
  return out.slice(0, 5);
}
