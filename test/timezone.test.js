// timezone.test.js — event times display in US Eastern with the correct EST/EDT abbreviation,
// while the stored starts_at stays a UTC epoch (display-only fix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/d1.js';
import * as svc from '../functions/tournaments/_lib/service.js';
import { formatEventTime, onRequestGet } from '../functions/tournaments/[slug].js';

test('winter date renders in Eastern with EST (Jan 9 2027, 19:00 UTC → 2:00 PM EST)', () => {
  assert.equal(formatEventTime(Date.parse('2027-01-09T19:00:00Z')), 'Saturday, January 9, 2027 at 2:00 PM EST');
});

test('summer date renders in Eastern with EDT (Jul 10 2027, 18:00 UTC → 2:00 PM EDT)', () => {
  assert.equal(formatEventTime(Date.parse('2027-07-10T18:00:00Z')), 'Saturday, July 10, 2027 at 2:00 PM EDT');
});

test('a missing start time is handled', () => {
  assert.equal(formatEventTime(null), 'To be announced');
});

test('event page shows the Jan 9 2027 time as 2:00 PM EST, UTC timestamp unchanged in storage', async () => {
  const env = makeEnv();
  const starts = Date.parse('2027-01-09T19:00:00Z');
  const t = await svc.createTournament(env, { slug: 'tz', name: 'TZ Cup', status: 'registration', starts_at: starts });
  const res = await onRequestGet({ env, params: { slug: 'tz' }, request: new Request('https://ih.gg/tournaments/tz') });
  const html = await res.text();
  assert.match(html, /Saturday, January 9, 2027 at 2:00 PM EST/);
  assert.equal((await svc.getTournament(env, t.id)).starts_at, starts, 'stored starts_at remains the exact UTC epoch');
});
