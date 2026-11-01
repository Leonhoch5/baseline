// ---------- training zones: heart rate (Strava), run pace (Strava, a test, your best 5 km, or the goal), power (shown only) ----------
// Run pace zones follow Strava's six zones. Strava draws them from a 5 km race speed; the upper bounds of Z1–Z5 sit at these
// shares of that speed (read off this athlete's Strava zones), so zones built here from a test or a best effort line up with Strava's.
const RUN_ZONE_RATIOS = [0.719, 0.835, 0.930, 0.994, 1.057];
const ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max', 'Anaerobic'];
const HR_ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'Maximal'];

function runZonesFromSpeed5k(v5) { return RUN_ZONE_RATIOS.map(r => +(v5 * r).toFixed(3)); }
// fastest 5 km effort inside the last `days` days, from the analysed Strava activities
function best5k(M, days) {
  const since = addDays(M.today, -days); let best = null;
  for (const a of M.acts) { const b = a.an && a.an.best; if (!b || !b.k5 || a.sport !== 'run' || a.start.slice(0, 10) < since) continue; if (!best || b.k5 < best.sec) best = { sec: b.k5, date: a.start.slice(0, 10), act: a }; }
  return best;
}
function zonesModel(M, D) {
  const P = (D && D.profile) || {};
  const hr = M.prof.zones ? { bounds: M.prof.zones, src: M.prof.zoneSrc, hrMax: M.prof.hrMax } : null;
  const G = M.goals || goalsFor(M);
  const cands = [];
  const th = M.race && M.race.thresholds && M.race.thresholds.runPace;
  if (th && th.v > 0 && daysBetween(th.date, M.today) <= 120) cands.push({ src: 'test', v5: 1000 / (th.v * 0.96), label: `your run test on ${fmtDay(th.date)} (threshold ${fmtMSS(th.v)}/km)`, date: th.date });
  if (Array.isArray(P.stravaRunZones) && P.stravaRunZones.length >= 5 && P.stravaRunZones.every(v => v > 0.5 && v < 10)) {
    const b = P.stravaRunZones.slice(0, 5).map(Number);
    const est = P.stravaRunZoneSrc === 'PerformancePredictions';
    cands.push({ src: 'strava', bounds: b, v5: b[3] / RUN_ZONE_RATIOS[3], label: est ? `Strava’s estimate${P.stravaRunRef ? ` (${P.stravaRunRef})` : ''}` : P.stravaRunZoneSrc === 'RacePace' ? `Strava${P.stravaRunRef ? ` (${P.stravaRunRef})` : ''}` : 'the zones set in Strava', estimated: est });
  }
  const b5 = best5k(M, 180);
  if (b5) cands.push({ src: 'best5k', v5: 5000 / b5.sec, label: `your fastest 5 km in the last 6 months (${fmtMSS(b5.sec)} on ${fmtDay(b5.date)})`, date: b5.date, sec: b5.sec });
  if (G.run && G.run.pace > 0) cands.push({ src: 'goal', v5: 1000 / (G.run.pace * (G.run.distM >= 9000 ? 0.96 : 1)), label: `the goal pace for ${G.run.race} (${fmtMSS(G.run.pace)}/km)` });
  const pick = cands.find(c => c.src === 'test') || cands.find(c => c.src === 'strava') || cands.find(c => c.src === 'best5k') || cands.find(c => c.src === 'goal') || null;
  let run = null;
  if (pick) {
    const bounds = pick.bounds || runZonesFromSpeed5k(pick.v5);
    const paceBounds = bounds.map(v => 1000 / v); // s/km; Z1 is slower than paceBounds[0], Z6 faster than paceBounds[4]
    run = { bounds, paceBounds, src: pick.src, label: pick.label, estimated: !!pick.estimated, v5: pick.v5, cands, best5k: b5 };
    // a Strava estimate faster than what you have actually run deserves a warning
    if (pick.src === 'strava' && b5 && 5000 / b5.sec < pick.v5 * 0.97) run.warn = `Strava’s estimate is faster than your best actual 5 km of the last 6 months (${fmtMSS(b5.sec)} on ${fmtDay(b5.date)}); a 5 km time trial settles it, and from then on the zones follow the test.`;
  }
  const ftp = P.stravaFtp ? { w: P.stravaFtp, estimated: !!P.stravaFtpEst, zones: P.stravaPowerZones || null } : null;
  return { hr, run, ftp };
}
// zone (1–6) of a pace in s/km
function runZoneOf(pace, run) { if (!run || !(pace > 0)) return null; const pb = run.paceBounds; for (let z = 0; z < 5; z++) if (pace > pb[z]) return z + 1; return 6; }
// pace range of a zone, [fast, slow] in s/km (Infinity / 0 at the ends)
function zonePaceRange(run, z) { const pb = run.paceBounds; return z <= 1 ? [pb[0], Infinity] : z >= 6 ? [0, pb[4]] : [pb[z - 1], pb[z - 2]]; }
function zoneRangeText(run, z) { const [lo, hi] = zonePaceRange(run, z); return z <= 1 ? `slower than ${fmtMSS(lo)}/km` : z >= 6 ? `faster than ${fmtMSS(hi)}/km` : `${fmtMSS(lo)}–${fmtMSS(hi)}/km`; }
// the planned structure of a session: "5×1 km", "3×8 min", "6×20 s strides", "6×30 s uphill"
function parseStructure(s) {
  const txt = ((s.title || '') + ' · ' + (s.details || '')).replace(/,/g, '.');
  // every "N × amount" in the text; the main set is the biggest one, strides/hill reps are named right after the amount
  const re = /(\d{1,2})\s*[×x]\s*(\d+(?:\.\d+)?)\s*(km\b|k\b|m\b|min\b|s\b|sec\b)([^.;·]{0,40})/gi;
  let m, best = null;
  while ((m = re.exec(txt))) {
    const n = +m[1], v = parseFloat(m[2]), u = m[3].toLowerCase(), after = m[4] || '';
    const work = u === 'km' || u === 'k' ? { m: Math.round(v * 1000) } : u === 'm' ? { m: Math.round(v) } : u === 'min' ? { s: Math.round(v * 60) } : { s: Math.round(v) };
    const secs = work.s != null ? work.s : work.m / 3.5; // rough seconds per rep, to rank sets
    const kind = /stride/i.test(after) ? 'strides' : /uphill|hill|berg/i.test(after) ? 'hills' : 'reps';
    const cand = { reps: n, work, kind, text: m[0].trim().replace(/\s+$/, ''), secs };
    if (!best || (kind === 'reps' && best.kind !== 'reps') || (kind === best.kind && secs * n > best.secs * best.reps)) best = cand;
  }
  if (!best) return null;
  best.text = `${best.reps}×${best.work.m ? (best.work.m >= 1000 ? best.work.m / 1000 + ' km' : best.work.m + ' m') : fmtDur(best.work.s)}`;
  return best;
}
// which zone a planned run session asks for (null: leave the plan's wording alone)
function sessionZone(s, G) {
  if (s.sportKey !== 'run' || s.isRest) return null;
  const txt = ((s.title || '') + ' ' + (s.details || '') + ' ' + (s.target || '')).toLowerCase();
  const st = parseStructure(s);
  if (s.intensity === 'race' || s.intensity === 'test' || /time trial|\btt\b|recce|race day/.test(txt)) return null;
  if (/race pace|goal pace|rennpace|wettkampftempo/.test(txt)) return { z: 'race' };
  // hills and trails: pace means little, so the plan's wording stays and the coach judges by heart rate
  const head = ((s.title || '') + ' ' + (s.target || '')).toLowerCase();
  if (/by effort|hilly|hills\b|trail|climb/.test(head) && !(st && st.kind === 'hills')) return { z: s.intensity === 'recovery' ? 1 : s.intensity === 'moderate' ? 3 : 2, byEffort: true };
  if (st && (st.kind === 'strides' || st.kind === 'hills')) return s.intensity === 'recovery' ? { z: 1, easyPart: true } : { z: 2, easyPart: true };
  if (/threshold|schwelle|cruise/.test(txt)) return { z: 4 };
  if (st && ((st.work.m && st.work.m <= 2000) || (st.work.s && st.work.s <= 360))) return { z: /tempo/.test(txt) ? 3 : 5 };
  if (/interval|vo2/.test(txt)) return { z: 5 };
  if (/tempo|steady|marathon pace/.test(txt)) return { z: 3 };
  if (s.intensity === 'recovery') return { z: 1 };
  if (s.intensity === 'easy') return { z: 2 };
  if (s.intensity === 'moderate') return { z: 3 };
  if (s.intensity === 'hard' || s.intensity === 'key') return { z: 4 };
  return null;
}
// the plan's run targets rewritten from the zones (future sessions), and every run session tagged with its zone for the coach
function applyRunZones(M, Z) {
  const run = Z && Z.run; if (!run) return null;
  const G = M.goals || goalsFor(M);
  const hrB = Z.hr ? Z.hr.bounds : null;
  let n = 0;
  for (const s of M.plan.sessions) {
    const sz = sessionZone(s, G); if (!sz) continue;
    let lo, hi, label;
    if (sz.z === 'race') { if (!G.run) continue; lo = G.run.pace * 0.985; hi = (G.run.paceHi || G.run.pace) * 1.015; label = 'race pace'; }
    else { [lo, hi] = zonePaceRange(run, sz.z); label = `Z${sz.z} ${ZONE_NAMES[sz.z - 1]}`; }
    s.targetZone = { z: sz.z, lo, hi, label, easyPart: !!sz.easyPart, byEffort: !!sz.byEffort };
    if (s.date < M.today || sz.byEffort) continue; // past sessions keep the plan's wording; the coach still judges them by zone
    const T = parseTarget(s.target, 'run');
    if (T && T.kind === 'time') continue;
    let txt = sz.z === 'race' ? `${fmtMSS(G.run.pace)}${G.run.paceHi && G.run.paceHi !== G.run.pace ? '–' + fmtMSS(G.run.paceHi) : ''}/km (race pace)` : sz.z <= 1 ? `> ${fmtMSS(lo)}/km (Z1)` : sz.z >= 6 ? `< ${fmtMSS(hi)}/km (Z6)` : `${fmtMSS(lo)}–${fmtMSS(hi)}/km (Z${sz.z})`;
    if (hrB && (sz.z === 1 || sz.z === 2)) txt += ` · < ${hrB[sz.z - 1]} bpm`;
    if (txt === s.target) continue;
    if (!s.targetBase) s.targetBase = s.target || '';
    s.target = txt; s.targetWhy = `From your run zones (${run.label}): ${label}${s.targetBase ? ' — plan said ' + s.targetBase : ''}`; n++;
  }
  return { sessions: n, src: run.src, label: run.label };
}
