// ---------- views ----------
const IC = {
  today: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12l4.5-3.5"/><path d="M12 3.5v2M3.5 12h2M18.5 12h2"/>',
  recovery: '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/><path d="M7.5 12.5h2.5l1.5-2.5 2 4 1.5-1.5h1.5"/>',
  model: '<path d="M4 19.5h16"/><path d="M6.5 16l4-5 3 3 4.5-6.5"/><circle cx="18" cy="7.5" r="1.2"/>',
  sleep: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/>',
  strain: '<path d="M13 3L5 13.5h6l-1 7.5 8-10.5h-6z"/>',
  activities: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  trends: '<path d="M4 4v16h16"/><path d="M7.5 15l4-4.5 3 3L20 7"/>',
  training: '<path d="M13 3L5 13.5h6l-1 7.5 8-10.5h-6z"/>',
  race: '<path d="M5.5 21V4"/><path d="M5.5 4.5h12l-2.5 4 2.5 4h-12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  journal: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1v16h-11a2 2 0 0 1-2-2v-14a1 1 0 0 1 1-1z"/><path d="M9 8h6.5M9 12h6.5M5.5 18.5a2 2 0 0 1 2-2h11"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4M8 14h2M11 14h2M14 14h2M8 17h2"/>',
  data: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>', right: '<path d="M9.5 6l6 6-6 6"/>',
};
const SPORT_IC = {
  run: '<circle cx="14.5" cy="4.5" r="1.7"/><path d="M8 11l3-3.5 4 1.5 2 3h3M11.5 8l-2 5.5 4 2.5-1.5 5M9.5 13.5L6.5 19"/>',
  ride: '<circle cx="6" cy="16.5" r="3.5"/><circle cx="18" cy="16.5" r="3.5"/><path d="M6 16.5l3.5-7h6l2.5 7M9.5 9.5l2.5 7H6M13.5 6.5h2.5"/>',
  swim: '<path d="M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2-1.5 4.5-1.5S19 17 21 17"/><circle cx="16" cy="7.5" r="1.7"/><path d="M5.5 13l5-4.5 3.5 3.5"/>',
  walk: '<circle cx="12.5" cy="4.5" r="1.7"/><path d="M12 8l-1.5 6 3 2.5V21M10.5 9.5l-3 3.5M12 8l3.5 3.5M10.5 14l-2.5 7"/>',
  strength: '<path d="M3.5 10v4M6.5 7.5v9M17.5 7.5v9M20.5 10v4M6.5 12h11"/>',
  hiit: IC.strain, mobility: '<circle cx="12" cy="5" r="1.7"/><path d="M4 11.5h16M12 8.5v7l-4 5M12 15.5l4 5"/>',
};
SPORT_IC.hike = SPORT_IC.walk;
function icon(p) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`; }
function sportIcon(s) { return icon(SPORT_IC[s] || IC.activities); }
const REC_COLOR = { hi: 'var(--rec-hi)', mid: 'var(--rec-mid)', lo: 'var(--rec-lo)' };
const REC_WORD = { hi: 'Green', mid: 'Yellow', lo: 'Red' };
function recColor(r) { const z = recoveryZone(r); return z ? REC_COLOR[z] : 'var(--muted)'; }
function f1(x) { return x == null ? '–' : x.toFixed(1); }
function pct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }
function srcBadges(a) {
  return a.sources.map(s => `<span class="src ${s === 'Strava' ? 'strava' : s === 'Apple Watch' ? 'watch' : 'health'}"><i></i>${esc(s)}</span>`).join('');
}
function zoneBar(hb, hrMax, bounds) {
  const z = zonesFromHist(hb, hrMax, bounds), tot = z.reduce((a, b) => a + b, 0); if (tot < 1) return '';
  return `<div class="zbar" title="Time in heart-rate zones 1–5">${z.map((m, k) => m > 0 ? `<span style="flex:${m.toFixed(2)};background:var(--strain);opacity:${(0.25 + k * 0.1875).toFixed(2)}"></span>` : '').join('')}</div>`;
}
function actRow(a, M, showDate) {
  const meta = [fmtClock(a.ls), fmtDurLong(a.durS / 60), a.distM ? fmtKm(a.distM) : null, a.avgHr ? a.avgHr + ' bpm avg' : null, a.elevM ? a.elevM + ' m up' : null].filter(Boolean);
  return `<div class="act">
    <div class="ic">${sportIcon(a.sport)}</div>
    <div style="min-width:0"><div class="n">${esc(a.name)}</div>
      <div class="m">${showDate ? `<span>${fmtDay(a.date)}</span>` : ''}${meta.map(m => `<span>${esc(m)}</span>`).join('')}</div>
      <div class="m" style="margin-top:4px">${srcBadges(a)}${a.merged ? '<span class="chip" title="Recorded by more than one source and merged">merged</span>' : ''}</div>
      ${zoneBar(a.hb, M.prof.hrMax, M.prof.zones)}
    </div>
    <div class="r"><span class="pill" title="Strain (based on ${esc(a.loadBasis || '')})">${f1(a.strain)}</span></div>
  </div>`;
}
function dial(kind, frac, color, val, unit, title, note, tab) {
  return `<div class="panel dial" data-action="tab" data-tab="${tab}" role="button" tabindex="0" aria-label="${esc(title + ' ' + val)}">${ringSvg(frac, color, val, unit)}<h3>${esc(title)}</h3><div class="note">${note}</div></div>`;
}
function tile(k, v, unit, d, cls) { return `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${v == null ? '–' : esc(v)}${v != null && unit ? `<small>${esc(unit)}</small>` : ''}</div><div class="d ${cls || ''}">${d || '&nbsp;'}</div></div>`; }
function deltaTxt(v, base, digits, goodUp, unit) {
  if (v == null || base == null) return ['vs 30-day baseline: building', ''];
  const dlt = v - base;
  if (Math.abs(dlt) < 0.5 * Math.pow(10, -digits)) return [`same as baseline ${base.toFixed(digits)}`, ''];
  const s = (dlt >= 0 ? '+' : '−') + Math.abs(dlt).toFixed(digits) + (unit || '');
  const good = goodUp === null ? null : goodUp ? dlt >= 0 : dlt <= 0;
  const small = Math.abs(dlt) < (digits ? 0.15 : 1);
  return [`${s} vs baseline ${base.toFixed(digits)}`, small || good === null ? '' : good ? 'delta-good' : 'delta-bad'];
}
function hrDayData(day, M) {
  const hr = hr5Array(day.a);
  const sleeps = [];
  const ds = lmsOf(day.date + 'T00:00');
  const addSl = (ls, le) => { const s = (ls - ds) / 60000, e = (le - ds) / 60000; if (e > 0 && s < 1440) sleeps.push({ s: Math.max(0, s), e: Math.min(1440, e) }); };
  if (day.sleep) addSl(day.sleep.ls, day.sleep.le);
  for (const n of day.naps) addSl(n.ls, n.le);
  const nx = M.day[addDays(day.date, 1)]; if (nx && nx.sleep) addSl(nx.sleep.ls, nx.sleep.le);
  const acts = day.acts.map(a => ({ s: minOfDayLms(a.ls), e: Math.min(1440, minOfDayLms(a.ls) + a.durS / 60), label: a.name }));
  return { hr, sleeps, acts, hrMax: M.prof.hrMax };
}
function noDayData(M) {
  const last = [...M.dates].reverse().find(d => M.day[d].sleep || (M.day[d].a && M.day[d].a.hb));
  return `<div class="panel empty"><h2>No data for ${esc(fmtDay(S.date))}</h2><p>Nothing from your Apple Watch or Strava has been imported for this day yet.${last ? ' Your most recent data is from ' + esc(fmtDay(last)) + '.' : ''}</p>
    <div class="row">${last ? `<button class="btn primary" data-action="goto" data-date="${last}">Go to ${esc(fmtDayShort(last))}</button>` : ''}<button class="btn" data-action="drive-sync">Check iPhone data now</button></div><div id="driveStatus" style="width:100%;max-width:560px">${driveStatusHtml(S.driveSync)}</div></div>`;
}
function emptyStateHtml() {
  return `<div class="panel empty">
    <div class="eyebrow">Get started</div>
    <h2>Bring in your training data</h2>
    <p>Baseline turns your Apple Watch heart rate, HRV and sleep into daily recovery, strain and sleep scores, merges in your Strava activities, and checks them against your training plan.</p>
    <div class="row" style="justify-content:center"><button class="btn primary" data-action="tab" data-tab="data">Set up automatic sync</button><button class="btn" data-action="sample">Preview with sample data</button></div>
  </div>`;
}

const VIEWS = {};
VIEWS.today = (v) => {
  const M = S.model; if (!M || M.empty) { v.innerHTML = emptyStateHtml(); return; }
  const d = M.day[S.date];
  if (!d || (!d.a && !d.acts.length)) {
    const c = coachFor(d || { date: S.date }, M);
    if (!c.planned.length && !c.rest) { v.innerHTML = noDayData(M); return; }
    v.innerHTML = sickTodayHtml(M) + (S.planEdit && S.planEdit.mode === 'sick' ? planEditFormHtml(M) : '') + `<div class="panel coach"><div><div class="eyebrow">${S.date === M.today ? "Today's plan" : 'Plan for ' + esc(fmtDay(S.date))}</div><h2>${esc(c.head)}</h2><p>${esc(c.body)}</p>${plannedListHtml(c, M)}${S.date === M.today && !c.sick && !S.planEdit ? '<button class="btn sm ghost" style="margin-top:10px" data-action="pe-open" data-mode="sick">Feeling sick or injured?</button>' : ''}</div>
      <div><div class="eyebrow">Strain target</div><p class="muted" style="font-size:13px;margin:8px 0 0">${c.target[0]}–${c.target[1]} on the 0–21 scale. It narrows once your recovery score is available.</p></div></div>
      <div class="panel"><div class="panel-h"><h2>No Watch data for this day yet</h2></div><p class="sub" style="margin:0 0 12px">Heart rate, sleep and HRV arrive when the iPhone Shortcut syncs; workouts arrive from Strava.</p>
      <div class="row"><button class="btn" data-action="drive-sync">Check iPhone data now</button><button class="btn ghost" data-action="tab" data-tab="data">Sync settings</button></div><div id="driveStatus" style="margin-top:10px">${driveStatusHtml(S.driveSync)}</div></div>` + testDueNoticeHtml(M) + coachPanelHtml(M, S.date);
    return;
  }
  const z = recoveryZone(d.rec), coach = coachFor(d, M);
  const topWhy = d.recWhy && d.recWhy.length ? d.recWhy.filter(w => Math.abs(w.pts) >= 0.15).slice(0, 2).map(w => `${w.label} ${w.pts >= 0 ? '↑' : '↓'}`).join(' · ') : '';
  const recNote = d.rec != null ? (topWhy || 'All signals near your normal') + (d.recConf ? ` · ${d.recConf.level} confidence` : '') : d.calibrating ? 'Baseline building: needs about 10 nights' : d.recMissing && d.recMissing.length ? d.recMissing[0][0].toUpperCase() + d.recMissing[0].slice(1) : 'Wear your Watch to sleep';
  const sleepNote = d.sleepMin != null ? `${fmtHM(d.sleepMin)} of ${fmtHM(d.need)} needed` : 'No sleep recorded';
  const ssW = sleepScoreWord(d.sleepScore);
  const [lo, hi] = coach.target;
  const st = d.strain || 0;
  const sessionHtml = plannedListHtml(coach, M);
  const hrvD = deltaTxt(d.hrv, d.base.hrv, 0, true, ' ms'), rhrD = deltaTxt(d.rhr, d.base.rhr, 0, false, ''), respD = deltaTxt(d.resp, d.base.resp, 1, null, '');
  const tempD = d.tempDev != null ? [(d.tempDev >= 0 ? '+' : '−') + Math.abs(d.tempDev).toFixed(2) + ' °C vs baseline', Math.abs(d.tempDev) > 0.5 ? 'delta-bad' : ''] : ['baseline building', ''];
  v.innerHTML = `
  <div class="dials">
    ${dial('rec', d.rec != null ? d.rec / 100 : 0, recColor(d.rec), d.rec != null ? d.rec + '%' : '—', d.rec != null ? REC_WORD[z].toUpperCase() : d.calibrating ? 'CALIBRATING' : 'NO SCORE', 'Recovery', esc(recNote), 'recovery')}
    ${dial('strain', st / 21, 'var(--strain)', d.strain != null ? f1(d.strain) : '—', 'OF 21', 'Strain', esc(d.acts.length ? d.acts.length + (d.acts.length > 1 ? ' activities' : ' activity') : 'No workouts'), 'strain')}
    ${dial('sleep', d.sleepScore != null ? d.sleepScore / 100 : 0, 'var(--sleep)', d.sleepScore != null ? d.sleepScore + '%' : '—', ssW ? ssW.toUpperCase() : 'NO DATA', 'Sleep', esc(sleepNote), 'sleep')}
  </div>
  ${sickTodayHtml(M)}
  ${S.planEdit && S.planEdit.mode === 'sick' ? planEditFormHtml(M) : ''}
  <div class="panel coach">
    <div><div class="eyebrow">${S.date === M.today ? "Today's guidance" : 'Guidance for ' + esc(fmtDay(S.date))}</div><h2>${esc(coach.head)}</h2><p>${esc(coach.body)}</p>${sessionHtml}${S.date === M.today && !coach.sick && !S.planEdit ? '<button class="btn sm ghost" style="margin-top:10px" data-action="pe-open" data-mode="sick">Feeling sick or injured?</button>' : ''}</div>
    <div><div class="eyebrow">Strain target</div>
      <div class="scale" aria-label="Strain ${f1(d.strain)} with target ${lo} to ${hi}"><div class="band" style="left:${lo / 21 * 100}%;width:${(hi - lo) / 21 * 100}%"></div><div class="fill" style="width:${st / 21 * 100}%"></div><div class="mark" style="left:${clamp(st / 21 * 100, 4, 96)}%">${f1(d.strain)}</div></div>
      <div class="scale-ticks"><span>0</span><span>7</span><span>14</span><span>21</span></div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">The shaded band is the strain range that fits ${d.rec != null ? 'a ' + REC_WORD[z].toLowerCase() + ' recovery' : 'an average day'}: ${lo}–${hi}. ${st >= hi ? 'You have reached it.' : st >= lo ? 'You are in range.' : `About ${f1(lo - st)} more to reach it.`}</p>
    </div>
  </div>
  ${testDueNoticeHtml(M)}
  ${coachPanelHtml(M, S.date)}
  ${bodySignalsHtml(M, S.date)}
  ${outlookHtml(M, true)}
  <div class="panel"><div class="panel-h"><h2>Activities</h2><span class="aside">${d.acts.length ? d.acts.length + ' today' : ''}</span></div>
    ${d.acts.length ? `<div class="acts">${d.acts.map(a => actRow(a, M)).join('')}</div>` : '<p class="muted" style="margin:0">No workouts recorded on this day.</p>'}</div>
  <details class="more" id="todayMore" ${lsGet('baseline.todayMore') === '1' ? 'open' : ''}><summary><span>Vitals &amp; heart rate</span><span class="muted">HRV ${d.hrv != null ? Math.round(d.hrv) : '–'} · RHR ${d.rhr ?? '–'} · resp ${d.resp != null ? d.resp.toFixed(1) : '–'}</span></summary>
  <div class="tiles">
    ${tile('HRV', d.hrv != null ? Math.round(d.hrv) : null, 'ms', hrvD[0], hrvD[1])}
    ${tile('Resting HR', d.rhr, 'bpm', rhrD[0], rhrD[1])}
    ${tile('Respiratory rate', d.resp != null ? d.resp.toFixed(1) : null, 'rpm', respD[0], '')}
    ${tile('Asleep', d.sleepMin != null ? fmtHM(d.sleepMin) : null, 'h', d.sleepMin != null ? 'need ' + fmtHM(d.need) : '', '')}
    ${tile('Blood oxygen', d.spo2 != null ? Math.round(d.spo2) : null, '%', d.spo2 != null ? 'average while asleep' : 'not measured', '')}
    ${tile('Wrist temp', d.tempDev != null ? (d.tempDev >= 0 ? '+' : '−') + Math.abs(d.tempDev).toFixed(1) : d.temp != null ? d.temp.toFixed(1) : null, '°C', tempD[0], tempD[1])}
  </div>
  <div class="panel"><div class="panel-h"><h2>Heart rate</h2><span class="aside">5-minute averages · zones from max HR ${M.prof.hrMax}</span></div>
    <div class="legend"><span><i style="background:var(--watch)"></i>Heart rate</span><span><i class="box" style="background:var(--sleep);opacity:.4"></i>Sleep</span><span><i class="box" style="background:var(--strain);opacity:.45"></i>Activity</span></div>
    <div class="chart" id="c-day"></div></div></details>`;
  const more = v.querySelector('#todayMore');
  const draw = () => { const el = v.querySelector('#c-day'); if (!more.open || el.dataset.drawn) return; el.dataset.drawn = '1'; const hd = hrDayData(d, M); if (hd.hr.some(x => x != null)) dayChart(el, hd); else el.innerHTML = '<p class="muted">No heart-rate readings for this day.</p>'; };
  more.addEventListener('toggle', () => { lsSet('baseline.todayMore', more.open ? '1' : '0'); draw(); });
  draw();
};

VIEWS.sleep = (v) => {
  const M = S.model; if (!M || M.empty) { v.innerHTML = emptyStateHtml(); return; }
  const d = M.day[S.date];
  const sl = d && d.sleep;
  const last14 = []; for (let i = 13; i >= 0; i--) { const k = addDays(S.date, -i); last14.push(M.day[k] || { date: k }); }
  const tonight = d ? sleepPlanner(d, M) : null;
  if (!sl && d && d.sleepSummary) {
    v.innerHTML = `<div class="panel"><div class="eyebrow">Night ending ${esc(fmtDay(S.date))}</div><div style="font:600 34px/1.1 var(--font-display);letter-spacing:-.02em;margin-top:6px">${fmtHM(d.sleepMin)} <span class="muted" style="font-size:18px">asleep · ${pct(d.perf)} of ${fmtHM(d.need)} needed</span></div>
      <p class="sub" style="margin:8px 0 0">Only the total is known for this night (from your Apple Health history), so stages and bed times aren't available. The sleep score (${d.sleepScore ?? '–'}%) is based on duration alone.</p></div>
      <div class="panel"><div class="panel-h"><h2>Last 14 nights</h2></div><div class="legend"><span><i class="box" style="background:var(--sleep)"></i>Asleep</span><span><i style="background:var(--fg-2)"></i>Sleep need</span></div><div class="chart" id="c-14"></div></div>`;
    v.insertAdjacentHTML('beforeend', sleepCoachHtml(M, S.date)); drawSleepWindows(v, M, S.date);
    sleepBars(v.querySelector('#c-14'), last14); return;
  }
  if (!sl) {
    v.innerHTML = `${d && d.naps && d.naps.length ? '' : ''}<div class="panel empty"><h2>No sleep recorded</h2><p>There is no main sleep from your Apple Watch for the night ending ${esc(fmtDay(S.date))}. Sleep tracking needs the Watch worn overnight with Sleep Focus or a sleep schedule turned on.</p></div>
      <div class="panel"><div class="panel-h"><h2>Last 14 nights</h2></div><div class="chart" id="c-14"></div></div>` + sleepCoachHtml(M, S.date);
    drawSleepWindows(v, M, S.date); sleepBars(v.querySelector('#c-14'), last14); return;
  }
  const stg = [['Awake', sl.awake, 'var(--st-awake)'], ['REM', sl.rem, 'var(--st-rem)'], ['Light', sl.core + (sl.unspec || 0), 'var(--st-core)'], ['Deep', sl.deep, 'var(--st-deep)']];
  const tot = stg.reduce((a, s) => a + s[1], 0) || 1;
  const np = d.needParts;
  v.innerHTML = `
  <div class="cols">
    <div class="panel" style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:20px;align-items:center">
      <div class="dial" style="border:0;padding:0;cursor:default">${ringSvg(d.sleepScore != null ? d.sleepScore / 100 : 0, 'var(--sleep)', d.sleepScore != null ? d.sleepScore + '%' : '—', (sleepScoreWord(d.sleepScore) || 'SLEEP SCORE').toUpperCase())}</div>
      <div style="display:grid;gap:12px;min-width:0">
        <div><div class="eyebrow">Hours of sleep</div><div style="font:600 34px/1 var(--font-display)">${fmtHM(d.sleepMin)} <span class="muted" style="font-size:18px">/ ${fmtHM(d.need)} needed · ${pct(d.perf)}</span></div></div>
        <div class="muted">${fmtClock(sl.ls)} → ${fmtClock(sl.le)}${d.naps.length ? ` · plus ${d.naps.length} nap${d.naps.length > 1 ? 's' : ''} (${fmtDurLong(d.a.sleep.napMin)})` : ''}</div>
      </div>
    </div>
    <div class="panel"><div class="panel-h"><h2>Sleep need</h2></div>
      <div class="equation"><span><b>${fmtHM(np.base)}</b>baseline</span><span>+</span><span><b>${fmtHM(np.strain)}</b>for strain</span><span>+</span><span><b>${fmtHM(np.debt)}</b>for debt</span><span>=</span><span><b>${fmtHM(d.need)}</b>needed</span></div>
      ${d.debt14 != null ? `<p class="sub" style="margin:12px 0 0;font-size:13px">${d.debt14 >= 30 ? `<b style="color:var(--rec-lo)">Sleep debt: ${fmtHM(d.debt14)} h</b> behind your need over the last two weeks. A quarter of it is added to tonight’s need; a long night repays at most 1½ h at a time.` : d.debt14 > 0 ? `Sleep debt: ${fmtHM(d.debt14)} h, nearly cleared.` : '<b style="color:var(--rec-hi)">No sleep debt</b> left after last night.'}</p>` : ''}
      ${tonight ? `<p class="muted" style="margin:14px 0 0;font-size:13px">Tonight: aim for <b style="color:var(--fg)">${fmtHM(tonight.need)}</b> asleep${tonight.keySession ? ` (15 min extra before “${esc(tonight.keySession.title)}”)` : ''}. To wake at ${fmtClock(tonight.wake, true)}, be in bed by <b style="color:var(--fg)">${fmtClock(tonight.bed, true)}</b>.</p>` : ''}
    </div>
  </div>
  ${sleepScoreHtml(d)}
  ${sleepCoachHtml(M, S.date)}
  <div class="panel"><div class="panel-h"><h2>Stages</h2><span class="aside">${esc(sl.src || '')}</span></div>
    <div class="legend">${stg.map(s => `<span><i class="box" style="background:${s[2]}"></i>${s[0]}</span>`).join('')}</div>
    <div class="chart" id="c-hyp"></div>
    <div class="stages" style="margin-top:14px">${stg.map(s => `<div class="stage"><span>${s[0]}</span><div class="bar"><span style="width:${(s[1] / tot * 100).toFixed(1)}%;background:${s[2]}"></span></div><span class="val">${fmtHM(s[1])} · ${Math.round(s[1] / tot * 100)}%</span></div>`).join('')}</div>
  </div>
  <div class="panel"><div class="panel-h"><h2>Night details</h2></div>
    <dl class="kv" style="margin:0">
      <div><dt>In bed</dt><dd>${fmtHM(sl.inBed)}</dd></div>
      <div><dt>Efficiency</dt><dd>${pct(d.eff)}</dd></div>
      <div><dt>Consistency</dt><dd>${pct(d.cons)}<small>vs last 4 nights</small></dd></div>
      <div><dt>Wake-ups</dt><dd>${sl.wake ?? '–'}</dd></div>
      <div><dt>Restorative</dt><dd>${fmtHM(sl.deep + sl.rem)}<small>deep + REM</small></dd></div>
      <div><dt>Sleeping HR</dt><dd>${sl.hrAvg ?? '–'}<small>avg · low ${sl.hrLow ?? '–'}</small></dd></div>
      <div><dt>HRV</dt><dd>${sl.hrv != null ? Math.round(sl.hrv) : '–'}<small>ms SDNN</small></dd></div>
      <div><dt>Respiratory</dt><dd>${sl.resp != null ? sl.resp.toFixed(1) : '–'}<small>rpm</small></dd></div>
      <div><dt>Blood oxygen</dt><dd>${sl.spo2 != null ? Math.round(sl.spo2) + '%' : '–'}</dd></div>
      <div><dt>Wrist temp</dt><dd>${d.tempDev != null ? (d.tempDev >= 0 ? '+' : '−') + Math.abs(d.tempDev).toFixed(2) + ' °C' : sl.temp != null ? sl.temp.toFixed(2) + ' °C' : '–'}</dd></div>
    </dl></div>
  <div class="panel"><div class="panel-h"><h2>Last 14 nights</h2><span class="aside">tap a night to open it</span></div>
    <div class="legend"><span><i class="box" style="background:var(--sleep)"></i>Asleep</span><span><i style="background:var(--fg-2)"></i>Sleep need</span></div>
    <div class="chart" id="c-14"></div></div>`;
  hypnogram(v.querySelector('#c-hyp'), sl);
  drawSleepWindows(v, M, S.date);
  sleepBars(v.querySelector('#c-14'), last14);
};
function sleepPlanner(d, M) {
  const ws = []; for (let i = 0; i < 7; i++) { const x = M.day[addDays(d.date, -i)]; if (x && x.sleep) ws.push(minOfDayLms(x.sleep.le)); }
  if (!ws.length) return null;
  const wake = median(ws);
  // tonight's need: baseline + today's strain + a quarter of the 2-week debt (max 1 h) + 15 min before a key session or test
  const tomorrow = M.plan && M.plan.sessions ? M.plan.sessions.filter(s => s.date === addDays(d.date, 1) && !s.isRest && ['hard', 'key', 'test', 'race'].includes(s.intensity)) : [];
  const keyAdj = tomorrow.length ? 15 : 0;
  const need = M.prof.needBase + (d.strain != null ? Math.max(0, d.strain - 10) * 3 : 0) + (d.debt14 ? Math.min(60, Math.round(d.debt14 * 0.25)) : 0) + keyAdj;
  const effs = []; for (let i = 0; i < 7; i++) { const x = M.day[addDays(d.date, -i)]; if (x && x.eff) effs.push(x.eff); }
  const eff = effs.length ? clamp(mean(effs), 0.75, 0.98) : 0.9;
  return { need, wake, bed: (wake - need / eff + 1440 * 2) % 1440, keySession: tomorrow[0] || null, debtPart: d.debt14 ? Math.min(60, Math.round(d.debt14 * 0.25)) : 0 };
}
function sleepBars(el, days) {
  barChart(el, {
    label: 'Hours asleep over the last 14 nights', height: 170, color: 'var(--sleep)', fmt: t => t + 'h', yMin: 0,
    items: days.map(x => ({ date: x.date, label: fmtDayShort(x.date), v: x.sleepMin != null ? x.sleepMin / 60 : null, tip: { head: fmtDay(x.date), rows: x.sleepMin != null ? [{ v: fmtHM(x.sleepMin) + ' h', k: 'asleep', color: 'var(--sleep)' }, { v: fmtHM(x.need) + ' h', k: 'needed' }, { v: pct(x.perf), k: 'of need' }, { v: x.sleepScore != null ? x.sleepScore + '%' : '–', k: 'sleep score' }] : [{ v: 'No sleep recorded' }] } })),
    line: { values: days.map(x => x.need != null && x.a ? x.need / 60 : null), color: 'var(--fg-2)' },
    onClick: it => { S.date = it.date; render(); }
  });
}

VIEWS.strain = (v) => {
  const M = S.model; if (!M || M.empty) { v.innerHTML = emptyStateHtml(); return; }
  const d = M.day[S.date];
  if (!d || (!d.a && !d.acts.length)) {
    v.innerHTML = statusPanelHtml(trainingStatus(M, S.date), true) + fitnessPanelHtml() + mixPanelHtml(M, S.date) + noDayData(M);
    drawFitness(v, M, S.date); return;
  }
  const coach = coachFor(d, M);
  const zn = d.zones, ztot = zn.reduce((a, b) => a + b, 0);
  const last14 = []; for (let i = 13; i >= 0; i--) { const k = addDays(S.date, -i); last14.push(M.day[k] || { date: k }); }
  const acwr = d.acwr;
  const acwrState = acwr == null ? ['Building', ''] : acwr > 1.5 ? ['Big jump vs usual', 'lo'] : acwr > 1.3 ? ['Ramping fast', 'mid'] : acwr >= 0.8 ? ['Close to usual', 'hi'] : ['Below usual', 'mid'];
  const last42 = []; for (let i = 41; i >= 0; i--) { const k = addDays(S.date, -i); last42.push(M.day[k] || { date: k }); }
  v.innerHTML = `
  ${statusPanelHtml(trainingStatus(M, S.date), true)}
  <div class="cols">
    <div class="panel" style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:20px;align-items:center">
      <div class="dial" style="border:0;padding:0;cursor:default">${ringSvg((d.strain || 0) / 21, 'var(--strain)', f1(d.strain), 'OF 21')}</div>
      <div style="display:grid;gap:10px;min-width:0">
        <div><div class="eyebrow">Day strain</div><div style="font:600 34px/1 var(--font-display)">${f1(d.strain)}<span class="muted" style="font-size:18px"> · target ${coach.target[0]}–${coach.target[1]}</span></div></div>
        <div class="muted" style="font-size:13px">Cardiovascular load ${Math.round(d.load)} (all-day heart rate${d.extraLoad > 1 ? ` + ${Math.round(d.extraLoad)} from activities without Watch heart rate` : ''}).</div>
      </div>
    </div>
    <div class="panel"><div class="panel-h"><h2>Heart-rate zones</h2><span class="aside">${fmtDurLong(ztot)} above 50% of max</span></div>
      <div class="stages">${zn.map((m, k) => `<div class="stage"><span title="${esc(zoneLabels(M.prof.hrMax, M.prof.zones)[k])} bpm">Zone ${k + 1}</span><div class="bar"><span style="width:${ztot ? (m / ztot * 100).toFixed(1) : 0}%;background:var(--strain);opacity:${(0.25 + k * 0.1875).toFixed(2)}"></span></div><span class="val">${fmtDurLong(m)}</span></div>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">${M.prof.zones ? `Your Strava zones: ${zoneLabels(M.prof.hrMax, M.prof.zones).map((l, k) => 'Z' + (k + 1) + ' ' + l).join(' · ')} bpm.` : `Zones are 50–60–70–80–90% of max HR (${M.prof.hrMax} bpm, from ${esc(M.prof.hrMaxSrc)}).`}</p></div>
  </div>
  <div class="panel"><div class="panel-h"><h2>Heart rate</h2></div><div class="chart" id="c-day"></div></div>
  <div class="panel"><div class="panel-h"><h2>Activities</h2></div>${d.acts.length ? `<div class="acts">${d.acts.map(a => actRow(a, M)).join('')}</div>` : '<p class="muted" style="margin:0">No workouts recorded on this day.</p>'}</div>
  <div class="cols">
    <div class="panel"><div class="panel-h"><h2>Last 14 days</h2><span class="aside">tap a day to open it</span></div><div class="chart" id="c-14"></div></div>
    ${mixPanelHtml(M, S.date)}
  </div>
  ${fitnessPanelHtml()}`;
  const hd = hrDayData(d, M);
  if (hd.hr.some(x => x != null)) dayChart(v.querySelector('#c-day'), hd); else v.querySelector('#c-day').innerHTML = '<p class="muted">No heart-rate readings for this day.</p>';
  barChart(v.querySelector('#c-14'), {
    label: 'Daily strain, last 14 days', color: 'var(--strain)', yMax: 21, ticks: [0, 7, 14, 21],
    items: last14.map(x => ({ date: x.date, label: fmtDayShort(x.date), v: x.strain ?? null, tip: { head: fmtDay(x.date), rows: x.strain != null ? [{ v: f1(x.strain), k: 'strain', color: 'var(--strain)' }].concat((x.acts || []).map(a => ({ v: f1(a.strain), k: a.name }))) : [{ v: 'No data' }] } })),
    onClick: it => { S.date = it.date; render(); }
  });
  drawFitness(v, M, S.date);
};

VIEWS.activities = (v) => {
  const M = S.model; if (!M || M.empty) { v.innerHTML = emptyStateHtml(); return; }
  const f = S.actFilter;
  const list = M.acts.filter(a => f === 'all' ? true : f === 'merged' ? a.merged : f === 'strava' ? !a.merged && a.sources.includes('Strava') : !a.sources.includes('Strava'));
  const shown = list.slice(0, S.actLimit);
  let body = '', lastDate = null;
  for (const a of shown) { if (a.date !== lastDate) { body += `<div class="day-label">${esc(fmtDay(a.date))}</div>`; lastDate = a.date; } body += actRow(a, M); }
  const merged = M.acts.filter(a => a.merged);
  const stravaN = M.acts.filter(a => a.sources.includes('Strava')).length, watchN = M.acts.filter(a => a.sources.some(s => s !== 'Strava')).length;
  v.innerHTML = `
  <div class="panel"><div class="panel-h"><h2>Overlapping recordings</h2><span class="aside">${M.acts.length} activities · ${watchN} from Apple Health · ${stravaN} from Strava</span></div>
    <p class="sub" style="margin:0 0 6px">${merged.length ? `${merged.length} workout${merged.length > 1 ? 's were' : ' was'} recorded by more than one source. Each is counted once: the name, distance and route come from Strava, heart rate from your Apple Watch.` : 'No overlapping recordings found. When the same workout shows up from your Apple Watch and Strava, it is merged here so it only counts once.'}</p>
    ${merged.slice(0, S.ovlLimit).map(a => ovlHtml(a)).join('')}
    ${merged.length > S.ovlLimit ? `<button class="btn sm" data-action="more-ovl">Show ${Math.min(20, merged.length - S.ovlLimit)} more</button>` : ''}
    ${M.splitPairs.length ? `<div class="day-label">Kept separate by you</div>${M.splitPairs.map(p => `<div class="row" style="padding:6px 0;justify-content:space-between"><span>${esc(p.a.name || SPORT_LABEL[p.a.sport])} · ${esc(p.b.name || SPORT_LABEL[p.b.sport])} <span class="muted">(${esc(fmtDay(p.a.start.slice(0, 10)))})</span></span><button class="btn sm" data-action="merge" data-key="${esc(p.key)}">Merge again</button></div>`).join('')}` : ''}
  </div>
  <div class="panel"><div class="panel-h"><h2>All activities</h2>
    <div class="seg" role="group" aria-label="Filter activities">${[['all', 'All'], ['merged', 'Merged'], ['strava', 'Strava only'], ['watch', 'Apple only']].map(([k, l]) => `<button aria-pressed="${f === k}" data-action="actfilter" data-f="${k}">${l}</button>`).join('')}</div></div>
    ${shown.length ? `<div class="acts">${body}</div>` : '<p class="muted">No activities match this filter.</p>'}
    ${list.length > shown.length ? `<div class="row" style="justify-content:center;margin-top:12px"><button class="btn" data-action="more-acts">Show more (${list.length - shown.length} left)</button></div>` : ''}
  </div>`;
};
function ovlHtml(a) {
  const p = a.pairs[0];
  const card = (x) => `<div class="ovl-card"><span class="src ${x.srcKind === 'strava' ? 'strava' : /watch/i.test(x.src) || x.hb ? 'watch' : 'health'}"><i></i>${esc(srcLabel(x))}${x.srcKind === 'apple' && !/watch/i.test(x.src) ? '' : ''}</span>
    <span class="n">${esc(x.name || (SPORT_LABEL[x.sport] + (x.type ? ' · ' + x.type : '')))}</span>
    <span class="muted">${fmtClock(x.ls)}–${fmtClock(x.le)} · ${fmtDurLong(x.durS / 60)}${x.distM ? ' · ' + fmtKm(x.distM) : ''}${x.avgHr ? ' · ' + x.avgHr + ' bpm' : ''}</span></div>`;
  return `<details class="ovl"><summary><span style="font-weight:600">${esc(a.name)}</span><span class="muted">${esc(fmtDay(a.date))} · ${fmtClock(a.ls)}</span>${srcBadges(a)}<span class="chip">${p ? Math.round(p.ratio * 100) + '% overlap' : 'merged'}</span></summary>
    <div class="ovl-grid">${a.items.map(card).join('')}</div>
    <div class="row" style="margin-left:20px"><span class="muted" style="font-size:12px">Counted once with strain ${f1(a.strain)}. Not the same workout?</span><button class="btn sm" data-action="split" data-keys="${esc(a.pairs.map(q => q.key).join('|'))}">Keep separate</button></div></details>`;
}

VIEWS.trends = (v) => {
  const M = S.model; if (!M || M.empty) { v.innerHTML = emptyStateHtml(); return; }
  const end = M.dates.includes(M.today) ? M.today : M.dates[M.dates.length - 1];
  const n = S.range, days = []; for (let i = n - 1; i >= 0; i--) { const k = addDays(end, -i); days.push(M.day[k] || { date: k }); }
  const prevDays = []; for (let i = 2 * n - 1; i >= n; i--) { const k = addDays(end, -i); if (M.day[k]) prevDays.push(M.day[k]); }
  const avg = (arr, f) => { const xs = arr.map(f).filter(x => x != null); return xs.length ? mean(xs) : null; };
  const stat = (k, f, digits, unit, goodUp) => {
    const a = avg(days, f), b = avg(prevDays, f);
    const dl = a != null && b != null ? a - b : null;
    const cls = dl == null || Math.abs(dl) < Math.pow(10, -digits) || goodUp == null ? '' : (dl > 0) === goodUp ? 'delta-good' : 'delta-bad';
    return tile(k, a == null ? null : (unit === 'h' ? fmtHM(a) : a.toFixed(digits)), unit, dl == null ? 'no earlier period' : (dl >= 0 ? '+' : '−') + (unit === 'h' ? fmtHM(Math.abs(dl)) : Math.abs(dl).toFixed(digits)) + ' vs previous ' + n + ' days', cls);
  };
  const labels = days.map(x => fmtDayShort(x.date));
  v.innerHTML = `
  ${weeklyHtml(M, end)}
  <div class="tiles">
    ${stat('Recovery', x => x.rec, 0, '%', true)}
    ${stat('HRV', x => x.hrv, 0, 'ms', true)}
    ${stat('Resting HR', x => x.rhr, 1, 'bpm', false)}
    ${stat('Strain', x => x.strain, 1, '', null)}
    ${stat('Asleep', x => x.sleepMin, 0, 'h', true)}
    ${stat('Sleep score', x => x.sleepScore, 0, '%', true)}
  </div>
  <div class="panel"><div class="panel-h"><h2>Recovery</h2><span class="aside">tap a day to open it</span></div>
    <div class="legend"><span><i class="box" style="background:var(--rec-hi)"></i>67–100 green</span><span><i class="box" style="background:var(--rec-mid)"></i>34–66 yellow</span><span><i class="box" style="background:var(--rec-lo)"></i>0–33 red</span></div>
    <div class="chart" id="c-rec"></div></div>
  <div class="cols">
    <div class="panel"><div class="panel-h"><h2>Heart-rate variability</h2><span class="aside">ms SDNN, overnight</span></div><div class="chart" id="c-hrv"></div></div>
    <div class="panel"><div class="panel-h"><h2>Resting heart rate</h2><span class="aside">bpm, lowest 30 min asleep</span></div><div class="chart" id="c-rhr"></div></div>
  </div>
  <div class="cols">
    <div class="panel"><div class="panel-h"><h2>Strain</h2></div><div class="chart" id="c-str"></div></div>
    <div class="panel"><div class="panel-h"><h2>Sleep</h2></div><div class="legend"><span><i class="box" style="background:var(--sleep)"></i>Asleep</span><span><i style="background:var(--fg-2)"></i>Sleep need</span></div><div class="chart" id="c-slp"></div></div>
  </div>
  ${days.some(x => x.a && x.a.vo2) ? `<div class="panel"><div class="panel-h"><h2>VO2 max</h2><span class="aside">mL/kg/min, Apple Watch estimate</span></div><div class="chart" id="c-vo2"></div></div>` : ''}
  <div class="panel"><div class="panel-h"><h2>Weekly summary</h2></div><div class="table-wrap">${weeklyTable(M, end, n)}</div></div>`;
  const go = it => { S.date = it.date; S.tab = 'today'; render(); };
  barChart(v.querySelector('#c-rec'), { label: 'Recovery by day', yMax: 100, ticks: [0, 33, 66, 100], fmt: t => t + '%', height: 180, onClick: go,
    items: days.map(x => ({ date: x.date, label: fmtDayShort(x.date), v: x.rec ?? null, color: recColor(x.rec), tip: { head: fmtDay(x.date), rows: x.rec != null ? [{ v: x.rec + '%', k: 'recovery', color: recColor(x.rec) }, { v: x.hrv != null ? Math.round(x.hrv) + ' ms' : '–', k: 'HRV' }, { v: x.rhr != null ? x.rhr + ' bpm' : '–', k: 'resting HR' }, { v: pct(x.perf), k: 'sleep performance' }] : [{ v: x.calibrating ? 'Calibrating' : 'No score' }] } })) });
  lineChart(v.querySelector('#c-hrv'), { label: 'HRV', labels, fmtTip: x => Math.round(x) + ' ms', series: [{ name: 'HRV', values: days.map(x => x.hrv ?? null), color: 'var(--rec-hi)' }],
    band: { lo: days.map(x => x.base && x.base.hrv ? x.base.hrv * 0.88 : null), hi: days.map(x => x.base && x.base.hrv ? x.base.hrv * 1.12 : null), color: 'var(--rec-hi)', name: 'normal range' }, tipHead: i => fmtDay(days[i].date) });
  lineChart(v.querySelector('#c-rhr'), { label: 'Resting heart rate', labels, fmtTip: x => Math.round(x) + ' bpm', series: [{ name: 'Resting HR', values: days.map(x => x.rhr ?? null), color: 'var(--watch)' }],
    band: { lo: days.map(x => x.base && x.base.rhr ? x.base.rhr - 3 : null), hi: days.map(x => x.base && x.base.rhr ? x.base.rhr + 3 : null), color: 'var(--watch)', name: 'normal range' }, tipHead: i => fmtDay(days[i].date) });
  barChart(v.querySelector('#c-str'), { label: 'Strain by day', color: 'var(--strain)', yMax: 21, ticks: [0, 7, 14, 21], onClick: go,
    items: days.map(x => ({ date: x.date, label: fmtDayShort(x.date), v: x.strain ?? null, tip: { head: fmtDay(x.date), rows: x.strain != null ? [{ v: f1(x.strain), k: 'strain', color: 'var(--strain)' }].concat((x.acts || []).map(a => ({ v: f1(a.strain), k: a.name }))) : [{ v: 'No data' }] } })) });
  sleepBars(v.querySelector('#c-slp'), days);
  const vo2El = v.querySelector('#c-vo2');
  if (vo2El) { let last = null; const vals = days.map(x => { if (x.a && x.a.vo2) last = x.a.vo2; return x.a && x.a.vo2 ? x.a.vo2 : null; });
    lineChart(vo2El, { label: 'VO2 max', labels, height: 150, fmtTip: x => x.toFixed(1), series: [{ name: 'VO2 max', values: vals, color: 'var(--rec-hi)' }], tipHead: i => fmtDay(days[i].date) }); }
};
function weeklyTable(M, end, n) {
  const rows = []; let wkStart = addDays(end, -((parseYmd(end).getDay() + 6) % 7));
  const minDate = addDays(end, -n + 1);
  while (addDays(wkStart, 6) >= minDate && rows.length < 60) {
    const ds = []; for (let i = 0; i < 7; i++) { const x = M.day[addDays(wkStart, i)]; if (x) ds.push(x); }
    const av = f => { const xs = ds.map(f).filter(x => x != null); return xs.length ? mean(xs) : null; };
    const acts = ds.reduce((a, x) => a + x.acts.length, 0), dur = ds.reduce((a, x) => a + x.acts.reduce((b, y) => b + y.durS / 60, 0), 0);
    const r = av(x => x.rec);
    rows.push(`<tr><td>${esc(fmtDayShort(wkStart))} – ${esc(fmtDayShort(addDays(wkStart, 6)))}</td><td>${r != null ? `<span class="chip ${recoveryZone(r)}"><i></i>${Math.round(r)}%</span>` : '–'}</td><td>${f1(av(x => x.hrv))}</td><td>${f1(av(x => x.rhr))}</td><td>${f1(av(x => x.strain))}</td><td>${Math.round(ds.reduce((a, x) => a + (x.load || 0), 0))}</td><td>${acts} · ${fmtHM(dur)}</td><td>${fmtHM(av(x => x.sleepMin))}</td></tr>`);
    wkStart = addDays(wkStart, -7);
  }
  return `<table class="t"><thead><tr><th>Week</th><th>Recovery</th><th>HRV ms</th><th>RHR</th><th>Strain</th><th>Load</th><th>Workouts · time</th><th>Asleep</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

VIEWS.journal = (v) => {
  const M = S.model || { journal: {}, insights: [] };
  const date = S.jdate;
  const saved = (M.journal || {})[date] || {};
  const e = S.jdraft[date] || saved;
  const dirty = !!S.jdraft[date];
  const tri = (key) => `<div class="seg" role="group" aria-label="${esc(key)}">${[[true, 'Yes'], [false, 'No']].map(([val, l]) => `<button aria-pressed="${e[key] === val}" data-action="jset" data-key="${key}" data-val="${val}">${l}</button>`).join('')}</div>`;
  const ins = (M.insights || []);
  const ready = ins.filter(i => i.ready && i.delta != null).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const notReady = ins.filter(i => !i.ready);
  const maxAbs = Math.max(10, ...ready.map(i => Math.abs(i.delta)));
  const recent = []; for (let i = 6; i >= 0; i--) recent.push(addDays(M.today || todayYmd(), -i - 1));
  const ck = addDays(date, 1), ce = (M.journal || {})[ck] || {};
  const scale = (key, n, lo, hi, dt, cur) => `<div class="seg scale-seg" role="group" aria-label="${esc(key)}">${Array.from({ length: n }, (_, k) => k + lo).map(x => `<button aria-pressed="${cur === x}" data-action="ck-set" data-date="${dt}" data-key="${key}" data-val="${x}">${x}</button>`).join('')}</div><div class="scale-ends"><span>${esc(lo === 1 && n === 10 ? 'poor' : 'none')}</span><span>${esc(n === 10 ? 'excellent' : 'severe')}</span></div>`;
  const dayActs = S.model && S.model.day && S.model.day[date] ? S.model.day[date].acts : [];
  const checkinHtml = ck > todayYmd() ? '' : `<div class="panel"><div class="panel-h"><h2>Morning check-in</h2><span class="aside">${esc(fmtDay(ck))} · ${ce.readiness != null ? 'saved' : 'not filled in yet'}</span></div>
    <p class="sub" style="margin:0 0 10px">Ten seconds each morning. These answers are what the app learns from: they let it check its predictions against how you actually felt.</p>
    <div class="ck"><label>How ready do you feel to train?</label>${scale('readiness', 10, 1, 10, ck, ce.readiness)}</div>
    <div class="ck"><label>General fatigue</label>${scale('fatigue', 5, 1, 5, ck, ce.fatigue)}</div>
    <div class="ck"><label>Muscle soreness</label>${scale('soreness', 5, 1, 5, ck, ce.soreness)}</div>
    <div class="ck"><label>How well did you sleep?</label>${scale('sleepQ', 5, 1, 5, ck, ce.sleepQ)}</div>
  </div>
  <div class="panel"><div class="panel-h"><h2>Session effort</h2><span class="aside">${esc(fmtDay(date))} · RPE 0–10, about 30 min after the session</span></div>
    ${dayActs.length ? dayActs.map(a => { const r = e.rpe ? e.rpe[a.gid] : (saved.rpe || {})[a.gid]; return `<div class="ck"><label>${esc(a.name)} <span class="muted" style="font-weight:400">· ${fmtDurLong(a.durS / 60)}</span></label><div class="seg scale-seg" role="group">${Array.from({ length: 11 }, (_, k) => k).map(x => `<button aria-pressed="${r === x}" data-action="rpe-set" data-date="${date}" data-gid="${esc(a.gid)}" data-val="${x}">${x}</button>`).join('')}</div><div class="scale-ends"><span>rest</span><span>maximal</span></div></div>`; }).join('') + '<p class="muted" style="font-size:12px;margin:8px 0 0">Effort × minutes gives session-RPE load (Foster et al. 2001), which works across swimming, strength and other sessions where heart rate is unreliable.</p>' : '<p class="muted" style="margin:0">No workouts on this day.</p>'}
  </div>`;
  v.innerHTML = checkinHtml + `
  <div class="cols">
    <div class="panel"><div class="panel-h"><h2>${esc(fmtDay(date))}</h2><span class="aside">${dirty ? 'Unsaved changes' : saved && Object.keys(saved).length ? 'Saved' : 'Not logged yet'}</span></div>
      <p class="sub" style="margin:0 0 6px">What happened on this day? Answers are compared with your recovery the next morning.</p>
      ${JOURNAL_ITEMS.map(it => `<div class="jq"><label>${esc(it.q)}</label>${tri(it.key)}</div>`).join('')}
      <div class="jq"><label>Stress level</label><div class="seg" role="group" aria-label="Stress level">${[1, 2, 3, 4, 5].map(n => `<button aria-pressed="${e.stress === n}" data-action="jset" data-key="stress" data-val="${n}">${n}</button>`).join('')}</div></div>
      <div style="padding-top:10px"><label class="eyebrow" for="jnote">Note</label><textarea id="jnote" data-action-input="jnote" placeholder="Anything else worth remembering: how the legs felt, a late night, a niggle…">${esc(e.note || '')}</textarea></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-action="jsave" ${dirty ? '' : 'disabled'}>Save entry</button>${dirty ? '<button class="btn ghost" data-action="jdiscard">Discard changes</button>' : ''}<span class="muted" id="jstatus" style="font-size:12px"></span></div>
    </div>
    <div class="panel"><div class="panel-h"><h2>What moves your recovery</h2></div>
      <p class="sub" style="margin:0 0 10px">Average next-morning recovery on days you answered yes, compared with days you answered no.</p>
      ${ready.length ? ready.map(i => { const w = Math.abs(i.delta) / maxAbs * 50; return `<div class="ins"><span>${esc(i.label)}<br><span class="muted" style="font-size:11px">${i.nYes} yes · ${i.nNo} no</span></span><div class="axis"><span style="${i.delta >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`};background:${i.delta >= 0 ? 'var(--rec-hi)' : 'var(--rec-lo)'}"></span></div><span class="v ${i.delta >= 0 ? 'delta-good' : 'delta-bad'}">${i.delta >= 0 ? '+' : '−'}${Math.abs(i.delta).toFixed(0)} pts</span></div>`; }).join('') : '<p class="muted">Log at least 3 yes and 3 no days for a behaviour to see its effect.</p>'}
      ${notReady.length ? `<p class="muted" style="font-size:12px;margin:12px 0 0">Still collecting: ${notReady.map(i => esc(i.label) + ` (${i.nYes}/${i.nNo})`).join(', ')}.</p>` : ''}
    </div>
  </div>
  <div class="panel"><div class="panel-h"><h2>Last 7 days</h2></div><div class="row">${recent.map(dd => { const has = (M.journal || {})[dd]; return `<button class="btn sm ${dd === date ? 'primary' : ''}" data-action="jdate" data-date="${dd}">${esc(fmtDay(dd))}${has ? ' ✓' : ''}</button>`; }).join('')}</div></div>`;
};

const PLAN_STATUS = { done: 'done', partial: 'cut short', missed: 'missed', skipped: 'skipped', today: 'today', upcoming: 'planned', rest: 'rest', sick: 'sick' };
function mondayOf(d) { return addDays(d, -((parseYmd(d).getDay() + 6) % 7)); }
VIEWS.plan = (v) => {
  const M = S.model; const P = M ? M.plan : { sessions: [], weeks: [], plans: [] };
  if (!P.sessions.length) {
    v.innerHTML = `<div class="panel empty"><div class="eyebrow">Training plan</div><h2>No plan yet</h2>
      <p>Add a plan from a calendar file, a spreadsheet, a Word document, pasted text or screenshots. Each session is matched against your Apple Watch and Strava workouts, with recovery-based advice for the day.</p>
      ${S.planImport ? '' : '<button class="btn primary" data-action="plan-add">Add a plan</button>'}</div>${S.planImport ? planImportHtml() : ''}`;
    return;
  }
  const today = M.today;
  const sel = P.plans.find(p => p.id === S.planSel) || P.curPlan || P.plans[0];
  const meta = (sel && sel.meta) || {};
  const pSessions = P.sessions.filter(s => s.planId === sel.id);
  const weekInfo = {}; for (const w of P.weeks || []) if (w.planId === sel.id) weekInfo['w' + w.week] = w;
  const groups = new Map();
  const pGone = (P.removed || []).filter(s => s.planId === sel.id).map(s => ({ ...s, gone: true }));
  for (const s of pSessions.concat(pGone).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.gone ? 1 : 0) - (b.gone ? 1 : 0) || (a.order || 0) - (b.order || 0))) { const key = s.week != null ? 'w' + s.week : 'm' + mondayOf(s.date); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(s); }
  const cw = P.curWeek && P.curWeek.planId === sel.id ? P.curWeek : null;
  const anchor = cw ? cw.start : sel.status === 'next' ? mondayOf(sel.start) : sel.status === 'past' ? mondayOf(addDays(sel.effEnd, -14)) : mondayOf(today);
  let keys = [...groups.keys()];
  const startOf = k => (weekInfo[k] && weekInfo[k].start) || groups.get(k)[0].date;
  if (!S.planAll) keys = keys.filter(k => { const st = startOf(k); return st >= addDays(anchor, -7) && st <= addDays(anchor, 21); });
  const todayDay = M.day[today];
  const coach = coachFor(todayDay || { date: today }, M);
  const race = meta.raceDate ? daysBetween(today, meta.raceDate) : null;
  const nextKey = pSessions.find(s => s.date > today && (s.intensity === 'key' || s.intensity === 'test' || s.intensity === 'race'));
  const totalWeeks = sel.totalWeeks;
  const planChips = `<div class="plan-switch">${P.plans.map(p => `<button class="plan-chip ${p.id === sel.id ? 'on' : ''}" data-action="plan-sel" data-id="${esc(p.id)}"><span class="chip st-${p.status === 'current' ? 'today' : p.status === 'next' ? 'upcoming' : 'rest'}">${p.status === 'current' ? 'current' : p.status === 'next' ? 'next' : 'finished'}</span><b>${esc(p.meta.name || 'Plan')}</b><small>${esc(fmtDayShort(p.start))}${p.start.slice(0, 4) !== p.effEnd.slice(0, 4) ? ' ' + p.start.slice(0, 4) : ''} – ${esc(fmtDayShort(p.effEnd))} ${p.effEnd.slice(0, 4)}</small></button>`).join('')}
    ${S.planImport ? '' : '<button class="plan-chip add" data-action="plan-add"><b>+ Add a plan</b><small>for after this one, or to replace it</small></button>'}</div>`;
  const sessionRow = (s, first) => {
    const canCheck = !s.isRest && !s.match && s.date <= today;
    const doneBy = s.checked ? (s.checked.by === 'you' ? 'marked done by you' : 'reported done' + (s.checked.note ? ': ' + s.checked.note : '')) : '';
    return `<div class="ps ${s.date === today ? 'is-today' : ''}"><div class="when">${first ? `<b>${WD[parseYmd(s.date).getDay()]}</b>${esc(fmtDayShort(s.date))}` : ''}</div>
      <div style="min-width:0"><div class="t">${esc(s.title || SPORT_LABEL[s.sportKey])}${s.target ? ` <span class="chip"${s.targetBase ? ` title="Adjusted to your latest CSS (plan said ${esc(s.targetBase)})"` : ''}>${esc(s.target)}${s.targetBase ? ' ↻' : ''}</span>` : ''}${s.optional ? ' <span class="chip">optional</span>' : ''}${testChipHtml(s)}${sessBadgesHtml(s)}</div>
        <div class="m">${[s.isRest ? null : SPORT_LABEL[s.sportKey], s.durationMin ? fmtDurLong(s.durationMin) : null, s.distance || null, s.isRest ? null : s.intensity].filter(Boolean).map(esc).join(' · ')}</div>
        ${s.details ? `<div class="m">${esc(s.details)}</div>` : ''}
        ${s.note ? `<div class="m" style="color:var(--fg-2)">${esc(s.note)}</div>` : ''}
        ${s.match ? `<div class="m" style="margin-top:2px;color:var(--fg-2)">Done: ${esc(s.match.name)} · ${fmtDurLong(s.match.durS / 60)}${s.match.distM ? ' · ' + esc(s.sportKey === 'swim' ? s.match.distM + ' m' : fmtKm(s.match.distM)) : ''}${s.match.strain != null ? ' · strain ' + f1(s.match.strain) : ''}</div>` : doneBy ? `<div class="m" style="margin-top:2px;color:var(--fg-2)">${esc(doneBy)}</div>` : ''}</div>
      <div class="r"><span class="chip st-${s.status}">${PLAN_STATUS[s.status] || s.status}</span>${canCheck && s.status !== 'sick' ? `<button class="btn sm ghost" data-action="plan-check" data-id="${esc(s.id)}">${s.checked ? 'Undo' : 'Mark done'}</button>` : ''}${s.match ? '' : `<button class="btn sm ghost" data-action="pe-open" data-mode="edit" data-id="${esc(s.id)}" aria-label="Edit session">Edit</button>`}</div></div>${sessEditHtml(s)}`;
  };
  const goneRow = (s, first) => `<div class="ps gone"><div class="when">${first ? `<b>${WD[parseYmd(s.date).getDay()]}</b>${esc(fmtDayShort(s.date))}` : ''}</div><div style="min-width:0"><div class="t">${esc(s.title || SPORT_LABEL[sportOf(s.sport || '')] || 'Session')}</div><div class="m">${s.removedBy === 'deleted' ? 'removed by you' : 'set aside: ' + esc(((P.blocks || []).find(b => b.id === s.removedBy) || {}).label || 'replaced')}</div></div><div class="r"></div></div>`;
  const paces = Array.isArray(meta.paces) ? meta.paces : [];
  const later = P.plans.find(p => p.start > sel.start);
  const delHtml = sel.id === 'main' ? '' : S.planDel === sel.id ? `<div class="row" style="margin-top:12px"><span>Delete this plan and all its sessions?</span><button class="btn danger sm" data-action="plan-del-yes" data-id="${esc(sel.id)}">Delete plan</button><button class="btn ghost sm" data-action="plan-del-no">Cancel</button><span class="muted" id="planDelStatus" style="font-size:12px"></span></div>` : `<button class="btn ghost sm" style="margin-top:10px" data-action="plan-del-ask" data-id="${esc(sel.id)}">Delete plan</button>`;
  v.innerHTML = `
  ${planChips}
  ${S.planImport ? planImportHtml() : ''}
  <div class="cols">
    <div class="panel"><div class="eyebrow">Training plan${sel.status === 'next' ? ' · starts ' + esc(fmtDay(sel.start)) : sel.status === 'past' ? ' · finished' : ''}</div><h2 style="font:700 22px/1.2 var(--font-body);letter-spacing:-.02em;margin:4px 0 6px">${esc(meta.name || 'Your plan')}</h2>
      ${meta.goal ? `<p class="sub" style="margin:0 0 12px">${esc(meta.goal)}</p>` : ''}
      <dl class="kv" style="margin:0">
        ${race != null ? `<div><dt>Race</dt><dd>${race >= 0 ? race + ' days' : 'done'}<small>${esc(fmtDay(meta.raceDate))}</small></dd></div>` : ''}
        ${cw ? `<div><dt>This week</dt><dd>Week ${cw.week}${totalWeeks ? ' of ' + totalWeeks : ''}<small>${esc(cw.phase || '')}</small></dd></div>` : ''}
        ${sel.status === 'next' ? `<div><dt>Starts in</dt><dd>${daysBetween(today, sel.start)} days<small>${esc(fmtDay(sel.start))} ${sel.start.slice(0, 4)}</small></dd></div><div><dt>Length</dt><dd>${sel.totalWeeks} weeks<small>${sel.count} sessions</small></dd></div>` : sel.status === 'current' ? `<div><dt>Done (last 4 wk)</dt><dd>${P.compliance != null ? Math.round(P.compliance * 100) + '%' : '–'}<small>${P.pastCount} sessions</small></dd></div>` : `<div><dt>Finished</dt><dd style="font-size:14px">${esc(fmtDay(sel.effEnd))} ${sel.effEnd.slice(0, 4)}</dd></div>`}
        ${nextKey ? `<div><dt>Next key session</dt><dd style="font-size:14px">${esc(nextKey.title)}<small>${esc(fmtDay(nextKey.date))}</small></dd></div>` : ''}
      </dl>
      ${cw && cw.focus ? `<p class="muted" style="font-size:13px;margin:12px 0 0">This week: ${esc(cw.focus)}</p>` : ''}
      ${later && sel.end >= later.start ? `<p class="muted" style="font-size:12px;margin:10px 0 0">“${esc(later.meta.name || 'The next plan')}” takes over from ${esc(fmtDay(later.start))}; this plan’s sessions after that are hidden.</p>` : ''}
      ${meta.source || meta.notes ? `<p class="muted" style="font-size:12px;margin:10px 0 0">${esc([meta.source ? 'Imported from ' + meta.source + '.' : '', meta.notes || ''].join(' ').trim())}</p>` : ''}
      ${delHtml}</div>
    <div class="panel"><div class="eyebrow">Today</div><h2 style="font:700 20px/1.2 var(--font-body);letter-spacing:-.02em;margin:4px 0 6px">${esc(coach.head)}</h2><p class="sub" style="margin:0">${esc(coach.body)}</p>
      <div class="row" style="margin-top:12px">${todayDay && todayDay.rec != null ? `<span class="chip ${recoveryZone(todayDay.rec)}"><i></i>Recovery ${todayDay.rec}%</span>` : ''}<span class="chip">Strain target ${coach.target[0]}–${coach.target[1]}</span></div></div>
  </div>
  ${paces.length ? (() => {
    const pu = M.race && M.race.paceUpdate && (!M.race.paceUpdate.planId || !sel || M.race.paceUpdate.planId === sel.id) ? M.race.paceUpdate : null;
    const isGoal = row => pu && pu.goal && String(row[1]).includes(pu.goal);
    const cell = row => pu && !isGoal(row) ? `${esc(scalePaceText(row[1], pu.ratio))}<div class="muted" style="font-size:11px">was ${esc(row[1])}</div>` : esc(row[1]);
    return `<div class="panel"><div class="panel-h"><h2>Swim paces</h2><span class="aside">${pu ? esc('From your CSS test on ' + fmtDay(pu.date) + ': ' + fmtMSS(pu.to, 1) + '/100 m') : meta.css ? esc('From the CSS test on ' + fmtDay(meta.css.date) + ': ' + meta.css.pace + '/100 m') : ''}</span></div>
    <div class="table-wrap"><table class="t guide-t"><thead><tr><th>Zone</th><th>Pace /100 m</th><th>Use</th></tr></thead><tbody>${paces.map(row => `<tr><td>${esc(row[0])}</td><td class="num">${cell(row)}</td><td>${esc(pu && !isGoal(row) ? scalePaceText(row[2] || '', pu.ratio, 20, 900) : row[2] || '')}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">${pu ? esc(`Updated automatically from your CSS test on ${fmtDayShort(pu.date)} (${fmtMSS(pu.from, 1)} → ${fmtMSS(pu.to, 1)}/100 m): every swim target after that date is scaled by the same factor (${pu.sessions} sessions, marked ↻). Goal race pace stays fixed. Log your next test in Training › Race.`) : meta.paceNote ? esc(meta.paceNote.replace(/ and send Claude[^.]*\./, '. Log the times in Training › Race and the paces update automatically.')) : ''}</p></div>`;
  })() : ''}
  ${S.planEdit && S.planEdit.mode !== 'edit' ? planEditFormHtml(M) : ''}
  ${planChangesHtml(M)}
  <div class="panel"><div class="panel-h"><h2>Sessions</h2><div class="row" style="gap:6px"><button class="btn sm" data-action="pe-open" data-mode="sick">Call in sick</button><button class="btn sm" data-action="pe-open" data-mode="replace">Replace a period</button><button class="btn sm" data-action="pe-open" data-mode="add">Add session</button><button class="btn sm ghost" data-action="planall">${S.planAll ? 'Show current weeks' : 'Show all weeks'}</button></div></div>
    ${keys.map(k => { const ss = groups.get(k), wi = weekInfo[k] || {}; const pastS = ss.filter(s => !s.isRest && !s.optional && s.date < today); const dn = pastS.filter(s => s.status === 'done').length;
      const isCur = cw && wi.week === cw.week;
      let lastDate = null;
      return `<div class="week"><div class="week-h"><b>${wi.week != null ? (wi.week === 0 ? 'Pre-block' : 'Week ' + wi.week) : 'Week of ' + esc(fmtDayShort(k.slice(1)))}</b>${wi.phase ? `<span class="muted" style="font-size:12px">${esc(wi.phase)}</span>` : ''}${isCur ? '<span class="chip st-today">this week</span>' : ''}${wi.deload ? '<span class="chip">lighter week</span>' : ''}<span class="muted" style="font-size:12px">${esc(fmtDayShort(ss[0].date))} – ${esc(fmtDayShort(ss[ss.length - 1].date))} · ${fmtHM(ss.filter(s => !s.optional).reduce((a, s) => a + (s.durationMin || 0), 0))} planned${pastS.length ? ` · ${dn}/${pastS.length} done` : ''}</span></div>
        ${wi.focus ? `<div class="muted" style="font-size:12px;margin:-2px 0 6px">${esc(wi.focus)}</div>` : ''}
        ${ss.map(s => { const first = s.date !== lastDate; lastDate = s.date; return s.gone ? goneRow(s, first) : sessionRow(s, first); }).join('')}</div>`; }).join('') || '<p class="muted">No sessions in these weeks.</p>'}
  </div>`;
};

VIEWS.data = (v) => {
  const R = S.real, mA = R.metaApple, mS = R.metaStrava, prof = R.profile || {};
  const M = S.model;
  const imp = S.importing;
  const sync = S.stravaSync;
  v.innerHTML = `
  ${S.dbMode === 'off' ? `<div class="notice warn">Saving is unavailable in this view, so imports only last until you close the page. Open the page inside Claude to keep your data.</div>` : ''}
  ${drivePanelHtml()}
  <div class="cols">
    <div class="panel"><div class="panel-h"><h2>Full history</h2><span class="aside">${mA && !mA.sample ? 'Imported ' + esc(new Date(mA.importedAt).toLocaleString()) : 'Optional, one time'}</span></div>
      <p class="sub" style="margin:0 0 10px">The iPhone Shortcut sends the last few days. To bring in older months as well, do one full Health export.</p>
      <ol class="steps"><li>On your iPhone, open the <b>Health</b> app and tap your profile picture.</li><li>Tap <b>Export All Health Data</b>, then <b>Export</b>. It can take a few minutes.</li><li>Save <b>export.zip</b> to Files or AirDrop it to your computer, then drop it below.</li></ol>
      <div class="row" style="margin:14px 0 10px"><label for="impMonths" class="muted" style="font-size:13px">Import the last</label>
        <select id="impMonths">${[[3, '3 months'], [6, '6 months'], [12, '12 months'], [24, '2 years'], [0, 'everything']].map(([m, l]) => `<option value="${m}" ${S.impMonths === m ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="drop" id="dropApple"><input type="file" id="fileApple" accept=".zip,.xml,application/zip,text/xml"><b>Choose export.zip</b><span class="muted" style="font-size:12px">or drop it here · export.xml also works · processed in your browser</span></label>
      <div id="impStatus" style="margin-top:12px">${importStatusHtml(imp)}</div>
      ${mA && !mA.sample ? `<p class="muted" style="font-size:12px;margin:12px 0 0">${esc(fmtDayShort(mA.from || ''))} – ${esc(fmtDayShort(mA.to || ''))} · ${(mA.hrSamples || 0).toLocaleString()} heart-rate readings · ${mA.nights || 0} nights · ${mA.workouts || 0} workouts</p>` : ''}
    </div>
    <div class="panel"><div class="panel-h"><h2>Strava</h2><span class="aside">${mS && mS.lastSync ? 'Synced ' + esc(new Date(mS.lastSync).toLocaleString()) : mS && mS.csvAt ? 'File imported ' + esc(new Date(mS.csvAt).toLocaleString()) : 'Not connected yet'}</span></div>
      <p class="sub" style="margin:0 0 12px">Live sync uses your Strava connector in Claude. Activities come in with name, distance and elevation, and heart rate for workouts your Watch didn't record.</p>
      <div class="row"><button class="btn primary" data-action="strava-sync" ${sync && sync.running ? 'disabled' : ''}>${sync && sync.running ? 'Syncing…' : mS && mS.lastSync ? 'Sync now' : 'Connect and sync'}</button>${mS && mS.lastSync ? `<button class="btn ghost" data-action="strava-full" ${sync && sync.running ? 'disabled' : ''}>Re-sync full history</button>` : ''}</div>
      <div id="syncStatus" style="margin-top:12px">${syncStatusHtml(sync)}</div>
      <details style="margin-top:14px"><summary class="muted" style="cursor:pointer;font-size:13px">Import a Strava export file instead</summary>
        <p class="muted" style="font-size:12px">On strava.com: Settings → My Account → Download or Delete Your Account → Request your archive. Drop the zip (or its activities.csv) here.</p>
        <label class="drop"><input type="file" id="fileStrava" accept=".zip,.csv,application/zip,text/csv"><b>Choose Strava export</b><span class="muted" style="font-size:12px">zip or activities.csv</span></label></details>
    </div>
  </div>
  <div class="cols">
    <div class="panel"><div class="panel-h"><h2>Scoring settings</h2></div>
      <div class="form-row"><label for="setHrMax"><b>Max heart rate</b><span>Now ${M ? M.prof.hrMax : '–'} bpm, from ${esc(M ? M.prof.hrMaxSrc : 'default')}${prof.stravaHrMax && prof.hrMax ? ` · Strava zones suggest ${prof.stravaHrMax}` : ''}${mA && mA.hrMaxEst ? ` · Watch data suggests ${mA.hrMaxEst}` : ''}</span></label><input type="number" id="setHrMax" min="120" max="230" placeholder="auto" value="${prof.hrMax || ''}"></div>
      <div class="form-row"><label for="setSleep"><b>Baseline sleep need</b><span>Hours of sleep you need on a rest day</span></label><input type="number" id="setSleep" min="5" max="11" step="0.25" placeholder="7.75" value="${prof.sleepNeedH || ''}"></div>
      <div class="form-row"><label for="setBirth"><b>Birth year</b><span>Fallback for max heart rate</span></label><input type="number" id="setBirth" min="1920" max="2020" placeholder="${mA && mA.dob ? esc(mA.dob.slice(0, 4)) : 'optional'}" value="${prof.birthYear || ''}"></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-action="save-settings">Save settings</button><span class="muted" id="setStatus" style="font-size:12px"></span></div>
    </div>
    <div class="panel prose"><div class="panel-h"><h2>How the scores work</h2></div>
      <p><b>Recovery</b> compares last night's heart-rate variability, lowest sleeping heart rate, respiratory rate and sleep (hours vs need) with your own 30-day baseline. Green is 67–100%, yellow 34–66%, red 0–33%.</p>
      <p><b>Strain</b> is cardiovascular load on a 0–21 scale, built from time spent above 50% of max heart rate across the whole day, so effort counts the same whether it was logged as a workout or not. A workout recorded by both your Watch and Strava counts once.</p>
      <p><b>Sleep need</b> starts from your baseline and adds time after hard days and after short nights.</p>
      <p class="muted" style="font-size:12px">These are estimates for training decisions, not medical measurements.</p>
    </div>
  </div>
  <div class="panel"><div class="panel-h"><h2>Your data</h2></div>
    <p class="sub" style="margin:0 0 12px">Imported data is saved privately with this page. Only you can see it, even if you share the link.</p>
    <div class="row">${S.sample ? '<button class="btn" data-action="sample-off">Leave sample data</button>' : '<button class="btn" data-action="sample">Preview with sample data</button>'}
      ${S.confirmDelete ? `<span>Delete all imported Apple Health and Strava data? Journal entries and your plan stay.</span><button class="btn danger" data-action="delete-yes">Delete data</button><button class="btn ghost" data-action="delete-no">Cancel</button>` : `<button class="btn danger" data-action="delete-ask" ${hasRealData() ? '' : 'disabled'}>Delete imported data</button>`}
      <span class="muted" id="delStatus" style="font-size:12px"></span></div>
  </div>`;
  wireDrop(v);
};
function importStatusHtml(imp) {
  if (!imp) return '';
  if (imp.error) return `<div class="notice err">${esc(imp.error)}</div>`;
  if (imp.done) return `<div class="notice">Imported ${esc(imp.done)}</div>`;
  const label = imp.phase === 'read' ? `Reading ${esc(imp.name || 'export')}… ${Math.round((imp.frac || 0) * 100)}%` : imp.phase === 'crunch' ? 'Calculating daily heart rate, sleep and workouts…' : imp.phase === 'save' ? `Saving ${imp.saved || 0} of ${imp.total || 0} months…` : 'Starting…';
  const frac = imp.phase === 'read' ? (imp.frac || 0) * 0.8 : imp.phase === 'crunch' ? 0.85 : imp.phase === 'save' ? 0.85 + 0.15 * ((imp.saved || 0) / (imp.total || 1)) : 0;
  return `<div style="display:grid;gap:6px"><span style="font-size:13px">${label}</span><div class="progress"><span style="width:${(frac * 100).toFixed(1)}%"></span></div></div>`;
}
function syncStatusHtml(s) {
  if (!s) return '';
  if (s.error) return `<div class="notice ${s.errorKind === 'warn' ? 'warn' : 'err'}">${esc(s.error)}</div>`;
  if (s.done) return `<div class="notice">${esc(s.done)}</div>`;
  return `<span style="font-size:13px">${esc(s.msg || 'Contacting Strava…')}</span>`;
}

function topbarHtml() {
  const titles = { today: 'Today', sleep: 'Sleep', journal: 'Journal', data: 'Settings', strain: 'Training', activities: 'Training', plan: 'Training', race: 'Training', trends: 'Trends', recovery: 'Trends', model: 'Trends' };
  let right = '';
  const M = S.model;
  if (['today', 'recovery', 'sleep', 'strain'].includes(S.tab) && M && !M.empty) {
    const isToday = S.date === M.today;
    right = `<div class="datenav"><button class="btn icon-btn" data-action="day" data-d="-1" aria-label="Previous day">${icon(IC.left)}</button>
      <div class="label"><small>${isToday ? 'Today' : S.date > M.today ? 'Future' : daysBetween(S.date, M.today) + ' days ago'}</small>${esc(fmtDay(S.date))}</div>
      <button class="btn icon-btn" data-action="day" data-d="1" aria-label="Next day" ${S.date >= M.today ? 'disabled' : ''}>${icon(IC.right)}</button>
      ${isToday ? '' : '<button class="btn sm" data-action="goto" data-date="today">Today</button>'}</div>`;
  } else if (S.tab === 'trends' && M && !M.empty) {
    right = `<div class="seg" role="group" aria-label="Range">${[[30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '1 year']].map(([n, l]) => `<button aria-pressed="${S.range === n}" data-action="range" data-n="${n}">${l}</button>`).join('')}</div>`;
  } else if (S.tab === 'journal') {
    right = `<div class="datenav"><button class="btn icon-btn" data-action="jday" data-d="-1" aria-label="Previous day">${icon(IC.left)}</button><div class="label"><small>Journal for</small>${esc(fmtDay(S.jdate))}</div><button class="btn icon-btn" data-action="jday" data-d="1" aria-label="Next day" ${S.jdate >= todayYmd() ? 'disabled' : ''}>${icon(IC.right)}</button></div>`;
  }
  return `<h1>${titles[S.tab]}</h1>${right}`;
}

function driveStatusHtml(s) {
  if (!s) return '';
  if (s.error) return `<div class="notice ${s.errorKind === 'warn' ? 'warn' : 'err'}">${esc(s.error)}</div>`;
  if (s.done) return `<div class="notice">${esc(s.done)}</div>${s.warn ? `<div class="notice warn" style="margin-top:8px">${esc(s.warn)}</div>` : ''}`;
  return `<span style="font-size:13px">${esc(s.msg || 'Checking…')}</span>`;
}
function drivePanelHtml() {
  const mG = S.real.metaDrive, sync = S.driveSync;
  const last = mG && mG.last;
  const counts = last && last.counts ? Object.keys(COUNT_LABEL).filter(k => last.counts[k] != null).map(k => `${(last.counts[k] || 0).toLocaleString()} ${COUNT_LABEL[k]}`).join(' · ') : '';
  const setUp = !!(mG && mG.lastSync);
  return `<div class="panel"><div class="panel-h"><h2>Apple Watch · automatic</h2><span class="aside">${last && last.at ? 'Latest iPhone file ' + esc(new Date(last.at).toLocaleString()) : setUp ? 'Waiting for the first file' : 'Not set up yet'}</span></div>
    <p class="sub" style="margin:0 0 12px">A free Apple Shortcut on your iPhone saves your recent heart rate, HRV, breathing, blood oxygen and sleep to Google Drive. Baseline picks up new files whenever you open it, so there's nothing to import by hand.</p>
    <div class="row"><button class="btn primary" data-action="drive-sync" ${sync && sync.running ? 'disabled' : ''}>${sync && sync.running ? 'Checking…' : 'Check Google Drive now'}</button>
      ${setUp ? `<button class="btn ghost" data-action="drive-full" ${sync && sync.running ? 'disabled' : ''}>Re-read all files</button>` : ''}
      <button class="btn ghost" data-action="guide" aria-expanded="${S.guideOpen || !setUp}">${S.guideOpen || !setUp ? 'Hide setup steps' : 'Show setup steps'}</button></div>
    <div id="driveStatus" style="margin-top:12px">${driveStatusHtml(sync)}</div>
    ${counts ? `<p class="muted" style="font-size:12px;margin:10px 0 0">${esc(last.file || '')}: ${esc(counts)}</p>` : ''}
    ${last && last.warnings && last.warnings.length ? `<p class="muted" style="font-size:12px;margin:4px 0 0">${last.warnings.map(esc).join(' · ')}</p>` : ''}
    ${S.guideOpen || !setUp ? shortcutGuideHtml() : ''}
  </div>`;
}
function cp(t) { return `<button class="code" data-action="copy" data-text="${esc(t)}" title="Copy">${esc(t)}</button>`; }
function shortcutGuideHtml() {
  const rows = [
    ['Heart Rate', 'HR'], ['Heart Rate Variability', 'HRV'], ['Resting Heart Rate', 'RHR'], ['Respiratory Rate', 'RESP'], ['Blood Oxygen', 'SPO2'],
  ];
  const v = (p, fmt) => `<span class="var">Health Samples › ${p}${fmt ? ' · ISO 8601' : ''}</span>`;
  return `<div class="guide">
    <h3><span class="n">1</span>Get Google Drive ready on your iPhone</h3>
    <ol class="steps">
      <li>Install the <b>Google Drive</b> app and sign in with the Google account you connected to Claude.</li>
      <li>Open the <b>Files</b> app, tap <b>Browse</b>, then <b>⋯ › Edit</b>, and switch on <b>Google Drive</b>.</li>
      <li>In Google Drive, create a folder called <b>Baseline</b>.</li>
    </ol>
    <h3><span class="n">2</span>Build the Shortcut</h3>
    <p>Open <b>Shortcuts</b>, tap <b>+</b> and name the new shortcut <b>Baseline Sync</b>. For each row of the table, add two actions, one under the other:</p>
    <ul class="steps">
      <li><b>Find Health Samples</b>: choose the type from the table. Tap <b>Add Filter</b> and set <i>Start Date</i> · <i>is in the last</i> · <i>3 days</i>. Sort by <i>Start Date</i>, order <i>Oldest First</i>, and leave <i>Limit</i> off.</li>
      <li><b>Text</b>: type the first marker and start a new line. Insert the variable <b>Health Samples</b> from the action above, tap it, choose <b>Start Date</b>, and set the date format to <b>ISO 8601</b> with <b>Include ISO 8601 Time</b> on. New line: type the second marker, new line, insert <b>Health Samples</b> again and choose <b>Value</b>.</li>
    </ul>
    <div class="table-wrap"><table class="t guide-t"><thead><tr><th>Find Health Samples type</th><th>Text action, line by line</th></tr></thead><tbody>
      ${rows.map(([t, k]) => `<tr><td>${t}</td><td><div class="lines">${cp('#' + k + '-T')}${v('Start Date', true)}${cp('#' + k + '-V')}${v('Value')}</div></td></tr>`).join('')}
      <tr><td>Sleep <span class="muted">(Sleep Analysis)</span></td><td><div class="lines">${cp('#SLEEP-S')}${v('Start Date', true)}${cp('#SLEEP-E')}${v('End Date', true)}${cp('#SLEEP-V')}${v('Value')}</div></td></tr>
    </tbody></table></div>
    <p>Finish with three more actions:</p>
    <ol class="steps">
      <li><b>Text</b>: insert the six Text results above (<i>Text</i>, <i>Text 2</i> … <i>Text 6</i>), each on its own line.</li>
      <li><b>Set Name</b> of that Text to ${cp('baseline-')} then the variable <b>Current Date</b> (tap it: Date Format <i>Custom</i>, ${cp('yyyy-MM-dd')}) then ${cp('.txt')}</li>
      <li><b>Save File</b>: turn off <i>Ask Where to Save</i>, pick <b>Google Drive › Baseline</b> as the folder, and turn on <i>Overwrite If File Exists</i>.</li>
    </ol>
    <p>Tap <b>▶</b> to run it once. When iOS asks, allow access to every Health category in the list.</p>
    <h3><span class="n">3</span>Make it run on its own</h3>
    <ol class="steps">
      <li>In Shortcuts, open <b>Automation</b> and add a new automation of type <b>App</b>.</li>
      <li>Choose <b>Strava</b> (or another app you open every day), tick <b>Is Opened</b>, and select <b>Run Immediately</b>.</li>
      <li>Pick <b>Baseline Sync</b>. Turn off <i>Notify When Run</i> if you don't want a banner.</li>
    </ol>
    <p class="muted" style="font-size:12px">Apple only lets apps read Health data while your iPhone is unlocked, so the Shortcut runs when you open an app, not at a fixed time at night.</p>
    <h3><span class="n">4</span>Connect it here</h3>
    <p>Press <b>Check Google Drive now</b> above. From then on Baseline checks for new files every time you open it.</p>
  </div>`;
}

function plannedListHtml(coach, M) {
  if (coach.planned.length) return `<div class="session" style="display:grid;gap:8px"><div class="eyebrow">Planned ${S.date === M.today ? 'today' : 'this day'}</div>${coach.planned.slice(0, 4).map(p => `<div class="row" style="gap:10px;flex-wrap:nowrap"><span class="ic">${sportIcon(p.sportKey)}</span><div style="min-width:0;flex:1"><div class="t">${esc(p.title)}${sessBadgesHtml(p)}${p.target ? ` <span class="chip"${p.targetBase ? ` title="Adjusted to your latest CSS (plan said ${esc(p.targetBase)})"` : ''}>${esc(p.target)}${p.targetBase ? ' ↻' : ''}</span>` : ''}${testChipHtml(p)}</div><div class="muted" style="font-size:12px">${[p.durationMin ? fmtDurLong(p.durationMin) : null, p.isRest ? null : p.intensity, p.optional ? 'optional' : null].filter(Boolean).map(esc).join(' · ')}</div></div>${p.status === 'done' ? '<span class="chip st-done">done</span>' : p.status === 'partial' ? '<span class="chip st-partial">cut short</span>' : p.status === 'sick' ? '<span class="chip st-sick">excused</span>' : ''}</div>`).join('')}</div>`;
  if (coach.rest) return `<div class="session"><div><div class="eyebrow">Planned</div><div class="t">${esc(coach.rest.title || 'Rest day')}</div></div></div>`;
  return '';
}

function planImportHtml() {
  const I = S.planImport; if (!I) return '';
  const pv = I.preview;
  let body;
  if (I.saving) body = `<p class="sub">Saving week ${I.savedWeeks || 0} of ${pv ? pv.weeks.length : 0}…</p><div class="progress"><span style="width:${pv ? Math.round((I.savedWeeks || 0) / pv.weeks.length * 100) : 0}%"></span></div>`;
  else if (pv) {
    const ph = []; for (const w of pv.weeks) { const l = ph[ph.length - 1]; if (l && l.name === (w.phase || '')) l.to = w.week; else ph.push({ name: w.phase || '', from: w.week, to: w.week }); }
    const first = pv.weeks.slice(0, 2);
    body = `<div class="cols" style="gap:14px">
        <div><label class="eyebrow" for="planName">Plan name</label><input type="text" id="planName" style="width:100%;margin-top:4px" value="${esc(pv.meta.name)}"></div>
        <div><label class="eyebrow" for="planStart">Starts</label><input type="date" id="planStart" style="width:100%;margin-top:4px" value="${esc(I.start)}"></div></div>
      <dl class="kv" style="margin:14px 0"><div><dt>Weeks</dt><dd>${pv.weeks.length}</dd></div><div><dt>Sessions</dt><dd>${pv.sessions}</dd></div><div><dt>Dates</dt><dd style="font-size:14px">${esc(fmtDayShort(pv.meta.startDate))} – ${esc(fmtDay(pv.meta.endDate))}</dd></div>${pv.meta.raceDate ? `<div><dt>Race</dt><dd style="font-size:14px">${esc(fmtDay(pv.meta.raceDate))}</dd></div>` : ''}</dl>
      ${pv.meta.goal ? `<p class="sub" style="margin:0 0 8px">${esc(pv.meta.goal)}</p>` : ''}
      ${ph.length > 1 || (ph[0] && ph[0].name) ? `<p class="muted" style="font-size:13px;margin:0 0 10px">${ph.map(p => `${esc(p.name || 'Weeks')} (wk ${p.from}${p.to > p.from ? '–' + p.to : ''})`).join(' · ')}</p>` : ''}
      <div class="eyebrow" style="margin-top:6px">First ${first.length} week${first.length > 1 ? 's' : ''}</div>
      ${first.map(w => `<div class="week"><div class="week-h"><b>Week ${w.week}</b><span class="muted" style="font-size:12px">${esc(w.phase || '')}</span></div>${w.sessions.map(s => `<div class="ps"><div class="when"><b>${WD[parseYmd(s.date).getDay()]}</b>${esc(fmtDayShort(s.date))}</div><div style="min-width:0"><div class="t">${esc(s.title)}${s.optional ? ' <span class="chip">optional</span>' : ''}</div><div class="m">${[SPORT_LABEL[sportOf(s.sport)] || s.sport, s.durationMin ? fmtDurLong(s.durationMin) : null, s.intensity !== 'rest' ? s.intensity : null].filter(Boolean).map(esc).join(' · ')}</div>${s.details ? `<div class="m">${esc(s.details)}</div>` : ''}</div><div></div></div>`).join('')}</div>`).join('')}
      <p class="muted" style="font-size:12px;margin:10px 0 0">If another plan is still running on the start date, this one takes over from then on. You can delete a plan later.</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-action="plan-save">Save plan</button><button class="btn ghost" data-action="plan-back">Start over</button><button class="btn ghost" data-action="plan-import-cancel">Cancel</button></div>`;
  } else {
    body = `<p class="sub" style="margin:0 0 12px">Add the plan in any form. A calendar (.ics) or spreadsheet (.csv) with dates is read directly. Anything else (a Word file, pasted text, or screenshots of the plan) is converted by ${esc(aiName())}, which takes about a minute.</p>
      <div class="cols" style="gap:14px"><div><label class="eyebrow" for="planStart">Start in the week of</label><input type="date" id="planStart" style="width:100%;margin-top:4px" value="${esc(I.start)}"></div>
        <div><label class="eyebrow" for="planName">Plan name (optional)</label><input type="text" id="planName" style="width:100%;margin-top:4px" value="${esc(I.name)}" placeholder="e.g. Olympic tri build 2027"></div></div>
      <label class="drop" id="planDrop" style="margin-top:14px"><input type="file" id="planFiles" multiple accept=".ics,.csv,.docx,.txt,.md,text/calendar,text/csv,text/plain,image/png,image/jpeg,image/heic,image/webp"><b>Choose files</b><span class="muted" style="font-size:12px">or drop them here · .ics · .csv · .docx · .txt · screenshots</span></label>
      ${I.files.length || I.images.length ? `<p class="muted" style="font-size:12px;margin:8px 0 0">Added: ${esc(I.files.join(', '))}</p>` : ''}
      <label class="eyebrow" for="planText" style="display:block;margin-top:14px">Or paste the plan</label>
      <textarea id="planText" style="min-height:140px;margin-top:4px" placeholder="Week 1: Mon swim 2000 m technique, Tue bike 60 min Z2…">${esc(I.text)}</textarea>
      <div class="row" style="margin-top:12px">${I.busy ? `<button class="btn primary" disabled>${esc(aiName())} is converting the plan…</button><button class="btn ghost" data-action="plan-stop">Stop</button>` : `<button class="btn primary" data-action="plan-convert">Convert with ${esc(aiName())}</button><button class="btn ghost" data-action="plan-import-cancel">Cancel</button>`}</div>`;
  }
  return `<div class="panel" id="planImport"><div class="panel-h"><h2>Add a plan</h2>${I.preview ? '<span class="chip st-done">check and save</span>' : ''}</div>${I.error ? `<div class="notice err" style="margin-bottom:12px">${esc(I.error)}</div>` : ''}${body}</div>`;
}

function sleepScoreHtml(d) {
  if (d.sleepScore == null) return '';
  const P = d.sleepParts, R = d.sleepRaw || {}, keys = Object.keys(SLEEP_WEIGHTS);
  const wSum = keys.filter(k => P[k] != null).reduce((a, k) => a + SLEEP_WEIGHTS[k], 0) || 1;
  const detail = {
    dur: () => `${pct(R.dur)} of need`,
    eff: () => `${pct(R.eff)} of time in bed asleep`,
    cont: () => `${Math.round(R.waso)} min awake · ${R.wakes} wake-up${R.wakes === 1 ? '' : 's'}`,
    stages: () => `deep ${Math.round(R.deepPct * 100)}% · REM ${Math.round(R.remPct * 100)}%`,
    cons: () => `${pct(R.cons)} overlap with last 4 nights`,
    stress: () => R.stressZ >= 0 ? 'HRV & sleeping HR at or better than usual' : `HRV & sleeping HR ${Math.abs(R.stressZ).toFixed(1)} SD off usual`,
  };
  const missing = { eff: 'no time-in-bed data', cont: 'no sleep segments', stages: 'no stage data', cons: 'needs a few nights in a row', stress: 'needs 7 nights of HRV or sleeping HR' };
  const color = v => v >= 80 ? 'var(--rec-hi)' : v >= 60 ? 'var(--rec-mid)' : 'var(--rec-lo)';
  const rows = keys.map(k => P[k] != null
    ? `<div class="stage ss"><span>${SLEEP_PART_LABEL[k]} <small class="muted">${Math.round(SLEEP_WEIGHTS[k] / wSum * 100)}%</small></span><div class="bar"><span style="width:${P[k]}%;background:${color(P[k])}"></span></div><span class="val"><b>${P[k]}</b> · ${esc(detail[k]())}</span></div>`
    : `<div class="stage ss" style="opacity:.55"><span>${SLEEP_PART_LABEL[k]}</span><div class="bar"></div><span class="val">${esc(missing[k])}</span></div>`).join('');
  return `<div class="panel"><div class="panel-h"><h2>Sleep score</h2><span class="aside">${d.sleepScore}% · ${esc(sleepScoreWord(d.sleepScore))}</span></div>
    <div class="stages">${rows}</div>
    <p class="muted" style="font-size:12px;margin:12px 0 0">Like WHOOP and Garmin, the score combines how long you slept against your need with how well you slept. The small % is each part's weight tonight; parts without data are left out. 90+ excellent · 80–89 good · 60–79 fair · below 60 poor. Apple Watch stages and wake detection are rough estimates, so they carry less weight than duration.</p></div>`;
}

// planned test sessions: show the logged result, or a button to log it
function testChipHtml(s) {
  if (!s || !s.testType) return '';
  const r = s.testResult;
  if (r) {
    const k = Object.keys(r.derived || {}).find(x => THRESHOLDS[x]);
    const txt = k ? THRESHOLDS[k].label + ' ' + THRESHOLDS[k].fmt(r.derived[k]) : r.derived && r.derived.swimPace ? TEST_TYPES[r.type].show(r.values) : 'result logged';
    return ` <span class="chip st-done">${esc(txt)}</span>`;
  }
  const today = (S.model && S.model.today) || todayYmd();
  if (s.date > today) return ' <span class="chip">test</span>';
  return ` <button class="btn sm primary" style="padding:2px 9px;font-size:12px" data-action="test-open" data-type="${s.testType}" data-date="${s.date}" data-session="${esc(s.id)}">Enter result</button>`;
}
function testDueNoticeHtml(M) {
  const R = M.race; if (!R || !R.sched) return '';
  const due = R.sched.due.filter(({ s }) => daysBetween(s.date, M.today) <= 7 && s.date !== S.date);
  if (!due.length) return '';
  return `<div class="notice" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1 1 220px">${due.length === 1 ? `Your <b>${esc(due[0].s.title)}</b> on ${esc(fmtDayShort(due[0].s.date))} has no result yet.` : `${due.length} planned tests have no result yet.`}</span><button class="btn sm primary" data-action="test-open" data-type="${due[0].type}" data-date="${due[0].s.date}" data-session="${esc(due[0].s.id)}">Enter result</button></div>`;
}
