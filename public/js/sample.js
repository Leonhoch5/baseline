// ---------- sample data (in memory only, for previewing the app) ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeSampleData() {
  const R = mulberry32(20261012), rn = () => (R() + R() + R() - 1.5) / 0.5; // ~N(0,1)
  const N = 140, today = todayYmd(), start = addDays(today, -N + 1);
  const apple = {}, strava = {}, journal = {};
  const adoc = (m) => apple[m] || (apple[m] = { v: 1, month: m, days: {}, workouts: [] });
  const sdoc = (m) => strava[m] || (strava[m] = { acts: [] });
  const jdoc = (m) => journal[m] || (journal[m] = { entries: {} });
  const week = {
    1: null,
    2: { kind: 'both', sport: 'run', type: 'Run', name: 'Track intervals 6×800 m', at: 18 * 60 + 10, dur: 55, hr: [148, 179], km: 10.4, elev: 22 },
    3: { kind: 'strava', sport: 'ride', type: 'Ride', name: 'Easy spin', at: 17 * 60 + 40, dur: 70, hr: [116, 138], km: 31.5, elev: 160 },
    4: { kind: 'both', sport: 'run', type: 'Run', name: 'Easy run', at: 7 * 60 + 5, dur: 45, hr: [128, 147], km: 8.1, elev: 40 },
    5: { kind: 'watch', sport: 'strength', type: 'TraditionalStrengthTraining', name: 'Strength', at: 18 * 60, dur: 40, hr: [98, 136] },
    6: { kind: 'both', sport: 'run', type: 'Run', name: 'Long run', at: 9 * 60 + 15, dur: 95, hr: [136, 160], km: 17.8, elev: 120 },
    0: { kind: 'strava', sport: 'ride', type: 'Ride', name: 'Sunday ride', at: 10 * 60, dur: 125, hr: [118, 152], km: 56.3, elev: 540 },
  };
  let fatigue = 0.6, prevAlcohol = false, nextBed = 23 * 60 - 20;
  for (let i = 0; i < N; i++) {
    const date = addDays(start, i), dow = parseYmd(date).getDay(), m = date.slice(0, 7);
    const isToday = date === today;
    // last night (wake on `date`)
    const alc = prevAlcohol;
    const bedMin = nextBed; // minutes after midnight of previous day (may exceed 1440)
    const asleep = clamp(440 + rn() * 32 - (alc ? 35 : 0) - fatigue * 6, 330, 540);
    const deep = asleep * clamp(0.17 + rn() * 0.02 - (alc ? 0.03 : 0), 0.08, 0.25), rem = asleep * clamp(0.23 + rn() * 0.025 - (alc ? 0.04 : 0), 0.1, 0.3);
    const awake = clamp(18 + rn() * 7 + (alc ? 12 : 0), 5, 60), core = asleep - deep - rem;
    const ls = lmsOf(addDays(date, -1) + 'T00:00') + bedMin * 60000;
    const le = ls + (asleep + awake) * 60000;
    const segs = []; let off = 0;
    const cyc = Math.round(asleep / 92);
    for (let c = 0; c < cyc; c++) {
      const share = 1 / cyc, dP = deep * share * (c < 2 ? 1.7 : c < 3 ? 0.6 : 0.15), rP = rem * share * (c < 2 ? 0.55 : 1.3);
      const cP = asleep * share - dP - rP;
      for (const [d, code] of [[cP * 0.55, 2], [dP, 3], [cP * 0.45, 2], [rP, 1]]) { if (d > 0.5) { segs.push([round1(off), round1(d), code]); off += d; } }
      const aw = awake / cyc; segs.push([round1(off), round1(aw), 0]); off += aw;
    }
    segs.pop();
    const hrv = Math.round(64 * Math.exp(-0.2 * (fatigue - 1) + rn() * 0.1) * (alc ? 0.78 : 1) * 10) / 10;
    const rhr = Math.round(51 + 1.6 * (fatigue - 1) + rn() * 1.2 + (alc ? 3.5 : 0));
    const sleepDoc = clean({
      src: 'Apple Watch (sample)', ls, le, inBed: Math.round(asleep + awake + 8), asleep: Math.round(asleep), deep: Math.round(deep), rem: Math.round(rem),
      core: Math.round(core), unspec: 0, awake: Math.round(awake), wake: Math.max(0, Math.round(1 + rn() + (alc ? 2 : 0))), segs,
      hrAvg: rhr + 4, hrLow: rhr, hrv, hrvN: 4, resp: round1(14.6 + rn() * 0.25 + (alc ? 0.6 : 0)), spo2: round1(96.5 + rn() * 0.8), temp: Math.round((35.3 + rn() * 0.12 + (alc ? 0.25 : 0)) * 100) / 100
    });
    const wakeMin = minOfDayLms(le);
    // tonight's bedtime
    const tonightAlcohol = (dow === 5 || dow === 6) ? R() < 0.45 : R() < 0.06;
    nextBed = 23 * 60 - 25 + Math.round(rn() * 22) + ((dow === 5 || dow === 6) ? 45 : 0);
    // workout of the day
    const W = week[dow] && !(isToday && new Date().getHours() * 60 < week[dow].at + week[dow].dur) ? week[dow] : null;
    const wDur = W ? Math.round(W.dur * (0.92 + R() * 0.16)) : 0, wAt = W ? W.at + Math.round(rn() * 10) : 0;
    // 5-minute heart-rate curve
    const nowSlot = isToday ? Math.floor((new Date().getHours() * 60 + new Date().getMinutes()) / 5) : 288;
    let hex = '', cv = '', walkLeft = 0, lvl = 74;
    const hb = new Array(HB_BINS).fill(0), wHb = new Array(HB_BINS).fill(0);
    let mx = 0, wSum = 0, wN = 0, wMax = 0;
    const charge = 19 * 12 + Math.floor(R() * 24);
    for (let k = 0; k < 288; k++) {
      const t = k * 5;
      let v = 0, c = 0;
      if (k >= nowSlot) { hex += '00'; cv += '0'; continue; }
      if (t < wakeMin || t >= nextBed) { v = rhr + 3 + Math.round(rn() * 3); c = 1; }
      else if (W && t >= wAt && t < wAt + wDur) {
        const prog = (t - wAt) / wDur, [lo, hi] = W.hr;
        const intervals = W.name.startsWith('Track') && prog > 0.2 && prog < 0.85 ? (Math.floor(prog * 20) % 2 ? 1 : 0.35) : 0.6;
        v = Math.round(lo + (hi - lo) * intervals + rn() * 4);
        c = W.kind === 'strava' ? 1 : 9;
        if (W.kind !== 'strava') { const kk = Math.floor((v - HB_BASE) / 5); if (kk >= 0) wHb[Math.min(HB_BINS - 1, kk)] += 300; wSum += v; wN++; wMax = Math.max(wMax, v + 4); }
      } else if (k >= charge && k < charge + 10) { v = 0; c = 0; }
      else {
        if (walkLeft <= 0 && R() < 0.035) walkLeft = 2 + Math.floor(R() * 5);
        lvl += (76 - lvl) * 0.2 + rn() * 3;
        v = walkLeft > 0 ? Math.round(98 + R() * 16) : Math.round(lvl);
        walkLeft--; c = R() < 0.25 ? 2 : 1;
      }
      hex += v ? Math.min(255, v).toString(16).padStart(2, '0') : '00'; cv += c;
      if (v) { const kk = Math.floor((v - HB_BASE) / 5); if (kk >= 0 && c) hb[Math.min(HB_BINS - 1, kk)] += c === 9 ? 300 : 240; if (v > mx) mx = v; }
    }
    const ad = adoc(m);
    ad.days[date] = clean({ hr5: hex, cv5: cv, hb, hrMax: mx, steps: Math.round(7000 + R() * 6000 + (W && W.sport === 'run' ? 9000 : 0)), kcal: Math.round(450 + R() * 300 + (W ? W.dur * 9 : 0)), rhr: rhr + 2, hrvDay: round1(hrv * 0.8), sleep: sleepDoc });
    if (W) {
      const startIso = date + 'T' + pad2(Math.floor(wAt / 60)) + ':' + pad2(wAt % 60) + ':00';
      const wls = lmsOf(startIso), durS = wDur * 60;
      if (W.kind !== 'strava') {
        ad.workouts.push(clean({ id: 'a' + Math.round(wls / 1000).toString(36) + 'sx' + W.sport.slice(0, 2), sport: W.sport, type: W.kind === 'both' ? 'Running' : W.type, src: 'Apple Watch (sample)', start: startIso, ls: wls, le: wls + durS * 1000, durS, distM: W.km ? Math.round(W.km * 1000 * wDur / W.dur) : null, kcal: Math.round(wDur * (W.sport === 'run' ? 12 : 7)), avgHr: wN ? Math.round(wSum / wN) : null, maxHr: wMax || null, elevM: W.elev || null, hb: wHb }));
      }
      if (W.kind !== 'watch') {
        const s2 = W.kind === 'both' ? wls + 40000 : wls, dS = durS + (W.kind === 'both' ? 75 : 0);
        const sid = String(9000000000 + i * 7);
        const act = { id: 's' + sid, sid, name: W.name, sport: W.sport, type: W.type, start: isoOfLms(s2), ls: s2, le: s2 + dS * 1000, durS: dS, movS: Math.round(dS * 0.95), distM: Math.round(W.km * 1000 * wDur / W.dur), elevM: W.elev, kcal: Math.round(wDur * 10), re: Math.round(wDur * (W.sport === 'run' ? 1.4 : 0.8)), via: 'sample' };
        if (W.kind === 'strava') { const h = new Array(HB_BINS).fill(0); let s = 0, n = 0, x = 0; for (let k = 0; k < wDur; k++) { const v = Math.round(W.hr[0] + (W.hr[1] - W.hr[0]) * (0.35 + 0.4 * R())); const kk = Math.floor((v - HB_BASE) / 5); h[Math.min(HB_BINS - 1, kk)] += 60; s += v; n++; x = Math.max(x, v); } act.hb = h; act.avgHr = Math.round(s / n); act.maxHr = x; act.hrDone = true; }
        sdoc(m).acts.push(clean(act));
      }
    }
    const load = loadFromHist(hb, 189) + (W && W.kind === 'strava' ? wDur * 2.6 : 0);
    fatigue = fatigue * 0.8 + load / 260 * 0.35;
    if (!isToday && R() < 0.75) {
      jdoc(m).entries[date] = { alcohol: tonightAlcohol, lateCaffeine: R() < 0.2, lateMeal: R() < 0.25, screens: R() < 0.5, stretch: R() < 0.4, meditation: R() < 0.3, sauna: R() < 0.1, sick: false, travel: R() < 0.05, stress: 1 + Math.floor(R() * 5), note: '' };
    }
    prevAlcohol = tonightAlcohol;
  }
  // a two-week sample plan around today
  const mon = addDays(today, -((parseYmd(today).getDay() + 6) % 7));
  const tpl = [
    ['rest', 'Rest day', 0, 'rest'], ['run', 'Track intervals 6×800 m', 55, 'hard'], ['ride', 'Easy spin', 70, 'easy'], ['run', 'Easy run', 45, 'easy'],
    ['strength', 'Strength: legs & core', 40, 'moderate'], ['run', 'Long run', 95, 'moderate'], ['ride', 'Endurance ride', 120, 'easy']
  ];
  const planSessions = [];
  for (let w = -1; w < 2; w++) tpl.forEach((t, k) => {
    const date = addDays(mon, w * 7 + k);
    planSessions.push({ id: 'sample-' + date, date, sport: t[0], title: w === 1 && k === 5 ? 'Long run with 3×10 min at half-marathon pace' : t[1], durationMin: t[2] + (w === 1 && t[2] ? 5 : 0), intensity: t[3], details: '' });
  });
  return {
    apple, strava, journal, planSessions,
    planMeta: { name: 'Sample: half-marathon build', goal: 'Example plan so you can see how the Plan tab works', startDate: addDays(mon, -7), endDate: addDays(mon, 13) },
    profile: {}, overlaps: { split: {} },
    metaApple: { importedAt: new Date().toISOString(), hrMaxEst: 189, sample: true }, metaStrava: { sample: true }
  };
}
