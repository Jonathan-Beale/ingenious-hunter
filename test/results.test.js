import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, validateReport, forfeitDecision, winsNeeded, ResultError } from '../functions/tournaments/_lib/results.js';

const match = (over = {}) => ({ team_a_id: 'A', team_b_id: 'B', best_of: 1, is_bye: 0, ...over });

test('winsNeeded', () => {
  assert.equal(winsNeeded(1), 1);
  assert.equal(winsNeeded(3), 2);
  assert.equal(winsNeeded(5), 3);
});

test('validateReport enforces participants, valid winner, and BO3 scoreline', () => {
  const m = match({ best_of: 3 });
  assert.throws(() => validateReport(m, { teamId: 'X', winner: 'A' }), (e) => e.code === 'not_a_participant');
  assert.throws(() => validateReport(m, { teamId: 'A', winner: 'Z' }), (e) => e.code === 'bad_winner');
  assert.throws(() => validateReport(m, { teamId: 'A', winner: 'A', scoreA: 1, scoreB: 0 }), (e) => e.code === 'bad_score'); // BO3 needs 2
  assert.equal(validateReport(m, { teamId: 'A', winner: 'A', scoreA: 2, scoreB: 1 }), true);
  // admin may report without being a participant
  assert.equal(validateReport(m, { teamId: null, winner: 'B', scoreA: 0, scoreB: 2, source: 'admin' }), true);
});

test('one captain report -> reported (awaiting the other)', () => {
  const d = reconcile(match(), [{ teamId: 'A', winner: 'A', scoreA: 1, scoreB: 0 }]);
  assert.equal(d.status, 'reported');
});

test('both captains agree -> confirmed', () => {
  const d = reconcile(match(), [
    { teamId: 'A', winner: 'A', scoreA: 1, scoreB: 0 },
    { teamId: 'B', winner: 'A', scoreA: 1, scoreB: 0 },
  ]);
  assert.equal(d.status, 'confirmed');
  assert.equal(d.winner, 'A');
  assert.equal(d.reason, 'both_agree');
});

test('captains disagree on winner -> disputed', () => {
  const d = reconcile(match(), [
    { teamId: 'A', winner: 'A', scoreA: 1, scoreB: 0 },
    { teamId: 'B', winner: 'B', scoreA: 0, scoreB: 1 },
  ]);
  assert.equal(d.status, 'disputed');
});

test('agree on winner but mismatched scores -> confirmed with a flag', () => {
  const d = reconcile(match({ best_of: 3 }), [
    { teamId: 'A', winner: 'A', scoreA: 2, scoreB: 1 },
    { teamId: 'B', winner: 'A', scoreA: 2, scoreB: 0 },
  ]);
  assert.equal(d.status, 'confirmed');
  assert.equal(d.reason, 'both_agree_winner_score_mismatch');
});

test('admin override confirms regardless of captain reports', () => {
  const d = reconcile(match(), [
    { teamId: 'A', winner: 'A', scoreA: 1, scoreB: 0 },
    { teamId: 'B', winner: 'B', scoreA: 0, scoreB: 1 },
    { source: 'admin', winner: 'B', scoreA: 0, scoreB: 1 },
  ]);
  assert.equal(d.status, 'confirmed');
  assert.equal(d.winner, 'B');
  assert.equal(d.reason, 'admin_override');
});

test('forfeit gives the opponent the minimum series win', () => {
  const d = forfeitDecision(match({ best_of: 3 }), 'A');
  assert.equal(d.winner, 'B');
  assert.equal(d.scoreB, 2);
  assert.equal(d.scoreA, 0);
  assert.equal(d.forfeit, true);
  assert.throws(() => forfeitDecision(match(), 'Z'), (e) => e instanceof ResultError);
});

test('no reports on a ready match -> ready', () => {
  assert.equal(reconcile(match(), []).status, 'ready');
  assert.equal(reconcile(match({ team_b_id: null }), []).status, 'pending');
});
