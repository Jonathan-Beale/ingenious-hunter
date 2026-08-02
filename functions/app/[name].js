// Cloudflare Pages Function — password-gated app endpoint for IH Tier-2 binary self-update.
// GET /app/<name> : if the password matches BETA_PASSWORD, streams app/<name> from the
// PRIVATE R2 bucket (bound as BETA_BUCKET). Serves latest.json (the release manifest) and
// the updater's exe. JSON is served as application/json; anything else as an octet-stream
// download. Bindings/vars live in the Cloudflare dashboard, never in this repo. Mirrors
// download.js / data/[name].js.
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

  const obj = await env.BETA_BUCKET.get('app/' + name);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  const isJson = name.endsWith('.json');
  headers.set('content-type', isJson ? 'application/json' : 'application/octet-stream');
  headers.set('cache-control', isJson ? 'no-cache' : 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  if (!isJson) headers.set('content-disposition', 'attachment; filename="' + name + '"');
  return new Response(obj.body, { headers });
}
