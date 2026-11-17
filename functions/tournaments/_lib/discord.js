// discord.js — fire-and-forget Discord announcements via an incoming webhook (DISCORD_WEBHOOK_URL).
// No bot token, no gateway; a single POST. Callers wrap in context.waitUntil so it never blocks or
// breaks a request. Brand red matches the site.
const RED = 0xff1e1e;
const SITE = 'https://ingenioushunter.gg';

export async function announce(env, embed) {
  const url = env && env.DISCORD_WEBHOOK_URL;
  if (!url) return { ok: false, skipped: 'no_webhook' };
  const body = {
    embeds: [{
      color: RED, footer: { text: 'Ingenious Hunter' }, timestamp: new Date().toISOString(),
      ...embed,
    }],
  };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Event builders — return an embed object for announce().
export const embeds = {
  published: (t) => ({ title: `🏆 ${t.name} — registration open`, url: `${SITE}/tournaments/${t.slug}`,
    description: `Sign up and find your bracket. ${t.starts_at ? `Starts <t:${Math.floor(t.starts_at / 1000)}:F>.` : ''}` }),
  checkinOpen: (t) => ({ title: `✅ Check-in open — ${t.name}`, url: `${SITE}/tournaments/${t.slug}`,
    description: 'Captains: check in now to lock your spot in the bracket.' }),
  bracketPublished: (t, d) => ({ title: `📊 ${d.name} bracket is live — ${t.name}`, url: `${SITE}/tournaments/${t.slug}#${d.id}`,
    description: 'Brackets are set. Good luck!' }),
  result: (t, d, m, winnerName, loserName) => ({ title: `${winnerName} advances`, url: `${SITE}/tournaments/${t.slug}#${d.id}`,
    description: `**${winnerName}** def. ${loserName} — ${d.name}, Round ${m.round}${m.best_of > 1 ? ` (${m.score_a}-${m.score_b})` : ''}.` }),
  champion: (t, d, name) => ({ title: `👑 Champion — ${d.name}`, url: `${SITE}/tournaments/${t.slug}#${d.id}`,
    description: `Congratulations to **${name}**, winner of ${d.name} in ${t.name}!` }),
};
