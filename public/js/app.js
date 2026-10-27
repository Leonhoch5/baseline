// ---------- app state, storage, actions ----------
function emptyData() { return { apple: {}, strava: {}, journal: {}, planMeta: null, planSessions: [], planWeeks: [], plans: [], planChecks: {}, planEdits: {}, preds: {}, coach: {}, profile: {}, tests: { list: [] }, overlaps: { split: {} }, metaApple: null, metaStrava: null, metaDrive: null }; }
// five main sections; the leaf views inside them keep their own ids (used in links and the URL)
const GROUPS = { today: ['today'], sleep: ['sleep'], training: ['strain', 'activities', 'plan', 'race'], trends: ['trends', 'recovery', 'model'], journal: ['journal'] };
const NAV = ['today', 'sleep', 'training', 'trends', 'journal'];
const NAV_LABEL = { today: 'Today', sleep: 'Sleep', training: 'Training', trends: 'Trends', journal: 'Journal', data: 'Settings' };
const SUB_LABEL = { strain: 'Load', activities: 'Activities', plan: 'Plan', race: 'Race', trends: 'Trends', recovery: 'Recovery', model: 'How it works' };
const TABS = [...Object.values(GROUPS).flat(), 'data'];
function groupOf(t) { for (const g in GROUPS) if (GROUPS[g].includes(t)) return g; return t; }
const COLLS = ['apple', 'strava', 'journal', 'planSessions', 'planWeeks', 'plans', 'plan', 'settings', 'meta', 'preds', 'coach'];
const S = {
  tab: 'today', date: todayYmd(), jdate: addDays(todayYmd(), -1), range: 90, actFilter: 'all', actLimit: 30, ovlLimit: 8, planAll: false,
  sample: false, sampleData: null, real: emptyData(), model: null, db: null, dbMode: 'loading', loaded: {},
  importing: null, stravaSync: null, driveSync: null, impMonths: 12, jdraft: {}, confirmDelete: false, owner: null, guideOpen: false, planSel: null, planImport: null, planDel: null, testForm: null, planEdit: null, coachBusy: null, coachErr: null
};
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
function hasRealData() { return Object.keys(S.real.apple).length > 0 || Object.keys(S.real.strava).length > 0; }
function cur() { return S.sample ? S.sampleData : S.real; }
let recomputeT = null;
function recompute() { try { const D = cur(); S.model = calibrate(enrichModel(scoreModel(buildModel(D), D)), D); try { S.model.race = raceModel(S.model, D); } catch (e) { console.error(e); } schedulePredLog(); } catch (e) { console.error(e); S.model = null; } }
function changed() { clearTimeout(recomputeT); recomputeT = setTimeout(() => { recompute(); render(); }, 40); }

