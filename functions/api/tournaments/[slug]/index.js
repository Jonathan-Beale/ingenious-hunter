// GET /api/tournaments/:slug — public tournament meta + divisions (counts only, no PII).
import { json } from '../../../tournaments/_lib/http.js';
import { getTournamentBySlug, listDivisions } from '../../../tournaments/_lib/service.js';

export async function onRequestGet({ env, params }) {
  if (!env.DB) return json({ error: 'not_configured' }, 503);
  const t = await getTournamentBySlug(env, params.slug);
  if (!t || t.visibility === 'private') return json({ error: 'not_found' }, 404);
  const divisions = await listDivisions(env, t.id);
  const teams = await env.DB.prepare('SELECT COUNT(*) c FROM teams WHERE tournament_id=? AND status=\'active\'').bind(t.id).first();
  return json({
    slug: t.slug, name: t.name, game: t.game, region: t.region, status: t.status,
    starts_at: t.starts_at, capacity: t.capacity, team_size: t.team_size,
    registration_url: t.registration_url, discord_invite: t.discord_invite,
    teams: teams?.c || 0,
    divisions: divisions.map((d) => ({ id: d.id, name: d.name, status: d.status })),
  });
}
