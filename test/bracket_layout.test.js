// bracket_layout.test.js — geometry invariants for the bracket renderer. Uses the REAL bracket
// engine to synthesize trees of several sizes (incl. byes), then checks the pure layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS } from '../assets/bracket_layout.js';
import { buildBracket } from '../functions/tournaments/_lib/bracket.js';

function tree(n) {
  const teams = Array.from({ length: n }, (_, i) => ({ id: 'T' + (i + 1), seed: i + 1 }));
  const b = buildBracket(teams, { bestOf: 1, finalBestOf: 3 });
  // adapt to the layout input shape (id/round/slot/nextId/isBye already present on engine matches)
  return { matches: b.matches.map((m) => ({ id: m.id, round: m.round, slot: m.slot, nextId: m.nextId, nextSlot: m.nextSlot, isBye: m.isBye })) };
}

const SIZES = [4, 8, 16, 32, 64];
const BYE_SIZES = [6, 12, 20, 24]; // non-powers of two → byes

for (const n of [...SIZES, ...BYE_SIZES]) {
  test(`layout: ${n} teams — every parent is centered on its children`, () => {
    const b = tree(n);
    const L = computeLayout(b);
    const byId = Object.fromEntries(L.cards.map((c) => [c.id, c]));
    const childrenOf = {};
    for (const m of b.matches) if (m.nextId != null) (childrenOf[m.nextId] = childrenOf[m.nextId] || []).push(m.id);
    for (const [pid, kids] of Object.entries(childrenOf)) {
      const want = kids.reduce((s, k) => s + byId[k].cy, 0) / kids.length;
      assert.ok(Math.abs(byId[pid].cy - want) < 0.001, `parent ${pid} cy=${byId[pid].cy} expected ${want}`);
    }
  });

  test(`layout: ${n} teams — no overlaps, columns advance, fits canvas`, () => {
    const L = computeLayout(tree(n));
    const byRound = {};
    for (const c of L.cards) (byRound[c.round] = byRound[c.round] || []).push(c);
    for (const r of Object.keys(byRound)) {
      const col = byRound[r].sort((a, b) => a.cy - b.cy);
      for (let i = 1; i < col.length; i++) {
        assert.ok(col[i].cy - col[i - 1].cy >= DEFAULTS.cardH, `round ${r}: cards overlap (${col[i - 1].cy}→${col[i].cy})`);
      }
    }
    // each round strictly to the right of the previous
    const xByRound = {};
    for (const c of L.cards) xByRound[c.round] = c.x;
    for (let r = 2; r <= L.rounds; r++) assert.ok(xByRound[r] > xByRound[r - 1], `round ${r} not right of ${r - 1}`);
    // everything inside the reported canvas
    for (const c of L.cards) {
      assert.ok(c.x >= 0 && c.x + c.w <= L.width + 0.5, `card ${c.id} x out of bounds`);
      assert.ok(c.y >= 0 && c.y + c.h <= L.height + 0.5, `card ${c.id} y out of bounds`);
    }
  });
}

test('layout is STABLE under result changes (no shift when a winner is recorded)', () => {
  const base = tree(16);
  const before = computeLayout(base);
  // simulate a live update: statuses/winners differ, structure identical
  const after = computeLayout({ matches: base.matches.map((m) => ({ ...m, status: 'confirmed', winner: 'T1', scoreA: 1, scoreB: 0 })) });
  assert.equal(before.width, after.width);
  assert.equal(before.height, after.height);
  const a = Object.fromEntries(after.cards.map((c) => [c.id, c]));
  for (const c of before.cards) {
    assert.equal(c.x, a[c.id].x, `x shifted for ${c.id}`);
    assert.equal(c.y, a[c.id].y, `y shifted for ${c.id}`);
  }
});

test('layout: connectors join each child to its parent at the parent center', () => {
  const b = tree(8);
  const L = computeLayout(b);
  const byId = Object.fromEntries(L.cards.map((c) => [c.id, c]));
  assert.ok(L.connectors.length > 0);
  for (const c of L.connectors) {
    assert.ok(Math.abs(c.y2 - byId[c.parent].cy) < 0.001, 'connector ends at parent center');
    assert.ok(Math.abs(c.y1 - byId[c.child].cy) < 0.001, 'connector starts at child center');
    assert.ok(c.x1 < c.midX && c.midX < c.x2, 'connector elbow between columns');
  }
});

test('layout: empty bracket yields an empty, zero-size canvas', () => {
  const L = computeLayout({ matches: [] });
  assert.equal(L.cards.length, 0);
  assert.equal(L.width, 0);
  assert.equal(L.height, 0);
});