function bannerHtml() {
  if (S.sample) return `<div class="notice" style="margin-bottom:6px"><span>You're looking at <b>sample data</b>. None of these numbers are yours.</span><button class="btn sm" data-action="sample-off">Leave sample data</button></div>`;
  if (S.owner === false) return `<div class="notice warn" style="margin-bottom:6px"><span>The health data on this page is private to its owner. You can still explore the sample data.</span><button class="btn sm" data-action="sample">Show sample data</button></div>`;
  return '';
}
function railFoot() {
  const el = document.getElementById('railFoot'); if (!el) return;
  const mA = S.real.metaApple, mS = S.real.metaStrava;
  const status = S.dbMode === 'live' ? '<span class="dot live"></span>Saved privately' : S.dbMode === 'off' ? '<span class="dot"></span>Not saving in this view' : '<span class="dot"></span>Loading…';
  const mG = S.real.metaDrive;
  const sy = S.driveSync && S.driveSync.running ? 'iPhone: checking…' : mG && mG.last && mG.last.at ? 'iPhone data ' + esc(fmtDayShort(ymd(new Date(mG.last.at)))) + ', ' + esc(new Date(mG.last.at).toTimeString().slice(0, 5)) : '';
  el.innerHTML = `<div>${status}</div><div><a href="#" onclick="window.signOut && window.signOut();return false" style="color:inherit">Sign out</a></div>${sy ? `<div>${sy}</div>` : ''}${mA && mA.to ? `<div>Health export to ${esc(fmtDayShort(mA.to))}</div>` : ''}${mS && mS.lastSync ? `<div>Strava ${esc(fmtDayShort(mS.lastSync.slice(0, 10)))}</div>` : ''}`;
}
function render() {
  hideTip();
  const grp = groupOf(S.tab);
  document.querySelectorAll('#nav button, #gear').forEach(b => { if (b.dataset.tab === grp) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const sub = document.getElementById('subnav'), leaves = GROUPS[grp] || [];
  sub.innerHTML = leaves.length > 1 ? `<div class="subnav" role="tablist" aria-label="${esc(NAV_LABEL[grp])}">${leaves.map(t => `<button role="tab" aria-selected="${t === S.tab}" data-action="tab" data-tab="${t}">${SUB_LABEL[t]}</button>`).join('')}</div>` : '';
  document.getElementById('topbar').innerHTML = topbarHtml();
  document.getElementById('banner').innerHTML = bannerHtml();
  const v = document.getElementById('view');
  try {
    if (!S.sample && S.dbMode === 'loading' && S.tab !== 'data' && !hasRealData()) v.innerHTML = '<div class="panel empty"><div class="eyebrow">Loading</div><h2>Opening your data</h2><p>Fetching your saved recovery, sleep and activities.</p></div>';
    else VIEWS[S.tab](v);
  } catch (e) { console.error(e); v.innerHTML = `<div class="notice err">This page hit an error while drawing: ${esc(e.message)}</div>`; }
  railFoot();
  lastW = window.innerWidth;
}
function setTab(t) {
  if (GROUPS[t] && !GROUPS[t].includes(t)) { const last = lsGet('baseline.sub.' + t); t = GROUPS[t].includes(last) ? last : GROUPS[t][0]; }
  if (!TABS.includes(t)) return;
  S.tab = t; lsSet('baseline.tab', t); lsSet('baseline.sub.' + groupOf(t), t);
  try { history.replaceState(null, '', '#' + t); } catch (e) { /* ignore */ }
  render(); window.scrollTo({ top: 0 });
}

// ---- storage (db capability) ----
async function initDb() {
  let db = null;
  try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) { db = null; }
  if (!db) { S.dbMode = 'off'; changed(); return; }
  S.db = db;
  const done = () => { if (COLLS.every(c => S.loaded[c])) { if (S.dbMode !== 'live') { S.dbMode = 'live'; afterLoad(); } } };
  const sub = (coll, fn) => db.collection(coll).onSnapshot(snap => { try { fn(snap.docs.filter(d => d.exists)); } catch (e) { console.error(e); } S.loaded[coll] = true; done(); changed(); },
    err => { console.warn('db', coll, err && err.code); S.loaded[coll] = true; done(); changed(); });
  const byId = docs => { const o = {}; docs.forEach(d => { o[d.id] = d.data(); }); return o; };
  sub('apple', docs => { S.real.apple = byId(docs); });
  sub('strava', docs => { S.real.strava = byId(docs); });
  sub('journal', docs => { S.real.journal = byId(docs); });
  sub('planSessions', docs => { S.real.planSessions = docs.map(d => ({ id: d.id, ...d.data() })); });
  sub('planWeeks', docs => { S.real.planWeeks = docs.map(d => ({ id: d.id, ...d.data() })); });
  sub('preds', docs => { const o = {}; docs.forEach(d => { o[d.id] = d.data(); }); S.real.preds = o; });
  sub('coach', docs => { const o = {}; docs.forEach(d => { o[d.id] = d.data(); }); S.real.coach = o; });
  sub('plans', docs => { S.real.plans = docs.map(d => ({ ...d.data(), id: d.id })); });
  sub('plan', docs => { const m = docs.find(d => d.id === 'meta'), c = docs.find(d => d.id === 'checks'), ed = docs.find(d => d.id === 'edits'); S.real.planMeta = m ? m.data() : null; S.real.planChecks = c ? c.data() : {}; S.real.planEdits = ed ? ed.data() : {}; });
  sub('settings', docs => { const p = docs.find(d => d.id === 'profile'), o = docs.find(d => d.id === 'overlaps'), t = docs.find(d => d.id === 'tests'); S.real.tests = t ? t.data() : { list: [] }; S.real.profile = p ? p.data() : {}; S.real.overlaps = o ? o.data() : { split: {} }; });
  sub('meta', docs => { const a = docs.find(d => d.id === 'apple'), s = docs.find(d => d.id === 'strava'), g = docs.find(d => d.id === 'gdrive'); S.real.metaApple = a ? a.data() : null; S.real.metaStrava = s ? s.data() : null; S.real.metaDrive = g ? g.data() : null; });
  setTimeout(() => { if (S.dbMode === 'loading') { S.dbMode = 'live'; changed(); } }, 12000);
  try { const user = await window.claude.use('user'); if (user) { S.owner = await user.isOwner(); if (S.owner === false && !hasRealData()) changed(); } } catch (e) { /* unknown viewer */ }
}
async function afterLoad() {
  if (S.owner === false) return;
  const mD = S.real.metaDrive, mS = S.real.metaStrava;
  await sleep(1200);
  if (mD && mD.lastSync && Date.now() - Date.parse(mD.lastSync) > 10 * 60 * 1000) await driveSync({ quiet: true });
  if (mS && mS.lastSync && Date.now() - Date.parse(mS.lastSync) > 3 * 3600 * 1000) await stravaSync({ quiet: true });
}
async function writeDoc(path, data) {
  if (S.db) { await S.db.doc(path).set(data); return; }
  const [coll, id] = path.split('/');
  if (coll === 'apple' || coll === 'strava' || coll === 'journal') S.real[coll][id] = data;
  else if (path === 'meta/apple') S.real.metaApple = data;
  else if (path === 'meta/strava') S.real.metaStrava = data;
  else if (path === 'meta/gdrive') S.real.metaDrive = data;
  else if (path === 'settings/profile') S.real.profile = data;
  else if (path === 'settings/overlaps') S.real.overlaps = data;
  else if (path === 'settings/tests') S.real.tests = data;
  else if (path === 'plan/checks') S.real.planChecks = data;
  else if (path === 'plan/edits') S.real.planEdits = data;
  else if (coll === 'preds') S.real.preds = { ...(S.real.preds || {}), [id]: data };
  else if (coll === 'coach') S.real.coach = { ...(S.real.coach || {}), [id]: data };
  else if (coll === 'planWeeks') { S.real.planWeeks = S.real.planWeeks.filter(w => w.id !== id).concat([{ ...data, id }]); }
  else if (coll === 'plans') { S.real.plans = S.real.plans.filter(x => x.id !== id).concat([{ ...data, id }]); }
}
async function deleteDoc(path) {
  if (S.db) { await S.db.doc(path).delete(); return; }
  const [coll, id] = path.split('/');
  if (coll === 'planWeeks' || coll === 'plans') S.real[coll] = S.real[coll].filter(x => x.id !== id);
  else if (S.real[coll]) delete S.real[coll][id];
  if (path === 'meta/apple') S.real.metaApple = null; if (path === 'meta/strava') S.real.metaStrava = null; if (path === 'meta/gdrive') S.real.metaDrive = null;
}
function humanError(e) {
  const c = e && e.code;
  if (c === 'quota_exceeded') return 'Storage for this page is full. Import a shorter period, or delete imported data and try again.';
  if (c === 'resource_exhausted') return 'Too many saves at once. Wait a few seconds and try again.';
  if (c === 'invalid_argument') return 'One month of data was too large to save. Import a shorter period and try again.';
  if (c === 'unavailable') return 'Saving is briefly unavailable. Try again in a moment.';
  if (c === 'revoked' || c === 'not_granted') return 'This page no longer has permission to save data. Reload it inside Claude.';
  return (e && e.message) || String(e);
}
function sinceForImport() { return S.impMonths ? addDays(todayYmd(), -Math.round(S.impMonths * 30.44)) : ''; }

// ---- imports ----
function refreshImport() { const el = document.getElementById('impStatus'); if (el) el.innerHTML = importStatusHtml(S.importing); }
function refreshSync() { const el = document.getElementById('syncStatus'); if (el) el.innerHTML = syncStatusHtml(S.stravaSync); }
function refreshDrive() { const el = document.getElementById('driveStatus'); if (el) el.innerHTML = driveStatusHtml(S.driveSync); railFoot(); }
async function importAppleFile(file) {
  if (S.importing && S.importing.phase && !S.importing.done && !S.importing.error) return;
  S.importing = { phase: 'start', name: file.name }; refreshImport();
  try {
    const res = await parseAppleExport(file, sinceForImport(), p => { Object.assign(S.importing, p); refreshImport(); });
    const months = Object.keys(res.months).sort();
    if (!months.length) throw new Error('No heart-rate, sleep or workout data found in this period. Choose a longer import range and try again.');
    S.importing.phase = 'save'; S.importing.total = months.length; S.importing.saved = 0; refreshImport();
    for (const m of months) { await writeDoc('apple/' + m, res.months[m]); S.importing.saved++; refreshImport(); }
    await writeDoc('meta/apple', res.meta);
    if (S.sample) S.sample = false;
    const mt = res.meta;
    S.importing = { done: `${mt.nights} nights, ${mt.workouts} workouts and ${(mt.hrSamples || 0).toLocaleString()} heart-rate readings from ${fmtDayShort(mt.from)} to ${fmtDayShort(mt.to)}.` };
    S.date = mt.to && mt.to < todayYmd() ? mt.to : todayYmd();
  } catch (e) { console.error(e); S.importing = { error: humanError(e) }; }
  refreshImport(); changed();
}
async function saveStravaActs(acts, metaPatch) {
  const existing = {}; for (const m in S.real.strava) for (const a of (S.real.strava[m] && S.real.strava[m].acts) || []) existing[a.id] = a;
  const byMonth = {};
  for (const a of acts) {
    const old = existing[a.id];
    const merged = old ? { ...old, ...a } : a;
    (byMonth[a.start.slice(0, 7)] || (byMonth[a.start.slice(0, 7)] = [])).push(merged);
  }
  for (const m of Object.keys(byMonth).sort()) {
    const map = new Map(((S.real.strava[m] && S.real.strava[m].acts) || []).map(a => [a.id, a]));
    for (const a of byMonth[m]) map.set(a.id, a);
    await writeDoc('strava/' + m, { acts: [...map.values()].sort((x, y) => x.ls - y.ls), updatedAt: new Date().toISOString() });
  }
  await writeDoc('meta/strava', clean({ ...(S.real.metaStrava || {}), ...metaPatch }));
}
async function importStravaFile(file) {
  S.stravaSync = { running: true, msg: 'Reading ' + file.name + '…' }; refreshSync();
  try {
    const acts = await parseStravaFile(file);
    const since = sinceForImport();
    const keep = acts.filter(a => !since || a.start.slice(0, 10) >= since);
    if (!keep.length) throw new Error('No activities in the selected import range.');
    await saveStravaActs(keep, { csvAt: new Date().toISOString() });
    if (S.sample) S.sample = false;
    S.stravaSync = { done: `Imported ${keep.length} activities from the file.` };
  } catch (e) { console.error(e); S.stravaSync = { error: humanError(e) }; }
  refreshSync(); changed();
}
async function callStrava(mcp, tool, input) {
  try { return (await mcp.callTool('Strava', tool, input)).payload; }
  catch (e) {
    if (e && e.retryable) { await sleep(Math.min(8000, e.retryAfterMs || 1200 + Math.random() * 1500)); return (await mcp.callTool('Strava', tool, input)).payload; }
    throw e;
  }
}
const MCP_STOP = ['needs_reauth', 'server_not_connected', 'selection_required', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'not_granted', 'capability_disabled', 'capability_removed'];
function mcpErrorState(e) {
  const c = e && e.code;
  const msg = {
    needs_reauth: 'Your Strava connection has expired. Reconnect Strava in claude.ai Settings → Connectors, then sync again.',
    server_not_connected: 'Strava isn’t connected to your Claude account. Add the Strava connector in claude.ai Settings → Connectors, then sync again.',
    selection_required: 'You have more than one Strava connector. Pick one when Claude asks, then sync again.',
    not_in_manifest: 'Strava is turned off for this page. Allow Strava in the page’s permissions, then sync again.',
    approval_required: 'Strava needs your approval for this page. Press Sync and choose Allow.',
    blocked_by_policy: 'Your organisation doesn’t allow the Strava connector here.',
    server_unavailable: 'Strava didn’t respond. Try again in a minute.',
    rate_limited: 'Strava is limiting requests right now. Try again in a few minutes.',
    tool_error: 'Strava reported a problem: ' + ((e && e.message) || 'unknown error'),
    not_granted: 'Strava sync only works with this page open inside Claude. You can import a Strava export file instead.',
    capability_disabled: 'Strava sync only works with this page open inside Claude. You can import a Strava export file instead.',
    capability_removed: 'Strava sync only works with this page open inside Claude. You can import a Strava export file instead.',
    cancelled: 'Sync was cancelled.',
  }[c];
  return { error: msg || 'Strava sync failed: ' + ((e && e.message) || 'unknown error'), errorKind: ['approval_required', 'server_unavailable', 'rate_limited', 'cancelled'].includes(c) ? 'warn' : 'err' };
}
async function stravaSync(opts) {
  opts = opts || {};
  if (S.stravaSync && S.stravaSync.running) return;
  S.stravaSync = { running: true, msg: 'Connecting to Strava…' }; refreshSync(); if (!opts.quiet && S.tab === 'data') render();
  let mcp = null;
  try { mcp = window.claude && window.claude.use ? await window.claude.use('mcp') : null; } catch (e) { mcp = null; }
  if (!mcp) { S.stravaSync = mcpErrorState({ code: 'not_granted' }); refreshSync(); if (S.tab === 'data') render(); return; }
  try {
    const meta = S.real.metaStrava || {};
    const windowStart = S.impMonths ? addDays(todayYmd(), -Math.round(S.impMonths * 30.44)) : '2008-01-01';
    const since = opts.full || !meta.lastSync ? windowStart : addDays(meta.lastSync.slice(0, 10), -3);
    const got = []; let after = null;
    for (let page = 0; page < 40; page++) {
      const input = { first: 100, range_start: since + 'T00:00:00' }; if (after) input.after = after;
      const p = await callStrava(mcp, 'list_activities', input) || {};
      const list = Array.isArray(p.activities) ? p.activities : [];
      for (const a of list) { const n = normStravaApi(a); if (n) got.push(n); }
      S.stravaSync.msg = `Fetched ${got.length} activities…`; refreshSync();
      if (!p.has_next_page || !p.end_cursor || !list.length) break;
      after = p.end_cursor;
    }
    // keep heart rate already fetched; fetch it for activities the Watch didn't record
    const existing = {}; for (const m in S.real.strava) for (const a of (S.real.strava[m] && S.real.strava[m].acts) || []) existing[a.id] = a;
    for (const a of got) { const o = existing[a.id]; if (o && o.hrDone) { a.hrDone = true; for (const k of ['hb', 'avgHr', 'maxHr']) if (o[k] != null) a[k] = o[k]; } }
    const appleW = []; for (const m in S.real.apple) for (const w of (S.real.apple[m] && S.real.apple[m].workouts) || []) if (w.hb) appleW.push(w);
    const covered = new Set(); for (const g of detectOverlaps(appleW, got, {}).acts) if (g.hasWatchHr) g.ids.forEach(id => covered.add(id));
    const cutoff = addDays(todayYmd(), -120);
    const watchDense = (a) => { const day = a.start.slice(0, 10), doc = S.real.apple[day.slice(0, 7)], dd = doc && doc.days && doc.days[day]; return !!dd && slotInfo(dd, minOfDayLms(a.ls), a.durS / 60).cov >= 0.6; };
    const need = got.filter(a => !a.hrDone && !covered.has(a.id) && !watchDense(a) && a.start.slice(0, 10) >= cutoff).sort((x, y) => y.ls - x.ls).slice(0, opts.quiet ? 10 : 40);
    let k = 0;
    for (const a of need) {
      k++; S.stravaSync.msg = `Reading heart rate for ${k} of ${need.length} activities…`; refreshSync();
      try {
        const st = await callStrava(mcp, 'get_activity_streams', { activity_id: a.sid, streams: ['time', 'heart_rate'], resolution: 500 });
        const hr = st ? hrFromStream(st.time, st.heart_rate) : null;
        a.hrDone = true; if (hr) Object.assign(a, hr);
      } catch (e) { if (e && MCP_STOP.includes(e.code)) throw e; }
    }
    try {
      const z = await callStrava(mcp, 'get_athlete_zones', {}), hm = hrMaxFromStravaZones(z);
      const zs = z && Array.isArray(z.heart_rate_zones) && z.heart_rate_zones.length >= 5 ? z.heart_rate_zones.slice(0, 4).map(x => x && x.max).filter(x => x > 0) : null;
      const p = S.real.profile || {}, patch = {};
      if (hm && hm !== p.stravaHrMax) patch.stravaHrMax = hm;
      if (zs && zs.length === 4 && JSON.stringify(zs) !== JSON.stringify(p.stravaZones)) patch.stravaZones = zs;
      if (Object.keys(patch).length) await saveProfile(patch);
    } catch (e) { if (e && MCP_STOP.includes(e.code)) throw e; }
    await saveStravaActs(got, { lastSync: new Date().toISOString(), via: 'api', count: got.length });
    if (S.sample && !opts.quiet) S.sample = false;
    S.stravaSync = { done: got.length ? `Synced ${got.length} activities${need.length ? `, with heart rate for ${need.length}` : ''}.` : 'Strava is up to date. No new activities.' };
  } catch (e) { console.warn('strava', e); S.stravaSync = e && e.code ? mcpErrorState(e) : { error: humanError(e) }; }
  refreshSync(); changed();
}
// ---- Google Drive: files written by the iPhone Shortcut ----
function b64ToText(b64) { const bin = atob(String(b64 || '').replace(/\s/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder('utf-8').decode(u); }
async function callDrive(mcp, tool, input) {
  try { return (await mcp.callTool('Google Drive', tool, input)).payload; }
  catch (e) {
    if (e && e.retryable) { await sleep(Math.min(8000, e.retryAfterMs || 1200 + Math.random() * 1500)); return (await mcp.callTool('Google Drive', tool, input)).payload; }
    throw e;
  }
}
function driveErrorState(e) {
  const c = e && e.code;
  const msg = {
    needs_reauth: 'Your Google Drive connection has expired. Reconnect Google Drive in claude.ai Settings → Connectors, then check again.',
    server_not_connected: 'Google Drive isn’t connected to your Claude account. Add the Google Drive connector in claude.ai Settings → Connectors, then check again.',
    selection_required: 'You have more than one Google Drive connector. Pick one when Claude asks, then check again.',
    not_in_manifest: 'Google Drive is turned off for this page. Allow Google Drive in the page’s permissions, then check again.',
    approval_required: 'Google Drive needs your approval for this page. Press Check again and choose Allow.',
    blocked_by_policy: 'Your organisation doesn’t allow the Google Drive connector here.',
    server_unavailable: 'Google Drive didn’t respond. Try again in a minute.',
    rate_limited: 'Google Drive is limiting requests right now. Try again in a few minutes.',
    tool_error: 'Google Drive reported a problem: ' + ((e && e.message) || 'unknown error'),
    not_granted: 'Google Drive sync only works with this page open inside Claude.',
    capability_disabled: 'Google Drive sync only works with this page open inside Claude.',
    capability_removed: 'Google Drive sync only works with this page open inside Claude.',
    cancelled: 'Check was cancelled.',
  }[c];
  return { error: msg || 'Google Drive check failed: ' + ((e && e.message) || 'unknown error'), errorKind: ['approval_required', 'server_unavailable', 'rate_limited', 'cancelled'].includes(c) ? 'warn' : 'err' };
}
const COUNT_LABEL = { HR: 'heart-rate readings', HRV: 'HRV', RHR: 'resting HR', RESP: 'breathing rate', SPO2: 'blood oxygen', SLEEP: 'sleep segments' };
async function driveSync(opts) {
  opts = opts || {};
  if (S.driveSync && S.driveSync.running) return;
  S.driveSync = { running: true, msg: 'Looking for new files in Google Drive…' }; refreshDrive();
  let mcp = null;
  try { mcp = window.claude && window.claude.use ? await window.claude.use('mcp') : null; } catch (e) { mcp = null; }
  if (!mcp) { S.driveSync = driveErrorState({ code: 'not_granted' }); refreshDrive(); return; }
  try {
    const meta = S.real.metaDrive || {};
    const doneMap = { ...(meta.files || {}) };
    const since = opts.full || !meta.lastSync ? null : new Date(Date.parse(meta.lastSync) - 4 * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
    const query = "title contains 'baseline'" + (since ? ` and modifiedTime > '${since}'` : '');
    let files = [], token = null;
    for (let page = 0; page < 10; page++) {
      const input = { query, pageSize: 100, excludeContentSnippets: true }; if (token) input.pageToken = token;
      const p = await callDrive(mcp, 'search_files', input) || {};
      const list = Array.isArray(p.files) ? p.files : [];
      files = files.concat(list);
      token = p.nextPageToken; if (!token || !list.length) break;
    }
    files = files.filter(f => /^baseline-\d{4}-\d{2}-\d{2}/i.test(f.title || '') && !/folder/i.test(f.mimeType || ''));
    const todo = files.filter(f => doneMap[f.id] !== f.modifiedTime)
      .sort((a, b) => (a.title.slice(9, 19) + (a.modifiedTime || '')).localeCompare(b.title.slice(9, 19) + (b.modifiedTime || ''))).slice(-45);
    if (!files.length && !meta.lastSync) { S.driveSync = { error: 'No Baseline files in your Google Drive yet. Build the Shortcut below, run it once on your iPhone, then check again.', errorKind: 'warn' }; refreshDrive(); return; }
    const parsed = []; let last = meta.last || null, k = 0;
    for (const f of todo) {
      k++; S.driveSync.msg = `Reading ${f.title} (${k} of ${todo.length})…`; refreshDrive();
      const d = await callDrive(mcp, 'download_file_content', { fileId: f.id }) || {};
      const r = shortcutFileToDays(d.content ? b64ToText(d.content) : '');
      parsed.push(r); doneMap[f.id] = f.modifiedTime;
      last = { file: f.title, at: f.modifiedTime, counts: r.counts, warnings: r.warnings.slice(0, 4) };
    }
    if (parsed.length) {
      S.driveSync.msg = 'Saving…'; refreshDrive();
      const docs = mergeShortcutDays(parsed, S.real.apple);
      for (const m of Object.keys(docs).sort()) await writeDoc('apple/' + m, docs[m]);
    }
    const cutoff = new Date(Date.now() - 45 * 86400000).toISOString();
    const kept = {}; for (const id in doneMap) if (doneMap[id] >= cutoff) kept[id] = doneMap[id];
    await writeDoc('meta/gdrive', clean({ lastSync: new Date().toISOString(), files: kept, last }));
    if (parsed.length && S.sample) S.sample = false;
    const c = last && last.counts;
    S.driveSync = !parsed.length ? { done: 'Up to date. No new files from your iPhone since the last check.' } :
      { done: `Imported ${parsed.length} file${parsed.length > 1 ? 's' : ''} from your iPhone.`, warn: c && !c.HR ? 'The newest file has no heart-rate readings. On your iPhone, open Settings → Health → Data Access & Devices → Shortcuts and allow all categories.' : null };
  } catch (e) { console.warn('drive', e); S.driveSync = e && e.code ? driveErrorState(e) : { error: humanError(e) }; }
  refreshDrive(); changed();
}
async function saveProfile(patch) {
  const next = { ...(S.real.profile || {}) };
  for (const k in patch) { if (patch[k] == null || patch[k] === '') delete next[k]; else next[k] = patch[k]; }
  await writeDoc('settings/profile', next);
}
// ---- swim tests & manual race (Training › Race) ----
async function saveTests(list) {
  if (S.sample) { S.sampleData.tests = { list }; changed(); return; }
  try { await writeDoc('settings/tests', { list }); } catch (e) { console.error(e); }
  changed();
}
async function onForm(form) {
  const f = Object.fromEntries(new FormData(form).entries()), msg = form.querySelector('#testMsg');
  const say = t => { if (msg) msg.textContent = t; };
  if (form.dataset.form === 'test-add') {
    const T = TEST_TYPES[f.type]; if (!T) return say('Pick a test.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) return say('Pick a date.');
    const values = {};
    for (const fd of T.fields) {
      const raw = String(f['v_' + fd.k] || '').trim();
      if (!raw) { if (fd.opt) continue; return say('Fill in “' + fd.label + '”.'); }
      const v = fd.kind === 'time' ? parseClock(raw) : fd.kind === 'num' ? parseFloat(raw.replace(',', '.')) : raw.slice(0, 80);
      if (v == null || (fd.kind !== 'text' && !isFinite(v))) return say('“' + fd.label + '” isn’t a valid ' + (fd.kind === 'time' ? 'time (m:ss)' : 'number') + '.');
      values[fd.k] = v;
    }
    const err = T.check ? T.check(values) : null; if (err) return say(err);
    const entry = clean({ id: 't' + Date.now().toString(36), date: f.date, type: f.type, values, sessionId: f.sessionId || null });
    const list = ((cur().tests && cur().tests.list) || []).filter(t => !(entry.sessionId && t.sessionId === entry.sessionId)).concat([entry]).sort((a, b) => a.date < b.date ? -1 : 1);
    S.testForm = null;
    await saveTests(list);
  } else if (form.dataset.form === 'race-set') {
    if (!f.name || !/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) return;
    const race = { name: f.name.trim().slice(0, 80), date: f.date, goal: (f.goal || '').trim().slice(0, 200) };
    if (S.sample) { S.sampleData.profile = { ...(S.sampleData.profile || {}), race }; changed(); return; }
    await saveProfile({ race }); changed();
  }
}
async function saveOverlaps(split) {
  if (S.sample) { S.sampleData.overlaps = { split }; changed(); return; }
  await writeDoc('settings/overlaps', { split }); changed();
}

// ---- actions ----
const ACTIONS = {
  tab: b => setTab(b.dataset.tab),
  'coach-note': async b => {
    const date = b.dataset.date, M = S.model; if (!M || S.coachBusy) return;
    S.coachBusy = date; S.coachErr = null; render();
    try {
      const sample = window.claude && window.claude.use ? await window.claude.use('sample') : null;
      if (!sample) throw { code: 'unavailable' };
      const out = await sample.json(coachNotePrompt(M, date), { modelTier: 'default', cache: false });
      if (!out || typeof out !== 'object' || !out.note) throw { code: 'invalid_json' };
      const note = { verdict: String(out.verdict || '').slice(0, 60), note: String(out.note).slice(0, 900), tomorrow: String(out.tomorrow || '').slice(0, 240), at: new Date().toISOString(), by: aiName() };
      const m = date.slice(0, 7), D = cur(), doc = { ...((D.coach || {})[m] || { notes: {} }) }; doc.notes = { ...(doc.notes || {}), [date]: note };
      if (S.sample) { S.sampleData.coach = { ...(S.sampleData.coach || {}), [m]: doc }; } else await writeDoc('coach/' + m, doc);
    } catch (e) { console.warn(e); S.coachErr = { date, text: sampleErrorText(e) }; }
    S.coachBusy = null; render();
  },
  'test-del': b => saveTests(((cur().tests && cur().tests.list) || []).filter(t => t.id !== b.dataset.id)),
  'test-open': b => {
    const s = S.model && S.model.plan.sessions.find(x => x.id === b.dataset.session);
    S.testForm = { type: b.dataset.type, date: b.dataset.date > M_today() ? M_today() : b.dataset.date, sessionId: b.dataset.session || null, pre: s ? sessionTestDefaults(s, b.dataset.type) : null };
    setTab('race');
    setTimeout(() => { const el = document.getElementById('testsPanel'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); const inp = document.querySelector('#testFields input'); if (inp) inp.focus({ preventScroll: true }); }, 60);
  },
  day: b => { const n = addDays(S.date, +b.dataset.d); if (n <= (S.model ? S.model.today : todayYmd())) { S.date = n; render(); } },
  goto: b => { S.date = b.dataset.date === 'today' ? (S.model ? S.model.today : todayYmd()) : b.dataset.date; render(); },
  range: b => { S.range = +b.dataset.n; render(); },
  actfilter: b => { S.actFilter = b.dataset.f; S.actLimit = 30; render(); },
  'more-acts': () => { S.actLimit += 60; render(); },
  'more-ovl': () => { S.ovlLimit += 20; render(); },
  split: async b => { const split = { ...((cur().overlaps || {}).split || {}) }; b.dataset.keys.split('|').forEach(k => { split[k] = true; }); b.disabled = true; try { await saveOverlaps(split); } catch (e) { b.disabled = false; } },
  merge: async b => { const split = { ...((cur().overlaps || {}).split || {}) }; delete split[b.dataset.key]; b.disabled = true; try { await saveOverlaps(split); } catch (e) { b.disabled = false; } },
  planall: () => { S.planAll = !S.planAll; render(); },
  'plan-sel': b => { S.planSel = b.dataset.id; S.planAll = false; S.planDel = null; render(); },
  'plan-add': () => {
    const P = S.model && S.model.plan, last = P && P.plans.length ? P.plans[P.plans.length - 1] : null;
    const start = last && last.end >= todayYmd() ? addDays(mondayOfDate(last.end), 7) : mondayOfDate(addDays(todayYmd(), 7));
    S.planImport = { start, name: '', text: '', images: [], files: [], busy: false }; render();
    const el = document.getElementById('planImport'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'plan-import-cancel': () => { if (S.planImport && S.planImport.ctl) S.planImport.ctl.abort(); S.planImport = null; render(); },
  'plan-convert': () => convertPlan(),
  'plan-stop': () => { if (S.planImport && S.planImport.ctl) S.planImport.ctl.abort(); },
  'plan-back': () => { S.planImport.preview = null; S.planImport.spec = null; S.planImport.error = null; render(); },
  'plan-save': () => savePlan(),
  'plan-del-ask': b => { S.planDel = b.dataset.id; render(); },
  'plan-del-no': () => { S.planDel = null; render(); },
  'plan-del-yes': async b => {
    const id = b.dataset.id; b.disabled = true;
    try {
      for (const w of S.real.planWeeks.filter(w => w.plan === id)) await deleteDoc('planWeeks/' + w.id);
      await deleteDoc('plans/' + id);
      S.planDel = null; S.planSel = null; changed();
    } catch (e) { b.disabled = false; const el = document.getElementById('planDelStatus'); if (el) el.textContent = humanError(e); }
  },
  'plan-check': async b => {
    const id = b.dataset.id, d = cur(), done = { ...(((d.planChecks || {}).done) || {}) };
    if (done[id]) delete done[id]; else done[id] = { by: 'you', at: todayYmd() };
    b.disabled = true;
    try { if (S.sample) { S.sampleData.planChecks = { done }; changed(); } else { await writeDoc('plan/checks', { done }); changed(); } }
    catch (e) { b.disabled = false; }
  },
  sample: () => { if (!S.sampleData) S.sampleData = makeSampleData(); S.sample = true; S.date = todayYmd(); S.jdraft = {}; S.tab = S.tab === 'data' ? 'today' : S.tab; recompute(); render(); },
  'sample-off': () => { S.sample = false; S.jdraft = {}; recompute(); render(); },
  jset: b => {
    const d = S.jdate, base = { ...((S.model && S.model.journal[d]) || {}), ...(S.jdraft[d] || {}) };
    let val = b.dataset.val; val = val === 'true' ? true : val === 'false' ? false : +val;
    if (base[b.dataset.key] === val) delete base[b.dataset.key]; else base[b.dataset.key] = val;
    const note = document.getElementById('jnote'); if (note) base.note = note.value;
    S.jdraft[d] = base; render();
  },
  jsave: async b => {
    const d = S.jdate, draft = S.jdraft[d]; if (!draft) return;
    b.disabled = true;
    const m = d.slice(0, 7), data = cur();
    const entries = { ...((data.journal[m] && data.journal[m].entries) || {}) };
    const e = {}; for (const k in draft) if (draft[k] !== undefined && draft[k] !== '') e[k] = draft[k];
    entries[d] = e;
    try {
      if (S.sample) S.sampleData.journal[m] = { entries }; else await writeDoc('journal/' + m, { entries });
      delete S.jdraft[d]; changed();
    } catch (err) { b.disabled = false; const st = document.getElementById('jstatus'); if (st) st.textContent = humanError(err); }
  },
  'ck-set': b => saveJournalPatch(b.dataset.date, j => { const k = b.dataset.key, v = +b.dataset.val; if (j[k] === v) delete j[k]; else j[k] = v; }),
  'rpe-set': b => saveJournalPatch(b.dataset.date, j => { const g = b.dataset.gid, v = +b.dataset.val; j.rpe = { ...(j.rpe || {}) }; if (j.rpe[g] === v) delete j.rpe[g]; else j.rpe[g] = v; }),
  jdiscard: () => { delete S.jdraft[S.jdate]; render(); },
  jdate: b => { S.jdate = b.dataset.date; render(); },
  jday: b => { const n = addDays(S.jdate, +b.dataset.d); if (n <= todayYmd()) { S.jdate = n; render(); } },
  'strava-sync': () => stravaSync({}),
  'drive-sync': () => driveSync({}),
  'drive-full': () => driveSync({ full: true }),
  guide: b => { S.guideOpen = !S.guideOpen; render(); },
  copy: b => {
    const t = b.dataset.text, done = () => { const o = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = o; }, 1100); };
    try { navigator.clipboard.writeText(t).then(done, () => selectText(b)); } catch (e) { selectText(b); }
  },
  'strava-full': () => stravaSync({ full: true }),
  'save-settings': async b => {
    const num = (id) => { const x = document.getElementById(id).value.trim(); return x === '' ? null : +x; };
    const hrMax = num('setHrMax'), sn = num('setSleep'), by = num('setBirth');
    const st = document.getElementById('setStatus');
    if (hrMax != null && !(hrMax >= 120 && hrMax <= 230)) { st.textContent = 'Max heart rate must be between 120 and 230.'; return; }
    if (sn != null && !(sn >= 5 && sn <= 11)) { st.textContent = 'Sleep need must be between 5 and 11 hours.'; return; }
    if (by != null && !(by >= 1920 && by <= 2020)) { st.textContent = 'Enter a birth year between 1920 and 2020.'; return; }
    b.disabled = true;
    try { await saveProfile({ hrMax, sleepNeedH: sn, birthYear: by }); st.textContent = 'Saved. Scores updated.'; changed(); }
    catch (e) { st.textContent = humanError(e); }
    b.disabled = false;
  },
  'delete-ask': () => { S.confirmDelete = true; render(); },
  'delete-no': () => { S.confirmDelete = false; render(); },
  'delete-yes': async () => {
    const st = document.getElementById('delStatus');
    try {
      const paths = Object.keys(S.real.apple).map(m => 'apple/' + m).concat(Object.keys(S.real.strava).map(m => 'strava/' + m), ['meta/apple', 'meta/strava', 'meta/gdrive']);
      let n = 0;
      for (const p of paths) { await deleteDoc(p); n++; if (st) st.textContent = `Deleting ${n} of ${paths.length}…`; }
      S.confirmDelete = false; S.importing = null; S.stravaSync = null; S.driveSync = null; changed();
    } catch (e) { if (st) st.textContent = humanError(e); }
  },
};
Object.assign(ACTIONS, PLAN_EDIT_ACTIONS);
// Log tomorrow's predictions once, on the day they are made, so accuracy can later be checked on genuinely unseen outcomes.
let predLogT = null;
function schedulePredLog() {
  clearTimeout(predLogT);
  predLogT = setTimeout(async () => {
    const M = S.model;
    if (!M || M.empty || S.sample || S.dbMode !== 'live' || S.owner === false || !S.db || !M.pred) return;
    const out = {};
    for (const k in M.pred) { const c = M.pred[k].current; if (c && c.date === addDays(todayYmd(), 1)) out[k] = clean({ pred: Math.round(c.pred * 1000) / 1000, lo: c.lo != null ? Math.round(c.lo * 1000) / 1000 : null, hi: c.hi != null ? Math.round(c.hi * 1000) / 1000 : null, method: c.method, version: CAL_VERSION, madeAt: new Date().toISOString() }); }
    if (!Object.keys(out).length) return;
    const date = addDays(todayYmd(), 1), m = date.slice(0, 7);
    const doc = (S.real.preds || {})[m] || { entries: {} };
    const have = (doc.entries || {})[date] || {};
    const add = {}; for (const k in out) if (!have[k]) add[k] = out[k];
    if (!Object.keys(add).length) return;
    try { await writeDoc('preds/' + m, { entries: { ...(doc.entries || {}), [date]: { ...have, ...add } } }); } catch (e) { console.warn('pred log', e); }
  }, 2500);
}
async function saveJournalPatch(date, fn) {
  const m = date.slice(0, 7), data = cur();
  const entries = { ...((data.journal[m] && data.journal[m].entries) || {}) };
  const e = { ...(entries[date] || {}) }; fn(e); entries[date] = e;
  try { if (S.sample) { S.sampleData.journal[m] = { entries }; changed(); } else await writeDoc('journal/' + m, { entries }); }
  catch (err) { console.warn(err); }
}
// ---- adding a plan ----
function rerenderImport() { const el = document.getElementById('planImport'); if (el) el.outerHTML = planImportHtml(); }
async function readPlanFiles(fileList) {
  const I = S.planImport; if (!I) return;
  I.error = null;
  for (const f of fileList) {
    const n = f.name.toLowerCase();
    try {
      if (/\.ics$/.test(n) || f.type === 'text/calendar') { I.spec = icsToSpec(await f.text(), I.name); I.kind = 'ics'; I.start = I.spec.firstDate; }
      else if (/\.csv$/.test(n)) { I.spec = csvToSpec(await f.text(), I.name); I.kind = 'csv'; I.start = I.spec.firstDate; }
      else if (/\.docx$/.test(n)) { I.text = (I.text ? I.text + '\n\n' : '') + await docxToText(f); }
      else if (/^image\//.test(f.type)) { I.images.push(f); }
      else if (/\.pdf$/.test(n)) { I.error = 'PDFs can’t be read here. Copy the text into the box or take screenshots of the pages.'; }
      else { I.text = (I.text ? I.text + '\n\n' : '') + await f.text(); }
      I.files.push(f.name);
    } catch (e) { I.error = (e && e.message) || 'This file couldn’t be read.'; }
  }
  if (I.spec && (I.kind === 'ics' || I.kind === 'csv')) buildPreview();
  rerenderImport();
}
function buildPreview() {
  const I = S.planImport;
  try { I.preview = expandPlanSpec(I.spec, I.start); if (I.name) I.preview.meta.name = I.name; I.error = I.preview.sessions ? null : 'No sessions fall on or after the start date.'; }
  catch (e) { I.error = (e && e.message) || 'The plan couldn’t be laid out.'; I.preview = null; }
}
async function convertPlan() {
  const I = S.planImport; if (!I || I.busy) return;
  const ta = document.getElementById('planText'); if (ta) I.text = ta.value;
  if (!I.text.trim() && !I.images.length) { I.error = 'Paste the plan, or add a file or screenshots first.'; rerenderImport(); return; }
  I.busy = true; I.error = null; I.ctl = new AbortController(); rerenderImport();
  try {
    const sample = window.claude && window.claude.use ? await window.claude.use('sample') : null;
    if (!sample) throw { code: 'unavailable' };
    let images = I.images;
    if (images.length) { const lim = await sample.limits().catch(() => null); if (!lim || !lim.images) throw { code: 'images_unavailable' }; images = images.slice(0, lim.images.maxCount); }
    const spec = await sample.json(planPrompt(I.text, I.start, todayYmd(), images.length > 0), { modelTier: 'complex', cache: false, signal: I.ctl.signal, ...(images.length ? { images } : {}) });
    if (!spec || typeof spec !== 'object' || (!Array.isArray(spec.phases) && !Array.isArray(spec.extras))) throw { code: 'invalid_json' };
    spec.source = images.length ? 'screenshots, converted by ' + aiName() : 'text, converted by ' + aiName();
    I.spec = spec; I.kind = 'claude';
    if (spec.startDate && /^\d{4}-\d{2}-\d{2}$/.test(spec.startDate)) I.start = spec.startDate;
    buildPreview();
  } catch (e) { console.warn(e); I.error = sampleErrorText(e); }
  I.busy = false; I.ctl = null; rerenderImport();
}
async function savePlan() {
  const I = S.planImport; if (!I || !I.preview) return;
  const nm = document.getElementById('planName'); if (nm && nm.value.trim()) I.preview.meta.name = nm.value.trim().slice(0, 80);
  I.saving = true; rerenderImport();
  const id = 'p' + I.preview.meta.startDate.replace(/-/g, '') + Math.random().toString(36).slice(2, 6);
  try {
    if (S.sample) throw new Error('Leave sample data before adding a plan.');
    await writeDoc('plans/' + id, { ...I.preview.meta, createdAt: new Date().toISOString() });
    let k = 0;
    for (const w of I.preview.weeks) {
      const wid = id + '-w' + pad2(w.week);
      const sessions = w.sessions.map(s => ({ ...s, id: wid + '-' + s.date.slice(5) + '-' + s.order }));
      await writeDoc('planWeeks/' + wid, { ...w, plan: id, sessions });
      I.savedWeeks = ++k; rerenderImport();
    }
    S.planImport = null; S.planSel = id; changed();
  } catch (e) { I.saving = false; I.error = humanError(e); rerenderImport(); }
}
function selectText(el) { try { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) { /* ignore */ } }
function wireDrop(v) {
  const sel = v.querySelector('#impMonths'); if (sel) sel.addEventListener('change', () => { S.impMonths = +sel.value; lsSet('baseline.impMonths', sel.value); });
  const fa = v.querySelector('#fileApple'); if (fa) fa.addEventListener('change', () => { if (fa.files[0]) importAppleFile(fa.files[0]); fa.value = ''; });
  const fs2 = v.querySelector('#fileStrava'); if (fs2) fs2.addEventListener('change', () => { if (fs2.files[0]) importStravaFile(fs2.files[0]); fs2.value = ''; });
  v.querySelectorAll('.drop').forEach(dz => {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (!f) return; if (dz.id === 'dropApple') importAppleFile(f); else importStravaFile(f); });
  });
}

// ---- boot ----
let lastW = 0, resizeT = null;
function boot() {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map(t => `<button data-tab="${t}">${icon(IC[t])}<span>${NAV_LABEL[t]}</span></button>`).join('');
  nav.addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
  const gear = document.getElementById('gear'); gear.innerHTML = `${icon(IC.gear)}<span>Settings</span>`; gear.addEventListener('click', () => setTab('data'));
  document.addEventListener('click', e => { const b = e.target.closest('[data-action]'); if (!b || b.disabled) return; const fn = ACTIONS[b.dataset.action]; if (fn) { e.preventDefault(); fn(b, e); } });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); e.target.click(); } });
  document.addEventListener('submit', e => { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); if (['sick-add', 'block-add', 'sess-add', 'sess-edit'].includes(f.dataset.form)) onPlanEditForm(f); else onForm(f); });
  document.addEventListener('change', e => {
    if (e.target.name === 'template' && e.target.closest('#blockForm')) { const fm = e.target.form, t = e.target.value, lab = fm.querySelector('input[name="label"]'); fm.querySelector('.pf').hidden = t !== 'pattern'; fm.querySelector('.tpl-text').textContent = BLOCK_TEMPLATES[t].text; if (lab && Object.values(BLOCK_TEMPLATES).some(x => x.label === lab.value)) lab.value = BLOCK_TEMPLATES[t].label; }
    if (e.target.name === 'type' && e.target.closest('#testForm')) { S.testForm = { ...(S.testForm || {}), type: e.target.value, pre: null }; const box = document.getElementById('testFields'); if (box) box.innerHTML = testFieldsHtml(e.target.value, null); }
    const I = S.planImport; if (!I) return;
    if (e.target.id === 'planFiles') { readPlanFiles([...e.target.files]); e.target.value = ''; }
    else if (e.target.id === 'planStart' && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { I.start = e.target.value; if (I.spec) buildPreview(); rerenderImport(); }
  });
  document.addEventListener('dragover', e => { if (S.planImport && e.target.closest && e.target.closest('#planDrop')) e.preventDefault(); });
  document.addEventListener('drop', e => { if (S.planImport && e.target.closest && e.target.closest('#planDrop')) { e.preventDefault(); readPlanFiles([...e.dataTransfer.files]); } });
  document.addEventListener('input', e => {
    if (S.planImport && e.target.id === 'planText') S.planImport.text = e.target.value;
    if (S.planImport && e.target.id === 'planName') S.planImport.name = e.target.value;
    if (e.target.id === 'jnote') {
      const d = S.jdate; S.jdraft[d] = { ...((S.model && S.model.journal[d]) || {}), ...(S.jdraft[d] || {}), note: e.target.value };
      const btn = document.querySelector('[data-action="jsave"]'); if (btn) btn.disabled = false;
    }
  });
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (Math.abs(window.innerWidth - lastW) > 30) render(); }, 160); });
  const h = (location.hash || '').slice(1); const saved = lsGet('baseline.tab');
  S.tab = TABS.includes(h) ? h : TABS.includes(saved) ? saved : 'today';
  const im = lsGet('baseline.impMonths'); if (im != null && !isNaN(+im)) S.impMonths = +im;
  recompute(); render();
  initDb();
}
boot();
