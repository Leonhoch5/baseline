// ---------- Apple Health export parser (streaming, runs in the browser) ----------
const AH_EPOCH = 946684800; // seconds at 2000-01-01T00:00:00Z; HR timestamps are stored relative to it
let _ahOff = 0;             // UTC offset (minutes) of the last date parsed by ahDate
function ahDate(d) {        // '2024-01-15 07:23:45 +0100' → epoch ms
  const y = +d.slice(0, 4), mo = +d.slice(5, 7), da = +d.slice(8, 10), h = +d.slice(11, 13), mi = +d.slice(14, 16), se = +d.slice(17, 19);
  let off = 0;
  if (d.length >= 25) { const sg = d.charCodeAt(20) === 45 ? -1 : 1; off = sg * (+d.slice(21, 23) * 60 + +d.slice(23, 25)); }
  _ahOff = off;
  return Date.UTC(y, mo - 1, da, h, mi, se) - off * 60000;
}
function xattr(s, from, to, key) {
  const i = s.indexOf(key, from);
  if (i < 0 || i > to) return null;
  const st = i + key.length;
  return s.slice(st, s.indexOf('"', st));
}
const SLEEP_CODE = {
  HKCategoryValueSleepAnalysisInBed: 9, HKCategoryValueSleepAnalysisAwake: 0, HKCategoryValueSleepAnalysisAsleepREM: 1,
  HKCategoryValueSleepAnalysisAsleepCore: 2, HKCategoryValueSleepAnalysisAsleepDeep: 3,
  HKCategoryValueSleepAnalysisAsleepUnspecified: 4, HKCategoryValueSleepAnalysisAsleep: 4,
  '0': 9, '1': 4, '2': 0, '3': 2, '4': 3, '5': 1
};
function distToM(v, unit) { if (!isFinite(v)) return null; switch ((unit || 'km').toLowerCase()) { case 'm': return v; case 'mi': return v * 1609.344; case 'yd': return v * 0.9144; case 'ft': return v * 0.3048; case 'cm': return v / 100; default: return v * 1000; } }
function energyToKcal(v, unit) { if (!isFinite(v)) return null; return /kj/i.test(unit || '') ? v / 4.184 : v; }
function lowerBound(T, n, x) { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < x) lo = m + 1; else hi = m; } return lo; }
function seriesIn(arr, s, e) { const out = []; for (const r of arr) if (r.t >= s && r.t <= e) out.push(r.v); return out; }

