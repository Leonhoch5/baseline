// ---------- coaching: every session and every day judged against the plan and the goal ----------
// Rule-based, so it is free, instant and the same every time. The optional "coach's note" (AI) is written
// from these judgements, never instead of them.

// ---- goals: what each sport is being trained for right now ----
function parseTimeStr(t) { const p = String(t).split(':').map(Number); return p.some(isNaN) ? null : p.reduce((a, b) => a * 60 + b, 0); }
function goalsFor(M) {
  const g = { swim: null, run: null, ride: null, races: [] };
  const R = M.race;
  if (R && R.race) g.races.push({ name: R.race.name, date: R.race.date, days: R.days, goal: R.race.goal, sport: R.swim ? 'swim' : null });
  if (R && R.swim) g.swim = { pace: R.swim.goalPace, css: R.swim.last ? R.swim.last.cssPace : null, dist: R.swim.goal.dist, sec: R.swim.goal.sec, label: `${R.swim.goal.dist} m under ${fmtMSS(R.swim.goal.sec)}`, race: R.race.name, date: R.race.date, days: R.days };
  // race sessions inside the plan (e.g. a 10 km inserted as a block), nearest upcoming per sport
  for (const s of M.plan.sessions) {
    if (s.intensity !== 'race' || s.date < M.today || s.isRest || (R && R.race && s.date === R.race.date)) continue;
    const txt = (s.title || '') + ' ' + (s.details || '') + ' ' + (s.target || '');
    const km = (txt.match(/(\d+(?:[.,]\d+)?)\s*km\b/i) || [])[1], m = (txt.match(/(\d{3,5})\s*m\b/) || [])[1];
    const distM = km ? Math.round(parseFloat(km.replace(',', '.')) * 1000) : m ? +m : null;
    const tt = (s.target || '').match(/(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[–-]\s*(\d{1,2}:\d{2}(?::\d{2})?))?/);
    const lo = tt ? parseTimeStr(tt[1]) : null, hi = tt && tt[2] ? parseTimeStr(tt[2]) : lo;
    const race = { name: s.title, date: s.date, days: daysBetween(M.today, s.date), goal: s.target || null, sport: s.sportKey, distM, lo, hi };
    g.races.push(race);
    if (s.sportKey === 'run' && distM && lo && !g.run) g.run = { pace: lo / distM * 1000, paceHi: hi / distM * 1000, distM, lo, hi, label: `${distM / 1000} km in ${fmtMSS(lo)}${hi && hi !== lo ? '–' + fmtMSS(hi) : ''}`, race: s.title, date: s.date, days: race.days };
    if (s.sportKey === 'ride' && distM && lo && !g.ride) g.ride = { speed: distM / lo * 3.6, label: `${distM / 1000} km in ${fmtMSS(lo)}`, race: s.title, date: s.date, days: race.days };
  }
  g.races.sort((a, b) => a.date < b.date ? -1 : 1);
  return g;
}

