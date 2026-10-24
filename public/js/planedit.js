// ---------- changing the plan: call in sick, replace a period, edit or add single sessions ----------
// Everything is stored in plan/edits and applied on top of the imported plan (model.js applyPlanEdits),
// so the original plan stays intact and every change can be undone.

const SICK_TYPES = { cold: 'Cold, symptoms above the neck', fever: 'Fever, flu or chest symptoms', injury: 'Injury', other: 'Other reason (travel, life…)' };
const BLOCK_TEMPLATES = {
  easier: { label: 'Easing back in', text: 'Easier version of the plan: same sports and days, everything easy, starting at about half the duration and building back to normal.' },
  pattern: { label: 'Running bridge', text: 'Your own pattern: one sport on chosen weekdays, with the duration building from a start value to an end value.' },
  rest: { label: 'Time off', text: 'No training: the planned sessions are removed for these days.' },
};
const EDIT_INTENSITIES = ['recovery', 'easy', 'moderate', 'hard', 'key', 'test', 'rest'];
const EDIT_SPORTS = ['swim', 'run', 'ride', 'strength', 'mobility', 'walk', 'row', 'hiit', 'other'];

function curEdits() { const e = cur().planEdits || {}; return { blocks: (e.blocks || []).slice(), sessions: { ...(e.sessions || {}) }, added: (e.added || []).slice() }; }
async function savePlanEdits(next) {
  if (S.sample) { S.sampleData.planEdits = next; changed(); return; }
  try { await writeDoc('plan/edits', next); } catch (e) { console.error(e); }
  changed();
}
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const round5 = x => Math.max(5, Math.round(x / 5) * 5);

// sessions for a replaced period
function genBlockSessions(M, b, f) {
  const out = [], days = daysBetween(b.start, b.end) + 1;
  const ramp = d => days <= 1 ? 1 : daysBetween(b.start, d) / (days - 1);
  if (b.template === 'easier') {
    const orig = M.plan.sessions.filter(s => s.date >= b.start && s.date <= b.end && !s.isRest && (!b.scope || b.scope === 'all' || s.sportKey === b.scope));
    for (const s of orig) {
      if (s.optional && ramp(s.date) < 0.5) continue;                 // drop optional extras in the first half
      const fct = 0.5 + 0.5 * ramp(s.date);
      const dur = s.durationMin ? round5(Math.max(s.sportKey === 'strength' ? 20 : 15, s.durationMin * fct)) : null;
      const strength = s.sportKey === 'strength' || s.sportKey === 'mobility';
      out.push(clean({ id: b.id + '-' + out.length, date: s.date, sport: s.sport || s.sportKey, durationMin: dur, intensity: fct < 0.7 ? 'recovery' : 'easy',
        title: strength ? 'Light ' + (s.title || 'strength') : 'Easy ' + (SPORT_LABEL[s.sportKey] || 'session').toLowerCase(),
        details: `Instead of “${s.title || SPORT_LABEL[s.sportKey]}”${s.durationMin ? ` (${s.durationMin} min, ${s.intensity})` : ''}.${strength ? ' About 60% of your usual weights, no sets to failure.' : ' Conversational effort, no intervals.'}${s.testType ? ' Do the test after this period.' : ''} Stop if symptoms come back.`,
        optional: s.optional || null }));
    }
  } else if (b.template === 'pattern') {
    const wd = new Set((f.days || []).map(Number));
    const d0 = +f.durStart || 30, d1 = +f.durEnd || d0;
    for (let d = b.start; d <= b.end; d = addDays(d, 1)) {
      if (!wd.has(parseYmd(d).getDay())) continue;
      out.push(clean({ id: b.id + '-' + out.length, date: d, sport: f.sport || 'run', title: f.title || (SPORT_LABEL[f.sport] || 'Session') + ' (' + b.label + ')',
        durationMin: round5(d0 + (d1 - d0) * ramp(d)), intensity: f.intensity || 'easy', details: f.details || null }));
    }
  }
  return out;
}

