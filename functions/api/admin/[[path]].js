// /api/admin/* — authorized admin mutations (the _middleware already verified Cloudflare Access;
// context.data.admin.email is the actor for the audit log). One router keeps the surface small.
import { json } from '../../tournaments/_lib/http.js';
import * as svc from '../../tournaments/_lib/service.js';
import { announce, embeds } from '../../tournaments/_lib/discord.js';
import { parseRank } from '../../tournaments/_lib/rank.js';

export async function onRequest(context) {
  const { request, env, params, data } = context;
  if (!env.DB) return json({ error: 'not_configured', detail: 'D1 binding DB is missing' }, 503);
  const method = request.method;
  const seg = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const actor = { id: data?.admin?.email || 'admin' };
  const body = async () => { try { return await request.json(); } catch { return {}; } };
  const origin = new URL(request.url).origin;

  try {
    // ---- tournaments ----
    if (seg[0] === 'tournaments' && seg.length === 1) {
      if (method === 'GET') return json({ tournaments: await svc.listTournaments(env, 'public').then(async (p) => p.concat(await svc.listTournaments(env, 'unlisted'), await svc.listTournaments(env, 'private'))) });
      if (method === 'POST') { const b = await body(); return json(await svc.createTournament(env, { ...b, actorId: actor.id }), 201); }
    }
    if (seg[0] === 'tournaments' && seg[1]) {
      const id = seg[1];
      if (seg[2] === 'import' && method === 'POST') { const b = await body(); return json(await svc.importParticipants(env, id, b.csv || '', b.mapping, { id: actor.id, filename: b.filename })); }
      if (seg[2] === 'assign' && method === 'POST') return json(await svc.autoAssignDivisions(env, id, actor));
      if (seg[2] === 'update' && method === 'POST') { const b = await body(); return json(await svc.updateTournament(env, id, b, actor)); }
      if (!seg[2] && method === 'GET') return json(await adminDetail(env, id));
    }
    // ---- divisions ----
    if (seg[0] === 'divisions' && seg.length === 1 && method === 'POST') {
      const b = await body();
      const rank_floor = b.floorRank ? parseRank(b.floorRank).ordinal : (b.rank_floor ?? null);
      const rank_ceiling = b.ceilingRank ? parseRank(b.ceilingRank).ordinal : (b.rank_ceiling ?? null);
      return json(await svc.createDivision(env, b.tournamentId, { ...b, rank_floor, rank_ceiling, actorId: actor.id }), 201);
    }
    if (seg[0] === 'divisions' && seg[1] && seg[2] === 'seed' && method === 'POST') { const b = await body(); return json(await svc.seedDivision(env, seg[1], { ...b, actorId: actor.id })); }
    // ---- teams ----
    if (seg[0] === 'teams' && seg.length === 1 && method === 'POST') { const b = await body(); return json(await svc.createTeam(env, b.tournamentId, { ...b, actorId: actor.id }), 201); }
    if (seg[0] === 'teams' && seg[1] && seg[2] === 'roster' && method === 'POST') { const b = await body(); await svc.addRosterMember(env, seg[1], b.participantId, b); return json({ ok: true }); }
    if (seg[0] === 'teams' && seg[1] && seg[2] === 'token' && method === 'POST') {
      const token = await svc.issueCaptainToken(env, seg[1]);
      const team = await env.DB.prepare('SELECT t.*, tr.slug FROM teams t JOIN tournaments tr ON tr.id=t.tournament_id WHERE t.id=?').bind(seg[1]).first();
      return json({ token, link: `${origin}/tournaments/${team.slug}/captain?t=${encodeURIComponent(token)}` });
    }
    // ---- matches ----
    if (seg[0] === 'matches' && seg[1] && seg[2]) {
      const mid = seg[1]; const b = await body();
      if (seg[2] === 'confirm' && method === 'POST') return json(await svc.adminConfirm(env, mid, { ...b, actorId: actor.id }));
      if (seg[2] === 'forfeit' && method === 'POST') return json(await svc.adminForfeit(env, mid, { ...b, actorId: actor.id }));
      if (seg[2] === 'correct' && method === 'POST') return json(await svc.correctResult(env, mid, { ...b, actorId: actor.id }));
      if (seg[2] === 'reopen' && method === 'POST') return json(await svc.reopenMatch(env, mid, { actorId: actor.id }));
    }
    // ---- discord announce ----
    if (seg[0] === 'announce' && method === 'POST') {
      const b = await body();
      const t = await svc.getTournament(env, b.tournamentId);
      if (!t) return json({ error: 'no_tournament' }, 404);
      const e = b.kind === 'checkin' ? embeds.checkinOpen(t) : embeds.published(t);
      return json(await announce(env, e));
    }
    return json({ error: 'not_found', path: seg }, 404);
  } catch (e) {
    return json({ error: e.code || 'error', detail: String(e.message || e) }, e.code ? 400 : 500);
  }
}

// Full admin view of one tournament.
async function adminDetail(env, id) {
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).all().then((r) => r.results);
  const t = await svc.getTournament(env, id);
  if (!t) throw Object.assign(new Error('no_tournament'), { code: 'not_found' });
  const [divisions, participants, teams, matches, audit] = await Promise.all([
    svc.listDivisions(env, id),
    q('SELECT id,external_ref,kind,display_name,riot_id,discord,rank_tier,rank_ordinal,preferred_role,proposed_team_name,team_id,division_id,status FROM participants WHERE tournament_id=? ORDER BY rank_ordinal DESC', id),
    q('SELECT * FROM teams WHERE tournament_id=? ORDER BY division_id, seed', id),
    q('SELECT id,division_id,round,slot,best_of,team_a_id,team_b_id,winner_team_id,score_a,score_b,status,is_bye,next_match_id FROM matches WHERE tournament_id=? ORDER BY division_id, round, slot', id),
    q('SELECT actor_type,actor_id,action,entity,entity_id,note,created_at FROM audit_log WHERE tournament_id=? ORDER BY created_at DESC LIMIT 100', id),
  ]);
  return { tournament: t, divisions, participants, teams, matches, audit };
}
