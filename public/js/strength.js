// ---------- gym: the exercises, sets, weights and reps logged in Strava's strength workouts ----------
// Strava's connector returns them (get_strength_workout_details); the public API does not, so the standalone app takes a pasted list.
// Stored on the Strava activity as sets: [{ e: 'Weighted Chin-Up', kg: 7.5, r: 5, s: null }], mg: { 'Weighted Chin-Up': ['Lats', 'Biceps'] }.
// Progress is measured per exercise with an estimated one-rep max (Epley: kg × (1 + reps ÷ 30), only for sets of 1–12 reps),
// tonnage (kg × reps) and the best set; muscle-group balance is counted in hard sets a week. Cardio load is untouched by all this.

const BW_EXERCISE = /chin[- ]?up|pull[- ]?up|\bdips?\b|push[- ]?up|press[- ]?up|muscle[- ]?up|inverted row|bodyweight|pistol|nordic|plank|hanging|l[- ]?sit/i;
function isBodyweightExercise(name) { return BW_EXERCISE.test(String(name || '')); }
function e1rmOf(kg, reps) { if (!(kg > 0) || !(reps > 0) || reps > 12) return null; return reps === 1 ? kg : kg * (1 + reps / 30); }

// "6m 0s", "1h 2m", "45s", "1:00", "6 min" → seconds
function parseDurationText(v) {
  const t = String(v == null ? '' : v).trim(); if (!t) return null;
  const mm = t.match(/^(\d+):(\d{2})(?::(\d{2}))?$/); if (mm) return mm[3] != null ? +mm[1] * 3600 + +mm[2] * 60 + +mm[3] : +mm[1] * 60 + +mm[2];
  let sec = 0, hit = false;
  const h = t.match(/(\d+(?:[.,]\d+)?)\s*h(?:ours?)?\b/i); if (h) { sec += parseFloat(h[1].replace(',', '.')) * 3600; hit = true; }
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*m(?:in(?:utes?)?)?\b/i); if (m) { sec += parseFloat(m[1].replace(',', '.')) * 60; hit = true; }
  const se = t.match(/(\d+(?:[.,]\d+)?)\s*s(?:ec(?:onds?)?)?\b/i); if (se) { sec += parseFloat(se[1].replace(',', '.')); hit = true; }
  if (hit) return Math.round(sec);
  const n = t.match(/\d+(?:[.,]\d+)?/); return n ? Math.round(parseFloat(n[0].replace(',', '.'))) : null;
}
// the connector's exercise_sets → stored sets
function setsFromConnector(list) {
  const sets = [], mg = {};
  for (const x of Array.isArray(list) ? list : []) {
    const e = String(x.exercise_name || '').trim(); if (!e) continue;
    const num = v => { if (v == null) return null; const m = String(v.value != null ? v.value : v).match(/-?\d+(?:[.,]\d+)?/); return m ? parseFloat(m[0].replace(',', '.')) : null; };
    let kg = num(x.weight); if (kg != null && x.weight && /lb/i.test(String(x.weight.value))) kg = Math.round(kg * 0.45359 * 10) / 10;
    const r = num(x.reps);
    const s = x.duration && x.duration.value != null ? parseDurationText(x.duration.value) : null;
    sets.push(clean({ e, kg: kg != null ? kg : null, r: r != null ? Math.round(r) : null, s: s != null ? Math.round(s) : null }));
    if (Array.isArray(x.muscle_groups) && x.muscle_groups.length && !mg[e]) mg[e] = x.muscle_groups.map(normMuscle);
  }
  return sets.length ? { sets, mg } : null;
}
// a pasted list → stored sets. Accepts one set per line ("Incline Dumbbell Bench Press 22.5 kg × 7", "Pull Up ×10", "Plank 45 s")
// or an exercise line followed by set lines ("RDL" / "50 kg x 10" / "70 x 8" / "90x5 90x4").
function parseSetsText(text) {
  const sets = []; let ex = null;
  const setRe = /(?:(\d+(?:[.,]\d+)?)\s*(kg|lb|lbs)?\s*[×x*]\s*(\d+)|(?:[×x*]\s*)?(\d+)\s*(?:reps?|wdh|x)\b|(\d+(?:[.,]\d+)?)\s*(kg|lb|lbs)\b|(\d+)\s*(?:s|sec|sek)\b|(\d+):(\d{2}))/gi;
  for (let raw of String(text || '').split(/\n|;/)) {
    let line = raw.replace(/^[\s•\-–*]+/, '').trim(); if (!line) continue;
    // strip a leading "3 sets:" or "Set 2"
    line = line.replace(/^\s*set\s*\d+\s*[:.—–-]?\s*/i, '');
    const first = line.search(/\d/);
    let head = first > 0 ? line.slice(0, first).replace(/[:\-–—,]\s*$/, '').trim() : (first < 0 ? line.trim() : '');
    head = head.split(/\s+[·•|]\s+/)[0].trim();                     // "Crunch · Bodyweight" (Bevel) → "Crunch"
    if (/^(tracked with|set\b)/i.test(head) || head.length > 60) head = '';
    if (head && head.length > 1 && !/^(kg|x|×|reps?)$/i.test(head)) ex = head;
    if (!ex) continue;
    const body = first >= 0 ? line.slice(first) : '';
    let m, found = 0, kgPending = null;
    while ((m = setRe.exec(body))) {
      if (m[1] != null && m[3] != null) { let kg = parseFloat(m[1].replace(',', '.')); if (/lb/i.test(m[2] || '')) kg = Math.round(kg * 0.45359 * 10) / 10; sets.push({ e: ex, kg, r: +m[3] }); found++; }
      else if (m[4] != null) { sets.push(clean({ e: ex, kg: kgPending, r: +m[4] })); kgPending = null; found++; }
      else if (m[5] != null) { kgPending = parseFloat(m[5].replace(',', '.')); if (/lb/i.test(m[6] || '')) kgPending = Math.round(kgPending * 0.45359 * 10) / 10; }
      else if (m[7] != null) { sets.push({ e: ex, s: +m[7] }); found++; }
      else if (m[8] != null) { sets.push({ e: ex, s: +m[8] * 60 + +m[9] }); found++; }
    }
    if (!found && kgPending != null) sets.push({ e: ex, kg: kgPending });
  }
  if (!sets.length) return null;
  const mg = {}; for (const st of sets) if (!mg[st.e]) { const g = guessMuscles(st.e); if (g.length) mg[st.e] = g; }
  return { sets, mg };
}
// does a Strava description carry a set list (Bevel and similar apps write "Exercise · Bodyweight / • Set 1 — 10 kg × 12")?
function descriptionHasSets(desc) { return /(set\s*\d|\d+\s*(kg|lb)\s*[×x]\s*\d+|\d+\s*reps?\b|tracked with)/i.test(String(desc || '')); }
// muscle groups guessed from the exercise name for pasted sets (Strava's connector gives them; a pasted list does not)
const MG_GUESS = [[/calf|calves|wadenheben/i, ['Calves']], [/romanian|rdl|deadlift|kreuzheben|good morning|hip thrust|glute bridge|nordic/i, ['Hamstrings', 'Glutes', 'Lower Back']], [/squat|kniebeuge|leg press|lunge|ausfall|step[- ]?up|pistol|bulgarian/i, ['Quadriceps', 'Glutes']], [/leg curl/i, ['Hamstrings']], [/leg extension/i, ['Quadriceps']], [/chin|pull[- ]?up|klimmzug|row|rudern|lat pull|pulldown/i, ['Lats', 'Biceps']], [/face pull|rear delt|reverse fly/i, ['Shoulders', 'Trapezius']], [/lateral raise|seitheben|overhead|shoulder press|military|push press|arnold/i, ['Shoulders', 'Triceps']], [/bench|press|push[- ]?up|liegest|dip|fly|flies/i, ['Chest', 'Triceps', 'Shoulders']], [/curl/i, ['Biceps']], [/pushdown|skull|triceps|extension/i, ['Triceps']], [/plank|crunch|sit[- ]?up|twist|leg raise|flutter|hollow|dead bug|pallof|bicycle|heel touch|v sit|ab\b|abs\b|core|bauch/i, ['Core']], [/burpee|thruster|clean|snatch|swing|kettlebell/i, ['Glutes', 'Quadriceps', 'Shoulders', 'Core']], [/shrug|trap/i, ['Trapezius']], [/farmer|grip|forearm/i, ['Forearms']]];
function guessMuscles(name) { for (const [re, mg] of MG_GUESS) if (re.test(String(name || ''))) return mg; return []; }
const MG_ALIAS = { Abdominals: 'Core', Abs: 'Core', Obliques: 'Core', 'Lower back': 'Lower Back', Quads: 'Quadriceps', Hams: 'Hamstrings', Traps: 'Trapezius', Delts: 'Shoulders' };
function normMuscle(g) { const t = String(g || '').trim(); return MG_ALIAS[t] || t; }
function fmtKg(kg) { return kg == null ? '' : (Math.round(kg * 10) / 10).toString().replace(/\.0$/, '') + ' kg'; }
function fmtSet(s, bw) {
  if (s.s != null && s.kg == null && s.r == null) return fmtDur(s.s);
  const w = s.kg != null ? (bw ? '+' : '') + fmtKg(s.kg) : (bw ? 'BW' : '');
  return [w, s.r != null ? s.r + (s.kg == null && !bw ? ' reps' : '') : ''].filter(Boolean).join(' × ') || '–';
}