// ---- targets written in the plan: "4:35–4:40/km", "1:57–2:02/100 m", "< 160 bpm", "HR 180–188", "21:00–21:30" ----
function parseTarget(t, sportKey) {
  if (!t) return null;
  const s = String(t);
  let m = s.match(/(\d{1,2}:\d{2}(?:\.\d+)?)\s*(?:[–-]\s*(\d{1,2}:\d{2}(?:\.\d+)?))?\s*(?:\/|per)\s*(100\s*m|km|k\b)/i);
  if (m) { const lo = parseClock(m[1]), hi = m[2] ? parseClock(m[2]) : lo; return { kind: 'pace', lo: Math.min(lo, hi), hi: Math.max(lo, hi), per: /100/.test(m[3]) ? 100 : 1000, text: s }; }
  m = s.match(/(?:<|under|below|max)\s*(\d{2,3})\s*(?:bpm|hr)?/i);
  if (m && +m[1] > 80) return { kind: 'hr', lo: null, hi: +m[1], text: s };
  m = s.match(/(\d{2,3})\s*[–-]\s*(\d{2,3})\s*(?:bpm)?/);
  if (m && +m[1] > 80 && +m[2] < 230 && !/\d:\d/.test(s)) return { kind: 'hr', lo: +m[1], hi: +m[2], text: s };
  m = s.match(/^\s*(\d{1,2}:\d{2}(?:\.\d+)?)\s*(?:[–-]\s*(\d{1,2}:\d{2}(?:\.\d+)?))?\s*$/);
  if (m) { const lo = parseClock(m[1]), hi = m[2] ? parseClock(m[2]) : lo; return lo >= 60 && lo > 400 && sportKey !== 'swim' ? { kind: 'time', lo, hi, text: s } : { kind: 'pace', lo, hi, per: sportKey === 'swim' ? 100 : 1000, text: s }; }
  m = s.match(/(\d{1,2}:\d{2}(?:\.\d+)?)/);
  if (m && sportKey === 'swim') { const v = parseClock(m[1]); if (v < 400) return { kind: 'pace', lo: v, hi: v, per: 100, text: s }; }
  return { kind: 'text', text: s };
}

// expected effort distribution by prescribed intensity (share of time in Z1–2 "easy" and Z4–5 "hard")
const INT_EXPECT = {
  recovery: { easyMin: 0.85, hardMax: 0.05, word: 'very easy' },
  easy: { easyMin: 0.7, hardMax: 0.1, word: 'easy' },
  moderate: { easyMin: 0.25, hardMax: 0.4, word: 'moderate' },
  hard: { hardMin: 0.2, word: 'hard' }, key: { hardMin: 0.2, word: 'hard' },
  test: { hardMin: 0.35, word: 'all-out' }, race: { hardMin: 0.45, word: 'race effort' },
};

