# Production deployment — Ingenious Hunter tournaments

The tournament system lives on `feat/tournaments`. It is **purely additive** — no existing site file
is modified, and `wrangler.toml` has **no `pages_build_output_dir`, so Cloudflare Pages ignores it**
and your dashboard-managed bindings/secrets (R2 `BETA_BUCKET`, etc.) stay authoritative and unchanged.

> Do **not** merge to `main` until section 0 is green.

## 0. Pre-merge gates
- [x] 91 automated tests pass (`npm test`)
- [x] 32-team staging simulation + a realistic mid-tournament state verified on real D1
- [x] Browser smoke (desktop + mobile): bracket alignment, admin dispute resolution, live advancement
- [x] Staging D1 isolated from prod; production R2 code paths untouched
- [x] `TOURNEY_AUTH_DEBUG` off ⇒ 403 is clean (no build/reason/headers leak)
- [ ] Final review + PR approval

## 1. Production D1
```
npx wrangler d1 create ih_tournaments                 # copy the database_id it prints
npx wrangler d1 execute ih_tournaments --remote --file=./migrations/0001_init.sql -y
npx wrangler d1 execute ih_tournaments --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
```
Expect **9 tables** (tournaments, divisions, participants, teams, rosters, matches, result_submissions,
audit_log, import_batches). Keep `ih_tournaments_staging` as the separate staging DB.

## 2. Pages bindings (dashboard → Pages → ingenious-hunter → Settings → Functions)
- **D1 → Production:** `DB` → `ih_tournaments` (the prod DB, **not** staging).
- **D1 → Preview:** `DB` → `ih_tournaments_staging` (leave as-is — keeps staging isolated).
- **R2:** leave `BETA_BUCKET` exactly as it is (the existing site depends on it).

## 3. Cloudflare Access (admin auth)
- Zero Trust → Access → Applications → add a self-hosted app covering **`/tournaments/admin*`** and
  **`/api/admin/*`** on your production hostname.
- Policy: allow only the admin email(s)/group.
- Production env vars:
  - `CF_ACCESS_TEAM_DOMAIN` = `https://<your-team>.cloudflareaccess.com` (code normalizes the scheme)
  - `CF_ACCESS_AUD` = the application **Audience (AUD) tag** from that Access app
- After deploy, verify: unauthenticated hit → Access login; an un-allowed user → **403**.

## 4. Production secrets / variables
- `TOURNEY_TOKEN_SECRET` — long random string for captain magic-link HMAC. **Required**, and **different
  from staging**.
- `TOURNEY_TOKEN_TTL_DAYS` — optional (default 45); set so links last through Dec 19.
- `DISCORD_WEBHOOK_URL` — production announcements webhook (optional; announce is a safe no-op if unset).
- `TOURNEY_AUTH_DEBUG` — **must be unset or `0` in Production** (it currently exists only on Preview).
  With it off, the admin 403 shows no build id, reason, or debug headers.

## 5. Deploy
- Merge `feat/tournaments` → `main`. Pages auto-builds Production from `main` (build command empty;
  static files + `functions/`). No wrangler deploy needed.
- Prod smoke: `/tournaments/` loads · `/tournaments/admin` → Access login · `/api/tournaments/<slug>/bracket`
  returns JSON · homepage, `/download`, `/builds/`, waitlist still work (R2 unaffected).

## 6. Create the real December 19 tournament
From the admin dashboard (or `/api/admin/*`):
1. **New tournament** — name "Ingenious Hunter Community Cup", a slug (e.g. `community-cup`), status
   `registration`, capacity + team size, **starts_at = 2026-12-19 14:00 EST**, registration URL = your
   Google Form. (The staging `staging-shakedown` test tournament lives only in staging and will not
   appear in production.)
2. **Registrations** — when the Form closes, paste/upload the CSV (import is idempotent; re-import is safe).
3. **Divisions** — create rank bands, then Auto-assign by rank. Create Teams + rosters (or from solos).
4. **Check-in** — issue captain links (Teams tab → Get link); captains check in.
5. **Seed** each division; set the tournament status to `live` (Lifecycle buttons).
6. **Run** — confirm results / resolve disputes / record forfeits from the Matches tab. Use the
   Announce buttons for Discord posts — announcements never change the tournament status.