// the athlete's body weight for bodyweight exercises: latest journal weight, else the profile, else Leon's
function bodyWeightKg(M, date) {
  const b = typeof bodyLog === 'function' ? bodyLog(M, date || M.today) : null;
  if (b && b.wLast) return b.wLast.v;
  return (M.prof && M.prof.weightKg) || (typeof OWNER !== 'undefined' && OWNER.weightKg) || 60;
}

// one gym session with its sets → exercises with top set, e1RM, tonnage
function strengthSession(a, bw) {
  const ex = []; const byName = {};
  for (const s of a.sets || []) {
    let x = byName[s.e]; if (!x) { const g = ((a.mg && a.mg[s.e]) || []).map(normMuscle); x = byName[s.e] = { name: s.e, mg: g.length ? g : guessMuscles(s.e), bw: isBodyweightExercise(s.e), sets: [], top: null, e1: null, tonnage: 0, hardSets: 0 }; ex.push(x); }
    const load = x.bw ? bw + (s.kg || 0) : (s.kg || 0);          // system weight for chin-ups, dips, push-ups
    const row = { ...s, load, e1: s.r ? e1rmOf(load, s.r) : null, vol: s.r ? load * s.r : 0 };
    x.sets.push(row); x.tonnage += row.vol; if (s.r || s.s) x.hardSets++;
    if (row.e1 != null && (x.e1 == null || row.e1 > x.e1)) { x.e1 = row.e1; x.top = row; }
    else if (x.top == null && s.r) x.top = row;
  }
  return { gid: a.gid, id: a.id, date: a.date, name: a.name, durS: a.durS, src: a.setsSrc || 'strava', exercises: ex, nSets: ex.reduce((n, x) => n + x.sets.length, 0), tonnage: ex.reduce((n, x) => n + x.tonnage, 0),
    mgSets: ex.reduce((acc, x) => { for (const g of x.mg.length ? x.mg : ['Other']) acc[g] = (acc[g] || 0) + x.hardSets; return acc; }, {}) };
}

