# ingenioushunter.gg

Marketing site for **Ingenious Hunter** — a data-driven League of Legends coaching companion.

Static single-page site (plain HTML/CSS, no build step).

## Deploy (Cloudflare Pages)
1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → this repo.
2. Framework preset: **None**. Build command: *(leave empty)*. Build output directory: **/** (root).
3. Deploy. Then add custom domains: `ingenioushunter.gg` (primary) and `ingenioushunter.com` (redirect to .gg).

## Edit
Everything is in `index.html`. Replace `REPLACE_WITH_DISCORD_INVITE` with the Discord invite URL before going live.
