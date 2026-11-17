// service.js — tournament orchestration over Cloudflare D1. Ties the pure engines (bracket,
// import, divisions, results) to persistence, with optimistic-concurrency guards on advancement
// and an append-only audit trail. Depends only on the D1 prepared-statement interface
// (env.DB.prepare(sql).bind(...).first()/all()/run()), so the integration tests run this exact
// code against a node:sqlite-backed adapter.
import { genId, now } from './ids.js';
import { parseCSV } from './csv.js';
import { guessMapping, planImport } from './import.js';
import { buildBracket } from './bracket.js';
import { assignDivisions } from './divisions.js';
import { reconcile, validateReport, forfeitDecision, winsNeeded } from './results.js';
import { signToken, sha256hex } from './auth.js';

export class ServiceError extends Error { constructor(code, msg) { super(msg || code); this.code = code; this.name = 'ServiceError'; } }

// ---- tiny D1 helpers ----
const run = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).run();
const first = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).first();
async function all(env, sql, ...a) { const r = await env.DB.prepare(sql).bind(...a).all(); return r.results || r || []; }
const changed = (res) => (res && (res.meta?.changes ?? res.changes ?? 0)) || 0;

export async function audit(env, o) {
  await run(env, `INSERT INTO audit_log (id,tournament_id,actor_type,actor_id,action,entity,entity_id,before_json,after_json,note,cc,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    genId('aud'), o.tournamentId || null, o.actorType || 'system', o.actorId || null, o.action,
    o.entity || null, o.entityId || null, o.before ? JSON.stringify(o.before) : null,
    o.after ? JSON.stringify(o.after) : null, o.note || null, o.cc || null, now());
}

// ---- tournaments / divisions / teams ----
export async function createTournament(env, t) {
  const id = genId('trn'); const ts = now();
  await run(env, `INSERT INTO tournaments (id,slug,name,game,region,format,status,visibility,starts_at,checkin_opens_at,checkin_closes_at,capacity,team_size,registration_url,discord_invite,config,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, t.slug, t.name, t.game || 'League of Legends', t.region || 'NA', t.format || 'single_elim',
    t.status || 'draft', t.visibility || 'public', t.starts_at || null, t.checkin_opens_at || null,
    t.checkin_closes_at || null, t.capacity || 32, t.team_size || 5, t.registration_url || null,
    t.discord_invite || null, JSON.stringify(t.config || {}), ts, ts);
  await audit(env, { tournamentId: id, actorType: 'admin', actorId: t.actorId, action: 'create_tournament', entity: 'tournaments', entityId: id });
  return getTournament(env, id);
}
const TOURNAMENT_EDITABLE = ['name', 'status', 'visibility', 'starts_at', 'checkin_opens_at', 'checkin_closes_at', 'capacity', 'team_size', 'registration_url', 'discord_invite'];
export async function updateTournament(env, id, fields, actor = {}) {
  const sets = [], vals = [];
  for (const k of TOURNAMENT_EDITABLE) if (k in fields) { sets.push(`${k}=?`); vals.push(fields[k]); }
  if (!sets.length) return getTournament(env, id);
  sets.push('updated_at=?'); vals.push(now());
  await run(env, `UPDATE tournaments SET ${sets.join(',')} WHERE id=?`, ...vals, id);
  await audit(env, { tournamentId: id, actorType: 'admin', actorId: actor.id, action: 'update_tournament', entity: 'tournaments', entityId: id, after: fields });
  return getTournament(env, id);
}
export const getTournament = (env, id) => first(env, `SELECT * FROM tournaments WHERE id=?`, id);
export const getTournamentBySlug = (env, slug) => first(env, `SELECT * FROM tournaments WHERE slug=?`, slug);
export const listTournaments = (env, visibility = 'public') =>
  all(env, `SELECT * FROM tournaments WHERE visibility=? AND status!='archived' ORDER BY starts_at DESC, created_at DESC`, visibility);

export async function createDivision(env, tournamentId, d) {
  const id = genId('div'); const ts = now();
  await run(env, `INSERT INTO divisions (id,tournament_id,name,rank_floor,rank_ceiling,best_of_default,final_best_of,seed_method,status,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'open', ?, ?, ?)`,
    id, tournamentId, d.name, d.rank_floor ?? null, d.rank_ceiling ?? null,
    d.best_of_default || 1, d.final_best_of || 3, d.seed_method || 'rank', d.sort_order || 0, ts, ts);
  await audit(env, { tournamentId, actorType: 'admin', actorId: d.actorId, action: 'create_division', entity: 'divisions', entityId: id });
  return first(env, `SELECT * FROM divisions WHERE id=?`, id);
}
export const listDivisions = (env, tournamentId) =>
  all(env, `SELECT * FROM divisions WHERE tournament_id=? ORDER BY sort_order, created_at`, tournamentId);

export async function createTeam(env, tournamentId, t) {
  const id = genId('tm'); const ts = now();
  await run(env, `INSERT INTO teams (id,tournament_id,division_id,name,captain_participant_id,seed_rank_ordinal,status,checkin_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?, 'active','pending', ?, ?)`,
    id, tournamentId, t.division_id || null, t.name, t.captain_participant_id || null, t.seed_rank_ordinal ?? null, ts, ts);
  await audit(env, { tournamentId, actorType: 'admin', actorId: t.actorId, action: 'create_team', entity: 'teams', entityId: id });
  return first(env, `SELECT * FROM teams WHERE id=?`, id);
}
export async function addRosterMember(env, teamId, participantId, { role, isCaptain } = {}) {
  await run(env, `INSERT OR IGNORE INTO rosters (id,team_id,participant_id,role,is_captain,created_at) VALUES (?,?,?,?,?,?)`,
    genId('ros'), teamId, participantId, role || null, isCaptain ? 1 : 0, now());
  await run(env, `UPDATE participants SET team_id=?, status='assigned', updated_at=? WHERE id=?`, teamId, now(), participantId);
  if (isCaptain) await run(env, `UPDATE teams SET captain_participant_id=?, updated_at=? WHERE id=?`, participantId, now(), teamId);
}

// ---- idempotent CSV import ----
export async function importParticipants(env, tournamentId, csvText, mappingOverride, actor = {}) {
  const { headers, rows } = parseCSV(csvText);
  const map = { ...guessMapping(headers), ...(mappingOverride || {}) };
  const existing = await all(env, `SELECT * FROM participants WHERE tournament_id=?`, tournamentId);
  const byRef = new Map(existing.map((p) => [p.external_ref, p]));
  const plan = planImport(byRef, rows, map);
  const ts = now();
  for (const n of plan.inserts) {
    await run(env, `INSERT INTO participants (id,tournament_id,external_ref,kind,display_name,riot_id,riot_id_norm,discord,email_hash,rank_tier,rank_ordinal,preferred_role,proposed_team_name,status,raw_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'registered', ?, ?, ?)`,
      genId('p'), tournamentId, n.external_ref, n.kind, n.display_name, n.riot_id, n.riot_id_norm, n.discord,
      n.email_hash, n.rank_tier, n.rank_ordinal, n.preferred_role, n.proposed_team_name, n.raw_json, ts, ts);
  }
  for (const n of plan.updates) {
    await run(env, `UPDATE participants SET display_name=?,riot_id=?,riot_id_norm=?,discord=?,email_hash=?,rank_tier=?,rank_ordinal=?,preferred_role=?,proposed_team_name=?,kind=?,raw_json=?,updated_at=? WHERE id=?`,
      n.display_name, n.riot_id, n.riot_id_norm, n.discord, n.email_hash, n.rank_tier, n.rank_ordinal,
      n.preferred_role, n.proposed_team_name, n.kind, n.raw_json, ts, n.id);
  }
  await run(env, `INSERT INTO import_batches (id,tournament_id,filename,row_count,inserted,updated,skipped,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    genId('imp'), tournamentId, actor.filename || null, rows.length, plan.inserts.length, plan.updates.length, plan.skipped.length, actor.id || null, ts);
  await audit(env, { tournamentId, actorType: 'admin', actorId: actor.id, action: 'import', entity: 'participants', note: `+${plan.inserts.length} ~${plan.updates.length} =${plan.skipped.length}` });
  return { rows: rows.length, inserted: plan.inserts.length, updated: plan.updates.length, skipped: plan.skipped.length };
}

// Assign solo (unassigned) participants into divisions by rank, respecting no merge-down.
export async function autoAssignDivisions(env, tournamentId, actor = {}) {
  const divs = await listDivisions(env, tournamentId);
  const solos = await all(env, `SELECT * FROM participants WHERE tournament_id=? AND status IN ('registered','assigned') AND team_id IS NULL`, tournamentId);
  const { assignments, unassigned } = assignDivisions(solos.map((p) => ({ id: p.id, rank_ordinal: p.rank_ordinal })), divs);
  for (const p of solos) {
    const d = assignments[p.id];
    if (d) await run(env, `UPDATE participants SET division_id=?, updated_at=? WHERE id=?`, d, now(), p.id);
  }
  await audit(env, { tournamentId, actorType: 'admin', actorId: actor.id, action: 'assign_divisions', note: `assigned ${solos.length - unassigned.length}, unassigned ${unassigned.length}` });
  return { assigned: solos.length - unassigned.length, unassigned };
}

// ---- seeding / bracket ----
function nsId(divisionId, localId) { return `${divisionId}:${localId}`; }

export async function seedDivision(env, divisionId, opts = {}) {
  const div = await first(env, `SELECT * FROM divisions WHERE id=?`, divisionId);
  if (!div) throw new ServiceError('no_division');
  const teams = await all(env, `SELECT * FROM teams WHERE division_id=? AND status='active'`, divisionId);
  if (teams.length < 2) throw new ServiceError('need_two_teams', 'a division needs at least two active teams to seed');

  const existing = await all(env, `SELECT id,status FROM matches WHERE division_id=?`, divisionId);
  if (existing.some((m) => m.status === 'confirmed')) throw new ServiceError('already_started', 'cannot re-seed: results already recorded');

  const method = opts.seedMethod || div.seed_method || 'rank';
  let ordered;
  if (method === 'manual' && teams.every((t) => t.seed != null)) ordered = teams.slice().sort((a, b) => a.seed - b.seed);
  else if (method === 'random') ordered = shuffle(teams.slice(), opts.rng);
  else ordered = teams.slice().sort((a, b) => (b.seed_rank_ordinal ?? -1) - (a.seed_rank_ordinal ?? -1));
  const seededTeams = ordered.map((t, i) => ({ id: t.id, seed: i + 1 }));

  const bracket = buildBracket(seededTeams, { bestOf: div.best_of_default, finalBestOf: div.final_best_of });
  const ts = now();

  for (const m of existing) await run(env, `DELETE FROM matches WHERE id=?`, m.id);
  for (const st of seededTeams) await run(env, `UPDATE teams SET seed=?, updated_at=? WHERE id=?`, st.seed, ts, st.id);

  // Insert later rounds FIRST so next_match_id foreign keys always point at an existing row.
  const byRoundDesc = bracket.matches.slice().sort((a, b) => b.round - a.round);
  for (const m of byRoundDesc) {
    await run(env, `INSERT INTO matches (id,tournament_id,division_id,round,slot,best_of,team_a_id,team_b_id,a_seed,b_seed,winner_team_id,loser_team_id,score_a,score_b,status,is_bye,next_match_id,next_slot,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
      nsId(divisionId, m.id), div.tournament_id, divisionId, m.round, m.slot, m.bestOf, m.aTeam, m.bTeam,
      m.aSeed, m.bSeed, m.winner, m.loser, m.scoreA, m.scoreB, m.status, m.isBye ? 1 : 0,
      m.nextId ? nsId(divisionId, m.nextId) : null, m.nextSlot, ts, ts);
  }
  await run(env, `UPDATE divisions SET status='seeded', bracket_json=?, updated_at=? WHERE id=?`, JSON.stringify(await bracketView(env, divisionId)), ts, divisionId);
  await audit(env, { tournamentId: div.tournament_id, actorType: 'admin', actorId: opts.actorId, action: 'seed', entity: 'divisions', entityId: divisionId, note: `${teams.length} teams, ${bracket.matches.length} matches` });
  return { teams: teams.length, matches: bracket.matches.length, byes: bracket.matches.filter((m) => m.isBye).length };
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// Public read model for a division's bracket (safe to serve read-only).
export async function bracketView(env, divisionId) {
  const div = await first(env, `SELECT id,name,status,best_of_default,final_best_of FROM divisions WHERE id=?`, divisionId);
  const rows = await all(env, `SELECT * FROM matches WHERE division_id=? ORDER BY round, slot`, divisionId);
  const teams = await all(env, `SELECT id,name,seed,checkin_status FROM teams WHERE division_id=?`, divisionId);
  const tmap = Object.fromEntries(teams.map((t) => [t.id, t]));
  const name = (id) => (id && tmap[id] ? tmap[id].name : null);
  const matches = rows.map((m) => ({
    id: m.id, round: m.round, slot: m.slot, bestOf: m.best_of, status: m.status, isBye: !!m.is_bye,
    a: { id: m.team_a_id, name: name(m.team_a_id), seed: m.a_seed },
    b: { id: m.team_b_id, name: name(m.team_b_id), seed: m.b_seed },
    winner: m.winner_team_id, scoreA: m.score_a, scoreB: m.score_b, nextId: m.next_match_id, nextSlot: m.next_slot,
  }));
  const final = rows.find((m) => m.round === Math.max(0, ...rows.map((x) => x.round)));
  return { division: div, matches, champion: final && final.status === 'confirmed' ? name(final.winner_team_id) : null };
}

// ---- captain tokens / check-in ----
export async function issueCaptainToken(env, teamId) {
  const team = await first(env, `SELECT * FROM teams WHERE id=?`, teamId);
  if (!team) throw new ServiceError('no_team');
  const ttlDays = Number(env.TOURNEY_TOKEN_TTL_DAYS) || 45; // lasts through the event, then expires
  // nonce makes every issuance unique so rotating a team's link truly revokes the previous one.
  const token = await signToken(env.TOURNEY_TOKEN_SECRET, { t: teamId, e: team.tournament_id, k: 'captain', n: genId() }, { ttlMs: ttlDays * 86400000 });
  await run(env, `UPDATE teams SET captain_token_hash=?, updated_at=? WHERE id=?`, await sha256hex(token), now(), teamId);
  return token; // scoped (team+tournament), expiring (exp), revocable (rotating replaces the stored hash)
}

export async function resolveCaptain(env, token) {
  const { verifyToken } = await import('./auth.js');
  const payload = await verifyToken(env.TOURNEY_TOKEN_SECRET, token);
  if (!payload || payload.k !== 'captain') return null;
  const team = await first(env, `SELECT * FROM teams WHERE id=?`, payload.t);
  if (!team) return null;
  const hash = await sha256hex(token);
  if (team.captain_token_hash && team.captain_token_hash !== hash) return null; // revoked/rotated
  return team;
}

export async function checkIn(env, token) {
  const team = await resolveCaptain(env, token);
  if (!team) throw new ServiceError('bad_token');
  await run(env, `UPDATE teams SET checkin_status='checked_in', checked_in_at=?, updated_at=? WHERE id=?`, now(), now(), team.id);
  await audit(env, { tournamentId: team.tournament_id, actorType: 'captain', actorId: team.id, action: 'check_in', entity: 'teams', entityId: team.id });
  return { ok: true, team: team.id };
}

// ---- results + guarded advancement ----
async function loadMatch(env, matchId) { const m = await first(env, `SELECT * FROM matches WHERE id=?`, matchId); if (!m) throw new ServiceError('no_match'); return m; }

// Confirm a winner and advance — guarded by the match version so two concurrent confirms can't both
// apply. Returns { ok, advanced } or { ok:false, reason } on a version conflict / already-confirmed.
async function confirmAndAdvance(env, matchId, winner, scoreA, scoreB, expectedVersion, meta = {}) {
  const m = await loadMatch(env, matchId);
  if (m.status === 'confirmed') {
    return m.winner_team_id === winner ? { ok: true, idempotent: true } : { ok: false, reason: 'already_confirmed' };
  }
  const res = await run(env,
    `UPDATE matches SET status='confirmed', winner_team_id=?, loser_team_id=CASE WHEN team_a_id=? THEN team_b_id ELSE team_a_id END,
       score_a=?, score_b=?, version=version+1, confirmed_at=?, updated_at=? WHERE id=? AND status!='confirmed' AND version=?`,
    winner, winner, scoreA | 0, scoreB | 0, now(), now(), matchId, expectedVersion);
  if (changed(res) === 0) return { ok: false, reason: 'version_conflict' };

  const fresh = await loadMatch(env, matchId);
  let advanced = null;
  if (fresh.next_match_id) {
    const col = fresh.next_slot === 'a' ? 'team_a_id' : 'team_b_id';
    await run(env, `UPDATE matches SET ${col}=?, updated_at=? WHERE id=?`, winner, now(), fresh.next_match_id);
    await run(env, `UPDATE matches SET status='ready', updated_at=? WHERE id=? AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL AND status='pending'`, now(), fresh.next_match_id);
    advanced = fresh.next_match_id;
  }
  await audit(env, { tournamentId: fresh.tournament_id, actorType: meta.actorType || 'system', actorId: meta.actorId, action: meta.action || 'confirm_result', entity: 'matches', entityId: matchId, after: { winner, scoreA, scoreB, reason: meta.reason }, note: meta.note });
  return { ok: true, advanced, winner };
}

// Captain submits a result. Agreement auto-confirms; mismatch disputes.
export async function submitResult(env, token, matchId, { winner, scoreA = 0, scoreB = 0 }) {
  const team = await resolveCaptain(env, token);
  if (!team) throw new ServiceError('bad_token');
  const m = await loadMatch(env, matchId);
  if (m.division_id == null || (m.team_a_id !== team.id && m.team_b_id !== team.id)) throw new ServiceError('not_a_participant');
  validateReport(m, { teamId: team.id, winner, scoreA, scoreB, source: 'captain' });

  await run(env, `INSERT INTO result_submissions (id,match_id,team_id,claimed_winner_team_id,score_a,score_b,source,created_at)
    VALUES (?,?,?,?,?,?, 'captain', ?)
    ON CONFLICT(match_id,team_id) DO UPDATE SET claimed_winner_team_id=excluded.claimed_winner_team_id, score_a=excluded.score_a, score_b=excluded.score_b, created_at=excluded.created_at`,
    genId('sub'), matchId, team.id, winner, scoreA | 0, scoreB | 0, now());

  const subsRaw = await all(env, `SELECT * FROM result_submissions WHERE match_id=?`, matchId);
  const subs = subsRaw.map((s) => ({ teamId: s.team_id, winner: s.claimed_winner_team_id, scoreA: s.score_a, scoreB: s.score_b, source: s.source }));
  const decision = reconcile(m, subs);
  await audit(env, { tournamentId: m.tournament_id, actorType: 'captain', actorId: team.id, action: 'report_result', entity: 'matches', entityId: matchId, after: { winner, scoreA, scoreB } });

  if (decision.status === 'confirmed') {
    const r = await confirmAndAdvance(env, matchId, decision.winner, decision.scoreA, decision.scoreB, m.version, { actorType: 'captain', actorId: team.id, action: 'confirm_result', reason: decision.reason });
    return { status: r.ok ? 'confirmed' : 'pending', decision, advance: r };
  }
  await run(env, `UPDATE matches SET status=?, updated_at=? WHERE id=? AND status!='confirmed'`, decision.status, now(), matchId);
  return { status: decision.status, decision };
}

// Admin: resolve a dispute / report directly.
export async function adminConfirm(env, matchId, { winner, scoreA = 0, scoreB = 0, actorId }) {
  const m = await loadMatch(env, matchId);
  validateReport(m, { teamId: null, winner, scoreA, scoreB, source: 'admin' });
  return confirmAndAdvance(env, matchId, winner, scoreA, scoreB, m.version, { actorType: 'admin', actorId, action: 'admin_confirm', reason: 'admin_override' });
}

export async function adminForfeit(env, matchId, { loserTeamId, actorId }) {
  const m = await loadMatch(env, matchId);
  const d = forfeitDecision(m, loserTeamId, 'admin');
  return confirmAndAdvance(env, matchId, d.winner, d.scoreA, d.scoreB, m.version, { actorType: 'admin', actorId, action: 'forfeit', reason: 'forfeit' });
}

// Admin: reverse a confirmed result (score correction). Guarded so you can't orphan a decided
// downstream match — reopen that one first.
export async function reopenMatch(env, matchId, { actorId } = {}) {
  const m = await loadMatch(env, matchId);
  if (m.status !== 'confirmed') return { ok: true, idempotent: true };
  if (m.next_match_id) {
    const nxt = await loadMatch(env, m.next_match_id);
    if (nxt.status === 'confirmed') throw new ServiceError('downstream_locked', `reopen ${nxt.id} first`);
    const col = m.next_slot === 'a' ? 'team_a_id' : 'team_b_id';
    await run(env, `UPDATE matches SET ${col}=NULL, status=CASE WHEN status='ready' THEN 'pending' ELSE status END, version=version+1, updated_at=? WHERE id=?`, now(), m.next_match_id);
  }
  const before = { winner: m.winner_team_id, scoreA: m.score_a, scoreB: m.score_b };
  await run(env, `UPDATE matches SET status=CASE WHEN team_a_id IS NOT NULL AND team_b_id IS NOT NULL THEN 'ready' ELSE 'pending' END,
     winner_team_id=NULL, loser_team_id=NULL, score_a=0, score_b=0, confirmed_at=NULL, version=version+1, updated_at=? WHERE id=?`, now(), matchId);
  await run(env, `DELETE FROM result_submissions WHERE match_id=?`, matchId);
  await audit(env, { tournamentId: m.tournament_id, actorType: 'admin', actorId, action: 'reopen', entity: 'matches', entityId: matchId, before });
  return { ok: true };
}

// Admin: correct a result = reopen then re-confirm with the fixed winner/score.
export async function correctResult(env, matchId, { winner, scoreA = 0, scoreB = 0, actorId }) {
  await reopenMatch(env, matchId, { actorId });
  return adminConfirm(env, matchId, { winner, scoreA, scoreB, actorId });
}

export { winsNeeded };