class AppleParser {
  constructor(since) {
    this.since = since || '';
    this.hrT = new Int32Array(1 << 20); this.hrO = new Int16Array(1 << 20); this.hrV = new Uint8Array(1 << 20); this.hrN = 0;
    this.hrv = []; this.resp = []; this.spo2 = []; this.temp = [];
    this.rhr = {}; this.vo2 = {}; this.steps = {}; this.energy = {};
    this.sleep = []; this.workouts = []; this.cur = null;
    this.carry = ''; this.nRec = 0; this.dob = null; this.sex = null;
    const series = (arr, scale) => (s, a, b) => {
      const sd = xattr(s, a, b, ' startDate="'); if (!sd || sd < this.since) return;
      const v = parseFloat(xattr(s, a, b, ' value="')); if (!isFinite(v)) return;
      const t = ahDate(sd);
      const r = { t, off: _ahOff, v: scale ? scale(v, xattr(s, a, b, ' unit="')) : v };
      if (arr === this.temp) { const ed = xattr(s, a, b, ' endDate="'); r.te = ed ? ahDate(ed) : t; }
      arr.push(r);
    };
    const daily = (map, conv) => (s, a, b) => {
      const sd = xattr(s, a, b, ' startDate="'); if (!sd || sd < this.since) return;
      let v = parseFloat(xattr(s, a, b, ' value="')); if (!isFinite(v)) return;
      if (conv) v = conv(v, xattr(s, a, b, ' unit="'));
      const day = sd.slice(0, 10), src = xattr(s, a, b, ' sourceName="') || '?';
      const m = map[day] || (map[day] = {}); m[src] = (m[src] || 0) + v;
    };
    const perDay = (map) => (s, a, b) => {
      const sd = xattr(s, a, b, ' startDate="'); if (!sd || sd < this.since) return;
      const v = parseFloat(xattr(s, a, b, ' value="')); if (isFinite(v)) map[sd.slice(0, 10)] = v;
    };
    this.H = {
      HKQuantityTypeIdentifierHeartRate: (s, a, b) => this.onHr(s, a, b),
      HKCategoryTypeIdentifierSleepAnalysis: (s, a, b) => this.onSleep(s, a, b),
      HKQuantityTypeIdentifierHeartRateVariabilitySDNN: series(this.hrv),
      HKQuantityTypeIdentifierRespiratoryRate: series(this.resp),
      HKQuantityTypeIdentifierOxygenSaturation: series(this.spo2, (v, u) => (u === '%' && v > 1.5) ? v : v * 100),
      HKQuantityTypeIdentifierAppleSleepingWristTemperature: series(this.temp, (v, u) => /F/.test(u || '') ? (v - 32) / 1.8 : v),
      HKQuantityTypeIdentifierRestingHeartRate: perDay(this.rhr),
      HKQuantityTypeIdentifierVO2Max: perDay(this.vo2),
      HKQuantityTypeIdentifierStepCount: daily(this.steps),
      HKQuantityTypeIdentifierActiveEnergyBurned: daily(this.energy, energyToKcal),
    };
  }
  push(str) {
    const s = this.carry ? this.carry + str : str;
    const cut = s.lastIndexOf('\n');
    if (cut < 0) { this.carry = s; return; }
    this.scan(s, cut);
    this.carry = s.slice(cut + 1);
  }
  end() { if (this.carry) { const s = this.carry + '\n'; this.scan(s, s.length - 1); } this.carry = ''; }
  scan(s, end) {
    let i = 0;
    for (;;) {
      i = s.indexOf('<', i);
      if (i < 0 || i >= end) return;
      const c = s.charCodeAt(i + 1);
      if (c === 82 && s.startsWith('Record type="', i + 1)) {
        const ts = i + 14, te = s.indexOf('"', ts), close = s.indexOf('>', te);
        const fn = this.H[s.slice(ts, te)];
        if (fn !== undefined) fn(s, te, close);
        this.nRec++;
        i = close + 1; continue;
      }
      if (c === 87) {
        if (s.startsWith('Workout ', i + 1)) { i = this.onWorkout(s, i); continue; }
        if (this.cur && s.startsWith('WorkoutStatistics ', i + 1)) { i = this.onStat(s, i); continue; }
        if (this.cur && s.startsWith('WorkoutActivity ', i + 1)) { const close = s.indexOf('>', i); this.inAct = s.charCodeAt(close - 1) !== 47; i = close + 1; continue; }
      } else if (c === 47) {
        if (this.cur && s.startsWith('/Workout>', i + 1)) { this.finishWorkout(); i += 10; continue; }
        if (s.startsWith('/WorkoutActivity>', i + 1)) { this.inAct = false; i += 18; continue; }
      } else if (c === 77) {
        if (this.cur && !this.inAct && s.startsWith('MetadataEntry key="HK', i + 1)) { i = this.onMeta(s, i); continue; }
        if (s.startsWith('Me ', i + 1)) {
          const close = s.indexOf('>', i);
          this.dob = xattr(s, i, close, 'DateOfBirth="') || null;
          const sx = xattr(s, i, close, 'BiologicalSex="') || '';
          this.sex = /Female/.test(sx) ? 'f' : /Male/.test(sx) ? 'm' : null;
          i = close + 1; continue;
        }
      }
      i += 1;
    }
  }
  onHr(s, a, b) {
    const sd = xattr(s, a, b, ' startDate="'); if (!sd || sd < this.since) return;
    const v = +xattr(s, a, b, ' value="'); if (!(v >= 25 && v <= 250)) return;
    const t = ahDate(sd);
    this.addHr(t, _ahOff, v);
  }
  addHr(t, off, v) {
    if (this.hrN === this.hrT.length) {
      const n = this.hrT.length * 2;
      const T = new Int32Array(n); T.set(this.hrT); this.hrT = T;
      const O = new Int16Array(n); O.set(this.hrO); this.hrO = O;
      const V = new Uint8Array(n); V.set(this.hrV); this.hrV = V;
    }
    this.hrT[this.hrN] = Math.round(t / 1000) - AH_EPOCH; this.hrO[this.hrN] = off; this.hrV[this.hrN] = Math.round(v); this.hrN++;
  }
  onSleep(s, a, b) {
    const sd = xattr(s, a, b, ' startDate="'), ed = xattr(s, a, b, ' endDate="');
    if (!sd || !ed || ed < this.since) return;
    const c = SLEEP_CODE[xattr(s, a, b, ' value="')]; if (c === undefined) return;
    const t0 = ahDate(sd), off = _ahOff, t1 = ahDate(ed);
    this.sleep.push({ src: decodeXml(xattr(s, a, b, ' sourceName="') || '?'), s: t0, e: t1, c, off });
  }
  onWorkout(s, i) {
    const close = s.indexOf('>', i), self = s.charCodeAt(close - 1) === 47;
    const sd = xattr(s, i, close, ' startDate="'), ed = xattr(s, i, close, ' endDate="');
    this.cur = null;
    if (!sd || !ed || sd < this.since) return close + 1;
    const type = (xattr(s, i, close, ' workoutActivityType="') || 'Other').replace('HKWorkoutActivityType', '');
    const t0 = ahDate(sd), off = _ahOff, t1 = ahDate(ed);
    let dur = parseFloat(xattr(s, i, close, ' duration="'));
    const du = xattr(s, i, close, ' durationUnit="') || 'min';
    if (isFinite(dur)) dur *= du === 'min' ? 60 : du === 'hr' || du === 'h' ? 3600 : du === 'ms' ? 0.001 : 1; else dur = (t1 - t0) / 1000;
    const w = { type, src: decodeXml(xattr(s, i, close, ' sourceName="') || '?'), s: t0, e: t1, off, durS: dur, distM: null, kcal: null, avgHr: null, maxHr: null, elevM: null, indoor: false };
    const td = parseFloat(xattr(s, i, close, ' totalDistance="'));
    if (td > 0) w.distM = distToM(td, xattr(s, i, close, ' totalDistanceUnit="'));
    const tk = parseFloat(xattr(s, i, close, ' totalEnergyBurned="'));
    if (tk > 0) w.kcal = energyToKcal(tk, xattr(s, i, close, ' totalEnergyBurnedUnit="'));
    this.cur = w; this.inAct = false;
    if (self) this.finishWorkout();
    return close + 1;
  }
  onStat(s, i) {
    const close = s.indexOf('>', i), w = this.cur;
    const type = xattr(s, i, close, ' type="') || '';
    if (type.startsWith('HKQuantityTypeIdentifierDistance')) {
      const v = parseFloat(xattr(s, i, close, ' sum="'));
      if (v > 0) { const m = distToM(v, xattr(s, i, close, ' unit="')); if (this.inAct) w._dSum = (w._dSum || 0) + m; else w.distM = m; }
    } else if (type === 'HKQuantityTypeIdentifierActiveEnergyBurned') {
      const v = parseFloat(xattr(s, i, close, ' sum="'));
      if (v > 0) { const k = energyToKcal(v, xattr(s, i, close, ' unit="')); if (this.inAct) w._kSum = (w._kSum || 0) + k; else w.kcal = k; }
    } else if (this.inAct) {
      // per-segment heart rate of a multisport workout: the whole-workout value or the sample stream wins
    } else if (type === 'HKQuantityTypeIdentifierHeartRate') {
      const av = parseFloat(xattr(s, i, close, ' average="')), mx = parseFloat(xattr(s, i, close, ' maximum="'));
      if (av > 0) w.avgHr = av; if (mx > 0) w.maxHr = mx;
    }
    return close + 1;
  }
  finishWorkout() {
    const w = this.cur; this.cur = null; this.inAct = false;
    if (w.distM == null && w._dSum) w.distM = w._dSum;
    if (w.kcal == null && w._kSum) w.kcal = w._kSum;
    this.workouts.push(w);
  }
  onMeta(s, i) {
    const close = s.indexOf('>', i), w = this.cur;
    const key = xattr(s, i, close, 'key="'), val = xattr(s, i, close, ' value="') || '';
    if (key === 'HKElevationAscended') { const v = parseFloat(val); if (v > 0) w.elevM = /cm/.test(val) ? v / 100 : /ft/.test(val) ? v * 0.3048 : v; }
    else if (key === 'HKIndoorWorkout') w.indoor = val === '1';
    return close + 1;
  }

