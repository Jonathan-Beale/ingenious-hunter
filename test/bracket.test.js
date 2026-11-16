import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextPow2, seedSlots, buildBracket, recordResult, reopenResult,
  bracketChampion, countByes, getMatch, BracketError,
} from '../functions/tournaments/_lib/bracket.js';

const teams = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, seed: i + 1 }));

test('nextPow2', () => {
  assert.equal(nextPow2(1), 1);
  assert.equal(nextPow2(2), 2);
  assert.equal(nextPow2(5), 8);
  assert.equal(nextPow2(32), 32);
  assert.equal(nextPow2(33), 64);
});

test('seedSlots canonical orders', () => {
  assert.deepEqual(seedSlots(2), [1, 2]);
  assert.deepEqual(seedSlots(4), [1, 4, 2, 3]);
  assert.deepEqual(seedSlots(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.equal(seedSlots(32).length, 32);
  // every seed present exactly once
  const s = seedSlots(32).slice().sort((a, b) => a - b);
  assert.deepEqual(s, Array.from({ length: 32 }, (_, i) => i + 1));
});

test('power-of-two bracket has no byes and seed 1 plays last seed', () => {
  const b = buildBracket(teams(8), { bestOf: 1 });
  assert.equal(b.size, 8);
  assert.equal(b.rounds, 3);
  assert.equal(countByes(b), 0);
  const r1 = b.matches.filter((m) => m.round === 1).sort((a, z) => a.slot - z.slot);
  assert.equal(r1.length, 4);
  // top match: seed 1 vs seed 8
  assert.deepEqual([r1[0].aSeed, r1[0].bSeed], [1, 8]);
});

for (const n of [2, 3, 5, 6, 7, 9, 13, 17, 31, 32]) {
  test(`bracket of ${n} teams: size/rounds/byes correct and byes go to TOP seeds`, () => {
    const b = buildBracket(teams(n), { bestOf: 1 });
    const size = nextPow2(n);
    assert.equal(b.size, size);
    assert.equal(b.rounds, Math.log2(size));
    assert.equal(countByes(b), size - n);
    // Every bye's advancing team must be a TOP seed (seed <= byes count).
    const byeCount = size - n;
    const byeTeams = b.matches.filter((m) => m.isBye).map((m) => m.winner);
    const topSeedIds = teams(n).filter((t) => t.seed <= byeCount).map((t) => t.id);
    for (const id of byeTeams) assert.ok(topSeedIds.includes(id), `${id} got a bye but is not a top seed`);
    // No match has two byes; byes only in round 1.
    for (const m of b.matches) {
      if (m.isBye) assert.equal(m.round, 1);
      assert.ok(!(m.aTeam && m.bTeam && m.isBye));
    }
  });
}

test('seed 1 reaches the final if it always wins (8 teams)', () => {
  const b = buildBracket(teams(8));
  // play every round, higher seed (lower number) always wins
  for (let r = 1; r <= b.rounds; r++) {
    for (const m of b.matches.filter((x) => x.round === r && x.status === 'ready')) {
      // pick the lower-seeded id by name number
      const an = Number(m.aTeam.slice(1)), bn = Number(m.bTeam.slice(1));
      recordResult(b, m.id, an < bn ? m.aTeam : m.bTeam);
    }
  }
  assert.equal(bracketChampion(b), 't1');
});

test('full 32-team bracket plays through to a single champion', () => {
  const b = buildBracket(teams(32), { bestOf: 1, finalBestOf: 3 });
  assert.equal(b.size, 32);
  assert.equal(b.rounds, 5);
  let played = 0;
  for (let r = 1; r <= b.rounds; r++) {
    for (const m of b.matches.filter((x) => x.round === r && x.status === 'ready')) {
      recordResult(b, m.id, m.aTeam); // team A always wins
      played++;
    }
  }
  assert.equal(played, 31); // a 32-team single-elim always has N-1 real matches
  const champ = bracketChampion(b);
  assert.ok(champ);
  // final is BO3 configurable
  assert.equal(getMatch(b, 'R5M0').bestOf, 3);
});

test('result recording is idempotent and rejects conflicting winners', () => {
  const b = buildBracket(teams(4));
  const m = b.matches.find((x) => x.round === 1 && x.slot === 0);
  recordResult(b, m.id, m.aTeam);
  // same winner again = no-op
  const again = recordResult(b, m.id, m.aTeam);
  assert.equal(again.idempotent, true);
  // different winner without reopening = error
  assert.throws(() => recordResult(b, m.id, m.bTeam), (e) => e instanceof BracketError && e.code === 'already_decided');
});

test('bad winner id is rejected', () => {
  const b = buildBracket(teams(4));
  const m = b.matches.find((x) => x.round === 1 && x.slot === 0);
  assert.throws(() => recordResult(b, m.id, 'nope'), (e) => e.code === 'bad_winner');
});

test('reopen reverses advancement and is guarded by downstream lock', () => {
  const b = buildBracket(teams(4)); // R1M0, R1M1 -> R2M0 (final)
  const m0 = getMatch(b, 'R1M0');
  const m1 = getMatch(b, 'R1M1');
  const final = getMatch(b, 'R2M0');
  recordResult(b, m0.id, m0.aTeam);
  recordResult(b, m1.id, m1.aTeam);
  assert.equal(final.status, 'ready');
  recordResult(b, final.id, final.aTeam);
  // cannot reopen a semifinal while the final is confirmed
  assert.throws(() => reopenResult(b, m0.id), (e) => e.code === 'downstream_locked');
  // reopen the final first: both teams remain, so it is 'ready' again (winner cleared)
  reopenResult(b, final.id);
  assert.equal(final.status, 'ready');
  assert.ok(final.aTeam && final.bTeam);
  // now the semifinal is reversible; reopening it pulls its team back out of the final
  const r = reopenResult(b, m0.id);
  assert.equal(r.ok, true);
  assert.equal(getMatch(b, m0.id).status, 'ready');
  assert.equal(final.aTeam, null);
  assert.equal(final.status, 'pending');
});

test('reopen then re-record a different winner (score correction path)', () => {
  const b = buildBracket(teams(2));
  const final = getMatch(b, 'R1M0');
  recordResult(b, final.id, final.aTeam, { a: 1, b: 0 });
  assert.equal(bracketChampion(b), final.aTeam);
  reopenResult(b, final.id);
  recordResult(b, final.id, final.bTeam, { a: 1, b: 2 });
  assert.equal(bracketChampion(b), final.bTeam);
  assert.equal(final.scoreB, 2);
});

test('single team is the champion with no matches', () => {
  const b = buildBracket(teams(1));
  assert.equal(b.matches.length, 0);
  assert.equal(bracketChampion(b), 't1');
});
