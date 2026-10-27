// ---------- adding training plans: calendar, spreadsheet, document, text or screenshots ----------
const DOW = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6, mo: 0, di: 1, mi: 2, do: 3, fr: 4, sa: 5, so: 6 };
function mondayOfDate(d) { return addDays(d, -((parseYmd(d).getDay() + 6) % 7)); }
function dowIndex(x) { if (typeof x === 'number') return clamp(Math.round(x) - 1, 0, 6); const k = String(x || '').trim().toLowerCase().slice(0, 3); return DOW[k] ?? DOW[k.slice(0, 2)] ?? null; }
const PLAN_INT = ['rest', 'recovery', 'easy', 'moderate', 'hard', 'key', 'test', 'race'];
function guessIntensity(t) {
  t = String(t || '').toLowerCase();
  if (/race|wettkampf|rennen/.test(t)) return 'race';
  if (/\btest\b|time trial|\btt\b|retest/.test(t)) return 'key';
  if (/rest|ruhetag|pause|off\b/.test(t)) return 'rest';
  if (/interval|threshold|tempo|hard|vo2|sprint|schwelle|intervall/.test(t)) return 'hard';
  if (/easy|recovery|locker|regener|zone 2|z2/.test(t)) return 'easy';
  return 'moderate';
}
function guessMinutes(t) {
  const s = String(t || '');
  let m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:–|-|to|bis)\s*(\d+(?:[.,]\d+)?)\s*(min|h|std)/i);
  if (m) { const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[2].replace(',', '.')); const v = (a + b) / 2; return Math.round(/h|std/i.test(m[3]) ? v * 60 : v); }
  m = s.match(/(\d+(?:[.,]\d+)?)\s*(min|h|std)/i);
  if (m) { const v = parseFloat(m[1].replace(',', '.')); return Math.round(/h|std/i.test(m[2]) ? v * 60 : v); }
  return null;
}
function cleanSession(x) {
  const s = {
    sport: String(x.sport || sportOf(x.title || '')).toLowerCase().slice(0, 20), title: String(x.title || '').trim().slice(0, 90) || 'Session',
    durationMin: x.durationMin != null && isFinite(+x.durationMin) ? Math.round(+x.durationMin) : null,
    intensity: PLAN_INT.includes(String(x.intensity || '').toLowerCase()) ? String(x.intensity).toLowerCase() : guessIntensity((x.title || '') + ' ' + (x.details || '')),
    details: x.details ? String(x.details).trim().slice(0, 300) : null, target: x.target ? String(x.target).slice(0, 40) : null,
    distance: x.distance ? String(x.distance).slice(0, 30) : null, optional: x.optional ? true : null, note: x.note ? String(x.note).slice(0, 160) : null,
  };
  if (s.sport === 'rest' || sportOf(s.sport) === 'rest') { s.sport = 'rest'; s.intensity = 'rest'; s.durationMin = null; }
  for (const k in s) if (s[k] == null) delete s[k];
  return s;
}

