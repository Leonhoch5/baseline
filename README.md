# Baseline

Recovery, strain and sleep from Apple Watch and Strava, matched to your training plan.
Static front end (`public/`) + Vercel serverless functions (`api/`) + Supabase (Postgres, login).

## One-time setup (about 15 minutes)

### 1. Supabase
1. Create a project at supabase.com (region: Frankfurt `eu-central-1`).
2. **SQL Editor** → paste `supabase/schema.sql` → Run.
3. **Authentication → Users → Add user → Create new user** with your email (tick *Auto confirm*).
4. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up" (only you can log in).
5. **Authentication → URL Configuration**: set *Site URL* to your Vercel URL (e.g. `https://baseline-xyz.vercel.app`) once you have it.
6. **Project Settings → API**: note the *Project URL*, the *anon public* key and the *service_role* key (keep that one secret).

### 2. Vercel
1. *Add New → Project* → import `Leonhoch5/baseline`. Framework preset: **Other**. No build command.
2. *Environment Variables*:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = anon public key
3. Deploy. Check `https://<your-app>.vercel.app/api/health` returns `{"ok":true}`.
4. For AI features (plan conversion from text, Word files or screenshots) add:
   - `HACKCLUB_AI_KEY` = your Hack Club AI key (https://ai.hackclub.com/dashboard). It stays on the server; `/api/ai` only answers signed-in requests.
   - optional `HACKCLUB_AI_MODEL` (default `anthropic/claude-haiku-5.5`, cheap and reads screenshots) and `HACKCLUB_AI_FALLBACKS`.
   Hack Club AI has a $3/day budget per key; a plan conversion costs well under a cent.
5. For the iPhone sync (step 6) also add:
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key (server only, never in the browser)
   - `USER_EMAIL` = your login email (or `BASELINE_USER_ID` = your user id from Authentication → Users)
   - `INGEST_TOKEN` = a long random secret, at least 16 characters (e.g. run `openssl rand -hex 24`)
   Redeploy after adding them.

### 3. Move your data over
```bash
npm install
# put the export folder (export/apple, export/strava, …) next to package.json
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… USER_EMAIL=you@example.com npm run import-export
```

### 4. Use it
Open the app, enter your email, open the link from the email. On iPhone: Safari → Share → *Add to Home Screen*.

### 6. iPhone sync + morning notification (replaces Google Drive)
The Shortcut sends its text straight to Baseline and gets this morning's summary back.
1. In the **Baseline Sync** shortcut, open **Get Contents of URL** and change the URL to
   `https://<your-app>.vercel.app/api/ingest?token=<INGEST_TOKEN>`
   Keep *Method* POST and *Request Body* **File** (the final Text). The Apps Script is no longer needed.
2. Replace **Show Result** with **Show Notification**: tap it and pick *Contents of URL* as the body.
   You'll get something like:
   ```
   Recovery 59% · Maintain
   Recovery 59% (yellow) · Sleep 93% · 7:52 h
   HRV 52 ms · RHR 48
   Today: Easy/recovery swim · 30 min
   Maintain. Strain target 10–14.
   ```
3. **Automation** tab → **+** → **Wake Up** (Sleep) or **Alarm → Is Stopped** → *Run Immediately* → run **Baseline Sync**.
   Sleep data is complete only after you wake, so a fixed time like 06:00 can miss the end of the night.
4. Optional: a second shortcut with only **Get Contents of URL** (method GET, same URL) + **Show Notification** gives the summary any time without syncing.

Answers: `401` wrong token · `400` empty body (Request Body must be File) · `500` server problem (see Vercel → Logs).

## Status
- **Week 1 (done):** hosting, login, storage, data migration. Scores, charts, coaching and plans work as in the Claude version.
- **Week 2:** iPhone Shortcut → `/api/ingest` with morning summary (done). AI via Hack Club (`/api/ai`, done). Strava (own API app + webhook) still to do; until then Strava sync in the app doesn't work.
- **Week 3:** plan import polish, home-screen app, optional notifications.
- **Week 4:** run both versions side by side, then switch.

## Layout
- `public/index.html`: page shell and script order
- `public/js/platform.js`: Supabase login + document storage (`docs` table)
- `public/js/*.js`: the app (parsers, scoring model, insights, views)
- `api/`: serverless functions (`ingest.js` runs the same scoring code as the browser, from `public/js`; `ai.js` proxies Hack Club AI and holds the key)
- `supabase/schema.sql`: database table and access rules
- `scripts/import-export.mjs`: one-off import of the Claude-version export
