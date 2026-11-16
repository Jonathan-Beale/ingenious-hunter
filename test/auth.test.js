import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken, verifyAccessJwt, sha256hex, _internal } from '../functions/tournaments/_lib/auth.js';

const SECRET = 'test-secret-value-abc123';

test('captain token round-trips and carries the payload', async () => {
  const tok = await signToken(SECRET, { t: 'team_1', e: 'tourney_1', k: 'captain' });
  const p = await verifyToken(SECRET, tok);
  assert.equal(p.t, 'team_1');
  assert.equal(p.e, 'tourney_1');
  assert.ok(p.iat);
});

test('a tampered token fails verification', async () => {
  const tok = await signToken(SECRET, { t: 'team_1' });
  const [head, sig] = tok.split('.');
  const forgedPayload = _internal.b64urlJSON({ t: 'team_ADMIN', iat: Date.now() });
  assert.equal(await verifyToken(SECRET, `${forgedPayload}.${sig}`), null); // sig no longer matches
  assert.equal(await verifyToken(SECRET, `${head}.AAAA`), null);            // bad signature
  assert.equal(await verifyToken('wrong-secret', tok), null);              // wrong key
  assert.equal(await verifyToken(SECRET, 'garbage'), null);
});

test('token hash is stable (for storage/revocation)', async () => {
  const tok = await signToken(SECRET, { t: 'team_1' });
  assert.equal(await sha256hex(tok), await sha256hex(tok));
});

test('captain token expires', async () => {
  const tok = await signToken(SECRET, { t: 'team_1', k: 'captain' }, { ttlMs: 1000 });
  const p = await verifyToken(SECRET, tok);
  assert.ok(p && p.exp, 'exp claim is set');
  // valid now, invalid after exp
  assert.ok(await verifyToken(SECRET, tok, { now: p.iat + 500 }));
  assert.equal(await verifyToken(SECRET, tok, { now: p.exp + 1 }), null);
});

// ---- Cloudflare Access JWT ----
async function makeAccessJwt({ aud, exp, email, kid = 'k1' }) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', publicKey); jwk.kid = kid;
  const header = _internal.b64urlJSON({ alg: 'RS256', kid, typ: 'JWT' });
  const claims = _internal.b64urlJSON({ aud, exp, email });
  const data = new TextEncoder().encode(`${header}.${claims}`);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data));
  return { token: `${header}.${claims}.${_internal.b64urlEncode(sig)}`, jwks: { keys: [jwk] } };
}

test('valid Access JWT verifies with aud + exp checks', async () => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const { token, jwks } = await makeAccessJwt({ aud: 'APP_AUD', exp, email: 'admin@ih.gg' });
  const claims = await verifyAccessJwt(token, { aud: 'APP_AUD', keyFetcher: async () => jwks });
  assert.equal(claims.email, 'admin@ih.gg');
});

test('Access JWT rejected on expiry, aud mismatch, and tamper', async () => {
  const past = Math.floor(Date.now() / 1000) - 10;
  const expired = await makeAccessJwt({ aud: 'APP_AUD', exp: past, email: 'a@ih.gg' });
  assert.equal(await verifyAccessJwt(expired.token, { aud: 'APP_AUD', keyFetcher: async () => expired.jwks }), null);

  const good = await makeAccessJwt({ aud: 'APP_AUD', exp: Math.floor(Date.now() / 1000) + 600, email: 'a@ih.gg' });
  assert.equal(await verifyAccessJwt(good.token, { aud: 'OTHER_AUD', keyFetcher: async () => good.jwks }), null); // aud mismatch

  const tampered = good.token.slice(0, -4) + 'AAAA';
  assert.equal(await verifyAccessJwt(tampered, { aud: 'APP_AUD', keyFetcher: async () => good.jwks }), null); // bad sig
});