  // ---- turn raw samples into per-day aggregates ----
  finalize() {
    const N = this.hrN, T0 = this.hrT, O0 = this.hrO, V0 = this.hrV;
    // 1. sort heart-rate samples by time
    const T = new Int32Array(N), O = new Int16Array(N), V = new Uint8Array(N);
    if (N) {
      let tmin = Infinity, tmax = -Infinity;
      for (let i = 0; i < N; i++) { const t = T0[i]; if (t < tmin) tmin = t; if (t > tmax) tmax = t; }
      const ib = 53 - Math.ceil(Math.log2(tmax - tmin + 2));
      let order;
      if (ib > 0 && N < Math.pow(2, ib)) {
        const M = Math.pow(2, ib), keys = new Float64Array(N);
        for (let i = 0; i < N; i++) keys[i] = (T0[i] - tmin) * M + i;
        keys.sort();
        order = new Uint32Array(N); for (let i = 0; i < N; i++) order[i] = keys[i] % M;
      } else {
        order = new Uint32Array(N); for (let i = 0; i < N; i++) order[i] = i;
        order.sort((a, b) => T0[a] - T0[b]);
      }
      for (let i = 0; i < N; i++) { const j = order[i]; T[i] = T0[j]; O[i] = O0[j]; V[i] = V0[j]; }
    }
    this.hrT = this.hrO = this.hrV = null;
    for (const arr of [this.hrv, this.resp, this.spo2, this.temp]) arr.sort((a, b) => a.t - b.t);

    // 2. per-day HR aggregates: 5-minute average curve, sample density, time-in-HR histogram
    const D = {};
    let lastDn = null, agg = null;
    const hist = new Uint32Array(256); const tLast = N ? T[N - 1] : 0;
    for (let i = 0; i < N; i++) {
      const v = V[i];
      const dt = i + 1 < N ? Math.min(T[i + 1] - T[i], 300) : 60;
      const ls = T[i] + AH_EPOCH + O[i] * 60;
      const dn = Math.floor(ls / 86400);
      if (dn !== lastDn) {
        lastDn = dn;
        const key = new Date(dn * DAY_MS).toISOString().slice(0, 10);
        agg = D[key] || (D[key] = { hs: new Float32Array(288), hc: new Uint16Array(288), hb: new Float64Array(HB_BINS), max: 0 });
      }
      const slot = Math.floor((ls - dn * 86400) / 300);
      agg.hs[slot] += v; agg.hc[slot]++;
      if (v > agg.max) agg.max = v;
      const k = Math.floor((v - HB_BASE) / 5);
      if (k >= 0) agg.hb[k < HB_BINS ? k : HB_BINS - 1] += dt;
      if (tLast - T[i] < 365 * 86400) hist[v]++;
    }
    // HRmax estimate: 99.95th percentile of the last year's samples
    let hrMaxEst = null;
    { let n = 0; for (let v = 0; v < 256; v++) n += hist[v];
      if (n > 2000) { const need = Math.max(3, Math.ceil(n * 0.0005)); let acc = 0; for (let v = 255; v > 0; v--) { acc += hist[v]; if (acc >= need) { hrMaxEst = clamp(v, 150, 215); break; } } } }

    // 3. sleep nights
    const sleepByDay = this.buildSleep(T, V, N);

    // 4. workouts with HR detail from the sample stream
    const workouts = [];
    for (const w of this.workouts) {
      const sSec = Math.round(w.s / 1000) - AH_EPOCH, eSec = Math.round(w.e / 1000) - AH_EPOCH;
      const lo = lowerBound(T, N, sSec), hi = lowerBound(T, N, eSec + 1);
      let hb = null;
      if (hi - lo >= Math.max(5, w.durS / 120)) { // need ≥1 sample per 2 min (a recorded workout session), not background readings
        hb = new Array(HB_BINS).fill(0); let sum = 0, dur = 0, mx = 0;
        for (let i = lo; i < hi; i++) {
          const dt = i + 1 < hi ? Math.min(T[i + 1] - T[i], 60) : 5, v = V[i];
          const k = Math.floor((v - HB_BASE) / 5); if (k >= 0) hb[k < HB_BINS ? k : HB_BINS - 1] += dt;
          sum += v * dt; dur += dt; if (v > mx) mx = v;
        }
        if (dur > 0) { w.avgHr = Math.round(sum / dur); w.maxHr = mx; }
        hb = hb.map(Math.round);
      }
      const ls = w.s + w.off * 60000, le = w.e + w.off * 60000;
      let h = 0; for (const ch of w.src) h = (h * 31 + ch.charCodeAt(0)) % 1296;
      const sport = sportOf(w.type);
      workouts.push(clean({
        id: 'a' + Math.round(w.s / 1000).toString(36) + h.toString(36) + sport.slice(0, 2), sport, type: w.type, src: w.src,
        start: isoOfLms(ls), ls, le, durS: Math.round(w.durS), distM: w.distM ? Math.round(w.distM) : null,
        kcal: w.kcal ? Math.round(w.kcal) : null, avgHr: w.avgHr ? Math.round(w.avgHr) : null, maxHr: w.maxHr ? Math.round(w.maxHr) : null,
        elevM: w.elevM ? Math.round(w.elevM) : null, indoor: w.indoor || null, hb
      }));
    }

    // 5. assemble month documents
    const months = {};
    const dayDoc = (day) => { const m = day.slice(0, 7); const md = months[m] || (months[m] = { v: 1, month: m, days: {}, workouts: [] }); return md.days[day] || (md.days[day] = {}); };
    const inRange = (day) => !this.since || day >= this.since;
    for (const day in D) {
      if (!inRange(day)) continue;
      const a = D[day], d = dayDoc(day);
      let hex = '', cv = '';
      for (let k = 0; k < 288; k++) {
        const c = a.hc[k];
        hex += c ? Math.min(255, Math.round(a.hs[k] / c)).toString(16).padStart(2, '0') : '00';
        cv += Math.min(9, c);
      }
      d.hr5 = hex; d.cv5 = cv; d.hb = Array.from(a.hb, Math.round); d.hrMax = a.max;
    }
    const maxOf = (m) => { let best = 0; for (const k in m) if (m[k] > best) best = m[k]; return best; };
    for (const day in this.steps) if (inRange(day)) dayDoc(day).steps = Math.round(maxOf(this.steps[day]));
    for (const day in this.energy) if (inRange(day)) dayDoc(day).kcal = Math.round(maxOf(this.energy[day]));
    for (const day in this.rhr) if (inRange(day)) dayDoc(day).rhr = Math.round(this.rhr[day]);
    for (const day in this.vo2) if (inRange(day)) dayDoc(day).vo2 = round1(this.vo2[day]);
    { const byDay = {}; for (const r of this.hrv) { const day = dateOfLms(r.t + r.off * 60000); (byDay[day] || (byDay[day] = [])).push(r.v); }
      for (const day in byDay) if (inRange(day)) dayDoc(day).hrvDay = round1(mean(byDay[day])); }
    for (const day in sleepByDay) if (inRange(day)) dayDoc(day).sleep = sleepByDay[day];
    for (const w of workouts) { const day = w.start.slice(0, 10); if (!inRange(day)) continue; dayDoc(day); months[day.slice(0, 7)].workouts.push(w); }

    const dayKeys = Object.keys(months).flatMap(m => Object.keys(months[m].days)).sort();
    const rhrVals = Object.keys(this.rhr).sort().slice(-60).map(k => this.rhr[k]);
    const srcCount = {}; for (const w of workouts) srcCount[w.src] = (srcCount[w.src] || 0) + 1;
    return {
      months,
      meta: clean({
        importedAt: new Date().toISOString(), since: this.since || null, from: dayKeys[0] || null, to: dayKeys[dayKeys.length - 1] || null,
        hrSamples: N, nights: Object.keys(sleepByDay).length, workouts: workouts.length, records: this.nRec,
        hrMaxEst, rhrEst: rhrVals.length ? Math.round(median(rhrVals)) : null, dob: this.dob, sex: this.sex,
        workoutSources: Object.entries(srcCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0])
      })
    };
  }

  buildSleep(T, V, N) {
    const bySrc = {}, inBed = [];
    for (const r of this.sleep) { if (r.c === 9) inBed.push(r); else (bySrc[r.src] || (bySrc[r.src] = [])).push(r); }
    inBed.sort((a, b) => a.s - b.s);
    const perDay = {};
    for (const src in bySrc) {
      const recs = bySrc[src].sort((a, b) => a.s - b.s);
      let cur = null;
      const flush = () => {
        if (!cur) return;
        const day = dateOfLms(cur.e + cur.off * 60000 + 4 * 3600000);
        const pd = perDay[day] || (perDay[day] = {});
        (pd[src] || (pd[src] = [])).push(summarizeSession(cur));
        cur = null;
      };
      for (const r of recs) {
        if (r.e <= r.s) continue;
        if (cur && r.s - cur.e <= 30 * 60000) { cur.segs.push(r); if (r.e > cur.e) cur.e = r.e; }
        else { flush(); cur = { src, s: r.s, e: r.e, off: r.off, segs: [r] }; }
      }
      flush();
    }
    const out = {};
    for (const day in perDay) {
      let best = null, bestScore = -1;
      for (const src in perDay[day]) {
        const sess = perDay[day][src];
        const asleep = sess.reduce((a, x) => a + x.asleep, 0);
        const staged = sess.some(x => x.deep + x.rem + x.core > 0);
        const score = asleep * (staged ? 1.25 : 1);
        if (score > bestScore) { bestScore = score; best = sess; }
      }
      if (!best || bestScore <= 0) continue;
      best.sort((a, b) => b.asleep - a.asleep);
      const main = best[0].asleep >= 120 ? best[0] : null;
      const naps = best.filter(x => x !== main && x.asleep >= 10).map(x => ({ ls: x.ls, le: x.le, min: Math.round(x.asleep) }));
      const night = { naps: naps.length ? naps : undefined, napMin: naps.reduce((a, x) => a + x.min, 0) || undefined };
      if (main) {
        let ibS = main.s, ibE = main.e;
        for (const r of inBed) { if (r.e < main.s) continue; if (r.s > main.e) break; if (r.s < ibS) ibS = r.s; if (r.e > ibE) ibE = r.e; }
        Object.assign(night, {
          src: main.src, ls: main.ls, le: main.le, inBed: Math.round((ibE - ibS) / 60000), asleep: Math.round(main.asleep),
          deep: Math.round(main.deep), rem: Math.round(main.rem), core: Math.round(main.core), unspec: Math.round(main.unspec),
          awake: Math.round(main.awake), wake: main.wake, segs: main.segs
        });
        // physiology during the main sleep
        const sSec = Math.round(main.s / 1000) - AH_EPOCH, eSec = Math.round(main.e / 1000) - AH_EPOCH;
        const lo = lowerBound(T, N, sSec), hi = lowerBound(T, N, eSec + 1);
        if (hi - lo >= 3) {
          let sum = 0; for (let i = lo; i < hi; i++) sum += V[i];
          night.hrAvg = Math.round(sum / (hi - lo));
          let low = Infinity, j = lo, wsum = 0;
          for (let i = lo; i < hi; i++) {
            wsum += V[i];
            while (T[i] - T[j] > 1800) { wsum -= V[j]; j++; }
            const n = i - j + 1; if (n >= 3 && T[i] - T[j] >= 600) { const a = wsum / n; if (a < low) low = a; }
          }
          if (!isFinite(low)) { low = 255; for (let i = lo; i < hi; i++) if (V[i] < low) low = V[i]; }
          night.hrLow = Math.round(low);
        }
        let hv = seriesIn(this.hrv, main.s, main.e);
        if (!hv.length) hv = seriesIn(this.hrv, main.e, main.e + 3 * 3600000);
        if (hv.length) { night.hrv = round1(mean(hv)); night.hrvN = hv.length; }
        const rr = seriesIn(this.resp, main.s, main.e); if (rr.length) night.resp = round1(mean(rr));
        const ox = seriesIn(this.spo2, main.s, main.e); if (ox.length) night.spo2 = round1(mean(ox));
        for (const r of this.temp) if (r.te >= main.s && r.t <= main.e) { night.temp = Math.round(r.v * 100) / 100; }
      }
      out[day] = clean(night);
    }
    return out;
  }
}
function summarizeSession(x) {
  const segs = x.segs.sort((a, b) => a.s - b.s);
  const r = { src: x.src, s: x.s, e: x.e, ls: x.s + x.off * 60000, le: x.e + x.off * 60000, asleep: 0, deep: 0, rem: 0, core: 0, unspec: 0, awake: 0, wake: 0, segs: [] };
  let t = x.s;
  const add = (st, en, c) => {
    const dur = (en - st) / 60000; if (dur <= 0) return;
    if (c === 0) r.awake += dur; else if (c === 1) r.rem += dur; else if (c === 2) r.core += dur; else if (c === 3) r.deep += dur; else r.unspec += dur;
    const last = r.segs[r.segs.length - 1];
    const off = round1((st - x.s) / 60000);
    if (last && last[2] === c && Math.abs(last[0] + last[1] - off) < 0.2) last[1] = round1(last[1] + dur);
    else r.segs.push([off, round1(dur), c]);
  };
  for (const g of segs) {
    if (g.s > t) add(t, g.s, 0);           // untracked gap inside a session counts as awake
    const st = Math.max(g.s, t);
    if (g.e > st) { add(st, g.e, g.c); t = g.e; }
  }
  r.asleep = r.deep + r.rem + r.core + r.unspec;
  for (let k = 1; k < r.segs.length - 1; k++) if (r.segs[k][2] === 0 && r.segs[k][1] >= 2) r.wake++;
  return r;
}
function clean(o) { for (const k in o) if (o[k] == null || (typeof o[k] === 'number' && isNaN(o[k]))) delete o[k]; return o; }

