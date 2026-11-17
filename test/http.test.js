import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireAccess, accessForbidden, BUILD } from '../functions/tournaments/_lib/http.js';

const ctx = (env, headers = {}) => ({ env, request: new Request('https://ih.gg/tournaments/admin', { headers }), data: {} });

test('requireAccess records the reason + the debug flag it actually read from env', async () => {
  const c = ctx({ TOURNEY_AUTH_DEBUG: '1' }); // CF_ACCESS_* not configured
  assert.equal(await requireAccess(c), null);
  assert.equal(c.data.accessDebug, true, 'function saw TOURNEY_AUTH_DEBUG=1');
  assert.match(c.data.accessReason, /not_configured/);

  const c2 = ctx({ CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' }); // configured, no token
  assert.equal(await requireAccess(c2), null);
  assert.equal(c2.data.accessDebug, false, 'debug off when flag unset');
  assert.match(c2.data.accessReason, /no_access_token/);
});

test('accessForbidden surfaces diagnostics ONLY when debug on; clean 403 in production', async () => {
  const on = accessForbidden({ data: { accessDebug: true, accessReason: 'aud_mismatch {"expected_aud":"a"}' } }, false);
  const onText = await on.text();
  assert.equal(on.status, 403);
  assert.ok(onText.includes(`[build ${BUILD} · debug on]`), 'build + debug-on marker present');
  assert.ok(onText.includes('[auth-debug] aud_mismatch'), 'reason shown when debug on');
  assert.equal(on.headers.get('x-ih-build'), BUILD);
  assert.equal(on.headers.get('x-ih-auth-debug'), 'on');

  const off = accessForbidden({ data: { accessDebug: false, accessReason: 'no_access_token' } }, false);
  const offText = await off.text();
  assert.ok(!offText.includes('[build'), 'no build marker when debug off (clean production 403)');
  assert.ok(!offText.includes('[auth-debug]'), 'no reason leaked when debug off');
  assert.equal(off.headers.get('x-ih-build'), null, 'no debug headers when debug off');

  const api = await accessForbidden({ data: { accessDebug: true, accessReason: 'aud_mismatch' } }, true).json();
  assert.equal(api.build, BUILD);
  assert.equal(api.debug, true);
  assert.equal(api.reason, 'aud_mismatch');
});
