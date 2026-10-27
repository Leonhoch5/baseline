// ---------- platform: Supabase storage + login, exposed with the same interface the app used inside Claude ----------
// Everything lives in one table, `docs` (coll, id, data jsonb), protected by row-level security so only you can read it.
(function () {
  let sb = null, user = null, authReady;
  const cache = {}, listeners = {}, loading = {};

  function snap(coll) { const m = cache[coll] || new Map(); return { docs: [...m].map(([id, data]) => ({ id, exists: true, data: () => data })), metadata: { fromCache: false, hasPendingWrites: false } }; }
  function notify(coll) { for (const fn of listeners[coll] || []) { try { fn(snap(coll)); } catch (e) { console.error(e); } } }
  async function load(coll) {
    const m = new Map(); let from = 0;
    for (;;) {
      const { data, error } = await sb.from('docs').select('id,data').eq('coll', coll).order('id').range(from, from + 999);
      if (error) throw error;
      for (const r of data) m.set(r.id, r.data);
      if (data.length < 1000) break; from += 1000;
    }
    cache[coll] = m;
  }
  const err = e => ({ code: e && e.code === '42501' ? 'invalid_argument' : 'unavailable', message: (e && e.message) || String(e) });
  const db = Object.freeze({
    collection(coll) {
      return {
        onSnapshot(fn, onErr) {
          (listeners[coll] = listeners[coll] || []).push(fn);
          (loading[coll] = loading[coll] || load(coll)).then(() => fn(snap(coll)), e => onErr && onErr(err(e)));
          return () => { listeners[coll] = (listeners[coll] || []).filter(f => f !== fn); };
        },
      };
    },
    doc(path) {
      const [coll, id] = path.split('/');
      return {
        async set(data) {
          const { error } = await sb.from('docs').upsert({ user_id: user.id, coll, id, data, updated_at: new Date().toISOString() });
          if (error) throw err(error);
          (cache[coll] = cache[coll] || new Map()).set(id, data); notify(coll);
        },
        async delete() {
          const { error } = await sb.from('docs').delete().eq('coll', coll).eq('id', id);
          if (error) throw err(error);
          if (cache[coll]) cache[coll].delete(id); notify(coll);
        },
      };
    },
  });

  // changes written by the server (Strava webhook, iPhone ingest) arrive live
  function subscribeRealtime() {
    const pending = new Set(); let t = null;
    sb.channel('docs').on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'user_id=eq.' + user.id }, p => {
      const row = p.new && p.new.coll ? p.new : p.old; if (!row || !row.coll) return;
      const m = cache[row.coll] = cache[row.coll] || new Map();
      if (p.eventType === 'DELETE') m.delete(row.id); else m.set(row.id, p.new.data);
      pending.add(row.coll); clearTimeout(t); t = setTimeout(() => { pending.forEach(notify); pending.clear(); }, 150);
    }).subscribe();
  }

  function loginScreen(message) {
    let el = document.getElementById('login');
    if (!el) { el = document.createElement('div'); el.id = 'login'; document.body.appendChild(el); }
    el.innerHTML = `<div class="login-card"><div class="brand"><b>Baseline</b></div>
      <p class="sub">Sign in with your email. You'll get a link; open it on this device.</p>
      <form id="loginForm"><input type="email" id="loginEmail" required placeholder="you@example.com" autocomplete="email"><button class="btn primary" type="submit">Send sign-in link</button></form>
      <p class="muted" id="loginMsg">${message || ''}</p></div>`;
    el.querySelector('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const email = el.querySelector('#loginEmail').value.trim(), msg = el.querySelector('#loginMsg');
      msg.textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin, shouldCreateUser: false } });
      msg.textContent = error ? 'Couldn’t send the link: ' + error.message : 'Check your inbox and open the link.';
    });
  }

  authReady = (async () => {
    const cfg = await fetch('/api/config').then(r => r.json());
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
    window.sb = sb;
    const { data } = await sb.auth.getSession();
    if (data.session) { user = data.session.user; }
    else {
      loginScreen();
      user = await new Promise(res => sb.auth.onAuthStateChange((ev, s) => { if (s && s.user) res(s.user); }));
      const el = document.getElementById('login'); if (el) el.remove();
    }
    subscribeRealtime();
    return user;
  })();

  const userApi = Object.freeze({ isOwner: async () => true, canEdit: async () => true, can: async () => true, id: async () => user && user.id, me: async () => ({ id: user && user.id, name: '', email: user && user.email }) });

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
    const { data } = await sb.auth.getSession();
    const token = data && data.session ? data.session.access_token : null;
    if (!token) throw { code: 'ai_auth', message: 'not signed in' };
    const images = [];
    for (const b of opts.images || []) { const u = await blobToDataUrl(b); if (!u) throw { code: 'image_rejected', message: 'image could not be read' }; images.push(u); }
    const body = { input, images, json: !!opts.json, model: opts.model || undefined, maxTokens: opts.maxTokens || undefined };
    let r;
    try { r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body), signal: opts.signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled', message: 'stopped' }; throw { code: 'unavailable', message: (e && e.message) || 'network error' }; }
    const j = await r.json().catch(() => null);
    if (!r.ok) { const err = (j && j.error) || {}; throw { code: err.code || (r.status === 413 ? 'prompt_too_large' : r.status === 429 ? 'rate_limited' : 'unavailable'), message: err.message || ('HTTP ' + r.status), retryAfter: err.retryAfter }; }
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
  window.signOut = async () => { await sb.auth.signOut(); location.reload(); };
})();
