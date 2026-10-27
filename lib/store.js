// Storage: Vercel Blob (private store), one JSON blob per collection: baseline/c/<coll>.json = { v, docs: { id: data }, updatedAt }.
// Why one blob per collection and not one per document: the Hobby plan includes 10,000 reads and 2,000 writes/lists a month,
// and one app load then costs ~11 reads instead of ~50 reads plus lists. Writes are read-modify-write with an ETag check,
// so the app and the iPhone sync can't overwrite each other.
import { put, get, del, head, BlobPreconditionFailedError } from '@vercel/blob';

const PREFIX = (process.env.BLOB_PREFIX || 'baseline').replace(/\/+$/, '') + '/c/';
// the collections the browser app reads on load (keep in step with COLLS in public/js/app.js)
export const COLLS = ['apple', 'strava', 'journal', 'planSessions', 'planWeeks', 'plans', 'plan', 'settings', 'meta', 'preds', 'coach'];
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
export function checkName(s, what) { if (!NAME.test(String(s || ''))) throw Object.assign(new Error('bad ' + what), { status: 400, code: 'bad_request' }); return s; }
const pathOf = coll => PREFIX + checkName(coll, 'collection') + '.json';

async function readStream(stream) {
  const chunks = []; const reader = stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); }
  return Buffer.concat(chunks).toString('utf8');
}
// { docs, etag } for a collection; a missing blob is an empty collection
export async function readColl(coll) {
  const r = await get(pathOf(coll), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return { docs: {}, etag: null };
  let j; try { j = JSON.parse(await readStream(r.stream)); } catch (e) { throw Object.assign(new Error('collection ' + coll + ' is not valid JSON'), { status: 500 }); }
  return { docs: (j && j.docs) || {}, etag: r.blob && r.blob.etag || null };
}
export async function readAll(colls = COLLS) {
  const out = {};
  const list = colls.map(c => checkName(c, 'collection'));
  // a few at a time: the Hobby rate limit is 20 reads a second
  for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(async c => { out[c] = (await readColl(c)).docs; }));
  return out;
}
async function writeColl(coll, docs, etag) {
  const body = JSON.stringify({ v: 1, docs, updatedAt: new Date().toISOString() });
  const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 };
  if (etag) opts.ifMatch = etag;
  return put(pathOf(coll), body, opts);
}
// apply { id: data | null } to one collection (null deletes); retried when someone else wrote in between
export async function applyColl(coll, changes) {
  for (let attempt = 0; ; attempt++) {
    const { docs, etag } = await readColl(coll);
    const next = { ...docs };
    for (const id of Object.keys(changes)) { checkName(id, 'id'); if (changes[id] === null) delete next[id]; else next[id] = changes[id]; }
    try { await writeColl(coll, next, etag); return next; }
    catch (e) { if (!(e instanceof BlobPreconditionFailedError) || attempt >= 3) throw e; await new Promise(r => setTimeout(r, 150 * (attempt + 1))); }
  }
}
export async function writeDoc(coll, id, data) { return applyColl(coll, { [id]: data }); }
export async function deleteDoc(coll, id) { return applyColl(coll, { [id]: null }); }
// [{coll, id, data|null}] grouped by collection, one write per collection
export async function writeMany(rows) {
  const by = {};
  for (const r of rows) { checkName(r.coll, 'collection'); checkName(r.id, 'id'); (by[r.coll] = by[r.coll] || {})[r.id] = r.data === undefined ? null : r.data; }
  const out = {};
  for (const coll of Object.keys(by)) out[coll] = await applyColl(coll, by[coll]);
  return out;
}
// remove a whole collection blob (used by tests and the reset script)
export async function dropColl(coll) { try { await del(pathOf(coll)); } catch (e) { /* missing is fine */ } }

// temporary diagnosis of conditional writes (large body): does get()'s ETag match what put({ifMatch}) expects?
export async function etagTest() {
  const path = PREFIX + '_etagtest.json', out = { steps: [] };
  const log = (k, v) => out.steps.push([k, v]);
  const big = JSON.stringify({ n: 1, pad: 'x'.repeat(200000) });
  try {
    const p1 = await put(path, big, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    log('put1.etag', p1.etag);
    const g = await get(path, { access: 'private', useCache: false }); log('get.etag', g && g.blob && g.blob.etag); log('get.headers', g && g.headers ? ['etag', 'content-encoding', 'content-length', 'x-vercel-cache'].map(h => h + '=' + g.headers.get(h)).join(' ') : null);
    const h = await head(path); log('head.etag', h.etag);
    try { const r = await put(path, big + ' ', { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', ifMatch: g.blob.etag }); log('ifMatch get.etag ok', r.etag); }
    catch (e) { log('ifMatch get.etag fail', `${e && e.name} / ${e && e.constructor && e.constructor.name} / instanceof=${e instanceof BlobPreconditionFailedError} / ${e && e.message}`); }
    const h2 = await head(path); log('head.after', h2.etag);
    try { const r = await put(path, big + '  ', { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', ifMatch: h2.etag }); log('ifMatch head.etag ok', r.etag); }
    catch (e) { log('ifMatch head.etag fail', `${e && e.name} / instanceof=${e instanceof BlobPreconditionFailedError} / ${e && e.message}`); }
    await del(path);
  } catch (e) { log('error', String(e && e.message)); }
  return out;
}
