// One-time (and after any command change): register the /wpa global slash command with Discord.
// Run from anywhere with Node 18+:
//   DISCORD_APP_ID=<app id> DISCORD_BOT_TOKEN=<bot token> node scripts/register_discord.mjs
// Global commands can take a few minutes to appear the first time. No dependencies (uses global fetch).
const APP = process.env.DISCORD_APP_ID, TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!APP || !TOKEN) { console.error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN env vars first.'); process.exit(2); }

const commands = [{
  name: 'wpa',
  description: 'Causal Win-Probability build for a champion — the items that actually raise win rate',
  options: [
    { name: 'champion', description: 'Champion name, e.g. Aatrox or Lee Sin', type: 3, required: true },
    { name: 'role', description: "Role (optional — defaults to the champion's main role)", type: 3, required: false,
      choices: [
        { name: 'Top', value: 'top' }, { name: 'Jungle', value: 'jungle' }, { name: 'Mid', value: 'mid' },
        { name: 'Bot', value: 'bot' }, { name: 'Support', value: 'support' },
      ] },
  ],
}];

const r = await fetch(`https://discord.com/api/v10/applications/${APP}/commands`, {
  method: 'PUT',
  headers: { authorization: `Bot ${TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify(commands),
});
console.log('HTTP', r.status);
console.log(await r.text());
if (!r.ok) process.exit(1);
console.log('Registered /wpa. It may take a few minutes to show up in Discord.');
