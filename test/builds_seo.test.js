// builds_seo.test.js — the server-rendered champion analytics block uses REAL data fields and
// states missing/low-sample data transparently (no fabrication).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { championContentBlock } from '../functions/builds/[[path]].js';

const meta = { curPatches: ['16.22'], patch: '16.21', tier: 'Gold+' };
// shape mirrors builds/data/champ/<id>.json (verified against live Ahri data)
const data = {
  '103|all': {
    cur: { g: 5319, wr: 0.5061, items: [[3118, 56, 0.5079, 2989, 'Malignance'], [3100, 40, 0.5327, 2114, 'Lich Bane']] },
    page: { keystone: { id: 8369, n: 'First Strike', w: 0.1034, g: 63 }, primary: [{ id: 8321, n: 'Cash Back', w: 0.1117, g: 35 }] },
    matchup: 1,
  },
  '103|2': { cur: { g: 4000, wr: 0.512, items: [[3118, 60, 0.51, 2400, 'Malignance']] }, page: { keystone: { id: 8369, n: 'First Strike', w: 0.09, g: 40 }, primary: [] } },
};

test('renders real champion win rate, items, runes (WPA) and internal links', () => {
  const h = championContentBlock(data, '103', 'Ahri', 'ahri', null, meta);
  assert.match(h, /Ahri build — patch 16\.22 · Gold\+/);
  assert.match(h, /Win Probability Added \(WPA\)/);
  assert.match(h, /Ahri win rate:<\/strong> 50\.6% over 5,319 games/);
  assert.match(h, /Malignance<\/span> — 50\.8% win rate, 56% pick, 2,989 games/);
  assert.match(h, /First Strike<\/span> \(WPA \+0\.103, 63 games\)/);
  assert.match(h, /href="\/builds\/ahri\/mid"/);   // other-role internal link (103|2 exists)
  assert.match(h, /href="\/builds\/patch"/);
  assert.match(h, /href="\/builds\/"/);
  assert.match(h, /Matchup-specific WPA for Ahri/);
});

test('role page uses that role’s entry', () => {
  const h = championContentBlock(data, '103', 'Ahri', 'ahri', 'mid', meta);
  assert.match(h, /Ahri Mid build/);
  assert.match(h, /51\.2% over 4,000 games/); // uses the 103|2 (mid) entry, not |all
  assert.match(h, /51\.0% win rate/);          // mid Malignance item WR
});

test('a role with no data shows a transparent note, never another role’s numbers', () => {
  // data has |all (50.6%) and |2/mid (51.2%) but NO support (|4) entry
  const h = championContentBlock(data, '103', 'Ahri', 'ahri', 'support', meta);
  assert.match(h, /still being collected/);
  assert.doesNotMatch(h, /win rate:<\/strong>/); // no win-rate stat line rendered at all
  assert.doesNotMatch(h, /50\.6%/);              // not the |all aggregate number
  assert.doesNotMatch(h, /51\.2%/);              // not the mid number
  assert.doesNotMatch(h, /Malignance/);          // not any item from another entry
});

test('aggregate page with no |all entry does not borrow a role entry', () => {
  // only a mid (|2) entry exists, no |all — the aggregate page must not present it as the whole champ
  const d = { '7|2': { cur: { g: 4000, wr: 0.57, items: [[3118, 60, 0.55, 2000, 'Malignance']] }, page: {} } };
  const h = championContentBlock(d, '7', 'Solo', 'solo', null, meta);
  assert.match(h, /still being collected/);
  assert.doesNotMatch(h, /57\.0%/);              // never shows the mid entry as if it were aggregate
  assert.doesNotMatch(h, /55\.0% win rate/);
});

test('missing data is stated transparently, never fabricated', () => {
  const h = championContentBlock({ '1|all': { cur: {}, page: {} } }, '1', 'Nodata', 'nodata', null, meta);
  assert.match(h, /still being collected/);
  assert.doesNotMatch(h, /\d+% win rate/); // no invented numbers
});

test('low sample is flagged', () => {
  const h = championContentBlock({ '7|all': { cur: { g: 24, wr: 0.3333, items: [] }, page: {} } }, '7', 'Thin', 'thin', null, meta);
  assert.match(h, /33\.3% over 24 games/);
  assert.match(h, /limited sample this patch/);
});
