// ---------- charts: hand-built SVG, coloured through CSS tokens ----------
function tipEl() { return document.getElementById('tip'); }
function showTip(e, head, rows) {
  const t = tipEl(); t.replaceChildren();
  if (head) { const h = document.createElement('div'); h.className = 'h'; h.textContent = head; t.appendChild(h); }
  for (const r of rows || []) {
    const d = document.createElement('div'); d.className = 'row';
    if (r.color) { const i = document.createElement('i'); i.style.background = r.color; d.appendChild(i); }
    const b = document.createElement('b'); b.textContent = r.v; d.appendChild(b);
    if (r.k) { const s = document.createElement('span'); s.textContent = r.k; d.appendChild(s); }
    t.appendChild(d);
  }
  t.hidden = false; moveTip(e);
}
function moveTip(e) {
  const t = tipEl(); if (t.hidden) return;
  const pad = 14, r = t.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
  t.style.left = Math.max(4, x) + 'px'; t.style.top = Math.max(4, y) + 'px';
}
function hideTip() { const t = tipEl(); if (t) t.hidden = true; }
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, step0 = span / (n || 4), mag = Math.pow(10, Math.floor(Math.log10(step0))), err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
function roundTop(x, y, w, h, r) { return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
function chartWidth(el) { return Math.max(260, Math.floor(el.getBoundingClientRect().width) || 600); }
function bindHits(el, sel, onEnter) {
  el.querySelectorAll(sel).forEach(r => {
    r.addEventListener('pointerenter', e => onEnter(r, e));
    r.addEventListener('pointermove', moveTip);
    r.addEventListener('pointerleave', () => { hideTip(); r.setAttribute('fill', 'transparent'); });
  });
}

function ringSvg(frac, color, val, unit) {
  const r = 70, c = 2 * Math.PI * r, f = clamp(frac || 0, 0, 1);
  return `<svg viewBox="0 0 172 172" aria-hidden="true"><circle cx="86" cy="86" r="${r}" fill="none" stroke="var(--track)" stroke-width="12"/>` +
    (f > 0 ? `<circle cx="86" cy="86" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 86 86)"/>` : '') +
    `<text x="86" y="92" text-anchor="middle" class="ring-val">${esc(val)}</text><text x="86" y="120" text-anchor="middle" class="ring-unit">${esc(unit)}</text></svg>`;
}

// Bars with optional overlay line (e.g. sleep need). items: [{label, v, color, tip:{head, rows}}]
function barChart(el, o) {
  const W = chartWidth(el), H = o.height || 170, ml = 36, mr = 8, mt = 10, mb = 22;
  const iw = W - ml - mr, ih = H - mt - mb, n = o.items.length || 1;
  const vals = o.items.map(d => d.v).filter(v => v != null);
  const lv = o.line ? o.line.values.filter(v => v != null) : [];
  const yMin = o.yMin != null ? o.yMin : 0;
  const yMax = o.yMax != null ? o.yMax : Math.max(1, ...vals, ...lv) * 1.1;
  const ticks = o.ticks || niceTicks(yMin, yMax, 4);
  const y = v => mt + ih - (clamp(v, yMin, yMax) - yMin) / (yMax - yMin) * ih;
  const band = iw / n, bw = Math.max(2, Math.min(24, band * 0.66 - 2));
  let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(o.label || '')}">`;
  for (const t of ticks) s += `<line x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/><text x="${ml - 6}" y="${y(t) + 3.5}" text-anchor="end">${esc(o.fmt ? o.fmt(t) : t)}</text>`;
  o.items.forEach((d, i) => {
    if (d.v == null || d.v <= yMin) return;
    const x = ml + band * i + (band - bw) / 2, top = y(d.v), h = Math.max(1, y(yMin) - top);
    s += `<path d="${roundTop(x, top, bw, h, Math.min(4, bw / 2, h))}" fill="${d.color || o.color}"/>`;
  });
  if (o.line) {
    let p = '', pen = false;
    o.line.values.forEach((v, i) => { if (v == null) { pen = false; return; } const x = ml + band * i + band / 2; p += (pen ? 'L' : 'M') + x.toFixed(1) + ',' + y(v).toFixed(1); pen = true; });
    s += `<path d="${p}" fill="none" stroke="${o.line.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 58))));
  o.items.forEach((d, i) => { if ((n - 1 - i) % every === 0) s += `<text x="${ml + band * i + band / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`; });
  o.items.forEach((d, i) => { s += `<rect class="hit" data-i="${i}" x="${ml + band * i}" y="${mt}" width="${band}" height="${ih}" fill="transparent" style="cursor:${o.onClick ? 'pointer' : 'default'}"/>`; });
  el.innerHTML = s + '</svg>';
  bindHits(el, '.hit', (r, e) => { const d = o.items[+r.dataset.i]; r.setAttribute('fill', 'var(--wash)'); if (d.tip) showTip(e, d.tip.head, d.tip.rows); });
  if (o.onClick) el.querySelectorAll('.hit').forEach(r => r.addEventListener('click', () => o.onClick(o.items[+r.dataset.i])));
}

// Lines with crosshair. series: [{name, values, color}], labels: x labels, band: {lo:[],hi:[],color}
function lineChart(el, o) {
  const W = chartWidth(el), H = o.height || 170, ml = 36, mr = 12, mt = 10, mb = 22;
  const iw = W - ml - mr, ih = H - mt - mb, n = o.labels.length;
  const all = [];
  o.series.forEach(s => s.values.forEach(v => v != null && all.push(v)));
  (o.hlines || []).forEach(h => all.push(h.v));
  if (o.band) { o.band.lo.forEach(v => v != null && all.push(v)); o.band.hi.forEach(v => v != null && all.push(v)); }
  if (!all.length) { el.innerHTML = '<p class="muted">No data in this range yet.</p>'; return; }
  let lo = o.yMin != null ? o.yMin : Math.min(...all), hi = o.yMax != null ? o.yMax : Math.max(...all);
  const pad = (hi - lo || 1) * 0.12; if (o.yMin == null) lo -= pad; if (o.yMax == null) hi += pad;
  const ticks = niceTicks(lo, hi, 4); lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  const x = i => ml + (n === 1 ? iw / 2 : i * iw / (n - 1));
  const y = o.invert ? v => mt + (v - lo) / (hi - lo) * ih : v => mt + ih - (v - lo) / (hi - lo) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(o.label || '')}">`;
  for (const t of ticks) s += `<line x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/><text x="${ml - 6}" y="${y(t) + 3.5}" text-anchor="end">${esc(o.fmt ? o.fmt(t) : t)}</text>`;
  if (o.band) {
    let top = '', bot = '';
    for (let i = 0; i < n; i++) if (o.band.lo[i] != null && o.band.hi[i] != null) { top += (top ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(o.band.hi[i]).toFixed(1); bot = 'L' + x(i).toFixed(1) + ',' + y(o.band.lo[i]).toFixed(1) + bot; }
    if (top) s += `<path d="${top}${bot}Z" fill="${o.band.color}" opacity="0.12"/>`;
  }
  for (const h of o.hlines || []) s += `<line x1="${ml}" x2="${W - mr}" y1="${y(h.v)}" y2="${y(h.v)}" stroke="${h.color}" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${h.start ? ml + 4 : W - mr - 4}" y="${y(h.v) - 5}" text-anchor="${h.start ? 'start' : 'end'}" fill="${h.color}">${esc(h.label || '')}</text>`;
  for (const vl of o.vlines || []) if (vl.i >= 0 && vl.i < n) s += `<line x1="${x(vl.i)}" x2="${x(vl.i)}" y1="${mt}" y2="${mt + ih}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3"/><text x="${x(vl.i) + (vl.i > n * 0.85 ? -4 : 4)}" y="${mt + 10}" text-anchor="${vl.i > n * 0.85 ? 'end' : 'start'}">${esc(vl.label || '')}</text>`;
  for (const se of o.series) {
    if (se.dots) { se.values.forEach((v, i) => { if (v != null) s += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${se.color}" opacity=".85"/>`; }); continue; }
    let p = '', pen = false, lastI = -1;
    se.values.forEach((v, i) => { if (v == null) { pen = false; return; } p += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true; lastI = i; });
    s += `<path d="${p}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${se.dash ? ` stroke-dasharray="${se.dash}"` : ''}/>`;
    if (lastI >= 0 && !se.noEnd) s += `<circle cx="${x(lastI)}" cy="${y(se.values[lastI])}" r="4" fill="${se.color}" stroke="var(--panel)" stroke-width="2"/>`;
  }
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 58))));
  o.labels.forEach((l, i) => { if ((n - 1 - i) % every === 0) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
  s += `<line class="xh" x1="0" x2="0" y1="${mt}" y2="${mt + ih}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>`;
  o.series.forEach((se, k) => { s += `<circle class="xd" data-k="${k}" r="4" fill="${se.color}" stroke="var(--panel)" stroke-width="2" visibility="hidden"/>`; });
  s += `<rect class="ov" x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  el.innerHTML = s;
  const svg = el.querySelector('svg'), ov = el.querySelector('.ov'), xh = el.querySelector('.xh'), dots = el.querySelectorAll('.xd');
  const move = (e) => {
    const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * W / r.width;
    const i = clamp(Math.round(n === 1 ? 0 : (px - ml) / iw * (n - 1)), 0, n - 1);
    xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility', 'visible');
    const rows = [];
    o.series.forEach((se, k) => {
      const v = se.values[i], d = dots[k];
      if (v == null) d.setAttribute('visibility', 'hidden'); else { d.setAttribute('cx', x(i)); d.setAttribute('cy', y(v)); d.setAttribute('visibility', 'visible'); }
      rows.push({ v: v == null ? '–' : (se.fmt || o.fmtTip || String)(v), k: se.name, color: se.color });
    });
    if (o.band && o.band.lo[i] != null) rows.push({ v: (o.fmtTip || String)(o.band.lo[i]) + '–' + (o.fmtTip || String)(o.band.hi[i]), k: o.band.name || 'normal range' });
    showTip(e, o.tipHead ? o.tipHead(i) : o.labels[i], rows);
  };
  ov.addEventListener('pointermove', move); ov.addEventListener('pointerenter', move);
  ov.addEventListener('pointerleave', () => { hideTip(); xh.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); });
}

// 24-hour heart-rate curve with sleep + activity bands
function dayChart(el, o) {
  const W = chartWidth(el), H = o.height || 200, ml = 36, mr = 30, mt = 18, mb = 22;
  const iw = W - ml - mr, ih = H - mt - mb;
  const vals = o.hr.filter(v => v != null);
  const lo = 40, hi = Math.max(Math.round(o.hrMax * 0.95), (vals.length ? Math.max(...vals) : 0) + 10, 140);
  const x = m => ml + m / 1440 * iw, y = v => mt + ih - (v - lo) / (hi - lo) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Heart rate over the day">`;
  for (const t of niceTicks(lo, hi, 4)) s += `<line x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/><text x="${ml - 6}" y="${y(t) + 3.5}" text-anchor="end">${t}</text>`;
  [[0.6, 'Z2'], [0.7, 'Z3'], [0.8, 'Z4'], [0.9, 'Z5']].forEach(([p, l]) => { const v = o.hrMax * p; if (v < hi) s += `<text x="${W - mr + 4}" y="${y(v) + 3.5}">${l}</text><line x1="${W - mr - 4}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--muted)" stroke-width="1"/>`; });
  for (const b of o.sleeps || []) s += `<rect x="${x(b.s)}" y="${mt}" width="${Math.max(1, x(b.e) - x(b.s))}" height="${ih}" fill="var(--sleep)" opacity="0.13"/>`;
  for (const b of o.acts || []) {
    s += `<rect x="${x(b.s)}" y="${mt}" width="${Math.max(2, x(b.e) - x(b.s))}" height="${ih}" fill="var(--strain)" opacity="0.16"/>`;
    s += `<text x="${x(b.s) + 2}" y="${mt - 6}" style="fill:var(--fg-2)">${esc(b.label)}</text>`;
  }
  let p = '', pen = false;
  o.hr.forEach((v, k) => { if (v == null) { pen = false; return; } p += (pen ? 'L' : 'M') + x(k * 5 + 2.5).toFixed(1) + ',' + y(v).toFixed(1); pen = true; });
  s += `<path d="${p}" fill="none" stroke="var(--watch)" stroke-width="1.6" stroke-linejoin="round"/>`;
  const fit = Math.floor(iw / 46), hs = [3, 4, 6, 12].find(st => 24 / st + 1 <= fit) || 12;
  for (let h = 0; h <= 24; h += hs) s += `<text x="${x(h * 60)}" y="${H - 6}" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}">${pad2(h % 24)}:00</text>`;
  s += `<line class="xh" y1="${mt}" y2="${mt + ih}" stroke="var(--muted)" visibility="hidden"/><circle class="xd" r="4" fill="var(--watch)" stroke="var(--panel)" stroke-width="2" visibility="hidden"/>`;
  s += `<rect class="ov" x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  el.innerHTML = s;
  const svg = el.querySelector('svg'), ov = el.querySelector('.ov'), xh = el.querySelector('.xh'), dot = el.querySelector('.xd');
  const move = e => {
    const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * W / r.width;
    const k = clamp(Math.floor((px - ml) / iw * 288), 0, 287); const v = o.hr[k], m = k * 5 + 2.5;
    xh.setAttribute('x1', x(m)); xh.setAttribute('x2', x(m)); xh.setAttribute('visibility', 'visible');
    if (v != null) { dot.setAttribute('cx', x(m)); dot.setAttribute('cy', y(v)); dot.setAttribute('visibility', 'visible'); } else dot.setAttribute('visibility', 'hidden');
    const rows = [{ v: v == null ? 'no reading' : v + ' bpm', k: v ? Math.round(v / o.hrMax * 100) + '% of max' : '', color: 'var(--watch)' }];
    const act = (o.acts || []).find(b => m >= b.s && m <= b.e); if (act) rows.push({ v: act.label, k: 'activity', color: 'var(--strain)' });
    if ((o.sleeps || []).some(b => m >= b.s && m <= b.e)) rows.push({ v: 'Asleep', color: 'var(--sleep)' });
    showTip(e, fmtClock(k * 5, true) + '–' + fmtClock(k * 5 + 5, true), rows);
  };
  ov.addEventListener('pointermove', move); ov.addEventListener('pointerenter', move);
  ov.addEventListener('pointerleave', () => { hideTip(); xh.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
}

const STAGES = [ // display rows top→bottom
  { code: 0, name: 'Awake', color: 'var(--st-awake)' },
  { code: 1, name: 'REM', color: 'var(--st-rem)' },
  { code: 2, name: 'Light', color: 'var(--st-core)' },
  { code: 3, name: 'Deep', color: 'var(--st-deep)' },
];
function stageRow(code) { return code === 0 ? 0 : code === 1 ? 1 : code === 3 ? 3 : 2; }
function hypnogram(el, sl) {
  const segs = sl.segs || []; if (!segs.length) { el.innerHTML = '<p class="muted">No sleep stages recorded for this night.</p>'; return; }
  const W = chartWidth(el), H = 176, ml = 52, mr = 10, mt = 6, mb = 22;
  const iw = W - ml - mr, ih = H - mt - mb, rh = ih / 4;
  const total = segs[segs.length - 1][0] + segs[segs.length - 1][1];
  const x = m => ml + m / total * iw;
  const startMin = minOfDayLms(sl.ls);
  let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Sleep stages through the night">`;
  STAGES.forEach((st, r) => { s += `<line x1="${ml}" x2="${W - mr}" y1="${mt + rh * r + rh / 2}" y2="${mt + rh * r + rh / 2}" stroke="var(--grid)"/><text x="${ml - 8}" y="${mt + rh * r + rh / 2 + 3.5}" text-anchor="end">${st.name}</text>`; });
  let prev = null;
  segs.forEach(([off, dur, code], i) => {
    const r = stageRow(code), yc = mt + rh * r + rh / 2;
    if (prev != null && prev !== r) s += `<line x1="${x(off)}" x2="${x(off)}" y1="${mt + rh * prev + rh / 2}" y2="${yc}" stroke="var(--line)" stroke-width="1"/>`;
    s += `<rect class="sg" data-i="${i}" x="${x(off)}" y="${yc - rh * 0.3}" width="${Math.max(1.5, x(off + dur) - x(off))}" height="${rh * 0.6}" rx="2" fill="${STAGES[r].color}"/>`;
    prev = r;
  });
  const firstHour = Math.ceil(startMin / 60) * 60;
  const step = total > 600 ? 120 : 60;
  for (let t = firstHour - startMin; t < total; t += step) s += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${fmtClock(startMin + t, true)}</text>`;
  s += `<rect class="ov" x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  el.innerHTML = s;
  const svg = el.querySelector('svg'), ov = el.querySelector('.ov');
  const move = e => {
    const r = svg.getBoundingClientRect(); const m = ((e.clientX - r.left) * W / r.width - ml) / iw * total;
    const sg = segs.find(g => m >= g[0] && m <= g[0] + g[1]); if (!sg) return hideTip();
    const st = STAGES[stageRow(sg[2])];
    showTip(e, fmtClock(startMin + sg[0], true) + '–' + fmtClock(startMin + sg[0] + sg[1], true), [{ v: st.name, k: fmtDurLong(sg[1]), color: st.color }]);
  };
  ov.addEventListener('pointermove', move); ov.addEventListener('pointerenter', move); ov.addEventListener('pointerleave', hideTip);
}

// Bedtime → wake-up bars per night on a clock axis (18:00 → 14:00)
function sleepWindowChart(el, nights) {
  const W = chartWidth(el), H = 190, ml = 44, mr = 8, mt = 8, mb = 22;
  const iw = W - ml - mr, ih = H - mt - mb, n = nights.length || 1;
  const T0 = 18 * 60, span = 20 * 60;
  const pos = m => { let x = m - T0; if (x < 0) x += 1440; return x; };
  const y = m => mt + pos(m) / span * ih;
  const band = iw / n, bw = Math.max(3, Math.min(18, band * 0.55));
  let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Bedtime and wake-up times">`;
  for (const h of [20, 22, 0, 2, 4, 6, 8, 10, 12]) { const yy = y(h * 60); s += `<line x1="${ml}" x2="${W - mr}" y1="${yy}" y2="${yy}" stroke="var(--grid)"/><text x="${ml - 6}" y="${yy + 3.5}" text-anchor="end">${pad2(h)}:00</text>`; }
  nights.forEach((x, i) => {
    if (!x.sleep) return;
    const b = minOfDayLms(x.sleep.ls), e = minOfDayLms(x.sleep.le);
    const y0 = y(b), y1 = Math.max(y0 + 2, y0 + (pos(e) - pos(b) + (pos(e) < pos(b) ? 1440 : 0)) / span * ih);
    s += `<rect x="${ml + band * i + (band - bw) / 2}" y="${y0}" width="${bw}" height="${Math.min(mt + ih, y1) - y0}" rx="3" fill="var(--sleep)"/>`;
  });
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 58))));
  nights.forEach((x, i) => { if ((n - 1 - i) % every === 0) s += `<text x="${ml + band * i + band / 2}" y="${H - 6}" text-anchor="middle">${esc(fmtDayShort(x.date))}</text>`; });
  nights.forEach((x, i) => { s += `<rect class="hit" data-i="${i}" x="${ml + band * i}" y="${mt}" width="${band}" height="${ih}" fill="transparent"/>`; });
  el.innerHTML = s + '</svg>';
  bindHits(el, '.hit', (r, e) => { const x = nights[+r.dataset.i]; r.setAttribute('fill', 'var(--wash)'); showTip(e, fmtDay(x.date), x.sleep ? [{ v: fmtClock(x.sleep.ls) + ' → ' + fmtClock(x.sleep.le), k: 'in bed', color: 'var(--sleep)' }, { v: fmtHM(x.sleepMin) + ' h', k: 'asleep' }] : [{ v: x.sleepMin != null ? fmtHM(x.sleepMin) + ' h asleep (no times)' : 'No sleep recorded' }]); });
}