// ---- one planned session with a matched activity → how it went ----
function reviewSession(M, s) {
  const a = s.match; if (!a) return null;
  const G = M.goals || goalsFor(M);
  const notes = [], flags = { dur: 'ok', eff: null, pace: null };
  const mins = a.durS / 60, mov = (a.movS || a.durS) / 60;
  // 1. duration
  const r = s.durationMin ? mins / s.durationMin : null;
  const pool = s.sportKey === 'swim';
  if (r != null) {
    flags.dur = r < 0.6 ? 'short' : r < 0.85 ? 'bit-short' : r > (pool ? 2 : 1.5) ? 'long' : r > (pool ? 1.5 : 1.2) ? 'bit-long' : 'ok';
    const unit = pool ? ' min in the pool' : ' min';
    if (flags.dur === 'short') notes.push(`${Math.round(mins)} of ${s.durationMin} planned minutes: cut well short.`);
    else if (flags.dur === 'bit-short') notes.push(`${Math.round(mins)} of ${s.durationMin}${unit}.`);
    else if (flags.dur === 'long') notes.push(`${Math.round(mins)}${unit} against ${s.durationMin} planned: much longer than asked.`);
    else if (flags.dur === 'bit-long') notes.push(`${Math.round(mins)}${unit}, over the ${s.durationMin} planned.`);
  }
  // 2. distance (swim sets)
  const pd = s.distance && String(s.distance).match(/(\d{3,5})\s*(?:[–-]\s*(\d{3,5}))?\s*m/);
  if (pd && a.distM) { const lo = +pd[1], hi = pd[2] ? +pd[2] : lo; if (a.distM < lo * 0.8) notes.push(`${a.distM} m swum of ${lo}${hi !== lo ? '–' + hi : ''} m planned.`); }
  // 3. effort from heart-rate zones
  const z = a.hb ? zonesFromHist(a.hb, M.prof.hrMax, M.prof.zones) : null, zt = z ? z.reduce((x, y) => x + y, 0) : 0;
  const ex = INT_EXPECT[s.intensity] || INT_EXPECT.moderate;
  let easy = null, hard = null;
  const gym = s.sportKey === 'strength' || s.sportKey === 'mobility';
  if (gym) notes.push(`Gym work is judged by whether it was done${s.durationMin ? ' and how long it took' : ''}; heart rate says little about it.`);
  else if (z && zt >= Math.max(8, mins * 0.5)) {
    easy = (z[0] + z[1]) / zt; hard = (z[3] + z[4]) / zt;
    if (ex.hardMin != null) { flags.eff = hard >= ex.hardMin || (z[2] + z[3] + z[4]) / zt >= 0.6 ? 'ok' : 'too-easy'; }
    else { flags.eff = hard > ex.hardMax + 0.1 || easy < ex.easyMin - 0.25 ? 'too-hard' : hard > ex.hardMax || easy < ex.easyMin ? 'bit-hard' : 'ok'; if (s.intensity === 'moderate' && easy > 0.95) flags.eff = 'too-easy'; }
    const zTxt = `${Math.round(easy * 100)}% easy (Z1–2), ${Math.round(hard * 100)}% hard (Z4–5)`;
    if (flags.eff === 'too-hard') notes.push(`Prescribed ${ex.word}, but ${zTxt}${a.avgHr ? `, average ${a.avgHr} bpm` : ''}. Easy days done hard are the most common way to flatten a block.`);
    else if (flags.eff === 'bit-hard') notes.push(`A touch harder than ${ex.word}: ${zTxt}.`);
    else if (flags.eff === 'too-easy') notes.push(`Prescribed ${ex.word}, but it stayed mostly easy: ${zTxt}${a.avgHr ? `, average ${a.avgHr} bpm` : ''}.`);
    else notes.push(`Effort as prescribed (${ex.word}): ${zTxt}.`);
  } else if (a.avgHr && M.prof.zones) {
    const b = M.prof.zones, zi = a.avgHr <= b[0] ? 0 : a.avgHr <= b[1] ? 1 : a.avgHr <= b[2] ? 2 : a.avgHr <= b[3] ? 3 : 4;
    if (ex.hardMin != null) flags.eff = zi >= 2 ? 'ok' : 'too-easy'; else flags.eff = zi >= 3 ? 'too-hard' : zi === 2 && ex.easyMin >= 0.7 ? 'bit-hard' : 'ok';
    notes.push(`Average ${a.avgHr} bpm (zone ${zi + 1}); ${flags.eff === 'ok' ? 'fits' : 'does not fit'} a ${ex.word} session.`);
  } else notes.push('No heart rate for this session, so the effort can’t be judged.');
  // 4. the target written in the plan
  const T = parseTarget(s.target, s.sportKey);
  let pace = null;
  if (a.distM && a.distM > 100) pace = mov * 60 / a.distM * (s.sportKey === 'swim' ? 100 : 1000);
  const continuous = ['recovery', 'easy', 'moderate'].includes(s.intensity) && !/\d\s*[×x]\s*\d/.test((s.details || '') + (s.title || ''));
  if (T && T.kind === 'pace' && pace != null) {
    const per = T.per === 100 ? '/100 m' : '/km', lo = T.lo, hi = T.hi;
    const dev = pace < lo ? (lo - pace) / lo : pace > hi ? (pace - hi) / hi : 0;
    if (continuous) {
      flags.pace = dev === 0 ? 'ok' : pace < lo ? (dev > 0.03 ? 'fast' : 'ok') : (dev > 0.03 ? 'slow' : 'ok');
      notes.push(`Average ${fmtMSS(pace, T.per === 100 ? 1 : 0)}${per} against ${esc(T.text)}${flags.pace === 'fast' ? ': faster than asked' : flags.pace === 'slow' ? ': slower than asked' : ': on target'}.`);
    } else notes.push(`Average over the whole session ${fmtMSS(pace, T.per === 100 ? 1 : 0)}${per} (target ${esc(T.text)} is for the main set, so compare by feel and watch splits).`);
  } else if (T && T.kind === 'hr' && a.avgHr) {
    flags.pace = (T.hi != null && a.avgHr > T.hi + 3) ? 'fast' : (T.lo != null && a.avgHr < T.lo - 5) ? 'slow' : 'ok';
    notes.push(`Average ${a.avgHr} bpm against ${esc(T.text)}${flags.pace === 'fast' ? ': over the limit' : flags.pace === 'slow' ? ': under the range' : ': inside'}.`);
  }
  // 5. what it means for the goal
  let goalTxt = null;
  if (s.sportKey === 'swim' && G.swim && pace != null) {
    const gp = G.swim.pace, css = G.swim.css;
    goalTxt = `Whole-session pace ${fmtMSS(pace, 1)}/100 m: ${css ? `${pace > css ? '+' : '−'}${Math.abs(pace - css).toFixed(1)} s on your CSS (${fmtMSS(css, 1)}), ` : ''}${pace > gp ? '+' : '−'}${Math.abs(pace - gp).toFixed(1)} s on goal pace ${fmtMSS(gp, 2)} for ${G.swim.label}.${['recovery', 'easy'].includes(s.intensity) ? ' Easy swims are meant to be slower than that.' : ''}`;
  } else if (s.sportKey === 'run' && G.run && pace != null) {
    const gp = G.run.pace;
    goalTxt = `Average ${fmtMSS(pace)}/km: ${pace > gp ? '+' : '−'}${fmtMSS(Math.abs(pace - gp))} on goal race pace ${fmtMSS(gp)}/km (${G.run.label}, ${G.run.days} days away).${['recovery', 'easy'].includes(s.intensity) ? ' Easy runs should sit 60–90 s/km slower than race pace.' : ''}`;
  }
  // grade
  const bad = (flags.dur === 'short' ? 1 : 0) + (flags.eff === 'too-hard' || flags.eff === 'too-easy' ? 1 : 0) + (flags.pace === 'fast' || flags.pace === 'slow' ? 0.5 : 0);
  const soft = (flags.dur === 'bit-short' || flags.dur === 'bit-long' || flags.dur === 'long' ? 1 : 0) + (flags.eff === 'bit-hard' ? 1 : 0);
  const grade = bad >= 1 ? (bad >= 2 ? 'miss' : 'partial') : soft >= 2 ? 'partial' : 'hit';
  const head = grade === 'hit' ? 'As planned' : grade === 'partial' ? 'Partly as planned' : 'Not as planned';
  return { grade, head, flags, notes, goal: goalTxt, pace, easy, hard, zones: z, mins, actGid: a.gid };
}

