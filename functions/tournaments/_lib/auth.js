// auth.js — two auth mechanisms, both on WebCrypto (Workers + Node 24):
//   1. Captain magic-link tokens: stateless HMAC-SHA256. token = b64url(payload).b64url(sig).
//      No account; the link IS the identity. We also store sha256(token) on the team so a token
//      can be revoked/rotated.
//   2. Admin: verify the Cloudflare Access JWT (Cf-Access-Jwt-Assertion) server-side so mutation
//      endpoints reject anyone without a valid Access identity, even on a direct hit.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes) {
  let s = ''; const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJSON = (obj) => b64urlEncode(enc.encode(JSON.stringify(obj)));
function parseB64urlJSON(seg) { try { return JSON.parse(dec.decode(b64urlDecode(seg))); } catch { return null; } }

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// Constant-time compare of two Uint8Arrays.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Sign a token. `opts.ttlMs` sets an expiry (exp); captain links are scoped (team+tournament),
// expiring (exp), and revocable (the team stores sha256(token); rotating invalidates the old one).
export async function signToken(secret, payload, opts = {}) {
  const iat = payload.iat || Date.now();
  const body = { ...payload, iat };
  if (opts.ttlMs) body.exp = iat + opts.ttlMs;
  else if (payload.exp) body.exp = payload.exp;
  const head = b64urlJSON(body);
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(head)));
  return `${head}.${b64urlEncode(sig)}`;
}

// Verify HMAC integrity AND expiry. Returns the payload or null. `opts.now` injectable for tests.
export async function verifyToken(secret, token, opts = {}) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [head, sig] = token.split('.');
  if (!head || !sig) return null;
  try {
    const key = await hmacKey(secret);
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(head)));
    if (!timingSafeEqual(expected, b64urlDecode(sig))) return null;
  } catch { return null; } // malformed base64 / signature -> treat as invalid, never throw
  const payload = parseB64urlJSON(head);
  if (!payload) return null;
  if (payload.exp && (opts.now || Date.now()) > payload.exp) return null; // expired
  return payload;
}

export async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Cloudflare Access JWT ----
// Verifies the RS256 Access assertion against the team's JWKS, checking aud + exp. Never throws —
// any failure returns null and (if `log` is given) reports the exact stage. `log` only ever receives
// NON-SENSITIVE detail (stage name, aud tags, kid, exp, host) — never the token or signature.
// `keyFetcher` is injectable for tests; otherwise it fetches <teamDomain>/cdn-cgi/access/certs.
export async function verifyAccessJwt(token, { teamDomain, aud, keyFetcher, now = Date.now(), log } = {}) {
  const dbg = typeof log === 'function' ? log : () => {};
  if (typeof token !== 'string') { dbg('no_token'); return null; }
  const parts = token.split('.');
  if (parts.length !== 3) { dbg('malformed_token', { segments: parts.length }); return null; }
  const header = parseB64urlJSON(parts[0]);
  const claims = parseB64urlJSON(parts[1]);
  if (!header || !claims) { dbg('unparseable_token'); return null; }
  if (header.alg !== 'RS256') { dbg('bad_alg', { alg: header.alg }); return null; }
  if (claims.exp && now / 1000 > claims.exp) { dbg('expired', { exp: claims.exp, now: Math.floor(now / 1000) }); return null; }
  if (aud) {
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) { dbg('aud_mismatch', { expected_aud: aud, token_aud: auds }); return null; }
  }
  const host = normalizeAccessDomain(teamDomain);
  let jwks;
  try { jwks = keyFetcher ? await keyFetcher() : await fetchCerts(host); }
  catch (e) { dbg('jwks_fetch_error', { host, error: String((e && e.message) || e) }); return null; }
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid) || (jwks.keys || [])[0];
  if (!jwk) { dbg('no_matching_jwk', { kid: header.kid, keys: (jwks.keys || []).length }); return null; }
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const data = enc.encode(parts[0] + '.' + parts[1]);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), data);
    if (!ok) { dbg('bad_signature', { kid: header.kid }); return null; }
    if (claims.iss && host && !String(claims.iss).includes(host)) dbg('issuer_note', { iss: claims.iss, host });
    return claims;
  } catch (e) { dbg('verify_error', { error: String((e && e.message) || e) }); return null; }
}

// Accept a team domain with or without a scheme / trailing slash — this is the bug behind a
// `https://`-prefixed CF_ACCESS_TEAM_DOMAIN producing a `https://https://…` JWKS URL.
export function normalizeAccessDomain(d) { return String(d || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, ''); }

async function fetchCerts(host) {
  const r = await fetch(`https://${host}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } });
  if (!r.ok) throw new Error('jwks_http_' + r.status);
  return r.json();
}

// test-only helpers exported for building/verifying tokens in unit tests
export const _internal = { b64urlEncode, b64urlDecode, b64urlJSON };