// everything the Gym tab and the coach need
function strengthModel(M, date, days) {
  date = date || M.today; days = days || 182;
  const bw = bodyWeightKg(M, date);
  const sessions = M.acts.filter(a => a.sets && a.sets.length && a.date <= date && daysBetween(a.date, date) <= days).map(a => strengthSession(a, bw)).sort((x, y) => x.date < y.date ? -1 : 1);
  const logged = M.acts.filter(a => (a.sport === 'strength' || a.sport === 'hiit') && a.date <= date && daysBetween(a.date, date) <= days);
  const byEx = {};
  for (const s of sessions) for (const x of s.exercises) {
    const r = byEx[x.name] || (byEx[x.name] = { name: x.name, mg: x.mg, bw: x.bw, hist: [], sessions: 0 });
    if (!r.mg.length && x.mg.length) r.mg = x.mg;
    r.sessions++; r.hist.push({ date: s.date, gid: s.gid, top: x.top, e1: x.e1, tonnage: x.tonnage, sets: x.sets.length, hardSets: x.hardSets });
  }
  const list = Object.values(byEx);
  for (const r of list) {
    r.last = r.hist[r.hist.length - 1];
    const withE1 = r.hist.filter(h => h.e1 != null);
    r.best = withE1.reduce((b, h) => !b || h.e1 > b.e1 ? h : b, null);
    const now = withE1.filter(h => daysBetween(h.date, date) <= 28), prev = withE1.filter(h => { const k = daysBetween(h.date, date); return k > 28 && k <= 84; });
    r.e1Now = now.length ? Math.max(...now.map(h => h.e1)) : null; r.e1Prev = prev.length ? Math.max(...prev.map(h => h.e1)) : null;
    r.delta = r.e1Now != null && r.e1Prev != null ? r.e1Now / r.e1Prev - 1 : null;
    r.trend = r.e1Now == null ? (withE1.length ? 'idle' : null) : r.delta == null ? 'new' : r.delta >= 0.025 ? 'up' : r.delta <= -0.025 ? 'down' : 'flat';
    // reps-only exercises (pull-ups, planks): best reps / longest hold
    r.bestReps = r.hist.reduce((b, h) => h.top && h.top.r != null && (b == null || h.top.r > b) ? h.top.r : b, null);
    r.lastWeeks = r.hist.filter(h => daysBetween(h.date, date) <= 28).length;
  }
  list.sort((a, b) => b.sessions - a.sessions || (b.last.date < a.last.date ? -1 : 1));
  // weeks, newest first (8)
  const weeks = [];
  for (let w = 0; w < 8; w++) {
    const end = addDays(date, -7 * w), start = addDays(end, -6);
    const ss = sessions.filter(s => s.date >= start && s.date <= end), lg = logged.filter(a => a.date >= start && a.date <= end);
    weeks.push({ start, end, sessions: ss.length, logged: lg.length, sets: ss.reduce((n, s) => n + s.nSets, 0), tonnage: ss.reduce((n, s) => n + s.tonnage, 0), minutes: Math.round(lg.reduce((n, a) => n + a.durS / 60, 0)) });
  }
  // muscle groups, last 4 weeks, hard sets a week
  const mg4 = {}; const s4 = sessions.filter(s => daysBetween(s.date, date) <= 27);
  for (const s of s4) for (const g in s.mgSets) mg4[g] = (mg4[g] || 0) + s.mgSets[g];
  const mgRows = Object.entries(mg4).map(([g, n]) => ({ g, n, perWeek: n / 4 })).sort((a, b) => b.n - a.n);
  const movers = list.filter(r => r.delta != null).sort((a, b) => b.delta - a.delta);
  const missing = logged.filter(a => !a.sets || !a.sets.length);
  return { bw, sessions, logged: logged.length, exercises: list, weeks, mgRows, movers, missing, last: sessions[sessions.length - 1] || null };
}

