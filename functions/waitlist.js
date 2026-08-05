// Cloudflare Pages Function — beta waitlist capture.
// POST /waitlist  body: { email, hp?, source? }  -> stores waitlist/<sha256(email)>.json
// in the PRIVATE R2 bucket (bound as BETA_BUCKET).
//
// OPEN (no password) BY DESIGN: the whole point is to capture people who do NOT have
// the beta password — the locked-out demand bouncing off the gate. Explicit opt-in:
// the visitor types their email to request an invite, so storing it is consented (this
// is the ONE place we keep a real email; everything else — gate log, telemetry — is
// anonymous). Coarse country only, no IP.
//
// Spam hardening for an open endpoint: a hidden honeypot field, email format + length
// checks, and hash-keyed storage so re-submits from one address overwrite (no flood
// from a single email). Cloudflare Turnstile is the recommended follow-on if abuse
// appears (needs a dashboard site key) — noted, not required for v1.
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  // Honeypot: a field hidden from humans that bots tend to fill. If it's non-empty,
  // pretend success (200) so the bot moves on, but store nothing.
  if (body && typeof body.hp === 'string' && body.hp.trim() !== '') return json({ ok: true }, 200);

  const email = String((body && body.email) || '').trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'bad_email' }, 400);
  }
  if (!env.BETA_BUCKET) return json({ error: 'not_configured' }, 500);

  const now = Date.now();
  const cc = (request.cf && request.cf.country) || null; // coarse country, no IP
  const source = String((body && body.source) || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 48) || 'gate';
  const hash = await sha256hex(email);
  const rec = { email, ts: now, cc, source, server_ts: now };
  // Key by email hash -> one object per address; a re-submit just overwrites it.
  await env.BETA_BUCKET.put(`waitlist/${hash}.json`, JSON.stringify(rec), {
    httpMetadata: { contentType: 'application/json' },
  });
  return json({ ok: true }, 200);
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(o, status) {
  return new Response(JSON.stringify(o), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