// ---- unplanned activity → judged against the day's guidance ----
function reviewUnplanned(M, a, d) {
  const G = M.goals || goalsFor(M);
  const z = a.hb ? zonesFromHist(a.hb, M.prof.hrMax, M.prof.zones) : null, zt = z ? z.reduce((x, y) => x + y, 0) : 0;
  const hard = zt ? (z[3] + z[4]) / zt : null;
  const rec = d.rec, zone = recoveryZone(rec);
  const notes = [];
  let grade = 'hit', head = 'Extra session';
  if (zone === 'lo' && (hard > 0.15 || (a.strain || 0) > 10)) { grade = 'miss'; head = 'Hard work on a red day'; notes.push(`Recovery was ${rec}% and this still carried ${hard != null ? Math.round(hard * 100) + '% hard time' : 'strain ' + f1(a.strain)}. Nothing in the plan asked for it.`); }
  else if ((a.strain || 0) > 12) { grade = 'partial'; head = 'Big unplanned session'; notes.push(`Strain ${f1(a.strain)} on top of the plan. Fine occasionally; a pattern of this is how fatigue outruns the plan.`); }
  else notes.push(`Not in the plan, but light (strain ${f1(a.strain)})${zone ? ` on a ${REC_WORD[zone].toLowerCase()} day` : ''}.`);
  return { grade, head, notes, goal: null, zones: z, hard, actGid: a.gid, unplanned: true, title: a.name || (SPORT_LABEL[a.sportKey] || 'Workout') + ' · ' + fmtDurLong(a.dur), sportKey: a.sportKey };
}

