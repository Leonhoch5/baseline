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

### 3. Move your data over
```bash
npm install
# put the export folder (export/apple, export/strava, …) next to package.json
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… USER_EMAIL=you@example.com npm run import-export
```

### 4. Use it
Open the app, enter your email, open the link from the email. On iPhone: Safari → Share → *Add to Home Screen*.

## Status
- **Week 1 (done):** hosting, login, storage, data migration. Scores, charts, coaching and plans work as in the Claude version.
- **Week 2:** Strava (own API app + webhook) and the iPhone Shortcut posting to `/api/ingest`. Until then, Strava sync and iPhone sync in the app don't work.
- **Week 3:** plan import polish, home-screen app, optional notifications.
- **Week 4:** run both versions side by side, then switch.

## Layout
- `public/index.html`: page shell and script order
- `public/js/platform.js`: Supabase login + document storage (`docs` table)
- `public/js/*.js`: the app (parsers, scoring model, insights, views)
- `api/`: serverless functions
- `supabase/schema.sql`: database table and access rules
- `scripts/import-export.mjs`: one-off import of the Claude-version export
