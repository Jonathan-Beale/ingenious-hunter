// event_page.test.js — the public event page renders per-event branding + links from the DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/d1.js';
import * as svc from '../functions/tournaments/_lib/service.js';
import { onRequestGet } from '../functions/tournaments/[slug].js';

const render = async (env, slug) => {
  const res = await onRequestGet({ env, params: { slug }, request: new Request('https://ih.gg/tournaments/' + slug) });
  return res.text();
};

test('event page renders per-event branding tagline + registration CTA + discord from config', async () => {
  const env = makeEnv();
  await svc.createTournament(env, {
    slug: 'flex', name: 'The Flex Men Cup', status: 'registration',
    registration_url: 'https://docs.google.com/forms/d/e/ABC/viewform',
    discord_invite: 'https://discord.gg/JbrK5VeYnY',
    config: { tagline: 'Presented by Flex Men, powered by Ingenious Hunter.' },
  });
  const html = await render(env, 'flex');
  assert.match(html, /The Flex Men Cup/);
  assert.match(html, /class="tbrand">Presented by Flex Men, powered by Ingenious Hunter\./);
  assert.match(html, /viewform[^"]*" target="_blank"[^>]*>Register/); // Register CTA points at the form
  assert.match(html, /discord\.gg\/JbrK5VeYnY/);
});

test('event page omits the branding line when no tagline is configured', async () => {
  const env = makeEnv();
  await svc.createTournament(env, { slug: 'plain', name: 'Plain Cup', status: 'registration' });
  const html = await render(env, 'plain');
  assert.doesNotMatch(html, /class="tbrand"/);
});
