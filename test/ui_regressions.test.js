// ui_regressions.test.js — behaviors the tournament-day UI depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/d1.js';
import * as svc from '../functions/tournaments/_lib/service.js';
import { announce, embeds } from '../functions/tournaments/_lib/discord.js';

async function four() {
  const env = makeEnv();
  const t = await svc.createTournament(env, { slug: 'c', name: 'C', status: 'live' });
  const d = await svc.createDivision(env, t.id, { name: 'D', best_of_default: 1, final_best_of: 1 });
  for (let i = 1; i <= 4; i++) await svc.createTeam(env, t.id, { name: 'T' + i, division_id: d.id, seed_rank_ordinal: 5 - i });
  await svc.seedDivision(env, d.id, { seedMethod: 'rank' });
  return { env, t, d };
}
const slotOf = (match, slot) => (slot === 'a' ? match.a : match.b);

test('score correction re-points the downstream opponent (no stale advancement)', async () => {
  const { env, d } = await four();
  const v0 = await svc.bracketView(env, d.id);
  const m0 = v0.matches.filter((m) => m.round === 1)[0];
  const A = m0.a.id, B = m0.b.id;

  await svc.adminConfirm(env, m0.id, { winner: A, scoreA: 1, scoreB: 0, actorId: 'admin' });
  let nxt = (await svc.bracketView(env, d.id)).matches.find((m) => m.id === m0.nextId);
  assert.equal(slotOf(nxt, m0.nextSlot).id, A, 'winner A advanced into the next match');

  // correct the result to the other team
  await svc.correctResult(env, m0.id, { winner: B, scoreA: 0, scoreB: 1, actorId: 'admin' });
  nxt = (await svc.bracketView(env, d.id)).matches.find((m) => m.id === m0.nextId);
  assert.equal(slotOf(nxt, m0.nextSlot).id, B, 'downstream opponent is now the corrected winner B');

  const laterHasA = (await svc.bracketView(env, d.id)).matches.filter((m) => m.round > 1).some((m) => m.a.id === A || m.b.id === A);
  assert.equal(laterHasA, false, 'the replaced team no longer appears in any later round');
});

test('reopen is blocked when the downstream match is already decided (no orphaned opponents)', async () => {
  const { env, d } = await four();
  const v = await svc.bracketView(env, d.id);
  const [m0, m1] = v.matches.filter((m) => m.round === 1);
  await svc.adminConfirm(env, m0.id, { winner: m0.a.id, scoreA: 1, scoreB: 0, actorId: 'admin' });
  await svc.adminConfirm(env, m1.id, { winner: m1.a.id, scoreA: 1, scoreB: 0, actorId: 'admin' });
  const fin = (await svc.bracketView(env, d.id)).matches.find((m) => m.round === 2);
  await svc.adminConfirm(env, fin.id, { winner: fin.a.id, scoreA: 1, scoreB: 0, actorId: 'admin' });
  await assert.rejects(() => svc.reopenMatch(env, m0.id, { actorId: 'admin' }), (e) => e.code === 'downstream_locked');
});

test('discord_invite + registration_url are configurable PER EVENT (isolated between tournaments)', async () => {
  const env = makeEnv();
  const a = await svc.createTournament(env, { slug: 'ev-a', name: 'Event A', status: 'registration', discord_invite: 'https://discord.gg/AAA' });
  const b = await svc.createTournament(env, { slug: 'ev-b', name: 'Event B', status: 'registration', discord_invite: 'https://discord.gg/BBB' });
  // edit only Event A's links
  const up = await svc.updateTournament(env, a.id, { registration_url: 'https://forms.example/a', discord_invite: 'https://discord.gg/NEWA' }, { id: 'admin' });
  assert.equal(up.registration_url, 'https://forms.example/a');
  assert.equal(up.discord_invite, 'https://discord.gg/NEWA');
  // Event B is untouched — per-event, not global
  assert.equal((await svc.getTournament(env, b.id)).discord_invite, 'https://discord.gg/BBB');
});

test('raising capacity is non-destructive — existing registrations and teams are preserved', async () => {
  const env = makeEnv();
  const t = await svc.createTournament(env, { slug: 'cap', name: 'Cap Cup', status: 'registration', capacity: 32 });
  await svc.importParticipants(env, t.id, 'Response ID,Display Name,Rank,Entry Type\nR1,Alpha,Diamond 1,Team\nR2,Beta,Gold 2,Team', null, {});
  await svc.createTeam(env, t.id, { name: 'Alpha Squad' });
  const count = async (tbl) => (await env.DB.prepare('SELECT count(*) n FROM ' + tbl + ' WHERE tournament_id=?').bind(t.id).first()).n;
  const pBefore = await count('participants'), teamBefore = await count('teams');
  assert.ok(pBefore >= 2 && teamBefore >= 1, 'has registrations + a team to preserve');
  const up = await svc.updateTournament(env, t.id, { capacity: 128 }, { id: 'admin' });
  assert.equal(up.capacity, 128, 'capacity raised');
  assert.equal(await count('participants'), pBefore, 'registrations preserved');
  assert.equal(await count('teams'), teamBefore, 'teams preserved');
});

test('announcing does NOT change tournament status (lifecycle stays a separate operation)', async () => {
  const env = makeEnv(); // no DISCORD_WEBHOOK_URL configured
  const t = await svc.createTournament(env, { slug: 'a', name: 'A', status: 'registration' });
  const res = await announce(env, embeds.published(t));
  const after = await svc.getTournament(env, t.id);
  assert.equal(after.status, 'registration', 'status unchanged by an announcement');
  assert.ok(res.ok === false, 'no webhook configured → announcement is a no-op, not a status change');
});