// ---- actions ----
const PLAN_EDIT_ACTIONS = {
  'pe-open': b => { S.planEdit = { mode: b.dataset.mode, id: b.dataset.id || null, date: b.dataset.date || null }; if (b.dataset.go) setTab(b.dataset.go); else render(); setTimeout(() => { const el = document.getElementById('peForm'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60); },
  'pe-close': () => { S.planEdit = null; render(); },
  'sick-end': async b => {
    const E = curEdits(), t = M_today(), i = E.blocks.findIndex(x => x.id === b.dataset.id); if (i < 0) return;
    const blk = E.blocks[i], end = blk.start >= t ? t : addDays(t, -1);
    E.blocks[i] = { ...blk, end };
    S.planEdit = null;
    await savePlanEdits(E);
  },
  'block-del': async b => { const E = curEdits(); E.blocks = E.blocks.filter(x => x.id !== b.dataset.id); for (const k in E.sessions) if (k.startsWith(b.dataset.id + '-')) delete E.sessions[k]; await savePlanEdits(E); },
  'sess-revert': async b => { const E = curEdits(); delete E.sessions[b.dataset.id]; await savePlanEdits(E); },
  'sess-del': async b => {
    const E = curEdits(), id = b.dataset.id;
    if (E.added.some(x => x.id === id)) E.added = E.added.filter(x => x.id !== id); else E.sessions[id] = { deleted: true };
    S.planEdit = null; await savePlanEdits(E);
  },
  'ease-back': b => {
    const rs = S.model && S.model.plan.recentSick; if (!rs) return;
    const start = addDays(rs.end, 1) < M_today() ? M_today() : addDays(rs.end, 1);
    S.planEdit = { mode: 'replace', pre: { template: 'easier', start, end: addDays(start, returnDays(rs) - 1), label: 'Easing back in' } };
    setTab('plan'); setTimeout(() => { const el = document.getElementById('peForm'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  },
};

async function onPlanEditForm(form) {
  const fd = new FormData(form), f = Object.fromEntries(fd.entries()); f.days = fd.getAll('days');
  const msg = form.querySelector('.pe-msg'), say = t => { if (msg) msg.textContent = t; };
  const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const E = curEdits();
  if (form.dataset.form === 'sick-add') {
    if (!isDate(f.start)) return say('Pick the first sick day.');
    if (f.end && (!isDate(f.end) || f.end < f.start)) return say('The last day must be on or after the first.');
    E.blocks.push(clean({ id: newId('sick'), kind: 'sick', start: f.start, end: f.end || null, type: f.type || 'cold', label: SICK_TYPES[f.type] || 'Sick', note: (f.note || '').slice(0, 200) || null, at: new Date().toISOString() }));
  } else if (form.dataset.form === 'block-add') {
    if (!isDate(f.start) || !isDate(f.end) || f.end < f.start) return say('Pick a start and an end date (end on or after start).');
    if (daysBetween(f.start, f.end) > 62) return say('Keep a replaced period to 9 weeks or less.');
    if (f.template === 'pattern' && !f.days.length) return say('Pick at least one weekday.');
    const b = clean({ id: newId('blk'), kind: 'replace', start: f.start, end: f.end, template: f.template, scope: f.scope || 'all', label: (f.label || BLOCK_TEMPLATES[f.template].label).slice(0, 60), at: new Date().toISOString() });
    b.sessions = genBlockSessions(S.model, b, f);
    E.blocks.push(b);
  } else if (form.dataset.form === 'sess-add') {
    if (!isDate(f.date)) return say('Pick a date.');
    E.added.push(clean({ id: newId('add'), date: f.date, sport: f.sport, title: (f.title || SPORT_LABEL[f.sport] || 'Session').slice(0, 80), durationMin: +f.durationMin || null, intensity: f.intensity || 'easy', details: (f.details || '').slice(0, 300) || null }));
  } else if (form.dataset.form === 'sess-edit') {
    if (!isDate(f.date)) return say('Pick a date.');
    const prev = E.sessions[f.id] || {};
    E.sessions[f.id] = clean({ ...prev, deleted: null, date: f.date, title: (f.title || '').slice(0, 80) || null, sport: f.sport, durationMin: +f.durationMin || null, intensity: f.intensity, details: (f.details || '').slice(0, 400) || null });
  } else return;
  S.planEdit = null;
  await savePlanEdits(E);
}

// ---- views ----
const opt = (v, l, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`;
function planEditFormHtml(M) {
  const P = S.planEdit; if (!P) return '';
  const t = M_today(), close = '<button type="button" class="btn ghost" data-action="pe-close">Cancel</button>';
  if (P.mode === 'sick') return `<div class="panel pe" id="peForm"><div class="panel-h"><h2>Call in sick</h2></div>
    <p class="sub" style="margin:0 0 10px;font-size:13px">Planned sessions on these days are excused: they don’t count as missed, and today’s guidance switches to rest. Leave “last day” empty if you don’t know yet; press “I’m better” when you are.</p>
    <form class="swim-form" data-form="sick-add"><label>First day<input type="date" name="start" value="${esc(P.date || t)}" required></label><label>Last day (optional)<input type="date" name="end"></label>
      <label style="flex:2 1 240px">What is it<select name="type">${Object.entries(SICK_TYPES).map(([k, l]) => opt(k, l, 'cold')).join('')}</select></label>
      <label style="flex:3 1 260px">Note (optional)<input name="note" maxlength="200" placeholder="e.g. sore throat, slept badly"></label>
      <button class="btn primary" type="submit">Save</button>${close}<span class="muted pe-msg" style="font-size:12px;flex-basis:100%"></span></form></div>`;
  if (P.mode === 'replace') {
    const pre = P.pre || {}, tpl = pre.template || 'pattern';
    return `<div class="panel pe" id="peForm"><div class="panel-h"><h2>Replace a period</h2></div>
    <p class="sub" style="margin:0 0 10px;font-size:13px">The plan’s sessions in this period are set aside (not deleted) and replaced. Undo it any time under “Your changes”.</p>
    <form class="swim-form" data-form="block-add" id="blockForm">
      <label>From<input type="date" name="start" value="${esc(pre.start || t)}" required></label><label>To<input type="date" name="end" value="${esc(pre.end || addDays(pre.start || t, 13))}" required></label>
      <label style="flex:2 1 240px">Replace with<select name="template">${Object.entries(BLOCK_TEMPLATES).map(([k, x]) => opt(k, x.label === 'Running bridge' ? 'A pattern, e.g. a running bridge' : x.label === 'Easing back in' ? 'An easier version of the plan' : x.label, tpl)).join('')}</select></label>
      <label>Which sessions<select name="scope">${opt('all', 'All sports', 'all')}${['swim', 'run', 'ride', 'strength'].map(k => opt(k, 'Only ' + SPORT_LABEL[k].toLowerCase() + ' sessions', '')).join('')}</select></label>
      <label style="flex:2 1 220px">Name<input name="label" maxlength="60" value="${esc(pre.label || BLOCK_TEMPLATES[tpl].label)}"></label>
      <p class="muted tpl-text" style="font-size:12px;margin:0;flex-basis:100%">${esc(BLOCK_TEMPLATES[tpl].text)}</p>
      <div class="pf" ${tpl === 'pattern' ? '' : 'hidden'}>
        <label>Sport<select name="sport">${EDIT_SPORTS.map(k => opt(k, SPORT_LABEL[k] || k, 'run')).join('')}</select></label>
        <label style="flex:2 1 200px">Session name<input name="title" maxlength="60" placeholder="Easy run"></label>
        <fieldset class="wd"><legend>Days</legend>${[1, 2, 3, 4, 5, 6, 0].map(d => `<label><input type="checkbox" name="days" value="${d}"${[1, 3, 5].includes(d) ? ' checked' : ''}>${WD[d]}</label>`).join('')}</fieldset>
        <label>Start (min)<input name="durStart" inputmode="numeric" value="20"></label><label>End (min)<input name="durEnd" inputmode="numeric" value="40"></label>
        <label>Intensity<select name="intensity">${EDIT_INTENSITIES.filter(k => k !== 'rest').map(k => opt(k, k, 'easy')).join('')}</select></label>
        <label style="flex:3 1 260px">Notes for each session (optional)<input name="details" maxlength="200" placeholder="e.g. flat route, walk breaks allowed"></label>
      </div>
      <button class="btn primary" type="submit">Replace</button>${close}<span class="muted pe-msg" style="font-size:12px;flex-basis:100%"></span></form></div>`;
  }
  if (P.mode === 'add') return `<div class="panel pe" id="peForm"><div class="panel-h"><h2>Add a session</h2></div>
    <form class="swim-form" data-form="sess-add">${sessFieldsHtml({ date: P.date || t, sport: 'run', intensity: 'easy' })}<button class="btn primary" type="submit">Add</button>${close}<span class="muted pe-msg" style="font-size:12px;flex-basis:100%"></span></form></div>`;
  return '';
}
function sessFieldsHtml(s) {
  return `<label>Date<input type="date" name="date" value="${esc(s.date || '')}" required></label>
    <label>Sport<select name="sport">${EDIT_SPORTS.concat(EDIT_SPORTS.includes(s.sportKey || s.sport) ? [] : [s.sportKey || s.sport]).filter(Boolean).map(k => opt(k, SPORT_LABEL[k] || k, s.sportKey || s.sport)).join('')}</select></label>
    <label style="flex:2 1 200px">Title<input name="title" maxlength="80" value="${esc(s.title || '')}"></label>
    <label>Minutes<input name="durationMin" inputmode="numeric" value="${esc(s.durationMin != null ? String(s.durationMin) : '')}"></label>
    <label>Intensity<select name="intensity">${EDIT_INTENSITIES.map(k => opt(k, k, s.intensity || 'easy')).join('')}</select></label>
    <label style="flex:1 1 100%">Details<input name="details" maxlength="400" value="${esc(s.details || '')}"></label>`;
}
// inline editor under a session row in the Plan
function sessEditHtml(s) {
  if (!S.planEdit || S.planEdit.mode !== 'edit' || S.planEdit.id !== s.id) return '';
  return `<form class="swim-form pe-inline" id="peForm" data-form="sess-edit"><input type="hidden" name="id" value="${esc(s.id)}">${sessFieldsHtml(s)}
    <button class="btn primary sm" type="submit">Save</button><button type="button" class="btn danger sm" data-action="sess-del" data-id="${esc(s.id)}">Remove session</button>
    ${s.edited && Object.keys(s.edited).length ? `<button type="button" class="btn ghost sm" data-action="sess-revert" data-id="${esc(s.id)}">Back to the plan’s version</button>` : ''}
    <button type="button" class="btn ghost sm" data-action="pe-close">Cancel</button><span class="muted pe-msg" style="font-size:12px;flex-basis:100%"></span></form>`;
}
function sessBadgesHtml(s) {
  const out = [];
  if (s.blockLabel) out.push(`<span class="chip pe-chip">${esc(s.blockLabel)}</span>`);
  if (s.added) out.push('<span class="chip pe-chip">added</span>');
  if (s.edited && Object.keys(s.edited).length) out.push(`<span class="chip pe-chip" title="${esc('Plan said: ' + Object.entries(s.edited).map(([k, v]) => k + ' ' + (v ?? '–')).join(', '))}">changed</span>`);
  return out.length ? ' ' + out.join(' ') : '';
}

function planChangesHtml(M) {
  const P = M.plan, E = cur().planEdits || {};
  const blocks = P.blocks || [], edits = Object.entries(E.sessions || {}).filter(([id]) => !blocks.some(b => id.startsWith(b.id + '-'))), added = E.added || [];
  if (!blocks.length && !edits.length && !added.length) return '';
  const byId = {}; for (const s of P.sessions) byId[s.id] = s; for (const s of P.removed || []) byId[s.id] = byId[s.id] || s;
  const rows = blocks.slice().reverse().map(b => {
    const rem = (P.removed || []).filter(s => s.removedBy === b.id).length, sick = (P.sessions || []).filter(s => s.sick === b.id).length;
    const when = `${fmtDayShort(b.start)} – ${b.end ? fmtDayShort(b.end) : 'ongoing'}`;
    return `<div class="pe-row"><span class="chip ${b.kind === 'sick' ? 'st-sick' : 'pe-chip'}">${b.kind === 'sick' ? 'sick' : 'replaced'}</span><div><b>${esc(b.kind === 'sick' ? b.label : b.label)}</b><span class="muted">${esc(when)} · ${b.kind === 'sick' ? `${sick} session${sick === 1 ? '' : 's'} excused` : `${rem} plan session${rem === 1 ? '' : 's'} set aside, ${(b.sessions || []).length} new`}${b.note ? ' · ' + esc(b.note) : ''}</span></div>
      <div class="r">${b.kind === 'sick' && !b.end ? `<button class="btn sm primary" data-action="sick-end" data-id="${esc(b.id)}">I’m better</button>` : ''}<button class="btn sm ghost" data-action="block-del" data-id="${esc(b.id)}">Undo</button></div></div>`;
  }).join('') + edits.map(([id, e]) => { const s = byId[id]; return `<div class="pe-row"><span class="chip pe-chip">${e.deleted ? 'removed' : 'changed'}</span><div><b>${esc((s && s.title) || 'Session')}</b><span class="muted">${esc(s ? fmtDayShort(s.edited && s.edited.date ? s.edited.date : s.date) : '')}${!e.deleted && e.date && s && s.edited && s.edited.date ? ' → ' + esc(fmtDayShort(e.date)) : ''}</span></div><div class="r"><button class="btn sm ghost" data-action="sess-revert" data-id="${esc(id)}">Undo</button></div></div>`; }).join('')
    + added.map(x => `<div class="pe-row"><span class="chip pe-chip">added</span><div><b>${esc(x.title)}</b><span class="muted">${esc(fmtDayShort(x.date))}${x.durationMin ? ' · ' + x.durationMin + ' min' : ''}</span></div><div class="r"><button class="btn sm ghost" data-action="sess-del" data-id="${esc(x.id)}">Remove</button></div></div>`).join('');
  return `<div class="panel"><div class="panel-h"><h2>Your changes</h2><span class="aside">the imported plan stays as it was</span></div><div class="pe-rows">${rows}</div></div>`;
}

// Today: while sick, and the first days after
function sickTodayHtml(M) {
  const P = M.plan; if (!P) return '';
  const sk = P.sickOn ? P.sickOn(S.date) : null;
  if (sk && S.date === M.today) return `<div class="panel pe sick-card"><div class="panel-h"><h2>${sk.type === 'injury' ? 'Marked injured' : 'Marked sick'}</h2><span class="aside">since ${esc(fmtDayShort(sk.start))}${sk.end ? ' · until ' + esc(fmtDayShort(sk.end)) : ''}</span></div>
    <p class="sub" style="margin:0 0 10px;font-size:13px">${esc(SICK_TYPES[sk.type] || '')}. Planned sessions are excused and don’t count as missed.${sk.note ? ' Note: ' + esc(sk.note) : ''}</p>
    <div class="row">${!sk.end || sk.end >= M.today ? `<button class="btn primary sm" data-action="sick-end" data-id="${esc(sk.id)}">I’m better</button>` : ''}<button class="btn ghost sm" data-action="block-del" data-id="${esc(sk.id)}">Undo</button></div></div>`;
  const rs = P.recentSick;
  if (rs && S.date === M.today && rs.since <= 3 && !(P.blocks || []).some(b => b.kind === 'replace' && b.start > rs.start && b.start <= addDays(rs.end, 4)))
    return `<div class="notice" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1 1 240px">Welcome back. Ease in over the next ${returnDays(rs)} days: replace them with an easier version of your plan (shorter, all easy, building back to normal).${rs.type === 'fever' ? ' After a fever, check with a doctor before hard training.' : ''}</span><button class="btn sm primary" data-action="ease-back">Set it up</button></div>`;
  return '';
}
