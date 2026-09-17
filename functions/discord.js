// Cloudflare Pages Function — Discord slash-command bot: /wpa <champion> [role]
//
// HTTP INTERACTIONS ENDPOINT (not a gateway bot): Discord POSTs each command here and we answer in
// the HTTP response. There is NO persistent connection and NO process — so it "stays live" for the
// same reason the website does: it runs on Cloudflare's edge. Nothing on a box, nothing to flap or
// monitor. Reads the same PUBLIC R2 build data (BETA_BUCKET) the /builds/ site serves.
//
// Setup (one-time, Jon — see functions/DISCORD_SETUP.md): create a Discord app, set its Interactions
// Endpoint URL to https://ingenioushunter.gg/discord, add env vars DISCORD_PUBLIC_KEY (+ DISCORD_APP_ID
// & DISCORD_BOT_TOKEN for register_discord.mjs) in the Cloudflare Pages project, run register_discord.mjs.

const ROLE_IDX = { top: 0, jungle: 1, jgl: 1, jg: 1, mid: 2, middle: 2, bot: 3, bottom: 3, adc: 3, support: 4, supp: 4, sup: 4 };
const RNAME = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
const RSLUG = ['top', 'jungle', 'mid', 'bot', 'support'];
const RED = 0xff1e1e;
const SITE = 'https://ingenioushunter.gg';

let META = null;
async function getMeta(env) {
  if (META) return META;
  const o = await env.BETA_BUCKET.get('builds/data/meta.json');
  META = o ? JSON.parse(await o.text()) : { meta: {}, champs: [] };
  return META;
}
const slugify = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function resolveChamp(champs, q) {
  const s = slugify(q);
  if (!s) return null;
  return champs.find((c) => c.slug === s)                       // exact
      || champs.find((c) => c.slug.startsWith(s))               // prefix
      || champs.find((c) => c.slug.includes(s))                 // contains
      || champs.find((c) => slugify(c.n).includes(s)) || null;  // display-name contains
}

const pct = (w) => (w >= 0 ? '+' : '') + (w * 100).toFixed(1) + '%';

async function buildEmbed(env, champQ, roleQ) {
  const { meta, champs } = await getMeta(env);
  const c = resolveChamp(champs, champQ);
  if (!c) return { title: 'Champion not found', color: RED,
    description: `No champion matches **${champQ}**. Try the exact name, e.g. \`/wpa champion:Lee Sin role:jungle\`.` };

  let ri = roleQ != null && roleQ !== '' ? ROLE_IDX[String(roleQ).toLowerCase()] : undefined;
  if (ri == null || c.roles.indexOf(ri) < 0) ri = c.roles[0];    // fall back to the champ's primary role

  const patch = meta.patch;
  const o = await env.BETA_BUCKET.get(`builds/data/champ/${c.id}.json`);
  const cell = o ? (JSON.parse(await o.text()) || {})[`${c.id}|${ri}`] : null;
  const patches = (cell && cell.patch) || {};
  const url = `${SITE}/builds/${c.slug}/${RSLUG[ri]}`;
  if (!Object.keys(patches).length) return { title: `${c.n} — ${RNAME[ri]}`, url, color: RED,
    description: `No build data for ${c.n} ${RNAME[ri]} yet.\n[See all builds →](${url})` };

  // Pool each item slot across patches (games-weighted WPA) — the current causal patch alone is thin,
  // so this matches the site's DEFAULT pooled view (and the page this links to).
  // Pool the given slots across patches (games-weighted WPA); dedupe by item id; return sorted.
  const pool = (slots) => {
    const acc = {};
    for (const p in patches) for (const slot of slots) for (const x of (((patches[p].items) || {})[slot] || [])) {
      const a = acc[x.id] || (acc[x.id] = { n: x.n, ws: 0, g: 0 }); a.ws += x.w * x.g; a.g += x.g;
    }
    return Object.values(acc).map((a) => ({ n: a.n, w: a.g ? a.ws / a.g : 0 })).sort((x, y) => y.w - x.w);
  };
  const top = (slot) => pool([slot])[0] || null;
  const core = pool(['first', 'second', 'third', 'fourth']).slice(0, 4)   // top DISTINCT legendary items, no slot dupes
    .map((x) => `\`•\` ${x.n} — **${pct(x.w)}**`);

  const wrRec = (c.wr && c.wr[String(ri)]) || null;                // reliable per-role WR from meta
  const wr = wrRec ? (wrRec[0] * 100).toFixed(1) + '%' : '—';
  const games = wrRec ? wrRec[1].toLocaleString('en-US') : '—';
  const fields = [];
  const st = top('starter'), bt = top('boots');
  if (st) fields.push({ name: 'Starter', value: st.n, inline: true });
  if (bt) fields.push({ name: 'Boots', value: bt.n, inline: true });
  if (core.length) fields.push({ name: 'Top items (by causal Win-Probability Added)', value: core.join('\n'), inline: false });

  return {
    title: `${c.n} — ${RNAME[ri]} build`,
    url,
    color: RED,
    description: `**${wr}** win rate · ${games} games · Gold+ · patch ${patch}\nRanked by *causal* win-rate impact — not pick rate.`,
    fields,
    footer: { text: 'Ingenious Hunter · get it live in champ select → ingenioushunter.gg' },
  };
}

// ---- Ed25519 request verification (Discord requires it) ----
const hex2bytes = (h) => new Uint8Array((h.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));
async function verify(request, rawBody, publicKey) {
  const sig = request.headers.get('x-signature-ed25519');
  const ts = request.headers.get('x-signature-timestamp');
  if (!sig || !ts || !publicKey) return false;
  try {
    const key = await crypto.subtle.importKey('raw', hex2bytes(publicKey), { name: 'Ed25519', namedCurve: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, hex2bytes(sig), new TextEncoder().encode(ts + rawBody));
  } catch (_) { return false; }
}

const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });

export async function onRequestPost(context) {
  const { request, env } = context;
  const raw = await request.text();
  if (!(await verify(request, raw, env.DISCORD_PUBLIC_KEY)))
    return new Response('bad signature', { status: 401 });

  let body; try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }

  if (body.type === 1) return json({ type: 1 });                 // PING -> PONG

  if (body.type === 2) {                                         // APPLICATION_COMMAND
    const opts = (body.data && body.data.options) || [];
    const get = (n) => { const o = opts.find((x) => x.name === n); return o && o.value; };
    if ((body.data && body.data.name) === 'wpa') {
      try {
        const embed = await buildEmbed(env, get('champion'), get('role'));
        return json({ type: 4, data: { embeds: [embed] } });
      } catch (_) {
        return json({ type: 4, data: { content: 'Something went wrong looking that up — try again shortly.', flags: 64 } });
      }
    }
    return json({ type: 4, data: { content: 'Unknown command.', flags: 64 } });
  }
  return json({ type: 4, data: { content: 'Unsupported interaction.', flags: 64 } });
}

// A GET on /discord is a friendly health page (Discord only ever POSTs here).
export const onRequestGet = () =>
  new Response('Ingenious Hunter Discord bot endpoint — POST-only (Discord interactions).', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
