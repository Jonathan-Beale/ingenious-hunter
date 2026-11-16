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

export async function signToken(secret, payload) {
  const body = { ...payload, iat: payload.iat || Date.now() };
  const head = b64urlJSON(body);
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(head)));
  return `${head}.${b64urlEncode(sig)}`;
}

export async function verifyToken(secret, token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [head, sig] = token.split('.');
  if (!head || !sig) return null;
  const key = await hmacKey(secret);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(head)));
  if (!timingSafeEqual(expected, b64urlDecode(sig))) return null;
  return parseB64urlJSON(head);
}

export async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Cloudflare Access JWT ----
// Verifies the RS256 Access assertion against the team's JWKS, checking aud + exp. `keyFetcher`
// is injectable for tests; in production it fetches https://<teamDomain>/cdn-cgi/access/certs.
export async function verifyAccessJwt(token, { teamDomain, aud, keyFetcher, now = Date.now() } = {}) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = parseB64urlJSON(parts[0]);
  const claims = parseB64urlJSON(parts[1]);
  if (!header || !claims || header.alg !== 'RS256') return null;
  if (claims.exp && now / 1000 > claims.exp) return null;
  if (aud) {
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) return null;
  }
  const jwks = keyFetcher ? await keyFetcher() : await fetchCerts(teamDomain);
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid) || (jwks.keys || [])[0];
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const data = enc.encode(parts[0] + '.' + parts[1]);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), data);
  return ok ? claims : null;
}

async function fetchCerts(teamDomain) {
  const r = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } });
  if (!r.ok) throw new Error('jwks_fetch_failed');
  return r.json();
}

// test-only helpers exported for building/verifying tokens in unit tests
export const _internal = { b64urlEncode, b64urlDecode, b64urlJSON };
