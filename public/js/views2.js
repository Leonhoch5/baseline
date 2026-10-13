// ---------- coaching views: training status, recovery, sleep coach, weekly report ----------
const TONE_COLOR = { good: 'var(--rec-hi)', warn: 'var(--rec-mid)', bad: 'var(--rec-lo)', neutral: 'var(--muted)' };
const TONE_CHIP = { good: 'hi', warn: 'mid', bad: 'lo', neutral: '' };
function toneChip(tone, text) { return `<span class="chip ${TONE_CHIP[tone] || ''}"><i></i>${esc(text)}</span>`; }
function insightList(items) {
  if (!items || !items.length) return '';
  return `<div class="insights">${items.map(it => `<div class="insight tone-${it.tone}"${it.tab ? ` data-action="tab" data-tab="${it.tab}" role="button" tabindex="0"` : ''}><i></i><div>${it.h ? `<b>${esc(it.h)}</b>` : ''}<span>${esc(it.t)}</span></div></div>`).join('')}</div>`;
}
function statusPanelHtml(st, full) {
  if (!st) return '';
  const meter = ['detraining', 'recovering', 'maintaining', 'productive', 'ramping', 'overreaching'];
  const pos = st.key === 'strained' ? 4 : st.key === 'building' ? -1 : meter.indexOf(st.key);
  return `<div class="panel status-panel tone-${st.tone}">
    <div class="panel-h"><h2>Training status</h2>${toneChip(st.tone, st.label)}${full ? '' : '<span class="aside"><button class="btn sm ghost" data-action="tab" data-tab="strain">Details</button></span>'}</div>
    ${pos >= 0 ? `<div class="status-meter" aria-hidden="true">${meter.map((k, i) => `<span class="${i === pos ? 'on' : ''}" style="--c:${TONE_COLOR[STATUS[k].tone]}">${esc(STATUS[k].label)}</span>`).join('')}</div>` : ''}
    <p class="sub" style="margin:12px 0 6px">${esc(st.summary)}</p>
    <p style="margin:0;font-weight:500">${esc(st.advice)}</p>
    ${full ? `<div class="signals">${st.signals.map(s => `<div class="sig"><i style="background:${TONE_COLOR[s.tone]}"></i><span class="k">${esc(s.k)}</span><b>${esc(s.v)}</b><span class="t">${esc(s.t)}</span></div>`).join('')}</div>
      ${st.physioKnown ? '' : '<p class="muted" style="font-size:12px;margin:10px 0 0">This verdict uses training load only. It gets sharper once overnight HRV and resting heart rate sync from your Watch.</p>'}` : ''}
  </div>`;
}
function contributorsHtml(d) {
  const cs = recoveryContributors(d);
  if (!cs.length) return '<p class="muted" style="margin:0">Contributors appear once a recovery score has been calculated.</p>';
  return cs.map(c => { const w = Math.min(50, Math.abs(c.z) / 2.5 * 50); return `<div class="ins"><span>${esc(c.label)}<br><span class="muted" style="font-size:11px">${esc(c.val)} · weight ${c.weight}%</span></span><div class="axis"><span style="${c.z >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`};background:${c.z >= 0 ? 'var(--rec-hi)' : 'var(--rec-lo)'}"></span></div><span class="v ${c.z >= 0.3 ? 'delta-good' : c.z <= -0.3 ? 'delta-bad' : ''}">${c.z >= 0 ? '+' : '−'}${Math.abs(c.z).toFixed(1)} SD</span></div>`; }).join('') +
    '<p class="muted" style="font-size:12px;margin:8px 0 0">Bars show how far each signal was from your own 30-day normal, in standard deviations. Green helps recovery, red holds it back.</p>';
}
function coachPanelHtml(M, date) {
  const st = trainingStatus(M, date), ins = dailyInsights(M, date);
  return statusPanelHtml(st, false) + (ins.length ? `<div class="panel"><div class="panel-h"><h2>Insights</h2><span class="aside">tap one for details</span></div>${insightList(ins)}</div>` : '');
}
function fitnessPanelHtml() {
  return `<div class="panel"><div class="panel-h"><h2>Fitness &amp; fatigue</h2><span class="aside">last 90 days</span></div>
    <div class="legend"><span><i style="background:var(--rec-hi)"></i>Fitness (42-day load)</span><span><i style="background:var(--rec-lo)"></i>Fatigue (7-day load)</span></div>
    <div class="chart" id="c-ff"></div>
    <div class="legend" style="margin-top:12px"><span><i style="background:var(--strain)"></i>Form = fitness − fatigue</span></div>
    <div class="chart" id="c-form"></div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">Fitness rises slowly with consistent training; fatigue reacts within days. Form below about −30% of fitness means you're carrying a lot of fatigue; positive form means you're fresh (good before a test or race).</p></div>`;
}
function drawFitness(v, M, end) {
  const el = v.querySelector('#c-ff'); if (!el) return;
  const days = []; for (let i = 89; i >= 0; i--) { const x = M.day[addDays(end, -i)]; days.push(x || { date: addDays(end, -i) }); }
  const labels = days.map(x => fmtDayShort(x.date));
  lineChart(el, { label: 'Fitness and fatigue', labels, height: 170, yMin: 0, fmtTip: x => Math.round(x), tipHead: i => fmtDay(days[i].date),
    series: [{ name: 'Fitness', values: days.map(x => x.ctl ?? null), color: 'var(--rec-hi)' }, { name: 'Fatigue', values: days.map(x => x.atl ?? null), color: 'var(--rec-lo)' }] });
  lineChart(v.querySelector('#c-form'), { label: 'Form', labels, height: 120, fmtTip: x => Math.round(x), tipHead: i => fmtDay(days[i].date),
    series: [{ name: 'Form', values: days.map(x => x.tsb ?? null), color: 'var(--strain)' }] });
}
function mixPanelHtml(M, date) {
  const mix = intensityMix(M, date, 28);
  if (!mix) return `<div class="panel"><div class="panel-h"><h2>Intensity mix</h2><span class="aside">last 4 weeks</span></div><p class="muted" style="margin:0">Needs at least 3 workouts with heart rate in the last 4 weeks.</p></div>`;
  const parts = [['Easy (Z1–2)', mix.easy, 'var(--rec-hi)'], ['Moderate (Z3)', mix.mod, 'var(--rec-mid)'], ['Hard (Z4–5)', mix.hard, 'var(--rec-lo)']];
  return `<div class="panel"><div class="panel-h"><h2>Intensity mix</h2><span class="aside">last 4 weeks · ${mix.n} workouts with HR · ${fmtHM(mix.tot)} h</span></div>
    <div class="mixbar">${parts.map(p => p[1] > 0.005 ? `<span style="flex:${p[1].toFixed(3)};background:${p[2]}" title="${esc(p[0])} ${Math.round(p[1] * 100)}%"></span>` : '').join('')}</div>
    <div class="legend" style="margin-top:8px">${parts.map(p => `<span><i class="box" style="background:${p[2]}"></i>${esc(p[0])} ${Math.round(p[1] * 100)}%</span>`).join('')}</div>
    ${insightList([{ tone: mix.tone, t: mix.t }])}
    <p class="muted" style="font-size:12px;margin:8px 0 0">Target for endurance training: about 80% easy, 20% hard, little in between.</p></div>`;
}
function sleepCoachHtml(M, date) {
  const sc = sleepCoach(M, date, 7);
  if (!sc) return '';
  const nights = []; for (let i = 13; i >= 0; i--) { const k = addDays(date, -i); nights.push(M.day[k] || { date: k }); }
  const has = nights.some(x => x.sleep);
  return `<div class="panel"><div class="panel-h"><h2>Sleep coach</h2><span class="aside">last ${sc.n} night${sc.n > 1 ? 's' : ''}</span></div>
    <dl class="kv" style="margin:0 0 14px">
      <div><dt>Avg asleep</dt><dd>${fmtHM(sc.avgAsleep)}<small>of ${fmtHM(sc.avgNeed)}</small></dd></div>
      <div><dt>Sleep debt</dt><dd>${fmtHM(sc.debt)}<small>h this week</small></dd></div>
      ${sc.bed != null ? `<div><dt>Avg bedtime</dt><dd>${fmtClock(sc.bed, true)}<small>±${Math.round(sc.bedSd || 0)} min</small></dd></div><div><dt>Avg wake-up</dt><dd>${fmtClock(sc.wake, true)}<small>±${Math.round(sc.wakeSd || 0)} min</small></dd></div>` : ''}
      ${sc.restor != null ? `<div><dt>Restorative</dt><dd>${Math.round(sc.restor * 100)}%<small>deep + REM</small></dd></div>` : ''}
      ${sc.eff != null ? `<div><dt>Efficiency</dt><dd>${Math.round(sc.eff * 100)}%</dd></div>` : ''}
    </dl>
    ${insightList(sc.tips)}
    ${has ? `<div class="eyebrow" style="margin-top:16px">Bedtime and wake-up, last 14 nights</div><div class="chart" id="c-win"></div>` : ''}</div>`;
}
function drawSleepWindows(v, M, date) {
  const el = v.querySelector('#c-win'); if (!el) return;
  const nights = []; for (let i = 13; i >= 0; i--) { const k = addDays(date, -i); nights.push(M.day[k] || { date: k }); }
  sleepWindowChart(el, nights);
}
function weeklyHtml(M, end) {
  const r = weeklyReport(M, end), c = r.cur, p = r.prev;
  const dl = (a, b, digits, goodUp, fmt) => a == null || b == null ? 'no data the week before' : `${a - b >= 0 ? '+' : '−'}${fmt ? fmt(Math.abs(a - b)) : Math.abs(a - b).toFixed(digits)} vs week before`;
  const cls = (a, b, goodUp) => a == null || b == null || goodUp == null || Math.abs(a - b) < 0.05 ? '' : (a > b) === goodUp ? 'delta-good' : 'delta-bad';
  return `<div class="panel"><div class="panel-h"><h2>Weekly performance</h2><span class="aside">${esc(fmtDayShort(r.start))} – ${esc(fmtDayShort(r.end))}</span></div>
    <div class="tiles" style="margin-bottom:14px">
      ${tile('Avg recovery', c.rec != null ? Math.round(c.rec) : null, '%', dl(c.rec, p.rec, 0), cls(c.rec, p.rec, true))}
      ${tile('Avg strain', c.strain != null ? c.strain.toFixed(1) : null, '', dl(c.strain, p.strain, 1), '')}
      ${tile('Training load', c.load ? Math.round(c.load) : null, '', dl(c.load || null, p.load || null, 0), '')}
      ${tile('Workouts', c.workouts, '', fmtHM(c.workMin) + ' h total', '')}
      ${tile('Avg sleep', c.sleep != null ? fmtHM(c.sleep) : null, 'h', dl(c.sleep, p.sleep, 0, true, fmtHM), cls(c.sleep, p.sleep, true))}
    </div>
    ${insightList(r.lines)}</div>`;
}

VIEWS.recovery = (v) => {
  const M = S.model; if (!M || M.empty) { v.innerHTML = emptyStateHtml(); return; }
  const d = M.day[S.date] || { date: S.date };
  const z = recoveryZone(d.rec);
  const days = []; for (let i = 59; i >= 0; i--) { const k = addDays(S.date, -i); days.push(M.day[k] || { date: k }); }
  const last30 = days.slice(-30), recs = last30.filter(x => x.rec != null);
  const cnt = { hi: 0, mid: 0, lo: 0 }; recs.forEach(x => cnt[recoveryZone(x.rec)]++);
  const hasHrv = days.some(x => x.hrv != null), hasRhr = days.some(x => x.rhr != null);
  v.innerHTML = `
  <div class="cols">
    <div class="panel" style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:20px;align-items:center">
      <div class="dial" style="border:0;padding:0;cursor:default">${ringSvg(d.rec != null ? d.rec / 100 : 0, recColor(d.rec), d.rec != null ? d.rec + '%' : '—', d.rec != null ? REC_WORD[z].toUpperCase() : 'NO SCORE')}</div>
      <div style="display:grid;gap:8px;min-width:0"><div class="eyebrow">Recovery</div>
        <div style="font:600 26px/1.1 var(--font-display);text-transform:uppercase">${d.rec == null ? 'No score yet' : z === 'hi' ? 'Ready to perform' : z === 'mid' ? 'Moderately recovered' : 'Body needs rest'}</div>
        <p class="sub" style="margin:0;font-size:13px">${d.rec == null ? 'Recovery needs last night’s HRV and resting heart rate from your Watch. It appears after a few synced nights.' : z === 'hi' ? 'Your body handled recent strain well. A good day for intensity.' : z === 'mid' ? 'You can train, but your body isn’t fully topped up. Moderate effort fits best.' : 'Your body is still dealing with strain, stress or short sleep. Keep today light.'}</p></div>
    </div>
    <div class="panel"><div class="panel-h"><h2>What drove it</h2></div>${contributorsHtml(d)}</div>
  </div>
  ${statusPanelHtml(trainingStatus(M, S.date), false)}
  <div class="cols">
    <div class="panel"><div class="panel-h"><h2>HRV trend</h2><span class="aside">ms, overnight</span></div>
      ${hasHrv ? `<div class="legend"><span><i style="background:var(--fg-2)"></i>Nightly</span><span><i style="background:var(--rec-hi)"></i>7-day average</span><span><i class="box" style="background:var(--rec-hi);opacity:.3"></i>Your normal range</span></div><div class="chart" id="c-hrvt"></div>` : '<p class="muted" style="margin:0">No HRV yet. It comes in once the iPhone Shortcut syncs your nights.</p>'}</div>
    <div class="panel"><div class="panel-h"><h2>Resting HR trend</h2><span class="aside">bpm</span></div>
      ${hasRhr ? `<div class="legend"><span><i style="background:var(--fg-2)"></i>Daily</span><span><i style="background:var(--watch)"></i>7-day average</span><span><i class="box" style="background:var(--watch);opacity:.3"></i>Your normal range</span></div><div class="chart" id="c-rhrt"></div>` : '<p class="muted" style="margin:0">No resting heart rate in the last 60 days.</p>'}</div>
  </div>
  <div class="panel"><div class="panel-h"><h2>Last 30 days</h2>${recs.length ? `<span class="aside">${cnt.hi} green · ${cnt.mid} yellow · ${cnt.lo} red</span>` : ''}</div>
    ${recs.length ? '<div class="chart" id="c-r30"></div>' : '<p class="muted" style="margin:0">No recovery scores in the last 30 days.</p>'}
    <p class="muted" style="font-size:12px;margin:8px 0 0">A 7-day HRV average that drops below your normal range for several days is one of the most reliable early signs of overreaching or illness, often before you feel it.</p></div>`;
  const labels = days.map(x => fmtDayShort(x.date)), th = i => fmtDay(days[i].date);
  if (hasHrv) lineChart(v.querySelector('#c-hrvt'), { label: 'HRV trend', labels, fmtTip: x => Math.round(x) + ' ms', tipHead: th,
    series: [{ name: 'Nightly', values: days.map(x => x.hrv ?? null), color: 'var(--fg-2)' }, { name: '7-day', values: days.map(x => x.hrv7 ?? null), color: 'var(--rec-hi)' }],
    band: { lo: days.map(x => x.hrvBand ? x.hrvBand[0] : null), hi: days.map(x => x.hrvBand ? x.hrvBand[2] : null), color: 'var(--rec-hi)' } });
  if (hasRhr) lineChart(v.querySelector('#c-rhrt'), { label: 'Resting HR trend', labels, fmtTip: x => Math.round(x) + ' bpm', tipHead: th,
    series: [{ name: 'Daily', values: days.map(x => x.rhr ?? null), color: 'var(--fg-2)' }, { name: '7-day', values: days.map(x => x.rhr7 ?? null), color: 'var(--watch)' }],
    band: { lo: days.map(x => x.rhrBand ? x.rhrBand[0] : null), hi: days.map(x => x.rhrBand ? x.rhrBand[2] : null), color: 'var(--watch)' } });
  if (recs.length) barChart(v.querySelector('#c-r30'), { label: 'Recovery, last 30 days', yMax: 100, ticks: [0, 33, 66, 100], fmt: t => t + '%', onClick: it => { S.date = it.date; render(); },
    items: last30.map(x => ({ date: x.date, label: fmtDayShort(x.date), v: x.rec ?? null, color: recColor(x.rec), tip: { head: fmtDay(x.date), rows: x.rec != null ? [{ v: x.rec + '%', k: 'recovery', color: recColor(x.rec) }] : [{ v: 'No score' }] } })) });
};
