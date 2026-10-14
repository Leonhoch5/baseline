// ---------- Training › Race: countdown, fitness toward race day, taper, swim goal ----------
function formWord(rel) { return rel == null ? '–' : rel > 0.35 ? 'very fresh' : rel > 0.1 ? 'fresh' : rel > -0.1 ? 'neutral' : rel > -0.3 ? 'tired' : 'very tired'; }

VIEWS.race = (v) => {
  const M = S.model; if (!M || M.empty) { v.innerHTML = emptyStateHtml(); return; }
  const R = M.race;
  if (!R || !R.race) { v.innerHTML = raceSetHtml(null); return; }
  const r = R.race, past = R.days < 0;
  // phase timeline
  const tot = R.phases.reduce((a, p) => a + p.weeks, 0) || 1;
  const todayPos = R.phases.length ? clamp(daysBetween(R.phases[0].start, M.today) / (tot * 7) * 100, 0, 100) : null;
  const phaseBar = R.phases.length ? `<div class="phasebar" aria-label="Plan phases">${R.phases.map((p, i) => `<div class="ph ${R.curPhase === p ? 'on' : p.end < M.today ? 'done' : ''}" style="flex:${p.weeks}" title="${esc(p.name)} · ${esc(fmtDayShort(p.start))}–${esc(fmtDayShort(p.end))}"><span>${esc(p.name)}</span><small>${p.weeks} wk</small></div>`).join('')}${todayPos != null ? `<i class="ph-now" style="left:${todayPos}%"></i>` : ''}</div>` : '';
  const vs = R.vsPlan, rf = R.raceForm;
  const fitLine = R.nowRow && R.nowRow.actual != null ? `Fitness now <b>${Math.round(R.nowRow.actual)}</b> vs <b>${Math.round(R.nowRow.plan)}</b> on the planned curve${vs != null ? ` (${vs >= 0 ? '+' : '−'}${Math.abs(Math.round(vs * 100))}%)` : ''}.` : '';
  const vsTxt = vs == null ? '' : vs > 0.1 ? 'You’re ahead of the plan’s load. Fine if recovery stays green; otherwise ease off.' : vs < -0.15 ? 'You’re behind the plan’s load, usually from missed or shortened sessions. Don’t cram them back in; the plan has room.' : 'You’re on track with the plan’s load.';
  const tc = R.taperCut;
  const taperVerdict = tc == null ? 'The plan has no sessions in the last weeks before the race yet.' : tc >= 0.41 && tc <= 0.6 ? 'That’s inside the range that works best in studies.' : tc < 0.41 ? (rf && rf.rel > 0.1 ? 'That’s a smaller cut than the research optimum, but the weeks before are already lighter, so you still arrive fresh.' : 'That’s a smaller cut than the research optimum; it may leave some fatigue on race day.') : 'That’s a bigger cut than usual. Keep short race-pace efforts in so you stay sharp.';
  v.innerHTML = `
  <div class="panel race-hero">
    <div><div class="eyebrow">${past ? 'Race day was' : 'Race day'} · ${esc(fmtDay(r.date))} ${r.date.slice(0, 4)}</div><h2>${esc(r.name)}</h2>${r.goal ? `<p class="sub" style="margin:6px 0 0">${esc(r.goal)}</p>` : ''}</div>
    <div class="race-count">${past ? '<b>Done</b>' : `<b>${R.days}</b><span>days to go</span><small>${R.weeks} weeks${R.weekNo ? ` · plan week ${R.weekNo} of ${R.weekTotal}` : ''}</small>`}</div>
  </div>
  ${phaseBar ? `<div class="panel"><div class="panel-h"><h2>Plan phases</h2><span class="aside">${R.curPhase ? 'Now: ' + esc(R.curPhase.name) : ''}</span></div>${phaseBar}</div>` : ''}
  <div class="panel"><div class="panel-h"><h2>Fitness toward race day</h2><span class="chip">projection</span></div>
    <div class="legend"><span><i style="background:var(--accent)"></i>Your fitness</span><span><i style="background:var(--fg-2)"></i>Planned curve</span><span><i style="background:var(--rec-mid)"></i>If you follow the plan from today</span></div>
    <div class="chart" id="c-race"></div>
    <p class="sub" style="font-size:13px;margin:10px 0 0">${fitLine} ${esc(vsTxt)}${rf ? ` If you follow the plan, race-day fitness is about <b>${Math.round(rf.ctl)}</b> and form <b>${esc(formWord(rf.rel))}</b> (${rf.tsb >= 0 ? '+' : '−'}${Math.abs(Math.round(rf.tsb))}).` : ''}</p>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Fitness = 42-day load average, form = fitness minus 7-day fatigue (Banister model). Planned sessions are converted to load using how your logged workouts compared with the plan (${R.pl.n} matched sessions). A model, not a promise.</p></div>
  <div class="panel"><div class="panel-h"><h2>Taper</h2><span class="aside">from ${esc(fmtDayShort(addDays(r.date, -14)))}</span></div>
    <p style="margin:0 0 8px">${tc != null ? `Your plan cuts weekly load by <b>${Math.round(tc * 100)}%</b> in the last 2 weeks, compared with its heaviest 4-week block before that (from ${esc(fmtDayShort(R.peakStart))}). ` : ''}${esc(taperVerdict)}</p>
    <ul class="tight"><li>Taper about 2 weeks, cutting volume by roughly 40–60%.</li><li>Keep intensity: short efforts at race pace stay in.</li><li>Keep how often you train; make sessions shorter rather than skipping them.</li><li>Sleep and easy days matter most in the final week; aim to start with “fresh” form.</li></ul>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Based on the meta-analysis by Bosquet et al. 2007 (Med Sci Sports Exerc). Individual responses vary.</p></div>
  ${swimGoalHtml(R)}
  ${r.manual ? raceSetHtml(r) : ''}`;
  drawRaceChart(v.querySelector('#c-race'), R, M);
  drawSwimChart(v.querySelector('#c-swim'), R, M);
};