// spec → dated weeks. Week 1 is the week containing `start`; sessions before `start` are dropped.
function expandPlanSpec(spec, start) {
  const mon = mondayOfDate(start);
  const shift = spec.startDate ? daysBetween(mondayOfDate(spec.startDate), mon) : 0;
  const weeks = {};
  const add = (w, date, sess, phase) => {
    if (date < start) return;
    const wk = weeks[w] || (weeks[w] = { week: w, phase: phase || null, sessions: [] });
    if (phase && !wk.phase) wk.phase = phase;
    wk.sessions.push({ ...cleanSession(sess), date });
  };
  const phases = Array.isArray(spec.phases) ? spec.phases : [];
  let total = +spec.weeksTotal || 0;
  for (const p of phases) {
    const a = Math.max(1, +p.fromWeek || 1), b = Math.max(a, +p.toWeek || a);
    total = Math.max(total, b);
    const deload = new Set((p.deloadWeeks || []).map(Number));
    for (let w = a; w <= b; w++) {
      const wk = weeks[w] || (weeks[w] = { week: w, phase: p.name || null, sessions: [] });
      wk.phase = p.name || wk.phase; wk.focus = p.focus ? String(p.focus).slice(0, 240) : wk.focus;
      if (deload.has(w)) { wk.deload = true; wk.focus = 'Lighter week: about 70% of the usual volume. ' + (wk.focus || ''); }
      for (const t of p.template || []) {
        const di = dowIndex(t.day); if (di == null) continue;
        const s = { ...t };
        if (deload.has(w) && s.durationMin) s.durationMin = Math.round(s.durationMin * 0.7);
        add(w, addDays(mon, (w - 1) * 7 + di), s, p.name);
      }
    }
  }
  for (const e of spec.extras || []) {
    let date, w;
    if (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) { date = addDays(e.date, shift); w = Math.floor(daysBetween(mon, date) / 7) + 1; }
    else { const di = dowIndex(e.day); if (di == null || !(+e.week >= 1)) continue; w = +e.week; date = addDays(mon, (w - 1) * 7 + di); }
    if (w < 1) continue;
    total = Math.max(total, w);
    if (e.replace !== false && weeks[w]) weeks[w].sessions = weeks[w].sessions.filter(s => !(s.date === date && (e.replace === 'day' || sportsCompatible(sportOf(s.sport), sportOf(e.sport || e.title)))));
    add(w, date, e, e.phase);
  }
  const out = Object.values(weeks).filter(w => w.sessions.length).sort((a, b) => a.week - b.week);
  for (const w of out) {
    w.sessions.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const per = {}; w.sessions.forEach(s => { per[s.date] = (per[s.date] || 0) + 1; s.order = per[s.date]; });
    w.start = addDays(mon, (w.week - 1) * 7); w.end = addDays(w.start, 6);
    if (w.start < start) w.start = start;
  }
  const end = out.length ? out[out.length - 1].sessions.slice(-1)[0].date : start;
  const meta = { name: String(spec.name || 'Training plan').slice(0, 80), goal: spec.goal ? String(spec.goal).slice(0, 240) : null, startDate: start, endDate: end,
    raceDate: spec.raceDate ? addDays(spec.raceDate, shift) : null, raceName: spec.raceName || null, paces: Array.isArray(spec.paces) ? spec.paces.slice(0, 8).map(r => [String(r[0] || ''), String(r[1] || ''), String(r[2] || '')]) : null,
    paceNote: spec.paceNote || null, notes: spec.notes ? String(spec.notes).slice(0, 400) : null, source: spec.source || null };
  for (const k in meta) if (meta[k] == null) delete meta[k];
  return { meta, weeks: out, sessions: out.reduce((a, w) => a + w.sessions.length, 0) };
}

