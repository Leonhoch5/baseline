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
  window.claude = Object.freeze({
    use: async name => {
      if (name === 'db') { await authReady; return db; }
      if (name === 'user') { await authReady; return userApi; }
      return null; // Strava and iPhone sync move to the server in week 2; plan conversion is on hold
    },
  });
  window.signOut = async () => { await sb.auth.signOut(); location.reload(); };
})();
