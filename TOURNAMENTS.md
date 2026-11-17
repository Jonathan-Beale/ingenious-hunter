# Ingenious Hunter — Tournament System

Integrated tournament management for ingenioushunter.gg. Pure vanilla JS + Cloudflare Pages
Functions + D1. Additive to the existing site — nothing about `builds/`, the beta download, the
waitlist, telemetry, the Discord bot, or the analytics middleware changes.

- **Public:** `/tournaments` (directory), `/tournaments/<slug>` (event page + live bracket).
- **Captains:** `/tournaments/<slug>/captain?t=<token>` (magic-link; check-in + report results).
- **Admin:** `/tournaments/admin` (behind Cloudflare Access).
- **APIs:** `/api/tournaments/<slug>/bracket` (public read), `/api/captain/*` (token), `/api/admin/*` (Access).

## Architecture
- Core logic is **pure, framework-free modules** in `functions/tournaments/_lib/` (bracket engine,
  seeding, CSV import, division assignment, result state machine, auth, Discord). D1 is a thin
  adapter beneath them, so the engine is unit-tested with zero infrastructure.
- **Single-elimination** with byes to top seeds, BO1/BO3, rank-based divisions. A stronger player is
  never auto-placed into a weaker division to fill a bracket.
- **Idempotent CSV import:** keyed on a stable per-response id; a re-import updates, never duplicates.
- **Captain auth:** stateless HMAC magic links (no accounts). **Admin auth:** Cloudflare Access, with
  the JWT also verified server-side in every admin function (direct hits without Access are rejected).
- **Integrity:** optimistic-concurrency version guards on advancement (no double/conflicting
  advances), both-captains-agree confirmation (mismatch → dispute), reversible corrections, and an
  append-only `audit_log`.

## One-time setup (manual — do these in the Cloudflare dashboard / CLI)

### 1. Create the D1 database
```sh
npx wrangler d1 create ih_tournaments
```
Copy the returned `database_id` into **`wrangler.toml`** (replace `REPLACE_WITH_D1_DATABASE_ID`).

### 2. Apply migrations
```sh
npx wrangler d1 migrations apply ih_tournaments            # production
npx wrangler d1 migrations apply ih_tournaments --local    # local dev db
```

### 3. Bind D1 to the Pages project
Pages project → **Settings → Functions → D1 database bindings** → add binding **`DB`** → `ih_tournaments`.
(The R2 `BETA_BUCKET` binding stays as-is. The Pages **build command stays empty**; `package.json`
and `wrangler.toml` do not change how the site deploys.)

### 4. Environment variables (Pages → Settings → Variables and Secrets — mark secrets **Encrypted**)
| Name | Value | Notes |
|---|---|---|
| `TOURNEY_TOKEN_SECRET` | `openssl rand -hex 32` | signs captain magic links — **secret** |
| `CF_ACCESS_TEAM_DOMAIN` | `yourteam.cloudflareaccess.com` | your Zero Trust team domain |
| `CF_ACCESS_AUD` | Access app **Application Audience (AUD) tag** | from step 5 |
| `DISCORD_WEBHOOK_URL` | channel webhook URL | optional; announcements no-op without it — **secret** |

### 5. Admin authentication — Cloudflare Access (Zero Trust)
1. Zero Trust dashboard → **Access → Applications → Add → Self-hosted**.
2. **Application domain(s):** add **both** `ingenioushunter.gg/tournaments/admin` and
   `ingenioushunter.gg/api/admin` (include subpaths).
3. **Policy:** Allow → *Emails* → your admin address(es).
4. Save, then copy the application's **AUD tag** into `CF_ACCESS_AUD`, and your team domain into
   `CF_ACCESS_TEAM_DOMAIN`. Access now gates the dashboard + mutation APIs at the edge, and the
   functions verify the signed JWT too (defense in depth).

### 6. Discord announcements (optional)
Discord channel → **Edit Channel → Integrations → Webhooks → New Webhook → Copy URL** → set
`DISCORD_WEBHOOK_URL`. Admins can also trigger announcements from the dashboard.

## Running the inaugural event (IH Community Cup — Dec 19, 2026)
Registration stays on the **existing Google Form** (no second sign-up). Then, from `/tournaments/admin`:
1. **New tournament** → name, slug, set `registration_url` (the Form) + `discord_invite` + start time.
2. **Registrations →** paste/upload the Form's CSV export → **Import** (re-import anytime; it updates,
   never duplicates). Correct any bad rows by re-importing a fixed CSV.
3. **Divisions →** create rank-based divisions from turnout (e.g. `Open`, or `Gold-` + `Plat+`).
   **Auto-assign solo players by rank** (never merges a stronger player down).
4. **Teams →** create teams / assemble solos; **Get link** issues each captain's magic link (send it
   privately via Discord DM — the link controls that team).
5. **Seed bracket** per division. Byes go to top seeds automatically.
6. **Check-in:** captains check in from their link; or manage it from the dashboard.
7. **Live:** captains report results; agreement auto-advances the bracket; the public page updates
   itself. Resolve any **disputed** matches, record **forfeits**, or **correct** a score (reversible)
   from the **Matches** tab.

## Local development & tests
```sh
npm test               # 55 unit + integration tests (node:test + a node:sqlite D1 shim)
npm run simulate 32    # seed + play a full 32-team bracket to one champion
npx wrangler pages dev . --d1 DB=ih_tournaments --local   # run the site locally with D1
```
Tests cover: bracket generation + byes, seeding, divisions (no merge-down), idempotent import
dedup, both-captains confirmation, disputes, forfeits, score correction, concurrent updates, and a
32-team end-to-end simulation.

## Security notes
- **No secrets in git.** All credentials are Pages env vars; `wrangler.toml` holds only the D1
  `database_id` (an identifier, not a secret). `node_modules/` is gitignored.
- Admin mutation endpoints (`/api/admin/*`) are unreachable without a valid Access identity —
  enforced at the edge *and* re-verified server-side.
- Captain links are HMAC-signed and bound to one team; rotating a team's link invalidates the old one.
- Riot Tournament API production access is **not** required for this event.
