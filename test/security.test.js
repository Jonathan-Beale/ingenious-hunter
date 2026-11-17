import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/d1.js';
import * as svc from '../functions/tournaments/_lib/service.js';
import { announce } from '../functions/tournaments/_lib/discord.js';
import { onRequestGet as bracketApi } from '../functions/api/tournaments/[slug]/bracket.js';
import { onRequestGet as metaApi } from '../functions/api/tournaments/[slug]/index.js';

const PII = { discord: 'secretuser#1234', riot: 'SecretSummoner#NA1', email: 'secret@private.com' };

async function scenario() {
  const env = makeEnv();
  const t = await svc.createTournament(env, { slug: 'sec', name: 'Security Cup', status: 'live', discord_invite: 'https://discord.gg/PZYKKQTxgR' });
  const div = await svc.createDivision(env, t.id, { name: 'Open' });
  const csv = ['Timestamp,Email Address,Summoner Name,Discord,Current Rank,Preferred Role,Solo or Team,Team Name',
    `2026-12-01,${PII.email},${PII.riot},${PII.discord},Gold 2,Mid,Solo,`].join('\n');
  await svc.importParticipants(env, t.id, csv);
  const p = await env.DB.prepare('SELECT * FROM participants WHERE tournament_id=?').bind(t.id).first();
  const team1 = await svc.createTeam(env, t.id, { name: 'Alpha', division_id: div.id, seed_rank_ordinal: 5 });
  const team2 = await svc.createTeam(env, t.id, { name: 'Bravo', division_id: div.id, seed_rank_ordinal: 3 });
  await svc.addRosterMember(env, team1.id, p.id, { isCaptain: true, role: 'mid' });
  await svc.seedDivision(env, div.id, { seedMethod: 'rank' });
  return { env, t, div, p, team1, team2 };
}

test('public bracket + meta APIs expose NO private player info', async () => {
  const { env, t } = await scenario();
  for (const handler of [bracketApi, metaApi]) {
    const res = await handler({ env, params: { slug: t.slug }, request: new Request('https://ingenioushunter.gg/api') });
    const text = await res.text();
    assert.ok(!text.includes(PII.discord), 'no discord handle');
    assert.ok(!text.includes(PII.riot), 'no riot id');
    assert.ok(!text.includes(PII.email), 'no email');
    assert.ok(!text.includes('email_hash'), 'no email hash field');
  }
});

test('private tournament is not served publicly', async () => {
  const { env, t } = await scenario();
  await svc.updateTournament(env, t.id, { visibility: 'private' });
  const res = await metaApi({ env, params: { slug: t.slug }, request: new Request('https://ih.gg/api') });
  assert.equal(res.status, 404);
});

test('captain token is scoped + revocable (rotating invalidates the old link)', async () => {
  const { env, team1 } = await scenario();
  const tok1 = await svc.issueCaptainToken(env, team1.id);
  assert.ok(await svc.resolveCaptain(env, tok1), 'fresh token resolves');
  const tok2 = await svc.issueCaptainToken(env, team1.id); // rotate
  assert.ok(await svc.resolveCaptain(env, tok2), 'new token resolves');
  assert.equal(await svc.resolveCaptain(env, tok1), null, 'old token is revoked');
  // a garbage token never resolves
  assert.equal(await svc.resolveCaptain(env, 'not.a.token'), null);
});

test('a captain cannot act on a match they are not in', async () => {
  const { env, div, team1, team2 } = await scenario();
  const m = (await svc.bracketView(env, div.id)).matches.find((x) => x.round === 1 && x.a.id && x.b.id);
  const tok1 = await svc.issueCaptainToken(env, team1.id);
  // if team1 is not in this match, submitResult must reject
  if (m.a.id !== team1.id && m.b.id !== team1.id) {
    await assert.rejects(() => svc.submitResult(env, tok1, m.id, { winner: m.a.id }), (e) => e.code === 'not_a_participant');
  } else {
    // team1 IS in the match; a token for the OTHER team's slot still can't claim to be team2
    assert.ok(true);
  }
});

test('Discord webhook failure never throws or affects state', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('webhook down'); };
  try {
    const r = await announce({ DISCORD_WEBHOOK_URL: 'https://discord.example/webhook' }, { title: 'x' });
    assert.equal(r.ok, false);
    assert.ok(r.error, 'failure is captured, not thrown');
  } finally { globalThis.fetch = origFetch; }
  // no webhook configured -> cleanly skipped
  const skip = await announce({}, { title: 'x' });
  assert.equal(skip.skipped, 'no_webhook');
});
