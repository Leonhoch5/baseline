// Strava's REST API for the standalone: OAuth tokens (kept in a private blob, never sent to the browser),
// token refresh, API calls, and the push-subscription (webhook) administration.
// Env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (from https://www.strava.com/settings/api), STRAVA_VERIFY_TOKEN (any random string),
// optional STRAVA_API_BASE (tests).
import crypto from 'node:crypto';
import { get, put, del } from '@vercel/blob';

const BASE = (process.env.STRAVA_API_BASE || 'https://www.strava.com').replace(/\/$/, '');
const AUTH_PATH = (process.env.BLOB_PREFIX || 'baseline').replace(/\/+$/, '') + '/strava/auth.json';
export const SCOPE = 'read,activity:read_all,profile:read_all';

export function configured() { return !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET); }
export function missingSettings() {
  const m = [];
  if (!process.env.STRAVA_CLIENT_ID) m.push('STRAVA_CLIENT_ID');
  if (!process.env.STRAVA_CLIENT_SECRET) m.push('STRAVA_CLIENT_SECRET');
  if ((process.env.STRAVA_VERIFY_TOKEN || '').length < 8) m.push('STRAVA_VERIFY_TOKEN');
  return m;
}
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

async function readStream(stream) { const chunks = []; const r = stream.getReader(); for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(Buffer.from(value)); } return Buffer.concat(chunks).toString('utf8'); }
export async function loadAuth() {
  const r = await get(AUTH_PATH, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  try { return JSON.parse(await readStream(r.stream)); } catch (e) { return null; }
}
export async function saveAuth(a) { await put(AUTH_PATH, JSON.stringify(a), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' }); }
export async function clearAuth() { try { await del(AUTH_PATH); } catch (e) { /* missing is fine */ } }

// a signed, short-lived state for the OAuth round trip (the login session starts it, the callback checks it)
export function signState() {
  const s = process.env.SESSION_SECRET || ''; if (s.length < 16) throw err(503, 'not_configured', 'SESSION_SECRET is not set');
  const t = Date.now().toString(36), sig = crypto.createHmac('sha256', s).update('strava-state:' + t).digest('hex').slice(0, 24);
  return t + '.' + sig;
}
export function verifyState(state) {
  const s = process.env.SESSION_SECRET || ''; const [t, sig] = String(state || '').split('.');
  if (!t || !sig || s.length < 16) return false;
  const want = crypto.createHmac('sha256', s).update('strava-state:' + t).digest('hex').slice(0, 24);
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Date.now() - parseInt(t, 36) < 15 * 60 * 1000;
}

async function tokenCall(body) {
  const r = await fetch(BASE + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, ...body }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw err(502, r.status === 400 || r.status === 401 ? 'strava_auth' : 'strava', 'Strava token request failed (' + r.status + '): ' + JSON.stringify(j).slice(0, 200));
  return j;
}
export function authorizeUrl(redirectUri) {
  const q = new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', approval_prompt: 'auto', scope: SCOPE, state: signState() });
  return BASE + '/oauth/authorize?' + q.toString();
}
export async function exchangeCode(code, scope) {
  const j = await tokenCall({ code, grant_type: 'authorization_code' });
  const athlete = j.athlete ? { id: j.athlete.id, name: [j.athlete.firstname, j.athlete.lastname].filter(Boolean).join(' '), username: j.athlete.username || null } : null;
  const auth = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, scope: scope || null, athlete, connectedAt: new Date().toISOString() };
  await saveAuth(auth);
  return auth;
}
// a valid access token, refreshed when it expires within a minute
export async function accessToken() {
  const a = await loadAuth();
  if (!a || !a.refresh_token) throw err(401, 'strava_not_connected', 'Strava is not connected');
  if (a.access_token && a.expires_at && a.expires_at * 1000 - Date.now() > 60 * 1000) return a.access_token;
  const j = await tokenCall({ grant_type: 'refresh_token', refresh_token: a.refresh_token });
  await saveAuth({ ...a, access_token: j.access_token, refresh_token: j.refresh_token || a.refresh_token, expires_at: j.expires_at });
  return j.access_token;
}
// GET https://www.strava.com/api/v3/<path>
export async function api(path, params) {
  const token = await accessToken();
  const u = new URL(BASE + '/api/v3' + path); for (const k in params || {}) if (params[k] != null) u.searchParams.set(k, params[k]);
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
  if (r.status === 429) throw err(429, 'rate_limited', 'Strava is limiting requests right now (' + (r.headers.get('x-ratelimit-usage') || '') + ' of ' + (r.headers.get('x-ratelimit-limit') || '') + ')');
  if (r.status === 401) throw err(401, 'strava_auth', 'Strava rejected the access token; connect Strava again');
  if (r.status === 404) return null;
  if (!r.ok) throw err(502, 'strava', 'Strava answered ' + r.status + ' for ' + path);
  return r.json();
}
export async function deauthorize() {
  const a = await loadAuth(); if (!a) return;
  try { await fetch(BASE + '/oauth/deauthorize', { method: 'POST', headers: { Authorization: 'Bearer ' + (await accessToken()) }, signal: AbortSignal.timeout(15000) }); } catch (e) { /* best effort */ }
  await clearAuth();
}

// ---- push subscriptions (webhook): one per API application ----
function appParams() { return { client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET }; }
export async function listSubscriptions() {
  const u = new URL(BASE + '/api/v3/push_subscriptions'); const p = appParams(); u.searchParams.set('client_id', p.client_id); u.searchParams.set('client_secret', p.client_secret);
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw err(502, 'strava', 'Could not list Strava subscriptions (' + r.status + ')');
  return r.json();
}
export async function createSubscription(callbackUrl) {
  const body = new URLSearchParams({ ...appParams(), callback_url: callbackUrl, verify_token: process.env.STRAVA_VERIFY_TOKEN });
  const r = await fetch(BASE + '/api/v3/push_subscriptions', { method: 'POST', body, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw err(502, 'strava', 'Strava refused the subscription (' + r.status + '): ' + JSON.stringify(j).slice(0, 300));
  return j;
}
export async function deleteSubscription(id) {
  const u = new URL(BASE + '/api/v3/push_subscriptions/' + id); const p = appParams(); u.searchParams.set('client_id', p.client_id); u.searchParams.set('client_secret', p.client_secret);
  const r = await fetch(u, { method: 'DELETE', signal: AbortSignal.timeout(15000) }); if (!r.ok && r.status !== 404) throw err(502, 'strava', 'Could not delete the subscription (' + r.status + ')');
}
export function verifyTokenOk(given) {
  const want = process.env.STRAVA_VERIFY_TOKEN || ''; if (want.length < 8 || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want); return a.length === b.length && crypto.timingSafeEqual(a, b);
}