// Calendar (.ics) → spec with dated extras
function icsToSpec(text, name) {
  const t = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const evs = [];
  for (const blk of t.split('BEGIN:VEVENT').slice(1)) {
    const get = k => { const m = blk.match(new RegExp('\\n' + k + '(?:;[^:\\n]*)?:([^\\n]*)')); return m ? m[1].replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\;/g, ';').trim() : ''; };
    const ds = get('DTSTART'); if (!/^\d{8}/.test(ds)) continue;
    const date = ds.slice(0, 4) + '-' + ds.slice(4, 6) + '-' + ds.slice(6, 8);
    let summary = get('SUMMARY'), desc = get('DESCRIPTION');
    const ph = summary.match(/^\[(?:wk\s*\d+\s*-\s*)?([^\]]+)\]\s*/i); let phase = null;
    if (ph) { phase = ph[1].trim(); summary = summary.slice(ph[0].length); }
    let dur = guessMinutes(desc) || guessMinutes(summary);
    const de = get('DTEND');
    if (!dur && /T\d{4}/.test(ds) && /T\d{4}/.test(de)) dur = Math.round((lmsOf(de.slice(0, 4) + '-' + de.slice(4, 6) + '-' + de.slice(6, 8) + 'T' + de.slice(9, 11) + ':' + de.slice(11, 13)) - lmsOf(date + 'T' + ds.slice(9, 11) + ':' + ds.slice(11, 13))) / 60000);
    evs.push({ date, title: summary, details: desc, sport: sportOf(summary + ' ' + desc), durationMin: dur, intensity: guessIntensity(summary + ' ' + desc), phase, replace: false });
  }
  if (!evs.length) throw new Error('No events found in this calendar file.');
  evs.sort((a, b) => a.date < b.date ? -1 : 1);
  return { name: name || 'Imported calendar plan', startDate: mondayOfDate(evs[0].date), firstDate: evs[0].date, extras: evs, source: 'calendar file' };
}
// Spreadsheet (.csv): date, sport, title, duration, intensity, details (header names flexible)
function csvToSpec(text, name) {
  const rows = parseCSV(text.replace(/^﻿/, '')).filter(r => r.some(c => c.trim()));
  if (rows.length < 2) throw new Error('The CSV file is empty.');
  const sep = rows[0].length === 1 && rows[0][0].includes(';');
  const R = sep ? rows.map(r => r.join(',').split(';')) : rows;
  const h = R[0].map(x => x.trim().toLowerCase());
  const col = (...names) => h.findIndex(x => names.some(n => x.includes(n)));
  const c = { date: col('date', 'datum', 'tag'), sport: col('sport', 'type', 'art'), title: col('title', 'session', 'workout', 'einheit', 'name'), dur: col('dur', 'min', 'dauer', 'zeit'), int: col('intens', 'effort', 'intensität'), det: col('detail', 'description', 'beschreibung', 'notes', 'notiz') };
  if (c.date < 0) throw new Error('The CSV needs a date column (YYYY-MM-DD or DD.MM.YYYY).');
  const ex = [];
  for (const r of R.slice(1)) {
    let d = (r[c.date] || '').trim(), m;
    if ((m = d.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/))) d = (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue; d = d.slice(0, 10);
    const title = (c.title >= 0 ? r[c.title] : '') || (c.sport >= 0 ? r[c.sport] : '') || 'Session';
    const det = c.det >= 0 ? r[c.det] : '';
    ex.push({ date: d, title, details: det, sport: sportOf((c.sport >= 0 ? r[c.sport] : '') + ' ' + title), durationMin: c.dur >= 0 ? (parseFloat(String(r[c.dur]).replace(',', '.')) || guessMinutes(r[c.dur])) : guessMinutes(det), intensity: c.int >= 0 ? (PLAN_INT.includes(String(r[c.int]).toLowerCase().trim()) ? String(r[c.int]).toLowerCase().trim() : guessIntensity(r[c.int])) : guessIntensity(title + ' ' + det), replace: false });
  }
  if (!ex.length) throw new Error('No rows with a readable date in this CSV.');
  ex.sort((a, b) => a.date < b.date ? -1 : 1);
  return { name: name || 'Imported spreadsheet plan', startDate: mondayOfDate(ex[0].date), firstDate: ex[0].date, extras: ex, source: 'spreadsheet' };
}
async function docxToText(file) {
  const entries = await zipEntries(file);
  const e = entries.find(x => x.name === 'word/document.xml'); if (!e) throw new Error('This Word file has no readable text.');
  const xml = await zipEntryText(file, e);
  return decodeXml(xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:tc>/g, ' | ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}

function planPrompt(text, start, today, hasImages) {
  return `You convert a training plan into JSON for a training app. Reply with ONLY one JSON object, no prose.

Today is ${today}. The athlete wants this plan to start in the week of ${start} (week 1 = that week, Monday to Sunday).

Schema:
{
  "name": "short plan name",
  "goal": "one sentence goal, or null",
  "raceDate": "YYYY-MM-DD or null",  "raceName": "string or null",
  "startDate": "YYYY-MM-DD Monday of week 1 ONLY if the plan itself gives real calendar dates, else null",
  "weeksTotal": number,
  "phases": [ { "name": "phase name", "fromWeek": 1, "toWeek": 4, "focus": "one sentence", "deloadWeeks": [4],
      "template": [ { "day": "Mon", "sport": "swim|run|ride|strength|mobility|walk|hike|row|hiit|rest|other", "title": "short title",
                      "durationMin": 45, "intensity": "rest|easy|moderate|hard|key|race", "details": "the set or workout, max 200 chars",
                      "target": "pace/zone target or null", "distance": "e.g. 2000 m or null", "optional": false } ] } ],
  "extras": [ { "week": 8, "day": "Fri", ...same session fields..., "replace": true } ],
  "paces": [ ["zone name", "pace or HR range", "what it is for"] ],
  "notes": "anything important the schema can't hold, max 300 chars"
}

Rules:
- A phase's "template" is its typical week; it repeats every week from fromWeek to toWeek. Use one template entry per session (two sessions on one day = two entries).
- Use "extras" for one-off sessions that differ from the template (tests, races, special workouts). With replace=true it replaces the template session of the same sport that day. If the plan gives exact dates, extras may use "date": "YYYY-MM-DD" instead of week/day.
- durationMin: a single number of minutes; for ranges use the middle. Strength ~45 if not stated.
- intensity "key" = tests and the most important session of the week.
- Keep the athlete's language for titles and details. Do not invent sessions the plan doesn't contain.
${hasImages ? '- The plan is in the attached image(s). Read all of them.\n' : ''}
${text ? 'The plan:\n"""\n' + text.slice(0, 200000) + '\n"""' : ''}`;
}
async function claudeSpec(text, images, start) {
  const sample = window.claude && window.claude.use ? await window.claude.use('sample') : null;
  if (!sample) throw { code: 'unavailable' };
  const opts = { modelTier: 'complex', cache: false };
  if (images && images.length) opts.images = images;
  const spec = await sample.json(planPrompt(text, start, todayYmd(), !!(images && images.length)), opts);
  if (!spec || typeof spec !== 'object' || (!Array.isArray(spec.phases) && !Array.isArray(spec.extras))) throw { code: 'invalid_json' };
  spec.source = images && images.length ? 'screenshots, converted by ' + aiName() : 'text, converted by ' + aiName();
  return spec;
}
function sampleErrorText(e) {
  const c = e && e.code, ai = aiName();
  return {
    unavailable: ai === 'Claude' ? 'Converting with Claude only works with this page open inside Claude. You can still import a calendar (.ics) or spreadsheet (.csv).' : `${ai} isn’t reachable right now. Check the connection and try again, or import a calendar (.ics) or spreadsheet (.csv).`,
    not_granted: `${ai} wasn’t allowed to run for this page. Allow it when asked and try again.`,
    sampling_disabled: `Asking ${ai} from pages is turned off for your account.`,
    prompt_too_large: 'The plan is too long to convert in one go. Split it into two parts and add them as separate plans.',
    rate_limited: `${ai} is busy. Wait a minute and try again.`,
    ai_budget: `${ai}’s daily budget is used up. It resets at midnight UTC.`,
    ai_key: `${ai} isn’t set up on the server: the API key is missing or invalid (HACKCLUB_AI_KEY).`,
    ai_auth: 'You need to be signed in to use the converter.',
    invalid_json: `${ai}’s answer couldn’t be read as a plan. Try again, or paste the plan as text.`,
    images_unavailable: 'Images can’t be sent from this view. Paste the plan as text instead.',
    image_rejected: 'One of the images couldn’t be used. Try a smaller screenshot (JPEG or PNG).',
    refused: `${ai} declined to convert this. Paste the plan as plain text and try again.`,
    cancelled: 'Stopped.',
  }[c] || ('Conversion failed' + (e && e.message ? ': ' + e.message : '.'));
}
