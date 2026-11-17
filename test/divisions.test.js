import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRank, rankOrdinal } from '../functions/tournaments/_lib/rank.js';
import { assignDivisions, groupByDivision } from '../functions/tournaments/_lib/divisions.js';

const ord = (s) => parseRank(s).ordinal;

// Gold- (ceiling Gold I) and Plat+ (floor Plat IV), plus an Open division.
const divs = [
  { id: 'open', name: 'Open', rank_floor: null, rank_ceiling: null, sort_order: 0 },
  { id: 'goldminus', name: 'Gold-', rank_floor: null, rank_ceiling: ord('Gold 1'), sort_order: 1 },
  { id: 'platplus', name: 'Plat+', rank_floor: ord('Platinum 4'), rank_ceiling: null, sort_order: 2 },
];

test('a Challenger is placed in Plat+, never merged down into Gold-', () => {
  const { assignments, unassigned } = assignDivisions([{ id: 'chal', rank_ordinal: ord('Challenger') }], divs);
  assert.equal(assignments.chal, 'platplus');
  assert.equal(unassigned.length, 0);
});

test('a Challenger is left UNASSIGNED when only a lower division exists (no forced merge-down)', () => {
  const onlyLow = [{ id: 'goldminus', name: 'Gold-', rank_floor: null, rank_ceiling: ord('Gold 1'), sort_order: 1 }];
  const { assignments, unassigned } = assignDivisions([{ id: 'chal', rank_ordinal: ord('Challenger') }], onlyLow);
  assert.equal(assignments.chal, null);
  assert.deepEqual(unassigned, ['chal']);
});

test('a Gold player lands in Gold-', () => {
  const { assignments } = assignDivisions([{ id: 'g', rank_ordinal: ord('Gold 3') }], divs);
  assert.equal(assignments.g, 'goldminus');
});

test('an unranked entity only fits the open division', () => {
  const { assignments } = assignDivisions([{ id: 'u', rank_ordinal: null }], divs);
  assert.equal(assignments.u, 'open');
  const noOpen = divs.filter((d) => d.id !== 'open');
  const { assignments: a2, unassigned } = assignDivisions([{ id: 'u', rank_ordinal: null }], noOpen);
  assert.equal(a2.u, null);
  assert.deepEqual(unassigned, ['u']);
});

test('groupByDivision buckets correctly', () => {
  const ents = [
    { id: 'chal', rank_ordinal: ord('Challenger') },
    { id: 'g', rank_ordinal: ord('Gold 3') },
    { id: 'p', rank_ordinal: ord('Platinum 1') },
  ];
  const { assignments } = assignDivisions(ents, divs);
  const grp = groupByDivision(ents, assignments);
  assert.equal(grp.platplus.length, 2); // chal + plat
  assert.equal(grp.goldminus.length, 1);
});

test('rank ordinals increase monotonically with skill', () => {
  assert.ok(ord('Iron 4') < ord('Gold 2'));
  assert.ok(ord('Gold 2') < ord('Platinum 4'));
  assert.ok(ord('Platinum 1') < ord('Diamond 4'));
  assert.ok(ord('Diamond 1') < ord('Master'));
  assert.ok(ord('Master') < ord('Challenger'));
  assert.equal(rankOrdinal('GOLD', 1), ord('Gold 1'));
});
