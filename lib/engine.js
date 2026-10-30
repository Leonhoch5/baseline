// The app's own scoring and parsing code (public/js) loaded into a Node vm, so the server computes exactly what the browser shows.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.TZ = process.env.BASELINE_TZ || 'Europe/Berlin'; // the app works in local wall-clock time

const ENGINE_FILES = ['util.js', 'apple.js', 'shortcut.js', 'strava.js', 'model.js', 'insights.js', 'calib.js', 'recovery.js', 'tests.js', 'race.js', 'coach.js', 'planedit.js'];
let engine = null;
export function loadEngine(dir = path.join(process.cwd(), 'public', 'js')) {
  if (engine) return engine;
  const ctx = vm.createContext({ console, performance: { now: () => Date.now() }, TextDecoder, TextEncoder });
  const src = ENGINE_FILES.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  vm.runInContext(src, ctx, { filename: 'baseline-engine.js' });
  engine = ctx;
  return ctx;
}
// same shape the browser app builds from its collections (app.js initDb), from { coll: { id: data } }
export function collsToData(all) {
  const D = { apple: {}, strava: {}, journal: {}, planMeta: null, planSessions: [], planWeeks: [], plans: [], planChecks: {}, planEdits: {}, preds: {}, coach: {}, profile: {}, tests: { list: [] }, overlaps: { split: {} }, metaApple: null, metaStrava: null, metaDrive: null };
  for (const coll of Object.keys(all || {})) for (const id of Object.keys(all[coll] || {})) {
    const data = all[coll][id];
    if (coll === 'apple' || coll === 'strava' || coll === 'journal' || coll === 'preds' || coll === 'coach') D[coll][id] = data;
    else if (coll === 'planSessions' || coll === 'planWeeks') D[coll].push({ id, ...data });
    else if (coll === 'plans') D.plans.push({ ...data, id });
    else if (coll === 'plan') { if (id === 'meta') D.planMeta = data; if (id === 'checks') D.planChecks = data; if (id === 'edits') D.planEdits = data; }
    else if (coll === 'settings') { if (id === 'profile') D.profile = data; if (id === 'overlaps') D.overlaps = data; if (id === 'tests') D.tests = data; }
    else if (coll === 'meta') { if (id === 'apple') D.metaApple = data; if (id === 'strava') D.metaStrava = data; if (id === 'gdrive') D.metaDrive = data; }
  }
  return D;
}
