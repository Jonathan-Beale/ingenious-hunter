// POST /api/captain/result  { token, matchId, winner, scoreA, scoreB } — verified captain result.
// Agreement with the opposing captain auto-confirms; a mismatch is flagged disputed. Optional
// Discord announce on confirmation (fire-and-forget).
import { json } from '../../tournaments/_lib/http.js';
import { submitResult, getTournament } from '../../tournaments/_lib/service.js';
import { announce, embeds } from '../../tournaments/_lib/discord.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return json({ error: 'not_configured' }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (!b || !b.token || !b.matchId || !b.winner) return json({ error: 'missing_fields' }, 400);
  try {
    const r = await submitResult(env, b.token, b.matchId, { winner: b.winner, scoreA: b.scoreA | 0, scoreB: b.scoreB | 0 });
    if (r.status === 'confirmed' && env.DISCORD_WEBHOOK_URL) {
      context.waitUntil((async () => {
        try {
          const m = await env.DB.prepare('SELECT * FROM matches WHERE id=?').bind(b.matchId).first();
          const t = await getTournament(env, m.tournament_id);
          const d = await env.DB.prepare('SELECT * FROM divisions WHERE id=?').bind(m.division_id).first();
          const nm = async (id) => (await env.DB.prepare('SELECT name FROM teams WHERE id=?').bind(id).first())?.name || 'TBD';
          await announce(env, embeds.result(t, d, m, await nm(m.winner_team_id), await nm(m.loser_team_id)));
        } catch { /* announcements never block */ }
      })());
    }
    return json(r);
  } catch (e) {
    return json({ error: e.code || 'error' }, e.code === 'bad_token' ? 401 : 400);
  }
}