// ---- the whole day ----
function dayReview(M, date) {
  const d = M.day[date]; if (!d) return null;
  M.goals = M.goals || goalsFor(M);
  const sessions = M.plan.sessions.filter(s => s.date === date && !s.isRest);
  const reviews = [];
  const used = new Set();
  for (const s of sessions) { const r = s.match ? reviewSession(M, s) : null; if (r) { used.add(s.match.gid); reviews.push({ session: s, review: r }); } else reviews.push({ session: s, review: null }); }
  for (const a of d.acts) if (!used.has(a.gid)) reviews.push({ session: null, review: reviewUnplanned(M, a, d) });
  const planned = sessions.filter(s => !s.optional), done = planned.filter(s => s.status === 'done' || s.status === 'partial'), missed = planned.filter(s => s.status === 'missed'), excused = planned.filter(s => s.status === 'sick');
  const graded = reviews.filter(r => r.review && r.session);
  const hits = graded.filter(r => r.review.grade === 'hit').length, partial = graded.filter(r => r.review.grade === 'partial').length, misses = graded.filter(r => r.review.grade === 'miss').length;
  const unplannedBad = reviews.some(r => r.review && r.review.unplanned && r.review.grade !== 'hit');
  const c = coachFor(d, M);
  const st = d.strain || 0, inBand = st >= c.target[0] && st <= c.target[1], over = st > c.target[1];
  const rest = M.plan.sessions.find(s => s.date === date && s.isRest);
  let verdict, tone;
  const future = date > M.today, today = date === M.today;
  if (excused.length && !done.length) { verdict = 'Sick day: sessions excused'; tone = 'neutral'; }
  else if (!planned.length && !d.acts.length) { verdict = rest ? 'Rest day, kept' : future ? 'Nothing planned' : 'Nothing planned, nothing done'; tone = rest ? 'good' : 'neutral'; }
  else if (!planned.length && d.acts.length) { verdict = unplannedBad ? (rest ? 'Rest day broken' : 'Unplanned load') : rest ? 'Rest day with light movement' : 'Unplanned but light'; tone = unplannedBad ? 'bad' : 'neutral'; }
  else if (future || (today && !done.length && !missed.length)) { verdict = today ? `${planned.length} session${planned.length > 1 ? 's' : ''} planned` : 'Planned'; tone = 'neutral'; }
  else if (missed.length && !done.length) { verdict = `Missed ${missed.length === planned.length ? 'the day' : missed.length + ' of ' + planned.length}`; tone = 'bad'; }
  else if (misses === 0 && partial === 0 && !missed.length && !unplannedBad) { verdict = over ? 'On plan, but over the strain target' : 'On plan'; tone = over ? 'warn' : 'good'; }
  else if (misses === 0 && !missed.length) { verdict = 'Mostly on plan'; tone = 'warn'; }
  else { verdict = missed.length ? `Off plan: ${missed.length} missed` : 'Off plan'; tone = 'bad'; }
  return { date, verdict, tone, reviews, planned: planned.length, done: done.length, missed: missed.length, excused: excused.length, hits, partial, misses, strain: st, target: c.target, inBand, over, coach: c };
}

