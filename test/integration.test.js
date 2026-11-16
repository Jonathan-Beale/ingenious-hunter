import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/d1.js';
import * as svc from '../functions/tournaments/_lib/service.js';
import { parseRank } from '../functions/tournaments/_lib/rank.js';

const HEADER = 'Timestamp,Email Address,Summoner Name,Discord,Current Rank,Preferred Role,Solo or Team,Team Name';
function csv(rows) { return [HEADER, ...rows].join('\n'); }

async function newTournament(env) {
  return svc.createTournament(env, { slug: 'cup-1', name: 'IH Community Cup', capacity: 32, status: 'registration' });
}

test('idempotent import against real D1: re-import does not duplicate', async () => {
  const env = makeEnv();
  const t = await newTournament(env);
  const file = csv([
    '2026-12-01,alice@x.com,Alice,alice#1,Gold 2,Mid,Solo,',
    '2026-12-01,bob@x.com,Bob,bob#2,Platinum 4,Jungle,Solo,',
  ]);
  const r1 = await svc.importParticipants(env, t.id, file);
  assert.deepEqual([r1.inserted, r1.updated, r1.skipped], [2, 0, 0]);
  const r2 = await svc.importParticipants(env, t.id, file);
  assert.deepEqual([r2.inserted, r2.updated, r2.skipped], [0, 0, 2]);
  const count = await env.DB.prepare('SELECT COUNT(*) c FROM participants WHERE tournament_id=?').bind(t.id).first();
  assert.equal(count.c, 2);

  // a changed rank is an UPDATE, still no duplicate
  const r3 = await svc.importParticipants(env, t.id, csv([
    '2026-12-01,alice@x.com,Alice,alice#1,Diamond 1,Mid,Solo,',
    '2026-12-01,bob@x.com,Bob,bob#2,Platinum 4,Jungle,Solo,',
  ]));
  assert.deepEqual([r3.inserted, r3.updated, r3.skipped], [0, 1, 1]);
  const alice = await env.DB.prepare("SELECT * FROM participants WHERE riot_id_norm='alice'").bind().first();
  assert.equal(alice.rank_tier, 'DIAMOND');
});

// Build a division of N teams (rank-seeded) and seed the bracket.
async function seededDivision(env, t, n, { bestOf = 1, finalBestOf = 1 } = {}) {
  const div = await svc.createDivision(env, t.id, { name: 'Open', best_of_default: bestOf, final_best_of: finalBestOf });
  const teams = [];
  for (let i = 1; i <= n; i++) {
    const team = await svc.createTeam(env, t.id, { name: `Team ${i}`, division_id: div.id, seed_rank_ordinal: n - i });
    teams.push(team);
  }
  const res = await svc.seedDivision(env, div.id, { seedMethod: 'rank' });
  return { div, teams, res };
}

test('seed a 6-team division: bracket persisted with correct byes', async () => {
  const env = makeEnv();
  const t = await newTournament(env);
  const { div, res } = await seededDivision(env, t, 6);
  assert.equal(res.teams, 6);
  assert.equal(res.byes, 2); // nextPow2(6)=8 -> 2 byes
  const view = await svc.bracketView(env, div.id);
  assert.ok(view.matches.length >= 7);
  // top seeds have byes
  const byeMatches = view.matches.filter((m) => m.isBye);
  assert.equal(byeMatches.length, 2);
});

test('captain token: check-in and both-agree result confirmation advances', async () => {
  const env = makeEnv();
  const t = await newTournament(env);
  const { div } = await seededDivision(env, t, 4);
  const view = await svc.bracketView(env, div.id);
  const m = view.matches.find((x) => x.round === 1 && x.a.id && x.b.id); // a real (non-bye) round-1 match
  const tokA = await svc.issueCaptainToken(env, m.a.id);
  const tokB = await svc.issueCaptainToken(env, m.b.id);

  const ci = await svc.checkIn(env, tokA);
  assert.equal(ci.ok, true);

  // one captain reports -> awaiting
  const r1 = await svc.submitResult(env, tokA, m.id, { winner: m.a.id });
  assert.equal(r1.status, 'reported');
  // the other agrees -> confirmed + advanced
  const r2 = await svc.submitResult(env, tokB, m.id, { winner: m.a.id });
  assert.equal(r2.status, 'confirmed');
  const after = await env.DB.prepare('SELECT * FROM matches WHERE id=?').bind(m.id).first();
  assert.equal(after.winner_team_id, m.a.id);
  // winner appears in the next match
  const nxt = await env.DB.prepare('SELECT * FROM matches WHERE id=?').bind(after.next_match_id).first();
  assert.ok(nxt.team_a_id === m.a.id || nxt.team_b_id === m.a.id);
});

