# Tournament System — Staging Validation Runbook

Validate the tournament system on an **isolated** Cloudflare Pages preview before going to
production. Nothing here touches production D1, R2, or secrets.

> Requires your Cloudflare account (wrangler login or a scoped API token with D1 + Pages edit).
> The code side is done and tested; these are the account-level steps + the validation checklist.

## 0. Isolation model (read first)
Cloudflare Pages lets every binding/secret have a **separate Production and Preview value**. We use
that for isolation — **not** a repo config file (`wrangler.toml` deliberately has no
`pages_build_output_dir`, so Pages ignores it and your existing dashboard bindings stay authoritative).

| Binding / secret | Production | Preview (staging) |
|---|---|---|
| `DB` (D1) | `ih_tournaments` | **`ih_tournaments_staging`** (separate db) |
| `BETA_BUCKET` (R2) | prod bucket | a **staging bucket** *or leave unset* on preview |
| `TOURNEY_TOKEN_SECRET` | prod secret | a **different** staging secret |
| `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN` | prod Access app | staging (can reuse the same team) |
| `DISCORD_WEBHOOK_URL` | prod channel | a **staging channel** webhook |

Preview deployments therefore cannot read or write production D1/R2.

## 1. Create + migrate the staging D1
```sh
npx wrangler d1 create ih_tournaments_staging
# paste the returned id into wrangler.toml under [env.staging]
npx wrangler d1 migrations apply ih_tournaments_staging --env staging
```

## 2. Dashboard: Preview bindings + secrets (Pages → Settings)
- **Functions → D1 bindings → Preview:** `DB` → `ih_tournaments_staging`.
- **Functions → R2 bindings → Preview:** `BETA_BUCKET` → a staging bucket (or remove for preview).
- **Variables & Secrets → Preview:** set `TOURNEY_TOKEN_SECRET` (new `openssl rand -hex 32`),
  `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `DISCORD_WEBHOOK_URL` (staging channel).

## 3. Cloudflare Access (staging)
Zero Trust → Access → Applications → Self-hosted, covering **both**
`*.pages.dev/tournaments/admin` and `*.pages.dev/api/admin` for the preview domain (or your staging
custom domain). Policy: Allow your admin email(s). Copy the AUD → `CF_ACCESS_AUD` (Preview).

## 4. Deploy the preview
Pushing `feat/tournaments` creates a Pages **preview deployment** automatically (Git integration),
or deploy explicitly:
```sh
npx wrangler pages deploy . --branch feat/tournaments
```
Note the `https://<hash>.ingenioushunter-site.pages.dev` URL.

## 5. Validation checklist

### A. Auth / authz (run against the preview URL)
```sh
B=https://<preview>.pages.dev
curl -s -o /dev/null -w "%{http_code}\n" $B/api/admin/tournaments           # expect 403 (no Access)
curl -s -o /dev/null -w "%{http_code}\n" -H "Cf-Access-Jwt-Assertion: bad" $B/api/admin/tournaments   # 403 (bad token)
curl -s -o /dev/null -w "%{http_code}\n" $B/tournaments/admin               # 302/403 (Access login)
```
- **Unauthenticated / invalid-audience / expired-token / unauthorized-user:** Access denies at the
  edge; the function also rejects (`403`) via server-side JWT verification. Expired/aud-mismatch are
  covered by the automated `auth.test.js` (RS256 verify with exp + aud checks).
