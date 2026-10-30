// Strava for the standalone, one function with several actions (/api/strava/<action>):
//   GET  status      (signed in)  → { configured, missing, connected, athlete, lastSync, count, webhook }
//   POST connect     (signed in)  → { url }  — open it; Strava sends the browser back to /api/strava/callback
//   GET  callback                 ← Strava, with code + state; stores the tokens and redirects to /?strava=connected
//   POST sync        (signed in or ingest token) { full?, months? } → { fetched, withHr, msg }
//   POST subscribe   (signed in)  { on: true|false } → webhook subscription on/off
//   POST disconnect  (signed in)  → tokens removed (and Strava told)
//   GET/POST webhook              ← Strava: subscription validation and activity events
// Tokens live in a private blob (baseline/strava/auth.json) and never reach the browser.
import { callerOk } from '../../lib/auth.js';
import { configured, missingSettings, authorizeUrl, verifyState, exchangeCode, loadAuth, deauthorize, listSubscriptions, createSubscription, deleteSubscription, verifyTokenOk, clearAuth } from '../../lib/strava.js';
import { syncActivities, upsertActivity, removeAct } from '../../lib/stravaSync.js';
import { readColl } from '../../lib/store.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

function baseUrl(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return (process.env.APP_URL || (proto + '://' + host)).replace(/\/$/, '');
}
function body(req) { let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } } return b && typeof b === 'object' ? b : {}; }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, obj) => res.status(status).json(obj);
  const fail = (status, code, message) => send(status, { error: { code, message } });
  const url = new URL(req.url, 'http://x');
  const action = (req.query && req.query.action) || url.pathname.split('/').filter(Boolean)[2] || '';
  try {
    // ---- Strava's own calls (no app login) ----
    if (action === 'webhook') {
      if (req.method === 'GET') {
        if (url.searchParams.get('hub.mode') === 'subscribe' && verifyTokenOk(url.searchParams.get('hub.verify_token'))) return send(200, { 'hub.challenge': url.searchParams.get('hub.challenge') });
        return fail(403, 'forbidden', 'wrong verify token');
      }
      if (req.method !== 'POST') return fail(405, 'method', 'use POST');
      const ev = body(req);
      if (ev.object_type === 'athlete') { if (ev.updates && String(ev.updates.authorized) === 'false') await clearAuth(); return send(200, { ok: true }); }
      if (ev.object_type !== 'activity' || !ev.object_id) return send(200, { ok: true, ignored: true });
      const auth = await loadAuth();
      if (!auth || !auth.athlete || String(auth.athlete.id) !== String(ev.owner_id)) return send(200, { ok: true, ignored: 'other athlete' });
      if (ev.aspect_type === 'delete') { await removeAct(ev.object_id); return send(200, { ok: true, removed: ev.object_id }); }
      const n = await upsertActivity(ev.object_id);
      return send(200, { ok: true, saved: n ? n.id : null });
    }
    if (action === 'callback') {
      if (req.method !== 'GET') return fail(405, 'method', 'use GET');
      const back = (q) => { res.statusCode = 302; res.setHeader('Location', baseUrl(req) + '/?' + q); return res.end(); };
      if (url.searchParams.get('error')) return back('strava=error&msg=' + encodeURIComponent(url.searchParams.get('error')));
      if (!verifyState(url.searchParams.get('state'))) return back('strava=error&msg=' + encodeURIComponent('The sign-in link expired. Start again from Settings.'));
      const scope = url.searchParams.get('scope') || '';
      if (!/activity:read/.test(scope)) return back('strava=error&msg=' + encodeURIComponent('Strava did not grant access to your activities. Connect again and keep "View data about your activities" ticked.'));
      await exchangeCode(url.searchParams.get('code'), scope);
      return back('strava=connected');
    }
    // ---- everything else needs the app login (sync also accepts the ingest token) ----
    const who = callerOk(req);
    if (!who) return fail(401, 'unauthenticated', 'sign in first');
    if (action === 'status') {
      const missing = missingSettings();
      const auth = await loadAuth();
      const meta = (await readColl('meta')).docs.strava || {};
      let webhook = { active: false, id: null, error: null };
      if (configured() && auth) { try { const subs = await listSubscriptions(); const mine = (subs || []).find(s => String(s.callback_url || '').startsWith(baseUrl(req))); webhook = { active: !!mine, id: mine ? mine.id : null, other: (subs || []).length - (mine ? 1 : 0) }; } catch (e) { webhook.error = e.message; } }
      return send(200, { configured: configured(), missing, connected: !!(auth && auth.refresh_token), athlete: auth ? auth.athlete : null, scope: auth ? auth.scope : null, connectedAt: auth ? auth.connectedAt : null, lastSync: meta.lastSync || null, lastEvent: meta.lastEvent || null, count: meta.count || null, webhook, callbackDomain: new URL(baseUrl(req)).host });
    }
    if (action === 'connect') {
      if (req.method !== 'POST') return fail(405, 'method', 'use POST');
      const missing = missingSettings().filter(m => m !== 'STRAVA_VERIFY_TOKEN');
      if (missing.length) return fail(503, 'not_configured', 'Missing in Vercel: ' + missing.join(', '));
      return send(200, { url: authorizeUrl(baseUrl(req) + '/api/strava/callback') });
    }
    if (action === 'sync') {
      if (req.method !== 'POST') return fail(405, 'method', 'use POST');
      const b = body(req);
      const r = await syncActivities({ full: !!b.full, months: b.months != null ? +b.months : undefined, maxStreams: who === 'ingest' ? 10 : 30 });
      return send(200, r);
    }
    if (action === 'subscribe') {
      if (req.method !== 'POST') return fail(405, 'method', 'use POST');
      if (missingSettings().length) return fail(503, 'not_configured', 'Missing in Vercel: ' + missingSettings().join(', '));
      const on = body(req).on !== false;
      const subs = await listSubscriptions();
      const mine = (subs || []).find(s => String(s.callback_url || '').startsWith(baseUrl(req)));
      if (on) { if (mine) return send(200, { active: true, id: mine.id }); for (const s of subs || []) await deleteSubscription(s.id); const r = await createSubscription(baseUrl(req) + '/api/strava/webhook'); return send(200, { active: true, id: r && r.id }); }
      if (mine) await deleteSubscription(mine.id);
      return send(200, { active: false, id: null });
    }
    if (action === 'disconnect') {
      if (req.method !== 'POST') return fail(405, 'method', 'use POST');
      await deauthorize();
      return send(200, { ok: true });
    }
    return fail(404, 'not_found', 'unknown action');
  } catch (e) {
    console.error('strava/' + action, e);
    return fail(e.status || 500, e.code || 'strava', e.message || 'failed');
  }
}
