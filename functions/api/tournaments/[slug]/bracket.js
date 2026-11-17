// GET /api/tournaments/:slug/bracket — read-only bracket + standings JSON. Public; the event page
// and the live bracket poll this. Short cache so it auto-updates without hammering D1.
import { json } from '../../../tournaments/_lib/http.js';
import { getTournamentBySlug, listDivisions, bracketView } from '../../../tournaments/_lib/service.js';

export async function onRequestGet({ env, params }) {
  if (!env.DB) return json({ error: 'not_configured' }, 503);
  const t = await getTournamentBySlug(env, params.slug);
  if (!t || t.visibility === 'private') return json({ error: 'not_found' }, 404);
  const divs = await listDivisions(env, t.id);
  const brackets = [];
  for (const d of divs) brackets.push(await bracketView(env, d.id));
  return json({
    tournament: { slug: t.slug, name: t.name, status: t.status, starts_at: t.starts_at },
    brackets,
  }, 200, { 'cache-control': 'public, max-age=10' });
}