// ---- this week against the plan, by sport (minutes done vs planned up to today) ----
function weekProgress(M, date) {
  const mon = mondayOf(date), sun = addDays(mon, 6);
  const by = {};
  for (const s of M.plan.sessions) {
    if (s.date < mon || s.date > sun || s.isRest || s.optional) continue;
    const k = s.sportKey; by[k] = by[k] || { planned: 0, done: 0, toDate: 0, n: 0, nDone: 0 };
    by[k].planned += s.durationMin || 0; by[k].n++;
    if (s.date <= date) { by[k].toDate += s.durationMin || 0; if (s.match) { by[k].done += s.match.durS / 60; by[k].nDone++; } else if (s.status === 'done') { by[k].done += s.durationMin || 0; by[k].nDone++; } }
  }
  const extra = {};
  for (let dt = mon; dt <= (date < sun ? date : sun); dt = addDays(dt, 1)) { const d = M.day[dt]; if (!d) continue; for (const a of d.acts) if (!M.plan.sessions.some(s => s.match && s.match.gid === a.gid)) { const k = a.sport; extra[k] = (extra[k] || 0) + a.durS / 60; } }
  return { mon, sun, by, extra };
}

// ---- the AI coach's note: written from the judgements above, never instead of them ----
function coachNotePrompt(M, date) {
  const d = M.day[date] || {}, dr = dayReview(M, date), wp = weekProgress(M, date), G = M.goals || goalsFor(M);
  const J = M.journal[date] || {}, st = trainingStatus(M, date);
  const ctx = {
    date, today: M.today, phase: M.plan.curWeek ? { week: M.plan.curWeek.week, phase: M.plan.curWeek.phase, focus: M.plan.curWeek.focus } : null,
    goals: G.races.map(r => ({ name: r.name, date: r.date, daysAway: r.days, goal: r.goal })),
    swimGoal: G.swim ? { goalPace100m: fmtMSS(G.swim.pace, 2), currentCSS: G.swim.css ? fmtMSS(G.swim.css, 1) : null } : null,
    runGoal: G.run ? { goalPaceKm: fmtMSS(G.run.pace), race: G.run.race } : null,
    recovery: d.rec != null ? { score: d.rec, zone: recoveryZone(d.rec), reasons: (d.recWhy || []).slice(0, 3).map(w => w.label + ' ' + (w.pts >= 0 ? '+' : '') + w.pts.toFixed(2)) } : null,
    sleep: d.sleepMin != null ? { hours: +(d.sleepMin / 60).toFixed(1), score: d.sleepScore, debtH: d.debt14 != null ? +(d.debt14 / 60).toFixed(1) : null } : null,
    checkin: J.readiness != null ? { readiness: J.readiness, fatigue: J.fatigue, soreness: J.soreness, sleepQ: J.sleepQ } : null,
    trainingStatus: st ? { label: st.label, summary: st.summary } : null,
    strain: { today: +(d.strain || 0).toFixed(1), target: dr ? dr.target : null },
    dayVerdict: dr ? dr.verdict : null,
    sessions: dr ? dr.reviews.map(r => ({ planned: r.session ? { title: r.session.title, minutes: r.session.durationMin, intensity: r.session.intensity, target: r.session.target || null, status: r.session.status } : null,
      done: r.review ? { grade: r.review.grade, minutes: Math.round(r.review.mins || 0), notes: r.review.notes.map(n => n.replace(/<[^>]+>/g, '')), goal: r.review.goal ? r.review.goal.replace(/<[^>]+>/g, '') : null, unplanned: !!r.review.unplanned } : null })) : [],
    week: { planned: wp.by, extra: wp.extra },
    tomorrow: M.plan.sessions.filter(s => s.date === addDays(date, 1) && !s.isRest).map(s => ({ title: s.title, minutes: s.durationMin, intensity: s.intensity, target: s.target || null })),
  };
  return `You are the athlete's coach. Judge this day against the training plan and the goal, in plain direct language, second person, no praise padding, no medical claims.
Use ONLY the data below; do not invent numbers. Mention the goal race by name when relevant. Be specific about what was right and what was off, and give ONE concrete instruction for tomorrow.
Reply with ONLY a JSON object: {"verdict": "3-6 words", "note": "60-120 words judging the day", "tomorrow": "one sentence instruction for tomorrow"}.

DATA:
${JSON.stringify(ctx)}`;
}
