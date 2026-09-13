// Cloudflare Pages Function — PUBLIC champion-analytics site under /champions/*.
// Serves the split analytics site from the PRIVATE R2 bucket (bound as BETA_BUCKET) at
// champions/<path>, WITHOUT a password (this is public marketing/SEO content, unlike the
// gated /data and /app endpoints). Preserves nested paths (icons, per-champ data). A
// directory/navigation request (/champions/ or an extensionless path) serves
// champions/index.html so the hash-routed SPA (#<champ>/<role>/<tab>) works on deep links.
// Mirrors data/[name].js / app/[name].js, minus the BETA_PASSWORD gate, plus [[path]] nesting.
const CT = {
  html: 'text/html; charset=utf-8', json: 'application/json', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp',
  css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8',
  ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', txt: 'text/plain; charset=utf-8',
};
export async function onRequestGet(context) {
  const { env, params } = context;
  if (!env.BETA_BUCKET) {
    return new Response(JSON.stringify({ error: 'not_configured' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
  // [[path]] yields an array of segments; join and guard against traversal.
  const segs = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  let rel = segs.join('/').replace(/\.\.+/g, '').replace(/^\/+/, '');
  // navigation / directory (empty or no file extension) -> the SPA entry
  const isNav = rel === '' || !rel.split('/').pop().includes('.');
  const key = isNav ? 'champions/index.html' : 'champions/' + rel;

  let obj = await env.BETA_BUCKET.get(key);
  if (!obj && !isNav) obj = await env.BETA_BUCKET.get('champions/index.html'); // deep-link fallback -> SPA
  if (!obj) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }
  const servedKey = obj.key || key;
  const ext = servedKey.split('.').pop().toLowerCase();
  const headers = new Headers();
  obj.writeHttpMetadata(headers); // carries the content-type we set at upload
  headers.set('content-type', CT[ext] || obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('cache-control', ext === 'html' || ext === 'json' ? 'no-cache' : 'public, max-age=86400');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(obj.body, { headers });
}
