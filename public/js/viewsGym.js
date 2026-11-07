// ---------- Gym tab: exercises, weights, progress and muscle balance from Strava's strength logging ----------
function trendChip(r) {
  if (r.trend === 'up') return `<span class="chip hi"><i></i>+${(r.delta * 100).toFixed(0)}%</span>`;
  if (r.trend === 'down') return `<span class="chip lo"><i></i>−${Math.abs(r.delta * 100).toFixed(0)}%</span>`;
  if (r.trend === 'flat') return `<span class="chip">flat</span>`;
  if (r.trend === 'new') return `<span class="chip">new</span>`;
  if (r.trend === 'idle') return `<span class="chip" title="Not trained in the last 4 weeks">idle</span>`;
  return '';
}
function gymEmptyHtml(M, sm) {
  const n = sm ? sm.logged : 0;
  return `<div class="panel"><div class="panel-h"><h2>Gym</h2></div>
    <p>${n ? `${n} strength session${n > 1 ? 's' : ''} in the last 6 months, but no exercises on any of them yet.` : 'No strength sessions in the last 6 months.'}</p>
    <p class="muted">${window.BASELINE_STRAVA ? 'Strava’s public API does not hand out the exercises you log in the app, so here they are typed in: open a session under Activities and press “Add sets” (copy the list from the Strava app). The Claude version fetches them automatically; a Backup and move brings them across.' : 'Press Sync (Settings → Strava) and the exercises, weights and reps you logged in Strava come across with the activities.'}</p></div>`;
}
function gymExerciseChart(v, r) {
  const el = v.querySelector('#c-gym-ex'); if (!el || !r) return;
  const hist = r.hist.filter(h => h.e1 != null || (h.top && h.top.r != null));
  if (!hist.length) { el.innerHTML = '<p class="muted">No sets with weights yet.</p>'; return; }
  const useE1 = hist.some(h => h.e1 != null);
  lineChart(el, { label: `${r.name}: ${useE1 ? 'estimated 1RM' : 'best set reps'} per session`, height: 170, yMin: 0, labels: hist.map(h => fmtDayShort(h.date)), tipHead: i => `${fmtDay(hist[i].date)} · ${hist[i].top ? fmtSet(hist[i].top, r.bw) : ''} · ${hist[i].sets} sets · ${(hist[i].tonnage / 1000).toFixed(1)} t`, fmtTip: x => useE1 ? Math.round(x) + ' kg' : x + ' reps',
    series: [{ name: useE1 ? 'e1RM' : 'reps', values: hist.map(h => useE1 ? (h.e1 != null ? Math.round(h.e1) : null) : h.top.r), color: 'var(--accent)', dots: true }] });
}
VIEWS.gym = (v) => {
  const M = S.model; if (!M) return;
  const sm = typeof strengthModel === 'function' ? strengthModel(M, M.today) : null;
  if (!sm || !sm.sessions.length) { v.innerHTML = gymEmptyHtml(M, sm); return; }
  const w4 = sm.weeks.slice(0, 4), sess4 = w4.reduce((n, w) => n + w.sessions, 0), sets4 = w4.reduce((n, w) => n + w.sets, 0), t4 = w4.reduce((n, w) => n + w.tonnage, 0);
  const up = sm.movers.filter(r => r.trend === 'up').length, down = sm.movers.filter(r => r.trend === 'down').length;
  const sel = S.gymEx && sm.exercises.find(r => r.name === S.gymEx) ? sm.exercises.find(r => r.name === S.gymEx) : sm.exercises[0];
  const rows = sm.exercises.map(r => `<tr class="${sel && sel.name === r.name ? 'is-sel' : ''}" data-action="gym-ex" data-ex="${esc(r.name)}" role="button" tabindex="0">
      <td><b>${esc(r.name)}</b><div class="muted" style="font-size:12px">${esc(r.mg.join(', '))}${r.bw ? (r.mg.length ? ' · ' : '') + 'bodyweight + load' : ''}</div></td>
      <td class="num">${r.last && r.last.top ? esc(fmtSet(r.last.top, r.bw)) : '–'}<div class="muted" style="font-size:12px">${fmtDayShort(r.last.date)}</div></td>
      <td class="num">${r.e1Now != null ? Math.round(r.e1Now) + ' kg' : r.best == null && r.bestReps != null ? r.bestReps + ' reps' : '–'}${r.e1Prev != null ? `<div class="muted" style="font-size:12px">${r.e1Now != null ? 'was' : 'last block'} ${Math.round(r.e1Prev)}</div>` : ''}</td>
      <td class="num">${r.best && r.best.top ? esc(fmtSet(r.best.top, r.bw)) + (r.best.e1 != null ? ` <span class="muted">(${Math.round(r.best.e1)})</span>` : '') : r.bestReps != null ? r.bestReps + ' reps' : '–'}<div class="muted" style="font-size:12px">${r.best ? fmtDayShort(r.best.date) : ''}</div></td>
      <td class="num">${r.lastWeeks}<span class="muted">/4 wk</span></td>
      <td>${trendChip(r)}</td></tr>`).join('');
  const bal = strengthBalance(sm);
  const maxMg = Math.max(1, ...bal.rows.map(r => r.perWeek));
  const mgBars = bal.rows.map(r => `<div class="mg-row"><span>${esc(r.g)}${r.why ? `<small class="muted"> · ${esc(r.why)}</small>` : ''}</span><div class="bar"><i style="width:${Math.round(r.perWeek / maxMg * 100)}%"></i></div><b>${r.perWeek.toFixed(1)}<small> sets/wk</small></b></div>`).join('');
  const weekRows = sm.weeks.map(w => `<tr><td>${fmtDayShort(w.start)} – ${fmtDayShort(w.end)}</td><td class="num">${w.logged}${w.sessions < w.logged ? `<span class="muted"> (${w.sessions} with sets)</span>` : ''}</td><td class="num">${w.minutes ? fmtDurLong(w.minutes) : '–'}</td><td class="num">${w.sets || '–'}</td><td class="num">${w.tonnage ? (w.tonnage / 1000).toFixed(1) + ' t' : '–'}</td></tr>`).join('');
  const last = sm.last;
  const lastHtml = last ? `<div class="panel"><div class="panel-h"><h2>Last session</h2><span class="aside">${esc(fmtDay(last.date))} · ${fmtDurLong(last.durS / 60)}</span></div>
      <div class="gym-ex">${last.exercises.map(x => `<div><b>${esc(x.name)}</b><span class="muted"> ${x.sets.map(st => esc(fmtSet(st, x.bw))).join(' · ')}</span>${x.e1 != null ? `<span class="chip" style="margin-left:6px">e1RM ${Math.round(x.e1)}</span>` : ''}</div>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">${last.nSets} sets · ${(last.tonnage / 1000).toFixed(1)} t${last.src === 'manual' ? ' · pasted' : ' · from Strava'}</p></div>` : '';
  v.innerHTML = `
  <div class="tiles" style="margin-bottom:12px">
    ${tile('Sessions', String(sess4), '', `last 4 weeks · ${sets4} sets`, '')}
    ${tile('Tonnage', (t4 / 1000).toFixed(1), 't', 'kg × reps, last 4 weeks', '')}
    ${tile('Getting stronger', String(up), '', `${down ? down + ' down, ' : ''}${sm.movers.length - up - down} flat (e1RM, 4 weeks vs the 8 before)`, up > down ? 'delta-good' : down > up ? 'delta-bad' : '')}
    ${tile('Body weight used', String(sm.bw), 'kg', 'for chin-ups, dips, push-ups', '')}
  </div>
  <div class="panel"><div class="panel-h"><h2>Exercises</h2><span class="aside">${sm.exercises.length} · last 6 months · tap one for its chart</span></div>
    <div class="table-wrap"><table class="t gym-t"><thead><tr><th>Exercise</th><th class="num">Last</th><th class="num">e1RM now</th><th class="num">Best</th><th class="num">Freq</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${sel ? `<div style="margin-top:12px"><div class="eyebrow">${esc(sel.name)}</div><div class="chart" id="c-gym-ex"></div></div>` : ''}
    <p class="muted" style="font-size:12px;margin:8px 0 0">e1RM = estimated one-rep max from the best set (Epley: weight × (1 + reps ÷ 30), sets of up to 12 reps). For chin-ups, dips and push-ups the load is body weight plus what you add. “Now” is the best of the last 4 weeks against the best of the 8 weeks before; ±2.5 % counts as a change.</p></div>
  <div class="cols">
    <div class="panel"><div class="panel-h"><h2>Muscle balance</h2><span class="aside">hard sets a week, last 4 weeks</span></div>
      <div class="mg-list">${mgBars || '<p class="muted">No muscle groups on the sets yet.</p>'}</div>
      ${bal.missing.length ? `<p class="muted" style="font-size:12px;margin:10px 0 0">Not trained in the last 4 weeks: <b>${bal.missing.join(', ')}</b>. For a swimmer-runner the posterior chain (glutes, hamstrings), calves and core carry the most over; 2 sessions a week with 2–4 hard sets per lift are enough (Rønnestad & Mujika 2014, Beattie 2014).</p>` : '<p class="muted" style="font-size:12px;margin:10px 0 0">The endurance-relevant groups are all covered.</p>'}</div>
    <div class="panel"><div class="panel-h"><h2>Weeks</h2><span class="aside">newest first</span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Week</th><th class="num">Sessions</th><th class="num">Time</th><th class="num">Sets</th><th class="num">Tonnage</th></tr></thead><tbody>${weekRows}</tbody></table></div>
      ${sm.missing.length ? `<p class="muted" style="font-size:12px;margin:8px 0 0">${sm.missing.length} strength session${sm.missing.length > 1 ? 's' : ''} without exercises (${sm.missing.slice(0, 3).map(a => fmtDayShort(a.date)).join(', ')}${sm.missing.length > 3 ? '…' : ''}): ${window.BASELINE_STRAVA ? 'paste them under Activities' : 'sync again, or paste them under Activities'}.</p>` : ''}</div>
  </div>
  ${lastHtml}
  <p class="muted" style="font-size:12px">Cardio load (strain, fitness, the load ratio) is unchanged by this tab: gym sessions still count through heart rate. Progress here is measured in weight on the bar, not in minutes.</p>`;
  gymExerciseChart(v, sel);
};
