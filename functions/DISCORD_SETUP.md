# Discord bot — setup (one-time, Jon)

The bot is a **serverless HTTP interactions endpoint** at `functions/discord.js` → served at
`https://ingenioushunter.gg/discord`. There is no process to run or keep alive — it lives on
Cloudflare's edge like the rest of the site. It answers `/wpa <champion> [role]` with the causal
build, reading the same public R2 data the `/builds/` site uses.

## Steps

1. **Create the Discord app**
   - https://discord.com/developers/applications → **New Application**.
   - Copy the **Application ID** and the **Public Key** (General Information page).
   - Under **Bot** → add a bot, copy the **Bot Token** (used only by the register script, below).

2. **Point Discord at our endpoint**
   - General Information → **Interactions Endpoint URL** = `https://ingenioushunter.gg/discord`
   - Click **Save**. Discord sends a signed PING; our endpoint verifies it and replies PONG.
     If it saves without error, verification works. (It won't save until the env var in step 3 is live.)

3. **Add the env var in Cloudflare Pages** (project: ingenious-hunter)
   - Settings → Environment variables → add **`DISCORD_PUBLIC_KEY`** = the Public Key from step 1.
   - Redeploy (any push, or "Retry deployment") so the function sees it.
   - `BETA_BUCKET` is already bound (the site uses it) — no extra binding needed.

4. **Register the `/wpa` command** (one-time, and after any command change)
   ```
   DISCORD_APP_ID=<app id> DISCORD_BOT_TOKEN=<bot token> node scripts/register_discord.mjs
   ```
   Global commands can take a few minutes to appear.

5. **Invite the bot to a server**
   - OAuth2 → URL Generator → scopes: `applications.commands` (that's all a slash-command bot needs;
     `bot` scope optional). Open the generated URL, pick a server, authorize.
   - Try it: `/wpa champion:Aatrox role:top`

## Notes
- `DISCORD_PUBLIC_KEY` is the only secret the running endpoint needs; the bot token is only for the
  register script and is never deployed.
- To change the build shown, edit `functions/discord.js` (`buildEmbed`) — it reads
  `builds/data/meta.json` and `builds/data/champ/<id>.json` from R2, so it always reflects the
  latest `refresh_builds.sh` deploy.
- Growth idea already wired: the embed footer nudges users to the app ("get it live in champ select").
