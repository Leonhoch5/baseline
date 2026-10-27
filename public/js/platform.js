// ---------- platform: storage + login on Vercel, exposed with the same interface the app used inside Claude ----------
// Data lives in a private Vercel Blob store behind /api/db; the app signs in once with the app password
// and keeps the session token in this browser (localStorage). No third-party accounts.
(function () {
  const TOKEN_KEY = 'baseline.session';
  const DEFAULT_COLLS = ['apple', 'strava', 'journal', 'planSessions', 'planWeeks', 'plans', 'plan', 'settings', 'meta', 'preds', 'coach'];
  const cache = {}, listeners = {}; let token = null, loadingAll = null, lastLoad = 0, authReady;

  try { token = localStorage.getItem(TOKEN_KEY) || null; } catch (e) { token = null; }
  const colls = () => (typeof COLLS !== 'undefined' && Array.isArray(COLLS) ? COLLS : DEFAULT_COLLS);
  function snap(coll) { const m = cache[coll] || new Map(); return { docs: [...m].map(([id, data]) => ({ id, exists: true, data: () => data })), metadata: { fromCache: false, hasPendingWrites: false } }; }
  function notify(coll) { for (const fn of listeners[coll] || []) { try { fn(snap(coll)); } catch (e) { console.error(e); } } }

  async function api(path, opts) {
    opts = opts || {};
    const headers = { ...(opts.headers || {}) }; if (token) headers.Authorization = 'Bearer ' + token;
    let r;
    try { r = await fetch(path, { ...opts, headers }); }
    catch (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled', message: 'stopped' }; throw { code: 'unavailable', message: (e && e.message) || 'network error' }; }
    const j = await r.json().catch(() => null);
    if (r.status === 401 && !path.startsWith('/api/login')) { forget(); loginScreen('Please sign in again.'); throw { code: 'unauthenticated', message: 'signed out' }; }
    if (!r.ok) { const err = (j && j.error) || {}; throw { code: err.code || (r.status === 413 ? 'prompt_too_large' : r.status === 429 ? 'rate_limited' : 'unavailable'), message: err.message || ('HTTP ' + r.status), retryAfter: err.retryAfter, status: r.status }; }
    return j;
  }
  function forget() { token = null; try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }

  // one request loads every collection; later loads only tell the app about collections that changed
  async function loadAll() {
    const j = await api('/api/db?colls=' + encodeURIComponent(colls().join(',')));
    const changed = [];
    for (const coll of Object.keys(j.colls || {})) {
      const m = new Map(Object.entries(j.colls[coll] || {}));
      const before = cache[coll];
      const same = before && before.size === m.size && [...m].every(([id, d]) => before.has(id) && JSON.stringify(before.get(id)) === JSON.stringify(d));
      cache[coll] = m; if (!same) changed.push(coll);
    }
    lastLoad = Date.now();
    return changed;
  }
  function ensureLoaded() { return loadingAll || (loadingAll = loadAll().catch(e => { loadingAll = null; throw e; })); }
  // the iPhone sync writes on the server, so a tab that comes back after a while refreshes itself
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !token || !loadingAll || Date.now() - lastLoad < 5 * 60 * 1000) return;
    try { (await loadAll()).forEach(notify); } catch (e) { console.warn('refresh failed', e); }
  });

  const db = Object.freeze({
    collection(coll) {
      return {
        onSnapshot(fn, onErr) {
          (listeners[coll] = listeners[coll] || []).push(fn);
          ensureLoaded().then(() => fn(snap(coll)), e => onErr && onErr(e));
          return () => { listeners[coll] = (listeners[coll] || []).filter(f => f !== fn); };
        },
      };
    },
    // several documents in one request (restore from a backup)
    async batch(writes) {
      await api('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'batch', writes }) });
      const touched = new Set();
      for (const w of writes) { const m = cache[w.coll] = cache[w.coll] || new Map(); if (w.data == null) m.delete(w.id); else m.set(w.id, w.data); touched.add(w.coll); }
      touched.forEach(notify);
    },
    doc(path) {
      const [coll, id] = path.split('/');
      return {
        async set(data) {
          await api('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'set', coll, id, data }) });
          (cache[coll] = cache[coll] || new Map()).set(id, data); notify(coll);
        },
        async delete() {
          await api('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'delete', coll, id }) });
          if (cache[coll]) cache[coll].delete(id); notify(coll);
        },
      };
    },
  });

  let resolveLogin = null;
  function loginScreen(message) {
    let el = document.getElementById('login');
    if (!el) { el = document.createElement('div'); el.id = 'login'; document.body.appendChild(el); }
    el.innerHTML = `<div class="login-card"><div class="brand"><b>Baseline</b></div>
      <p class="sub">Your training data, on your own Vercel. Enter the app password.</p>
      <form id="loginForm"><input type="password" id="loginPw" required placeholder="App password" autocomplete="current-password" autofocus><button class="btn primary" type="submit">Sign in</button></form>
      <p class="muted" id="loginMsg">${message || ''}</p></div>`;
    const msg = el.querySelector('#loginMsg');
    fetch('/api/login').then(r => r.json()).then(j => { if (j && j.ready === false) msg.textContent = 'Not set up yet. Missing in Vercel: ' + (j.problems || []).join(', ') + '.'; }).catch(() => {});
    el.querySelector('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pw = el.querySelector('#loginPw').value; msg.textContent = 'Signing in…';
      try {
        const j = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
        token = j.token; try { localStorage.setItem(TOKEN_KEY, token); } catch (e2) { /* private mode: the session lasts for this tab */ }
        el.remove(); if (resolveLogin) { resolveLogin(); resolveLogin = null; }
      } catch (err) { msg.textContent = err.code === 'wrong_password' ? 'Wrong password.' : (err.message || 'Could not sign in.'); }
    });
    return new Promise(res => { resolveLogin = res; });
  }

  authReady = (async () => {
    if (!token) await loginScreen();
    else {
      // a stale token (SESSION_SECRET changed) shows the login instead of a broken page
      try { await ensureLoaded(); } catch (e) { if (e && e.code === 'unauthenticated') await loginScreen('Signed out. Please sign in again.'); else throw e; }
    }
    return { id: 'owner' };
  })();

  const userApi = Object.freeze({ isOwner: async () => true, canEdit: async () => true, can: async () => true, id: async () => 'owner', me: async () => ({ id: 'owner', name: '', email: '' }) });

  // ---- AI: the same `sample` interface the app used inside Claude, answered by Hack Club AI through /api/ai ----
  window.BASELINE_AI = { name: 'Hack Club AI' };
  const AI_IMG = { maxCount: 4, maxEdge: 1600, maxBytes: 1.5 * 1024 * 1024 };
  async function blobToDataUrl(blob) {
    // screenshots are downscaled to ≤ 1600 px JPEG so four of them fit in one request
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (!bmp) return null;
    const k = Math.min(1, AI_IMG.maxEdge / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
    let q = 0.85, url = c.toDataURL('image/jpeg', q);
    while (url.length > AI_IMG.maxBytes * 1.37 && q > 0.4) { q -= 0.15; url = c.toDataURL('image/jpeg', q); }
    return url;
  }
  async function aiCall(input, opts) {
    opts = opts || {};
    await authReady;
    if (!token) throw { code: 'ai_auth', message: 'not signed in' };
    const images = [];
    for (const b of opts.images || []) { const u = await blobToDataUrl(b); if (!u) throw { code: 'image_rejected', message: 'image could not be read' }; images.push(u); }
    const body = { input, images, json: !!opts.json, model: opts.model || undefined, maxTokens: opts.maxTokens || undefined };
    const j = await api('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: opts.signal });
    if (opts.onText && j.text) opts.onText({ text: j.text, delta: j.text });
    return j;
  }
  const sample = Object.freeze(Object.assign(async (input, opts) => { const r = await aiCall(input, opts); return { text: r.text || '', truncated: r.finish === 'length', modelApplied: r.model }; }, {
    json: async (input, opts) => { const r = await aiCall(input, { ...(opts || {}), json: true }); if (r.json == null) throw { code: 'invalid_json', message: 'no JSON in the answer', text: r.text }; return r.json; },
    limits: async () => ({ images: { maxCount: AI_IMG.maxCount, maxBytes: AI_IMG.maxBytes, types: ['image/jpeg', 'image/png', 'image/webp'] } }),
  }));

  window.claude = Object.freeze({
    use: async name => {
      if (name === 'db') { await authReady; return db; }
      if (name === 'user') { await authReady; return userApi; }
      if (name === 'sample') { await authReady; return sample; }
      return null; // Strava and iPhone sync move to the server
    },
  });
  window.signOut = async () => { forget(); location.reload(); };
})();
