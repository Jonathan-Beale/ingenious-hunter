import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../functions/tournaments/_lib/csv.js';
import { guessMapping, normalizeRow, planImport, makeExternalRef } from '../functions/tournaments/_lib/import.js';

const HEADER = 'Timestamp,Email Address,Summoner Name (Riot ID),Discord,Current Rank,Preferred Role,Are you registering solo or as a team?,Team Name';
const rowsText = (lines) => [HEADER, ...lines].join('\n');

test('parseCSV handles quotes, commas and newlines in fields', () => {
  const csv = 'a,b,c\n1,"two, 2","line\nbreak"\n"q""x",5,6';
  const { headers, rows } = parseCSV(csv);
  assert.deepEqual(headers, ['a', 'b', 'c']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].b, 'two, 2');
  assert.equal(rows[0].c, 'line\nbreak');
  assert.equal(rows[1].a, 'q"x');
});

test('guessMapping finds the Google Form columns', () => {
  const { headers } = parseCSV(HEADER + '\n');
  const map = guessMapping(headers);
  assert.equal(map.timestamp, 'Timestamp');
  assert.equal(map.email, 'Email Address');
  assert.ok(map.riot_id);
  assert.equal(map.discord, 'Discord');
  assert.equal(map.rank, 'Current Rank');
  assert.ok(map.preferred_role);
  assert.ok(map.team_name);
});

const SAMPLE = rowsText([
  '2026-12-01 10:00:00,alice@example.com,Alice#NA1,alice#1,Gold 2,Mid,Solo,',
  '2026-12-01 10:05:00,bob@example.com,Bob#NA1,bob#2,Platinum 4,Jungle,Team,Bob\'s Team',
]);

test('idempotent import: re-importing the same CSV changes nothing', () => {
  const { rows } = parseCSV(SAMPLE);
  const map = guessMapping(parseCSV(HEADER + '\n').headers);

  // first import into an empty store
  const first = planImport(new Map(), rows, map);
  assert.equal(first.inserts.length, 2);
  assert.equal(first.updates.length, 0);

  // simulate the store now holding those participants, keyed by external_ref
  const store = new Map();
  for (const n of first.inserts) store.set(n.external_ref, { ...n, id: 'id_' + n.external_ref });

  // second import of the identical file -> everything skipped, nothing duplicated
  const second = planImport(store, rows, map);
  assert.equal(second.inserts.length, 0);
  assert.equal(second.updates.length, 0);
  assert.equal(second.skipped.length, 2);
});

test('changed field -> update (not a duplicate); same ref preserved', () => {
  const { rows } = parseCSV(SAMPLE);
  const map = guessMapping(parseCSV(HEADER + '\n').headers);
  const store = new Map();
  for (const n of planImport(new Map(), rows, map).inserts) store.set(n.external_ref, { ...n, id: 'id_' + n.external_ref });

  // Alice's rank changes; re-export has the same email -> same external_ref -> UPDATE
  const changed = rowsText([
    '2026-12-01 10:00:00,alice@example.com,Alice#NA1,alice#1,Diamond 4,Mid,Solo,',
    '2026-12-01 10:05:00,bob@example.com,Bob#NA1,bob#2,Platinum 4,Jungle,Team,Bob\'s Team',
  ]);
  const plan = planImport(store, parseCSV(changed).rows, map);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.updates[0].rank_tier, 'DIAMOND');
  assert.ok(plan.updates[0].id, 'update carries the existing participant id');
});

test('duplicate rows within one file dedupe to a single participant', () => {
  const dup = rowsText([
    '2026-12-01 10:00:00,alice@example.com,Alice#NA1,alice#1,Gold 2,Mid,Solo,',
    '2026-12-02 11:00:00,alice@example.com,Alice#NA1,alice#1,Gold 1,Mid,Solo,',
  ]);
  const map = guessMapping(parseCSV(HEADER + '\n').headers);
  const plan = planImport(new Map(), parseCSV(dup).rows, map);
  assert.equal(plan.inserts.length, 1, 'same email -> one participant');
  assert.equal(plan.deduped[0].rank_tier, 'GOLD'); // last row wins
});

test('external_ref is stable and non-reversible (no raw email)', () => {
  const map = guessMapping(parseCSV(HEADER + '\n').headers);
  const row = parseCSV(SAMPLE).rows[0];
  const ref = makeExternalRef(row, map);
  assert.equal(ref, makeExternalRef(row, map));
  assert.ok(!ref.includes('alice@example.com'));
  const n = normalizeRow(row, map);
  assert.ok(!String(n.email_hash).includes('alice@example.com'));
});
