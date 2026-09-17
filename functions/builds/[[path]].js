// Cloudflare Pages Function — PUBLIC champion-analytics site under /builds/*.
// Serves the split analytics site from the PRIVATE R2 bucket (BETA_BUCKET) at builds/<path>,
// ungated (public SEO content). Preserves nested paths. Navigations serve builds/index.html so the
// SPA works. For a CHAMPION path (/builds/<slug>) it injects per-champion <title>/description/
// canonical SERVER-SIDE (so each of the 173 pages is distinct + indexable, not one duplicate title
// until JS runs). Mirrors data/[name].js / app/[name].js minus the password gate.
const CT = {
  html: 'text/html; charset=utf-8', json: 'application/json', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp',
  css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8',
  ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', txt: 'text/plain; charset=utf-8',
};
const ESC = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let SLUGS = null; // per-isolate cache of slug -> champion display name
async function getSlugs(env) {
  if (SLUGS) return SLUGS;
  try { const o = await env.BETA_BUCKET.get('builds/slugs.json'); SLUGS = o ? JSON.parse(await o.text()) : {}; }
  catch (_) { SLUGS = {}; }
  return SLUGS;
}
const ROLE_SET = new Set(['top', 'jungle', 'mid', 'bot', 'support', 'all']);
const RDISP = { top: 'Top', jungle: 'Jungle', mid: 'Mid', bot: 'Bot', support: 'Support' };
// The site is served under /builds/, but a role path (/builds/<slug>/<role>) is two levels deep, so
// the browser would resolve relative URLs (icons, data/champ/*.json) against /builds/<slug>/ and 404.
// A single <base href="/builds/"> pins every relative URL to the site root at any path depth.
const withBase = (h) => h.includes('<base ') ? h : h.replace('<meta charset="utf-8">', '<meta charset="utf-8"><base href="/builds/">');
function injectMeta(html, name, slug, role) {
  const n = ESC(name);
  const rlRaw = role && RDISP[role] ? ' ' + RDISP[role] : '';     // '' for 'all' or none
  const rl = ESC(rlRaw);
  const title = n + rl + ' Build &amp; Win Rate — Best Items, Runes · Ingenious Hunter';
  const desc = 'Causal Win-Probability ' + (rlRaw ? ESC(RDISP[role]) + ' ' : '') + 'build for ' + n
    + ': the items, runes and summoners that measurably raise win rate in Gold+ ranked games — not scraped pick-rates.';
  const canon = 'https://ingenioushunter.gg/builds/' + slug + (role && role !== 'all' ? '/' + role : '');
  // JSON-LD (raw text, not HTML-escaped): WebPage + breadcrumb for rich results.
  const nameRaw = name + rlRaw;
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebPage',
    name: nameRaw + ' Build & Win Rate',
    url: canon,
    description: 'Causal Win-Probability ' + (rlRaw ? RDISP[role] + ' ' : '') + 'build for ' + name
      + ': items, runes and summoners that measurably raise win rate in Gold+ ranked games.',
    isPartOf: { '@type': 'WebSite', name: 'Ingenious Hunter', url: 'https://ingenioushunter.gg' },
    breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Champion Builds', item: 'https://ingenioushunter.gg/builds/' },
      { '@type': 'ListItem', position: 2, name: nameRaw + ' Build', item: canon },
    ] },
  };
  const ldTag = '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';
  return withBase(html
    .replace(/<title>[^<]*<\/title>/, '<title>' + title + '</title>')
    .replace(/(<meta name="description" content=")[^"]*(">)/, '$1' + desc + '$2')
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, '$1' + n + rl + ' Build &amp; Runes · Ingenious Hunter$2')
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, '$1' + desc + '$2')
    .replace(/(<link rel="canonical" href=")[^"]*(">)/, '$1' + canon + '$2')
    .replace('</head>', ldTag + '</head>'));
}
// Hub: inject a crawlable "All champions" index (real /builds/<slug> links) before </body>, so the
// hub page links to all 173 champion pages for internal-linking / crawl (SPA content stays above it).
function injectHubIndex(html, map) {
  const links = Object.entries(map).sort((a, b) => a[1].localeCompare(b[1]))
    .map(([slug, name]) => '<a href="/builds/' + slug + '">' + ESC(name) + '</a>').join('');
  const nav = '<nav class="champ-index" aria-label="All champions"><h2>All champion builds</h2>' + links + '</nav>'
    + '<style>.champ-index{max-width:1120px;margin:26px auto 44px;padding:0 20px}.champ-index h2{font-family:var(--fh,inherit);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#8a8f98;margin:0 0 12px}.champ-index a{display:inline-block;margin:0 12px 7px 0;color:#cfd3dc;text-decoration:none;font-size:13px;font-weight:600}.champ-index a:hover{color:#ff3b3b}</style>';
  return withBase(html.replace('</body>', nav + '</body>'));
}
export async function onRequestGet(context) {
  const { env, params } = context;
  if (!env.BETA_BUCKET) return new Response(JSON.stringify({ error: 'not_configured' }), { status: 500, headers: { 'content-type': 'application/json' } });
  const segs = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const rel = segs.join('/').replace(/\.\.+/g, '').replace(/^\/+/, '');
  const isNav = rel === '' || !rel.split('/').pop().includes('.');
  // champion page: /builds/<slug> or /builds/<slug>/<role> -> per-page (role-aware) meta
  if (isNav && rel) {
    const parts = rel.toLowerCase().split('/');
    if (parts.length <= 2) {
      const name = (await getSlugs(env))[parts[0]];
      if (name) {
        const role = ROLE_SET.has(parts[1]) ? parts[1] : null;   // ignore an unknown 2nd segment
        const idx = await env.BETA_BUCKET.get('builds/index.html');
        if (idx) return new Response(injectMeta(await idx.text(), name, parts[0], role),
          { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' } });
      }
    }
  }
  // static content page: /builds/<name> -> builds/<name>.html (e.g. /builds/patch, the patch report)
  if (isNav && rel && !rel.includes('/')) {
    const page = await env.BETA_BUCKET.get('builds/' + rel.toLowerCase() + '.html');
    if (page) return new Response(withBase(await page.text()),
      { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' } });
  }
  // hub (/builds/): inject the crawlable champion index
  if (isNav && rel === '') {
    const idx = await env.BETA_BUCKET.get('builds/index.html');
    if (idx) return new Response(injectHubIndex(await idx.text(), await getSlugs(env)),
      { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' } });
  }
  const key = isNav ? 'builds/index.html' : 'builds/' + rel;
  let obj = await env.BETA_BUCKET.get(key);
  if (!obj && !isNav) obj = await env.BETA_BUCKET.get('builds/index.html'); // deep-link fallback -> SPA
  if (!obj) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  const servedKey = obj.key || key;
  const ext = servedKey.split('.').pop().toLowerCase();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('content-type', CT[ext] || obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('cache-control', ext === 'html' || ext === 'json' ? 'no-cache' : 'public, max-age=86400');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(obj.body, { headers });
}
