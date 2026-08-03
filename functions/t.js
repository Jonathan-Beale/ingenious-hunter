// Cloudflare Pages Function — anonymous usage/telemetry collector for IH retention.
// POST /t?pw=<BETA_PASSWORD>  body: one event object or an array (batch, <=100).
// Writes each event to telemetry/<install_id>/<ts>-<rand>.json in the PRIVATE R2 bucket
// (bound as BETA_BUCKET). ANONYMOUS by design: client-generated install_id only, NO IP
// stored (coarse country from request.cf only). Password-gated to keep out random spam.
// Mirrors download.js / data/[name].js auth. Never returns data; fire-and-forget for clients.
export async function onRequestPost(context) {
  const { request, env } = context;
  const pw = new URL(request.url).searchParams.get('pw') || request.headers.get('x-beta-pw') || '';
  const expected = env.BETA_PASSWORD || '';
  let ok = expected.length > 0 && pw.length === expected.length;
  for (let i = 0; i < expected.length; i++) ok = ok && (pw.charCodeAt(i) === expected.charCodeAt(i));
  if (!ok) return json({ error: 'unauthorized' }, 401);
  if (!env.BETA_BUCKET) return json({ error: 'not_configured' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const events = Array.isArray(body) ? body : [body];
  if (events.length === 0 || events.length > 100) return json({ error: 'bad_batch' }, 400);

  const now = Date.now();
  const cc = (request.cf && request.cf.country) || null;
  let wrote = 0;
  for (const ev of events) {
    const iid = String((ev && ev.install_id) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    const name = String((ev && ev.event) || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 48);
    if (!iid || !name) continue;
    const rec = {
      install_id: iid,
      event: name,
      ts: Number(ev.ts) || now,
      version: String(ev.version || '').slice(0, 32),
      session: String(ev.session || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64),
      props: (ev.props && typeof ev.props === 'object') ? ev.props : undefined,
      cc,                 // coarse country only — no IP, no PII
      server_ts: now,
    };
    const key = `telemetry/${iid}/${rec.ts}-${Math.random().toString(36).slice(2, 8)}.json`;
    await env.BETA_BUCKET.put(key, JSON.stringify(rec), { httpMetadata: { contentType: 'application/json' } });
    wrote++;
  }
  return json({ ok: true, wrote }, 200);
}
function json(o, status) {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