// endurance-relevant muscle groups: what a triathlete's gym work should cover (Beattie 2014, Rønnestad & Mujika 2014)
const MG_FOR_ENDURANCE = { 'Glutes': 'hip drive for running and the bike', 'Hamstrings': 'posterior chain, injury guard for running', 'Quadriceps': 'bike power, downhill running', 'Calves': 'running economy, Achilles tolerance', 'Core': 'swim body position, run posture late in a race', 'Lats': 'the swim pull', 'Lower Back': 'posture on the bike and in the water' };
function strengthBalance(sm) {
  const have = new Set(sm.mgRows.map(r => r.g));
  const missing = Object.keys(MG_FOR_ENDURANCE).filter(g => !have.has(g));
  return { missing, rows: sm.mgRows.map(r => ({ ...r, why: MG_FOR_ENDURANCE[r.g] || null })) };
}

// one line for the coach about a gym session: top sets, tonnage, and the change against the last time each lift was done
function gymReview(M, a) {
  if (!a.sets || !a.sets.length) return null;
  const bw = bodyWeightKg(M, a.date), ss = strengthSession(a, bw);
  const prevActs = M.acts.filter(x => x.sets && x.sets.length && x.date < a.date && daysBetween(x.date, a.date) <= 60).sort((x, y) => x.date < y.date ? 1 : -1);
  const parts = [], ups = [], downs = [];
  for (const x of ss.exercises) {
    let prev = null;
    for (const p of prevActs) { const px = strengthSession(p, bw).exercises.find(e => e.name === x.name); if (px && px.e1 != null) { prev = px; break; } }
    const top = x.top ? fmtSet(x.top, x.bw) : `${x.sets.length} sets`;
    const d = prev && x.e1 != null ? x.e1 / prev.e1 - 1 : null;
    parts.push(`${x.name} ${top}${x.e1 != null ? ` (e1RM ${Math.round(x.e1)}${d != null ? `, ${d >= 0.025 ? '+' : d <= -0.025 ? '−' : '±'}${Math.abs(Math.round(d * 100))}% vs last time` : ''})` : ''}`);
    if (d != null && d >= 0.025) ups.push(x.name); else if (d != null && d <= -0.025) downs.push(x.name);
  }
  const verdict = ups.length && !downs.length ? `Stronger on ${ups.join(' and ')}.` : downs.length && !ups.length ? `Lighter than last time on ${downs.join(' and ')}: fine on a tired day, a pattern if it repeats.` : ups.length && downs.length ? `Up on ${ups.join(', ')}, down on ${downs.join(', ')}.` : 'Same loads as last time.';
  return { text: `${ss.exercises.length} exercises, ${ss.nSets} sets, ${(ss.tonnage / 1000).toFixed(1)} t: ${parts.join('; ')}. ${verdict}`, ups, downs, exercises: ss.exercises.map(x => ({ name: x.name, top: x.top ? fmtSet(x.top, x.bw) : null, e1rm: x.e1 != null ? Math.round(x.e1) : null, sets: x.sets.length })), tonnageKg: Math.round(ss.tonnage), nSets: ss.nSets };
}
