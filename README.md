# Baseline

Recovery, strain and sleep from Apple Watch and Strava, matched to your training plan.
Everything runs on Vercel: a static front end (`public/`), serverless functions (`api/`) and a private Blob store for the data.
No database service, no third-party login: one app password, one Vercel project.

## One-time setup (about 10 minutes)

### 1. Vercel project
1. *Add New → Project* → import `Leonhoch5/baseline`. Framework preset: **Other**. No build command.
2. **Storage** tab → *Create Database → Blob* → access **Private** → connect it to the project.
   That adds `BLOB_READ_WRITE_TOKEN` to the project by itself.
3. **Settings → Environment Variables** (see `.env.example`):
   - `APP_PASSWORD` = the password you sign in with (8+ characters)
   - `SESSION_SECRET` = a long random string (`openssl rand -hex 32`). Change it to sign out every device.
   - `INGEST_TOKEN` = a long random string (`openssl rand -hex 24`) for the iPhone Shortcut and the import script
   - `HACKCLUB_AI_KEY` = your Hack Club AI key (https://ai.hackclub.com/dashboard) for plan import and the coach's note.
     It stays on the server; `/api/ai` only answers signed-in requests. Optional: `HACKCLUB_AI_MODEL`, `HACKCLUB_AI_FALLBACKS`.
4. Deploy (or redeploy after adding the variables). `https://<your-app>.vercel.app/api/health` lists anything still missing.

### 2. Move your data over
In the Claude version: Settings → **Backup and move** → *Download my data* (one JSON file).
In this app: sign in → Settings → **Backup and move** → *Restore from a file* → pick that file. Done.
The same two buttons are your backup: download now and then, restore if anything is ever lost.

(Alternative from a terminal, with an export folder of `coll/id.json` files:
`BASE_URL=https://<your-app>.vercel.app INGEST_TOKEN=… node scripts/import-export.mjs ./export`)

### 3. Use it
Open the app and enter the app password (once per browser). On iPhone: Safari → Share → *Add to Home Screen*.

### 4. iPhone sync + morning notification (replaces Google Drive)
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
- **Done:** hosting, login, storage, data migration, iPhone Shortcut → `/api/ingest` with morning summary, AI via Hack Club (`/api/ai`), coaching.
- **To do:** Strava (own API app + webhook); until then Strava sync in the app doesn't work.

## Storage and the free plan
Data is stored as one JSON file per collection (`baseline/c/<collection>.json`) in a private Blob store, read and written only by the functions in `api/`.
The Hobby plan includes 10,000 reads and 2,000 writes a month: an app load is ~11 reads, a save is 1 read + 1 write, the morning sync is ~11 reads + 2 writes.
That is fine for a few dozen opens a day; Vercel emails you if you get near the limits (Observability → Blob shows usage).

## Layout
- `public/index.html`: page shell and script order
- `public/js/platform.js`: login + document storage through `/api/db`, and the AI shim through `/api/ai`
- `public/js/*.js`: the app (parsers, scoring model, insights, coaching, views)
- `api/`: serverless functions (`db.js` storage, `login.js`, `ingest.js` runs the same scoring code as the browser from `public/js`, `ai.js` proxies Hack Club AI and holds the key, `health.js`)
- `lib/`: shared auth (`auth.js`) and Blob storage (`store.js`) code
- `scripts/import-export.mjs`: one-off import of the Claude-version export
