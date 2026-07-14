// Cloudflare Pages Function — password-gated beta download.
// GET /download?pw=... : if the password matches BETA_PASSWORD, streams the beta
// file from a PRIVATE R2 bucket (bound as BETA_BUCKET). Wrong password -> 401 and
// the file/URL is never exposed. Bindings & vars are set in the Cloudflare
// dashboard (never in this repo), so no secret ships in git.
export async function onRequestGet(context) {
  const { request, env } = context;
  const pw = new URL(request.url).searchParams.get('pw') || '';

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
    return new Response(JSON.stringify({ error: 'not_configured' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
  const key = env.BETA_FILE_KEY || 'IngeniousHunter-beta.zip';
  const obj = await env.BETA_BUCKET.get(key);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('content-disposition', 'attachment; filename="' + key + '"');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(obj.body, { headers });
}