- **Captain tokens:** scoped (team+tournament), expiring (`exp`, default 45d via `TOURNEY_TOKEN_TTL_DAYS`),
  revocable (rotate the team's link to invalidate the old one). Covered by `security.test.js`.
- **No PII in public APIs:** `/api/tournaments/<slug>/bracket` and `/api/tournaments/<slug>` expose
  only team names/seeds/scores — no email/discord/riot id. Covered by `security.test.js`; spot-check
  the live JSON.

### B. Logic on real D1 (preview)
The full `npm test` suite (bracket, byes, divisions, dedup, concurrency, forfeit, correction, 32-team
sim) runs on the SQLite engine D1 uses. To exercise the **deployed** D1, run the browser E2E (C) — it
drives the real preview D1 end to end. Spot-check rows directly if desired:
```sh
npx wrangler d1 execute ih_tournaments_staging --env staging --command "SELECT status,COUNT(*) FROM matches GROUP BY status"
```

### C. Browser end-to-end (on the preview, logged in via Access)
1. `/tournaments/admin` → **New tournament** (set the Google Form URL + Discord invite).
2. **Registrations** → paste `test/fixtures/sample_registrations.csv` → Import; re-import → 0 new /
   all unchanged; import the *modified* CSV → only changed rows update (idempotency).
3. **Divisions** → add division(s) → **Auto-assign** solos.
4. **Teams** → create/assemble teams → **Get link** (captain magic link).
5. **Seed bracket** → confirm byes land on top seeds; open `/tournaments/<slug>` (public bracket).
6. Open the captain link in a separate browser/incognito → **Check in** → **Report result**; have the
   opposing captain agree → bracket advances on the public page within ~15s.
7. Force a **dispute** (two captains disagree) → resolve in **Matches**; test a **forfeit** and a
   **score correction** (reopen + re-confirm) and confirm downstream updates.
8. Play through to the **champion**; verify the public bracket shows the crown.

### D. Discord-failure isolation
Temporarily set the Preview `DISCORD_WEBHOOK_URL` to an invalid URL, confirm a result still confirms
and the bracket advances (announcements are fire-and-forget; covered by `security.test.js`).

### E. Regression (existing site)
On the preview: load `/` (homepage), the beta download box, `/waitlist` POST, `/builds/` — all behave
as today. The tournament system changed **no existing files** (verify: `git diff --name-status main`
shows only `A` additions), so existing R2/env bindings and functions are untouched.

## 6b. Troubleshooting an Access 403 ("Forbidden — requires admin access")
The admin function verifies the Access JWT itself, so a 403 means that verification failed. To see
**exactly why** without exposing any token:
1. Set Preview var `TOURNEY_AUTH_DEBUG = 1` (Pages → Variables → Preview) and redeploy.
2. Reload `/tournaments/admin`. The 403 page now appends `[auth-debug] <reason>` (and an
   `x-access-debug` header); `/api/admin/*` returns `{ "reason": ... }`. You can also run
   `npx wrangler pages deployment tail` and look for `[access] <stage>` lines.
3. Common reasons and fixes:
   - `aud_mismatch {expected_aud, token_aud}` → `CF_ACCESS_AUD` must equal the Access app's
     **Application Audience (AUD) Tag** (Zero Trust → Access → your app → Overview), not the Client ID.
   - `no_access_token {header:false,cookie:false}` → the Access app isn't actually in front of this
     path; ensure it covers both `…/tournaments/admin` and `…/api/admin` on the preview domain.
   - `jwks_fetch_error {host}` → `CF_ACCESS_TEAM_DOMAIN` must be the bare host
     `yourteam.cloudflareaccess.com` (a scheme/trailing slash is now tolerated, but use the bare host).
   - `expired` → re-login; `bad_signature` / `no_matching_jwk` → team domain points at the wrong team.
4. **Turn `TOURNEY_AUTH_DEBUG` back off (unset or `0`) before production.** The reason strings contain
   no secrets (stage names, AUD tags, kid), but keep them off in prod.

## 6. Promote to production (after your approval)
Set the same bindings/secrets on the **Production** environment (prod `ih_tournaments` D1, prod Access
app over `ingenioushunter.gg/tournaments/admin*` + `/api/admin*`, prod secrets + Discord), apply
migrations to the prod D1, then merge `feat/tournaments` → `main`. See TOURNAMENTS.md.