function drawRaceChart(el, R, M) {
  if (!el) return;
  const step = R.series.length > 200 ? 3 : 1, rows = R.series.filter((x, i) => i % step === 0 || x.date === M.today || x.date === R.race.date);
  const ti = rows.findIndex(x => x.date === M.today);
  lineChart(el, {
    label: 'Fitness: actual, planned and projected to race day', height: 200, labels: rows.map(x => fmtDayShort(x.date)), tipHead: i => fmtDay(rows[i].date), fmtTip: x => Math.round(x),
    series: [
      { name: 'planned', values: rows.map(x => x.plan), color: 'var(--fg-2)', dash: '4 4', noEnd: true },
      { name: 'if you follow the plan', values: rows.map(x => x.date >= M.today ? x.proj ?? null : null), color: 'var(--rec-mid)', dash: '2 3' },
      { name: 'your fitness', values: rows.map(x => x.actual), color: 'var(--accent)' },
    ],
    vlines: [{ i: ti, label: 'today' }, { i: rows.length - 1, label: 'race' }],
  });
}

function swimGoalHtml(R) {
  const s = R.swim; if (!s) return '';
  const g = s.goal, last = s.last;
  const tests = s.tests.slice().reverse();
  const testRows = tests.map(t => `<tr><td>${esc(fmtDayShort(t.date))}</td><td>${t.cssPace ? `CSS test (400 m ${fmtMSS(t.t400, 1)}, 200 m ${fmtMSS(t.t200, 1)})` : `${t.dist} m time trial`}</td><td>${t.cssPace ? fmtMSS(t.cssPace, 1) + '/100 m' : fmtMSS(t.sec, 1) + ` (${fmtMSS(t.pace, 1)}/100 m)`}</td><td>${esc(t.src === 'plan' ? 'trainer' : t.src === 'strava' ? 'Strava' : 'you')}</td><td>${t.src === 'you' && t.id ? `<button class="btn sm ghost" data-action="swim-del" data-id="${esc(t.id)}" aria-label="Delete test">✕</button>` : ''}</td></tr>`).join('');
  const rateTxt = s.rate != null ? `Your CSS has changed by ${s.rate <= 0 ? '−' : '+'}${Math.abs(s.rate).toFixed(1)} s/100 m per month between tests${s.projected != null ? `; at that rate you’d reach ${fmtMSS(s.projected, 1)}/100 m by race day (${fmtMSS(s.projected * g.dist / 100)} for ${g.dist} m)` : ''}.` : 'A second test will show how fast your pace is improving.';
  const trend = s.recentBest != null ? `Fastest average moving pace in a session: ${fmtMSS(s.recentBest, 1)}/100 m in the last 4 weeks${s.beforeBest != null ? ` (vs ${fmtMSS(s.beforeBest, 1)} the 4 weeks before)` : ''}. Volume ${(s.recentVol / 1000).toFixed(1)} km in ${s.recentN} swims${s.beforeVol ? ` (vs ${(s.beforeVol / 1000).toFixed(1)} km)` : ''}.` : '';
  return `<div class="panel" id="swimGoal"><div class="panel-h"><h2>Swim goal: ${g.dist} m under ${fmtMSS(g.sec)}</h2><span class="aside">needs ${fmtMSS(s.goalPace, 2)}/100 m</span></div>
    <div class="tiles swim-tiles" style="margin-bottom:12px">
      ${tile('Critical swim speed', last ? fmtMSS(last.cssPace, 1) : null, '/100m', last ? 'test ' + fmtDayShort(last.date) : 'no test yet', '')}
      ${tile('Predicted ' + g.dist + ' m', s.pred != null ? fmtMSS(s.pred) : null, '', s.pred != null ? 'at CSS pace, in the pool' : '', '')}
      ${tile('Gap to goal', s.gap != null ? (s.gap > 0 ? '+' : '−') + Math.abs(s.gap).toFixed(1) : null, 's/100 m', s.gap != null ? (s.gap > 0 ? fmtMSS(s.pred - g.sec) + ' over ' + fmtMSS(g.sec) : 'goal pace reached') : '', s.gap > 0 ? 'delta-bad' : 'delta-good')}
      ${tile('Needed per month', s.needRate != null && s.gap > 0 ? Math.abs(s.needRate).toFixed(1) : null, 's/100 m', s.needRate != null && s.gap > 0 ? 'faster, steady until race day' : '', '')}
    </div>
    <p class="sub" style="font-size:13px;margin:0 0 8px">${esc(rateTxt)} ${esc(trend)}</p>
    <div class="legend"><span><i class="box" style="background:var(--sleep)"></i>Average moving pace per swim</span><span><i style="background:var(--rec-mid)"></i>CSS</span><span><i style="background:var(--rec-hi)"></i>Goal pace</span></div>
    <div class="chart" id="c-swim"></div>
    <p class="muted" style="font-size:12px;margin:6px 0 12px">CSS = 200 m ÷ (400 m time − 200 m time), roughly the pace you can hold for about 30 minutes, so it approximates ${g.dist} m race pace in the pool. Open water, a wetsuit, current and the start change the real race time. Session paces include easy work and drills, so they sit around or above CSS.${s.nextTest ? ' ' + esc(s.nextTest.replace(/ and send Claude[^.]*\./, '. Enter the times below.')) : ''}</p>
    <details class="method"${tests.length ? '' : ' open'}><summary><b>Tests</b><span class="muted" style="font-size:12px">${tests.length} logged · Strava swims named “test” or “TT” at 200/400/1600 m are picked up automatically</span></summary>
      ${testRows ? `<div class="table-wrap" style="margin-top:8px"><table class="t"><thead><tr><th>Date</th><th>Test</th><th>Result</th><th>From</th><th></th></tr></thead><tbody>${testRows}</tbody></table></div>` : ''}
      <form class="swim-form" data-form="swim-add">
        <label>Date<input type="date" name="date" value="${esc(M_today())}" max="${esc(M_today())}" required></label>
        <label>Type<select name="kind"><option value="css">CSS test (400 m + 200 m)</option><option value="tt1600">1600 m time trial</option><option value="tt1500">1500 m time trial</option></select></label>
        <label class="f-css">400 m time<input name="t400" placeholder="6:35.2" inputmode="decimal"></label>
        <label class="f-css">200 m time<input name="t200" placeholder="3:14.0" inputmode="decimal"></label>
        <label class="f-tt" hidden>Time<input name="sec" placeholder="26:40" inputmode="decimal"></label>
        <button class="btn primary" type="submit">Add test</button>
        <span class="muted" id="swimMsg" style="font-size:12px"></span>
      </form>
    </details></div>`;
}
function M_today() { return (S.model && S.model.today) || todayYmd(); }

