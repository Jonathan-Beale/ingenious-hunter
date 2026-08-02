// Cloudflare Pages Function — password-gated data endpoint for IH auto-update.
// GET /data/<name> : if the password matches BETA_PASSWORD, streams data/<name> from
// the PRIVATE R2 bucket (bound as BETA_BUCKET). Used by the client's Tier-1 hot-update
// to fetch manifest.json + the WPA tables. Bindings/vars are set in the Cloudflare
// dashboard (never in this repo), so no secret ships in git. Mirrors download.js.
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const pw = new URL(request.url).searchParams.get('pw')
          || request.headers.get('x-beta-pw') || '';

  const expected = env.BETA_PASSWORD || '';
  // length-independent comparison to avoid trivial timing leaks
  let ok = expected.length > 0 && pw.length === expected.length;
  for (let i = 0; i < expected.length; i++) ok = ok && (pw.charCodeAt(i) === expected.charCodeAt(i));
  if (!ok) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  if (!env.BETA_BUCKET) {
    return new Response(JSON.stringify({ error: 'not_configured' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }

  const name = params.name || '';
  // path-traversal / injection guard: plain filenames only (no slashes, no ..)
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    return new Response(JSON.stringify({ error: 'bad_name' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  const obj = await env.BETA_BUCKET.get('data/' + name);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('content-type', 'application/json');
  headers.set('cache-control', 'no-cache');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(obj.body, { headers });
}