async function feedStream(stream, total, parser, onProgress) {
  const reader = stream.getReader(), dec = new TextDecoder();
  let bytes = 0, last = Date.now();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    parser.push(dec.decode(value, { stream: true }));
    if (Date.now() - last > 80) { onProgress && onProgress({ phase: 'read', frac: total ? Math.min(1, bytes / total) : 0, bytes }); await sleep(0); last = Date.now(); }
  }
  parser.push(dec.decode());
  parser.end();
}
async function isZipFile(file) { const b = new Uint8Array(await file.slice(0, 4).arrayBuffer()); return b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4; }
async function parseAppleExport(file, since, onProgress) {
  const p = new AppleParser(since);
  let stream, total;
  if (await isZipFile(file)) {
    const entries = await zipEntries(file);
    const e = entries.find(x => /(^|\/)export\.xml$/i.test(x.name));
    if (!e) throw new Error("This zip doesn't contain export.xml. Use the export.zip that the Health app creates.");
    stream = await zipEntryStream(file, e); total = e.usize;
  } else {
    const head = await file.slice(0, 2000).text();
    if (!/HealthData|<\?xml/.test(head)) throw new Error("This doesn't look like an Apple Health export. Choose export.zip or export.xml.");
    stream = file.stream(); total = file.size;
  }
  await feedStream(stream, total, p, onProgress);
  onProgress && onProgress({ phase: 'crunch' });
  await sleep(30);
  return p.finalize();
}