function drawSwimChart(el, R, M) {
  const s = R.swim; if (!el || !s) return;
  const n = 120, dates = []; for (let i = n - 1; i >= 0; i--) dates.push(addDays(M.today, -i));
  const by = {}; for (const w of s.swims) if (w.date >= dates[0]) by[w.date] = Math.min(by[w.date] ?? Infinity, w.pace);
  const hl = [{ v: s.goalPace, color: 'var(--rec-hi)', label: 'goal ' + fmtMSS(s.goalPace, 1), start: true }];
  if (s.last) hl.push({ v: s.last.cssPace, color: 'var(--rec-mid)', label: 'CSS ' + fmtMSS(s.last.cssPace, 1) });
  const vals = Object.values(by); if (!vals.length) { el.innerHTML = '<p class="muted">No pool swims with distance in the last 4 months.</p>'; return; }
  // keep the axis on the useful range; very slow outliers (drills, kick sets) are pinned to the bottom edge
  const lo = Math.floor((Math.min(s.goalPace, ...vals) - 3) / 5) * 5, hi = Math.max(lo + 30, Math.ceil((Math.min(Math.max(...vals), (median(vals) || 120) + 25) + 3) / 5) * 5);
  lineChart(el, { label: 'Swim pace per session, last 4 months', height: 190, invert: true, yMin: lo, yMax: hi, labels: dates.map(fmtDayShort), tipHead: i => fmtDay(dates[i]), fmt: x => fmtMSS(x), fmtTip: x => fmtMSS(x, 1) + '/100 m',
    series: [{ name: 'pace', values: dates.map(d => by[d] == null ? null : Math.min(by[d], hi)), color: 'var(--sleep)', dots: true }], hlines: hl });
}

function raceSetHtml(r) {
  return `<div class="panel"><div class="panel-h"><h2>${r ? 'Change race' : 'Add your race'}</h2></div>
    <p class="sub" style="margin:0 0 10px">${r ? 'This race was set by hand.' : 'No race found. Import a training plan with a race date in Training › Plan, or set one here.'}</p>
    <form class="swim-form" data-form="race-set"><label>Race<input name="name" value="${esc(r ? r.name : '')}" placeholder="Heidelberg Triathlon" required></label><label>Date<input type="date" name="date" value="${esc(r ? r.date : '')}" required></label><label style="flex:2 1 260px">Goal<input name="goal" value="${esc(r ? r.goal : '')}" placeholder="1600 m swim under 25:00"></label><button class="btn primary" type="submit">Save</button></form></div>`;
}