test('captains disagree -> disputed; admin resolves', async () => {
  const env = makeEnv();
  const t = await newTournament(env);
  const { div } = await seededDivision(env, t, 4);
  const m = (await svc.bracketView(env, div.id)).matches.find((x) => x.round === 1 && x.a.id && x.b.id);
  const tokA = await svc.issueCaptainToken(env, m.a.id);
  const tokB = await svc.issueCaptainToken(env, m.b.id);
  await svc.submitResult(env, tokA, m.id, { winner: m.a.id });
  const d = await svc.submitResult(env, tokB, m.id, { winner: m.b.id });
  assert.equal(d.status, 'disputed');
  const resolved = await svc.adminConfirm(env, m.id, { winner: m.a.id, actorId: 'admin@ih.gg' });
  assert.equal(resolved.ok, true);
});

test('concurrent confirms: exactly one wins (version guard), no double advance', async () => {
  const env = makeEnv();
  const t = await newTournament(env);
  const { div } = await seededDivision(env, t, 4);
  const m = (await svc.bracketView(env, div.id)).matches.find((x) => x.round === 1 && x.a.id && x.b.id);
  // two admins confirm different winners at the same time
  const [r1, r2] = await Promise.all([
    svc.adminConfirm(env, m.id, { winner: m.a.id, actorId: 'admin1' }),
    svc.adminConfirm(env, m.id, { winner: m.b.id, actorId: 'admin2' }),
  ]);
  const oks = [r1, r2].filter((r) => r.ok).length;
  assert.equal(oks, 1, 'exactly one confirm should apply');
  const after = await env.DB.prepare('SELECT * FROM matches WHERE id=?').bind(m.id).first();
  assert.equal(after.status, 'confirmed');
  // the next match has exactly ONE of its slots filled by this match's winner
  const nxt = await env.DB.prepare('SELECT * FROM matches WHERE id=?').bind(after.next_match_id).first();
  const filledByWinner = [nxt.team_a_id, nxt.team_b_id].filter((x) => x === after.winner_team_id).length;
  assert.equal(filledByWinner, 1);
});

test('forfeit advances the opponent; reopen + correct reverses safely', async () => {
  const env = makeEnv();
  const t = await newTournament(env);
  const { div } = await seededDivision(env, t, 4, { bestOf: 3, finalBestOf: 3 });
  const m = (await svc.bracketView(env, div.id)).matches.find((x) => x.round === 1 && x.a.id && x.b.id);
  const ff = await svc.adminForfeit(env, m.id, { loserTeamId: m.a.id, actorId: 'admin' });
  assert.equal(ff.ok, true);
  let row = await env.DB.prepare('SELECT * FROM matches WHERE id=?').bind(m.id).first();
  assert.equal(row.winner_team_id, m.b.id);
  assert.equal(row.score_b, 2); // BO3 min win

  // correct the mistake: it was actually team A 2-1
  const fix = await svc.correctResult(env, m.id, { winner: m.a.id, scoreA: 2, scoreB: 1, actorId: 'admin' });
  assert.equal(fix.ok, true);
  row = await env.DB.prepare('SELECT * FROM matches WHERE id=?').bind(m.id).first();
  assert.equal(row.winner_team_id, m.a.id);
  assert.equal(row.score_a, 2);
  // audit trail recorded the reopen + both confirms
  const log = await env.DB.prepare("SELECT action FROM audit_log WHERE entity_id=? ORDER BY created_at").bind(m.id).all();
  const actions = log.results.map((r) => r.action);
  assert.ok(actions.includes('reopen'));
  assert.ok(actions.includes('forfeit'));
});

test('cannot reopen a match whose downstream is already decided', async () => {
  const env = makeEnv();
  const t = await newTournament(env);
  const { div } = await seededDivision(env, t, 4);
  const view = await svc.bracketView(env, div.id);
  const semis = view.matches.filter((x) => x.round === 1 && x.a.id && x.b.id);
  for (const s of semis) await svc.adminConfirm(env, s.id, { winner: s.a.id, actorId: 'admin' });
  const final = (await svc.bracketView(env, div.id)).matches.find((x) => x.round === 2);
  await svc.adminConfirm(env, final.id, { winner: final.a.id, actorId: 'admin' });
  // now reopening a semifinal must fail
  await assert.rejects(() => svc.reopenMatch(env, semis[0].id, { actorId: 'admin' }), (e) => e.code === 'downstream_locked');
});
