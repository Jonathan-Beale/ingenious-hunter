# ingenioushunter.gg

Marketing site + gated beta download for **Ingenious Hunter** — a data-driven
League of Legends coaching companion. Static HTML/CSS plus one Cloudflare Pages
Function. No build step.

## Deploy (Cloudflare Pages)
1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → this repo.
2. Framework preset: **None**. Build command: *(leave empty)*. Output directory: **/**.
3. Custom domains: `ingenioushunter.gg` (primary) and `ingenioushunter.com` (redirect to .gg).

## Password-gated direct download
The page has a beta-password box that calls `/download?pw=...`, handled by
`functions/download.js`. It checks the password **server-side** and streams the
file from a **private R2 bucket** — a wrong password returns 401 and never reveals
the file or its URL. Wire it up in the Cloudflare dashboard (Pages project → Settings):

1. **R2** — create a bucket (e.g. `ih-beta`), upload the beta artifact
   (`IngeniousHunter.exe` or `IngeniousHunter-beta.zip`). Keep the bucket PRIVATE.
2. **Bindings → R2 bucket** — bind that bucket as **`BETA_BUCKET`**.
3. **Environment variables**:
   - **`BETA_PASSWORD`** = the download password (mark as encrypted).
   - **`BETA_FILE_KEY`** = the exact object name in R2 (e.g. `IngeniousHunter.exe`).
4. Redeploy. The download box works; no secret lives in this repo.

Rotate access by changing `BETA_PASSWORD` or replacing the R2 object.

## Edit
Everything user-facing is in `index.html`. The Discord invite is wired in the
beta section; the download box is right below it.
