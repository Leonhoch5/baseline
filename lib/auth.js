// Who may talk to the API. One person uses this app, so login is one password (env APP_PASSWORD).
// A successful login hands the browser a session token derived from SESSION_SECRET; the token stays valid
// until SESSION_SECRET changes (change it in Vercel to sign out everywhere). The iPhone Shortcut and the
// import script use INGEST_TOKEN instead.
import crypto from 'node:crypto';

function same(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function sessionToken() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 16) return null;
  return crypto.createHmac('sha256', s).update('baseline-session-v1').digest('hex');
}
export function passwordOk(pw) {
  const want = process.env.APP_PASSWORD || '';
  return want.length >= 8 && same(pw, want);
}
export function ingestTokenOk(given) {
  const want = process.env.INGEST_TOKEN || '';
  return want.length >= 16 && same(given, want);
}
export function bearer(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
// true for the signed-in browser (session token) or a caller with the ingest token (?token= or x-baseline-token)
export function callerOk(req) {
  const url = new URL(req.url || '/', 'http://x');
  const t = bearer(req), q = url.searchParams.get('token') || (req.headers && req.headers['x-baseline-token']) || '';
  const s = sessionToken();
  if (s && t && same(t, s)) return 'session';
  if (ingestTokenOk(t) || ingestTokenOk(q)) return 'ingest';
  return null;
}
// names of settings that are missing or too short (shown by /api/health and the login screen, never their values)
export function configProblems() {
  const out = [];
  if ((process.env.APP_PASSWORD || '').length < 8) out.push('APP_PASSWORD (at least 8 characters)');
  if ((process.env.SESSION_SECRET || '').length < 16) out.push('SESSION_SECRET (at least 16 characters)');
  if (!process.env.BLOB_READ_WRITE_TOKEN) out.push('BLOB_READ_WRITE_TOKEN (connect a Blob store to the project)');
  return out;
}
