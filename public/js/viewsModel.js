// ---------- Model tab: what the app has learned about you, how accurate it is, and how it works ----------
const EVID = { ev: ['Evidence-based', 'hi'], eng: ['Engineering approximation', 'mid'], exp: ['Experimental', 'lo'] };
const REF = {
  rothschild: ['Rothschild et al. 2024, Eur J Appl Physiol', 'https://doi.org/10.1007/s00421-024-05530-2'],
  miller: ['Miller, Sargent & Roach 2022, Sensors', 'https://doi.org/10.3390/s22166317'],
  nuuttila: ['Nuuttila et al. 2025, Sensors', 'https://doi.org/10.3390/s25020533'],
  dial: ['Dial et al. 2025, Physiol Rep', 'https://doi.org/10.14814/phy2.70527'],
  plews12: ['Plews et al. 2012, Eur J Appl Physiol', 'https://doi.org/10.1007/s00421-012-2354-4'],
  plews13: ['Plews et al. 2013, Sports Med', 'https://doi.org/10.1007/s40279-013-0071-8'],
  buchheit: ['Buchheit 2014, Front Physiol', 'https://doi.org/10.3389/fphys.2014.00073'],
  munoz: ['Muñoz et al. 2015, PLoS ONE', 'https://doi.org/10.1371/journal.pone.0138921'],
  morton: ['Morton, Fitz-Clarke & Banister 1990, J Appl Physiol', 'https://doi.org/10.1152/jappl.1990.69.3.1171'],
  foster: ['Foster et al. 2001, J Strength Cond Res', 'https://journals.lww.com/nsca-jscr/abstract/2001/02000/a_new_approach_to_monitoring_exercise_training.19.aspx'],
  williams: ['Williams et al. 2017, Br J Sports Med', 'https://doi.org/10.1136/bjsports-2016-096589'],
  imp20: ['Impellizzeri et al. 2020, IJSPP', 'https://doi.org/10.1123/ijspp.2019-0864'],
  imp21: ['Impellizzeri et al. 2021, Sports Med', 'https://doi.org/10.1007/s40279-020-01378-6'],
  phillips: ['Phillips et al. 2017, Sci Rep', 'https://doi.org/10.1038/s41598-017-03171-4'],
  watson: ['Watson et al. 2015, J Clin Sleep Med (AASM/SRS)', 'https://doi.org/10.5664/jcsm.4758'],
  hirsh: ['Hirshkowitz et al. 2015, Sleep Health (NSF)', 'https://doi.org/10.1016/j.sleh.2014.12.010'],
  bellenger: ['Bellenger et al. 2016, Sports Med', 'https://doi.org/10.1007/s40279-016-0484-2'],
  manresa: ['Manresa-Rocamora et al. 2021, IJERPH', 'https://doi.org/10.3390/ijerph181910299'],
};
const METHODS = [
  { id: 'baseline', title: 'Personal baselines', ev: 'ev', refs: ['plews12', 'plews13', 'buchheit', 'miller', 'munoz'],
    why: 'Day-to-day HRV and resting heart rate vary a lot within a person, so a single reading only means something relative to that person’s own recent history. Averaging over several days and log-transforming HRV are standard in endurance-athlete monitoring.',
    vars: 'Overnight HRV (Apple Watch SDNN, log-transformed), resting heart rate, sleep duration, sleep midpoint.',
    how: 'For each day, using only earlier days: 28-day median and robust spread (MAD × 1.4826, minimum 10 days), 7-day mean, and a 90-day reference (days 29–90 back, minimum 20). Deviation = (value − median) / spread. Readings more than 5 robust spreads away are flagged as likely artifacts, still shown, and left out of later baselines. The 7-day mean is also compared with the 90-day reference, so a slow drift isn’t absorbed by the 28-day baseline without notice.',
    limits: 'The windows and the ±5 threshold are engineering choices, not validated cut-offs. Apple Watch stores HRV as SDNN from short recordings, which agreed only moderately with ECG (ICC 0.67) and isn’t comparable with published RMSSD values, so it’s only compared with your own history. If you change device or HRV metric, the baseline restarts instead of mixing the two.',
    eval: 'Data completeness and the share of flagged readings are shown under Data quality. Baselines are judged by how well they serve the predictions below.' },
  { id: 'recovery', title: 'Recovery estimate (0–100%)', ev: 'eng', refs: ['bellenger', 'manresa', 'plews13'],
    why: 'Combining HRV, resting heart rate and sleep relative to your baseline is a common way to summarise readiness, but no published formula has been validated for this purpose.',
    vars: 'HRV deviation (weight 50%), resting HR deviation (25%, inverted), sleep vs need (15%), respiratory rate (10%, only when raised).',
    how: 'Weighted average of the deviations, mapped to 0–100 with a logistic curve. Green ≥ 67, yellow 34–66, red ≤ 33. A confidence level (low, moderate, high) is shown, based on which inputs exist and how long the baselines are.',
    limits: 'The weights are fixed assumptions, not learned. HRV can rise both with good adaptation and with overreaching (Bellenger 2016), so a single score doesn’t mean you are fit or unfit to train. Treat it as a summary of measurements, not a measurement of recovery itself.',
    eval: 'Once you log morning check-ins, the Prediction accuracy section shows how well readiness can actually be predicted, and whether a personalized model beats simple baselines.' },
  { id: 'load', title: 'Training load: TRIMP, session RPE and strain', ev: 'ev', refs: ['morton', 'foster', 'williams'],
    why: 'Internal load can be quantified from heart rate (TRIMP) or from perceived effort × duration (session RPE). Each has its own units, and they shouldn’t be mixed.',
    vars: 'Heart-rate stream or Watch heart rate during each workout, resting HR baseline, max HR, sex; RPE (0–10) and minutes.',
    how: 'Banister TRIMP = Σ minutes × HRr × 0.64·e^(1.92·HRr) for men (0.86·e^(1.67·HRr) for women), HRr = (HR − resting) / (max − resting), computed per heart-rate band. Session RPE load = RPE × minutes (arbitrary units). 7- and 28-day exponentially weighted averages use λ = 2/(N+1), overall and per sport. The 0–21 “strain” shown on Today is a separate display scale of all-day heart-rate load (engineering approximation).',
    limits: 'Workouts without heart rate have no TRIMP (coverage is shown); RPE fills that gap only if you log it. TRIMP coefficients come from running and cycling work; they’re less certain for swimming, where wrist heart rate is unreliable.',
    eval: 'Load features are used in the predictions; whether they help is visible in the model’s weights and accuracy.' },
  { id: 'acwr', title: 'Training status and load ratio', ev: 'eng', refs: ['imp20', 'imp21', 'williams'],
    why: 'Comparing recent load with your usual load describes whether you are building, holding or backing off. The acute:chronic ratio is not a valid injury predictor and has statistical problems.',
    vars: '7- vs 28-day load, 42-day fitness trend, 7-day HRV and resting HR vs baseline, average recovery.',
    how: 'Rule-based labels (Productive, Maintaining, Ramping fast, Strained, Overreaching, Recovering, Detraining) from the load ratio and physiology, as described on the Strain tab.',
    limits: 'The thresholds (0.8, 1.05, 1.3, 1.5) are conventions, not evidence-based cut-offs. The labels describe load; they don’t predict injury or illness.',
    eval: 'Not separately validated. Treat as a description of the last weeks.' },
  { id: 'sleep', title: 'Sleep: quantity, regularity and need', ev: 'ev', refs: ['phillips', 'watson', 'hirsh', 'miller'],
    why: 'Adults are advised to sleep at least 7 hours (7–9 h for ages 18–64). Regularity is measured with the Sleep Regularity Index. Wrist wearables estimate sleep timing reasonably but stages poorly.',
    vars: 'Sleep segments from Apple Watch, morning check-ins or next-morning HRV.',
    how: 'SRI = 200 × (share of 5-minute slots in the same sleep/wake state 24 h apart) − 100, over the last 14 days with complete nights. Individual sleep need: a hinge regression of your morning outcome on sleep duration (plateau searched between 6 and 9.5 h), with a bootstrap interval; reported only with ≥ 30 nights, a positive slope and a narrow interval, and always kept within 7–9 h.',
    limits: 'Apple Watch overestimated total sleep by about 40 minutes and detected wake poorly (26%) against polysomnography; stage agreement was low (κ 0.20). Stages and efficiency are therefore shown as estimates only. A sleep-need estimate from observational data is an association, not proof of what you need.',
    eval: 'The sleep-need analysis reports its interval and sample size and says so when the evidence is unclear.' },
  { id: 'predict', title: 'Predictions and how they are tested', ev: 'exp', refs: ['rothschild', 'nuuttila'],
    why: 'In endurance athletes, individual models predicted daily recovery better than simple baselines on average, but accuracy varied more than fivefold between athletes and the most useful inputs differed per person (Rothschild 2024). Responses to overload also varied widely between individuals (Nuuttila 2025).',
    vars: 'Targets: next-morning readiness (check-in), next-morning HRV deviation, next-morning resting HR deviation. Features known by the evening before: today’s value, HRV and resting HR deviation, sleep (last night and 3-night average), training load (today, 3 days, fatigue vs fitness), reported fatigue.',
    how: 'Four methods compete: your historical average, today’s value, your 7-day average, and a ridge regression (standardized features, penalty chosen on the most recent 25% of past data), refitted weekly on past data only. Each day is predicted using only data available before it (rolling origin). At each point the method with the lowest past error is used; the personalized model is only chosen once it has ≥ 20 out-of-sample predictions and is at least 5% more accurate than the best simple method. 80% prediction intervals come from recent out-of-sample errors. Predictions for tomorrow are also saved, with model version, and scored once the outcome arrives.',
    limits: 'Needs at least 21 days of training data plus 15 out-of-sample days per target. Associations learned this way aren’t causes. Ridge regression is used instead of LASSO (best in Rothschild 2024) for stability with little data.',
    eval: 'Mean absolute error, RMSE, correlation and interval coverage per method; the selected method’s errors include the effect of choosing it, so they are honestly out-of-sample.' },
  { id: 'response', title: 'Your responses: efficiency and recovery after load', ev: 'exp', refs: ['buchheit'],
    why: 'A lower heart rate at the same speed usually reflects better aerobic fitness; a higher one is ambiguous and not a reliable fatigue sign.',
    vars: 'Average speed and heart rate of steady runs, rides and swims (15–180 min); next-day HRV, resting HR and readiness after easy, moderate and hard days (your own load thirds).',
    how: 'Efficiency = metres per minute ÷ average heart rate; median of the last 6 weeks vs the 6–18 weeks before (≥ 3 sessions each). Recovery curves: average deviation 1–3 days after each load category (≥ 5 observations).',
    limits: 'Whole-session averages don’t control for terrain, wind, heat, pool vs open water or interval structure. Recovery curves are confounded by what you did on the following days.',
    eval: 'Descriptive only; sample sizes are shown.' },
  { id: 'quality', title: 'Data quality and provenance', ev: 'eng', refs: ['miller', 'dial'],
    why: 'Consumer wearables differ in accuracy, and missing data must not be filled in and shown as if it were measured.',
    vars: 'Source of each value (Apple Watch, Apple Health history, Strava, your check-ins), completeness, flagged readings.',
    how: 'Missing values stay missing (no imputation). Days without any data are shown as missing, not as zero. Duplicate workouts from Watch and Strava are merged and counted once. Measured values, your reports, estimates and predictions are labelled separately.',
    limits: 'Days with no recorded workouts count as zero training load in the load averages, which is wrong if a workout simply wasn’t recorded.',
    eval: 'Completeness and flagged readings are listed below.' },
];
function evChip(e) { const [l, c] = EVID[e]; return `<span class="chip ${c}">${l}</span>`; }
function refLinks(ids) { return ids.map(id => REF[id] ? `<a href="${REF[id][1]}" target="_blank" rel="noopener">${esc(REF[id][0])}</a>` : '').join(' · '); }
function fmtT(key, v) { if (v == null || isNaN(v)) return '–'; const T = TARGETS[key]; return (key === 'readiness' ? v.toFixed(1) : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(T.digits)) + ' ' + T.unit; }
function outlookHtml(M, compact) {
  const keys = Object.keys(TARGETS);
  const rows = keys.map(k => {
    const p = M.pred[k], T = TARGETS[k];
    if (!p || p.status === 'insufficient') return `<div class="ol"><div><b>${esc(T.label)}</b><span class="muted">${p && p.n ? `Learning: ${p.n} days with this measure so far` : k === 'readiness' ? 'Starts once you log morning check-ins' : 'Waiting for data'}</span></div><span class="chip">not enough data</span></div>`;
    const c = p.current;
    if (!c) return `<div class="ol"><div><b>${esc(T.label)}</b><span class="muted">Today’s inputs are incomplete, so no prediction for tomorrow.</span></div></div>`;
    return `<div class="ol"><div><b>${esc(T.label)}</b><span class="muted">${esc(METHOD_LABEL[c.method])}${c.fallback ? ' (fallback: some of today’s inputs are missing)' : ''}</span></div>
      <div class="ol-v"><span class="num">${esc(fmtT(k, c.pred))}</span>${c.lo != null ? `<small>80% range ${esc(fmtT(k, c.lo))} to ${esc(fmtT(k, c.hi))}</small>` : ''}</div></div>`;
  }).join('');
  return `<div class="panel"><div class="panel-h"><h2>Tomorrow’s outlook</h2><span class="chip">prediction</span>${compact ? '<span class="aside"><button class="btn sm ghost" data-action="tab" data-tab="model">How accurate?</button></span>' : ''}</div>${rows}
    <p class="muted" style="font-size:12px;margin:8px 0 0">Model output, not a measurement. Based only on data available today; the range is where the actual value fell 80% of the time in past tests.</p></div>`;
}
function accuracyHtml(M) {
  return Object.keys(TARGETS).map(k => {
    const p = M.pred[k], T = TARGETS[k];
    if (!p || !p.metrics.mean) return `<div class="acc"><div class="panel-h" style="margin-bottom:6px"><h3>${esc(T.label)}</h3><span class="chip">not enough data</span></div><p class="muted" style="margin:0;font-size:13px">${esc(T.def)} ${k === 'readiness' ? 'Log the morning check-in in the Journal tab to start.' : ''} Needs about 5 weeks of this measure.</p></div>`;
    const row = (m, label) => { const x = p.metrics[m]; if (!x) return ''; return `<tr class="${p.active === m ? 'on' : ''}"><td>${esc(label)}${p.active === m ? ' <span class="chip st-done">in use</span>' : ''}</td><td>${x.mae.toFixed(T.digits)}</td><td>${x.rmse.toFixed(T.digits)}</td><td>${x.r != null ? x.r.toFixed(2) : '–'}</td><td>${x.cov != null ? Math.round(x.cov * 100) + '%' : '–'}</td><td>${x.n}</td></tr>`; };
    const ridge = p.metrics.ridge, best = ['mean', 'last', 'roll7'].map(m => p.metrics[m]).filter(Boolean).sort((a, b) => a.mae - b.mae)[0];
    const verdict = !ridge ? 'The personalized model hasn’t made enough out-of-sample predictions yet.' : ridge.n < 20 ? 'Too few out-of-sample predictions to judge the personalized model.' : ridge.mae < 0.95 * best.mae ? `The personalized model is ${Math.round((1 - ridge.mae / best.mae) * 100)}% more accurate than the best simple method, so it is used.` : `The personalized model is not clearly better than the best simple method (${ridge.mae.toFixed(T.digits)} vs ${best.mae.toFixed(T.digits)} ${T.unit} average error), so the simple method is used.`;
    const lg = M.predLogged[k];
    return `<div class="acc"><div class="panel-h" style="margin-bottom:6px"><h3>${esc(T.label)}</h3><span class="aside">${esc(T.def)}</span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Method</th><th>Avg error</th><th>RMSE</th><th>Correlation</th><th>In 80% range</th><th>Days</th></tr></thead><tbody>
      ${row('mean', METHOD_LABEL.mean)}${row('last', METHOD_LABEL.last)}${row('roll7', METHOD_LABEL.roll7)}${row('ridge', METHOD_LABEL.ridge)}
      ${p.metrics.active ? `<tr class="sel"><td>What the app actually used</td><td>${p.metrics.active.mae.toFixed(T.digits)}</td><td>${p.metrics.active.rmse.toFixed(T.digits)}</td><td>${p.metrics.active.r != null ? p.metrics.active.r.toFixed(2) : '–'}</td><td>${p.metrics.active.cov != null ? Math.round(p.metrics.active.cov * 100) + '%' : '–'}</td><td>${p.metrics.active.n}</td></tr>` : ''}
      </tbody></table></div>
      <p class="sub" style="font-size:13px;margin:8px 0 0">${esc(verdict)} Errors are in ${esc(T.unit)}; all predictions were made using only earlier data.</p>
      ${lg ? `<p class="muted" style="font-size:12px;margin:4px 0 0">Predictions saved in advance and scored later: ${lg.n}, average error ${lg.mae.toFixed(T.digits)} ${esc(T.unit)}${lg.cov != null ? ', ' + Math.round(lg.cov * 100) + '% inside the 80% range' : ''}.</p>` : '<p class="muted" style="font-size:12px;margin:4px 0 0">Predictions saved in advance: none scored yet. Each day’s prediction for tomorrow is saved and checked once the outcome arrives.</p>'}
      ${p.weights && p.weights.length ? `<details style="margin-top:6px"><summary class="muted" style="cursor:pointer;font-size:12px">What the personalized model has learned (standardized weights)</summary>${p.weights.map(w => `<div class="ins"><span style="font-size:12px">${esc(w.label)}</span><div class="axis"><span style="${w.w >= 0 ? `left:50%;width:${Math.min(50, Math.abs(w.w) / (Math.abs(p.weights[0].w) || 1) * 50)}%` : `left:${50 - Math.min(50, Math.abs(w.w) / (Math.abs(p.weights[0].w) || 1) * 50)}%;width:${Math.min(50, Math.abs(w.w) / (Math.abs(p.weights[0].w) || 1) * 50)}%`};background:var(--accent)"></span></div><span class="v">${w.w >= 0 ? '+' : '−'}${Math.abs(w.w).toFixed(2)}</span></div>`).join('')}<p class="muted" style="font-size:12px">Associations in your data, not causes.</p></details>` : ''}
      <div class="chart" id="c-acc-${k}" style="margin-top:8px"></div></div>`;
  }).join('');
}
function drawAccuracy(v, M) {
  for (const k in TARGETS) {
    const el = v.querySelector('#c-acc-' + k), p = M.pred[k]; if (!el || !p || !p.oos.active.length) continue;
    const pts = p.oos.active.slice(-90), T = TARGETS[k];
    lineChart(el, { label: T.label + ': predicted vs actual', labels: pts.map(x => fmtDayShort(x.date)), height: 150, fmtTip: x => (+x).toFixed(T.digits) + ' ' + T.unit, tipHead: i => fmtDay(pts[i].date),
      series: [{ name: 'Actual', values: pts.map(x => x.y), color: 'var(--fg-2)' }, { name: 'Predicted', values: pts.map(x => x.pred), color: 'var(--accent)' }],
      band: { lo: pts.map(x => x.lo), hi: pts.map(x => x.hi), color: 'var(--accent)', name: '80% range' } });
  }
}
function responsesHtml(M) {
  const t = M.day[M.today] || M.day[M.dates[M.dates.length - 1]];
  const fams = ['swim', 'run', 'ride', 'strength'];
  let cov = 0, tot = 0; for (let k = 0; k < 28; k++) { const d = M.day[addDays(M.today, -k)]; if (d && d.trainMin) { tot += d.trainMin; cov += d.trainMin * (d.trimpCov || 0); } }
  let srpeN = 0, actN = 0; for (let k = 0; k < 28; k++) { const d = M.day[addDays(M.today, -k)]; if (!d) continue; actN += d.acts.length; srpeN += d.acts.filter(a => a.rpe != null).length; }
  const eff = efficiencyTrends(M), rc = recoveryCurves(M);
  const effRow = (sp, label) => { const e = eff[sp]; if (!e || e.change == null) return `<tr><td>${label}</td><td colspan="3" class="muted" style="text-align:left">${e ? e.n : 0} steady sessions with heart rate; needs 3 recent and 3 earlier</td></tr>`; return `<tr><td>${label}</td><td>${(e.recent * 100).toFixed(1)}</td><td>${(e.earlier * 100).toFixed(1)}</td><td class="${e.change > 0.01 ? 'delta-good' : ''}">${e.change >= 0 ? '+' : '−'}${Math.abs(e.change * 100).toFixed(1)}%</td></tr>`; };
  const curve = c => { const s = rc.summ && rc.summ[c]; if (!s) return ''; const cell = x => x.m == null ? `<span class="muted">n=${x.n}</span>` : `${x.m >= 0 ? '+' : '−'}${Math.abs(x.m).toFixed(2)}`; return `<tr><td>${c[0].toUpperCase() + c.slice(1)} days <span class="muted">(${s.count})</span></td>${s.map(x => `<td>${cell(x.hrv)}</td>`).join('')}${s.map(x => `<td>${cell(x.rhr)}</td>`).join('')}</tr>`; };
  return `<div class="panel"><div class="panel-h"><h2>Training load by sport</h2><span class="aside">TRIMP, exponentially weighted</span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Sport</th><th>7-day load</th><th>28-day load</th><th>Ratio</th><th>Minutes/day (7 d)</th></tr></thead><tbody>
      ${fams.map(f => { const e = t.ewFam[f]; return `<tr><td>${FAMILY_LABEL[f]}</td><td>${e.a.toFixed(1)}</td><td>${e.c.toFixed(1)}</td><td>${e.c > 0.5 ? (e.a / e.c).toFixed(2) : '–'}</td><td>${e.ma.toFixed(0)}</td></tr>`; }).join('')}
      <tr class="sel"><td>All</td><td>${t.ewA.toFixed(1)}</td><td>${t.ewC.toFixed(1)}</td><td>${t.ewC > 0.5 ? (t.ewA / t.ewC).toFixed(2) : '–'}</td><td></td></tr></tbody></table></div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">Heart rate covers ${tot ? Math.round(cov / tot * 100) : 0}% of training minutes in the last 4 weeks; sessions without it have no TRIMP. Session RPE logged for ${srpeN} of ${actN} sessions. Units are TRIMP per day; the ratio is descriptive, not an injury forecast.</p></div>
    <div class="cols">
      <div class="panel"><div class="panel-h"><h2>Aerobic efficiency</h2><span class="aside">metres/min per heartbeat × 100</span></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Sport</th><th>Last 6 wk</th><th>6–18 wk ago</th><th>Change</th></tr></thead><tbody>${effRow('run', 'Run')}${effRow('ride', 'Ride')}${effRow('swim', 'Swim')}</tbody></table></div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Higher = more speed for the same heart rate. A rise usually means better aerobic fitness; a fall is ambiguous (heat, terrain, fatigue). Uncontrolled whole-session averages.</p></div>
      <div class="panel"><div class="panel-h"><h2>Recovery after load</h2><span class="aside">deviation from baseline, days 1–3 after</span></div>
        ${rc.summ ? `<div class="table-wrap"><table class="t"><thead><tr><th>After</th><th>HRV +1</th><th>+2</th><th>+3</th><th>RHR +1</th><th>+2</th><th>+3</th></tr></thead><tbody>${curve('easy')}${curve('moderate')}${curve('hard')}</tbody></table></div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Average deviation in robust SD (HRV: below 0 = lower than usual; RHR: above 0 = higher than usual). Cells need 5 observations. Associations only: later days’ training also plays a part.</p>` : `<p class="muted" style="margin:0">Needs at least 15 days with heart-rate-based training load (${rc.n} so far) and overnight HRV or resting HR on the following days.</p>`}</div>
    </div>`;
}
function sleepModelHtml(M) {
  const sri = sleepRegularity(M, M.today, 14), need = sleepNeedAnalysis(M, M.today), sc = sleepCoach(M, M.today, 7);
  const comp = [
    ['Quantity', sc ? `${fmtHM(sc.avgAsleep)} h average over ${sc.n} nights` : 'no data', 'Measured by the Watch (tends to overestimate by ~40 min)'],
    ['Regularity', sri.sri != null ? `SRI ${Math.round(sri.sri)} (${sri.pairs} day pairs)` : `not enough complete nights (${sri.pairs} pairs)`, '100 = identical timing every day; students averaged 73 in the original study'],
    ['Estimated quality', sc && sc.eff != null ? `${Math.round(sc.eff * 100)}% efficiency, ${Math.round((sc.restor || 0) * 100)}% deep + REM` : 'no stage data', 'Low confidence: wrist sleep staging agrees poorly with lab measurement'],
    ['Body’s response', '', 'See “Recovery after load” and the HRV / resting HR predictions'],
  ];
  return `<div class="panel"><div class="panel-h"><h2>Sleep model</h2></div>
    <div class="table-wrap"><table class="t guide-t"><thead><tr><th>Component</th><th>Now</th><th>How to read it</th></tr></thead><tbody>${comp.map(c => `<tr><td>${c[0]}</td><td>${esc(c[1])}</td><td class="muted">${esc(c[2])}</td></tr>`).join('')}</tbody></table></div>
    <div class="eyebrow" style="margin-top:14px">Your sleep need</div>
    ${insightList([{ tone: need.status === 'estimated' ? 'good' : 'neutral', t: need.text }])}
    <p class="muted" style="font-size:12px;margin:8px 0 0">The app’s working sleep need is still ${fmtHM(M.prof.needBase)} h (your setting) plus extra after hard days. A learned range only replaces it once the evidence is clear, and never goes below 7 h.</p></div>`;
}
function qualityHtml(M) {
  const last = []; for (let k = 27; k >= 0; k--) last.push(M.day[addDays(M.today, -k)] || null);
  const cnt = f => last.filter(d => d && f(d)).length;
  const flags = []; for (const date of M.dates.slice(-90)) { const c = M.day[date].cal || {}; for (const k of ['hrv', 'rhr']) if (c[k] && c[k].flag) flags.push({ date, k, x: k === 'hrv' ? Math.round(Math.exp(c[k].x)) + ' ms' : c[k].x + ' bpm' }); }
  const rows = [['Overnight HRV (Apple Watch, SDNN)', cnt(d => d.hrv != null)], ['Resting heart rate', cnt(d => d.rhr != null)], ['Sleep', cnt(d => d.sleepMin != null)], ['All-day heart rate', cnt(d => d.a && d.a.hr5)], ['Workouts', cnt(d => d.acts.length)], ['Morning check-in', cnt(d => { const j = checkinOf(M, d.date); return j && j.readiness != null; })]];
  return `<div class="panel"><div class="panel-h"><h2>Data quality</h2><span class="aside">last 28 days</span></div>
    ${rows.map(r => `<div class="stage"><span style="font-size:12px">${esc(r[0])}</span><div class="bar"><span style="width:${r[1] / 28 * 100}%;background:var(--accent)"></span></div><span class="val">${r[1]} / 28 days</span></div>`).join('')}
    <p class="muted" style="font-size:12px;margin:10px 0 0">${flags.length ? `Flagged as likely sensor artifacts in the last 90 days (kept, but left out of baselines): ${flags.slice(-6).map(f => `${fmtDayShort(f.date)} ${f.k.toUpperCase()} ${f.x}`).join(', ')}.` : 'No readings flagged as likely artifacts in the last 90 days.'} Missing values are never filled in. Model ${esc(CAL_VERSION)}; calculated in ${M.cal.ms} ms.</p></div>`;
}
function methodsHtml() {
  return `<div class="panel"><div class="panel-h"><h2>Methods</h2><span class="aside">what each number is based on</span></div>
    <p class="sub" style="margin:0 0 10px">For personal training analysis and education, not medical diagnosis. Each method is labelled by how strongly evidence supports it.</p>
    ${METHODS.map(m => `<details class="method"><summary><b>${esc(m.title)}</b>${evChip(m.ev)}</summary>
      <dl><dt>Why</dt><dd>${esc(m.why)}</dd><dt>Inputs</dt><dd>${esc(m.vars)}</dd><dt>Method</dt><dd>${esc(m.how)}</dd><dt>Assumptions and limits</dt><dd>${esc(m.limits)}</dd><dt>How it’s evaluated</dt><dd>${esc(m.eval)}</dd><dt>Sources</dt><dd>${refLinks(m.refs)}</dd></dl></details>`).join('')}</div>`;
}
VIEWS.model = (v) => {
  const M = S.model; if (!M || M.empty) { v.innerHTML = emptyStateHtml(); return; }
  const st = (label, ok, txt) => `<div class="tile"><div class="k">${esc(label)}</div><div class="v" style="font-size:18px">${ok === 'ok' ? 'Calibrated' : ok === 'part' ? 'Learning' : 'Waiting'}</div><div class="d">${esc(txt)}</div></div>`;
  const tday = M.day[M.today] || {}, hz = tday.cal && tday.cal.hrv, rz = tday.cal && tday.cal.rhr;
  const bestPred = Object.values(M.pred).filter(p => p.status === 'model').length;
  v.innerHTML = `
  <div class="tiles">
    ${st('HRV baseline', hz && hz.n28 >= 20 ? 'ok' : hz && hz.n28 >= 10 ? 'part' : '', hz ? `${hz.n28} of last 28 nights` : 'no HRV yet')}
    ${st('Resting HR baseline', rz && rz.n28 >= 20 ? 'ok' : rz && rz.n28 >= 10 ? 'part' : '', rz ? `${rz.n28} of last 28 days` : 'no data')}
    ${st('Check-ins', M.checkins >= 36 ? 'ok' : M.checkins ? 'part' : '', `${M.checkins} logged; personal readiness model needs ~36`)}
    ${st('Predictions', bestPred ? 'ok' : Object.values(M.pred).some(p => p.status === 'baseline') ? 'part' : '', bestPred ? `${bestPred} target${bestPred > 1 ? 's' : ''} use a personalized model` : 'simple baselines until a model proves better')}
  </div>
  ${outlookHtml(M, false)}
  <div class="panel"><div class="panel-h"><h2>Prediction accuracy</h2><span class="aside">tested day by day on data the model hadn’t seen</span></div>${accuracyHtml(M)}</div>
  ${responsesHtml(M)}
  ${sleepModelHtml(M)}
  ${qualityHtml(M)}
  ${methodsHtml()}`;
  drawAccuracy(v, M);
};
