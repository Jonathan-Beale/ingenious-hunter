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
export function injectMeta(html, name, slug, role, ogImage) {
  const n = ESC(name);
  const rlRaw = role && RDISP[role] ? ' ' + RDISP[role] : '';     // '' for 'all' or none
  const rl = ESC(rlRaw);
  const title = n + rl + ' Build &amp; Win Rate — Best Items, Runes · Ingenious Hunter';
  const desc = n + rl + ' build ranked by Win Probability Added (WPA): the items, runes and summoners that measurably raise win rate in Gold+ ranked games — not scraped pick-rates.';
  const canon = 'https://ingenioushunter.gg/builds/' + slug + (role && role !== 'all' ? '/' + role : '');
  // JSON-LD (raw text, not HTML-escaped): WebPage + breadcrumb for rich results.
  const nameRaw = name + rlRaw;
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebPage',
    name: nameRaw + ' Build & Win Rate',
    url: canon,
    description: nameRaw + ' build ranked by Win Probability Added (WPA): items, runes and summoners that measurably raise win rate in Gold+ ranked games.',
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
    .replace(/(<meta property="og:image" content=")[^"]*(">)/, ogImage ? '$1' + ESC(ogImage) + '$2' : '$&')
    .replace(/(<meta name="twitter:image" content=")[^"]*(">)/, ogImage ? '$1' + ESC(ogImage) + '$2' : '$&')
    .replace('</head>', ldTag + '</head>'));
}
// Hub: inject a crawlable "All champions" index (real /builds/<slug> links) before </body>, so the
// hub page links to all 173 champion pages for internal-linking / crawl (SPA content stays above it).
function injectHubIndex(html, map) {
  const links = Object.entries(map).map(([slug, rec]) => [slug, typeof rec === 'string' ? rec : ((rec && rec.n) || slug)])
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([slug, nm]) => '<a href="/builds/' + slug + '">' + ESC(nm) + '</a>').join('');
  const nav = '<nav class="champ-index" aria-label="All champions"><h2>All champion builds</h2>' + links + '</nav>'
    + '<style>.champ-index{max-width:1120px;margin:26px auto 44px;padding:0 20px}.champ-index h2{font-family:var(--fh,inherit);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#b5bac4;margin:0 0 12px;text-shadow:0 1px 10px rgba(0,0,0,.92),0 0 3px rgba(0,0,0,.95)}.champ-index a{display:inline-block;margin:0 12px 7px 0;color:#e2e5ea;text-decoration:none;font-size:13px;font-weight:600;text-shadow:0 1px 10px rgba(0,0,0,.92),0 0 3px rgba(0,0,0,.95)}.champ-index a:hover{color:#ff3b3b}</style>';
  return withBase(html.replace('</body>', nav + '</body>'));
}
// --- Server-side champion analytics (real data from builds/data/champ/<numericId>.json) ---
let META = null;      // per-isolate cache: builds/data/meta.json .meta
const ROLE_IDX = { top: 0, jungle: 1, mid: 2, bot: 3, support: 4 };
// Static DDragon key -> numeric champion id for every current champion (from champion.json 16.23.1).
// Baked in so the hot path needs NO external fetch: faster cold requests, and a transient DDragon
// outage can never blank champion SSR. DDragon is consulted only for a champion NEWER than this map
// (and never caches a failure). Regenerate when a new champion ships.
const CHAMP_ID_MAP = { Aatrox:'266',Ahri:'103',Akali:'84',Akshan:'166',Alistar:'12',Ambessa:'799',Amumu:'32',Anivia:'34',Annie:'1',Aphelios:'523',Ashe:'22',AurelionSol:'136',Aurora:'893',Azir:'268',Bard:'432',Belveth:'200',Blitzcrank:'53',Brand:'63',Braum:'201',Briar:'233',Caitlyn:'51',Camille:'164',Cassiopeia:'69',Chogath:'31',Corki:'42',Darius:'122',Diana:'131',Draven:'119',DrMundo:'36',Ekko:'245',Elise:'60',Evelynn:'28',Ezreal:'81',Fiddlesticks:'9',Fiora:'114',Fizz:'105',Galio:'3',Gangplank:'41',Garen:'86',Gnar:'150',Gragas:'79',Graves:'104',Gwen:'887',Hecarim:'120',Heimerdinger:'74',Hwei:'910',Illaoi:'420',Irelia:'39',Ivern:'427',Janna:'40',JarvanIV:'59',Jax:'24',Jayce:'126',Jhin:'202',Jinx:'222',Kaisa:'145',Kalista:'429',Karma:'43',Karthus:'30',Kassadin:'38',Katarina:'55',Kayle:'10',Kayn:'141',Kennen:'85',Khazix:'121',Kindred:'203',Kled:'240',KogMaw:'96',KSante:'897',Leblanc:'7',LeeSin:'64',Leona:'89',Lillia:'876',Lissandra:'127',Locke:'805',Lucian:'236',Lulu:'117',Lux:'99',Malphite:'54',Malzahar:'90',Maokai:'57',MasterYi:'11',Mel:'800',Milio:'902',MissFortune:'21',MonkeyKing:'62',Mordekaiser:'82',Morgana:'25',Naafiri:'950',Nami:'267',Nasus:'75',Nautilus:'111',Neeko:'518',Nidalee:'76',Nilah:'895',Nocturne:'56',Nunu:'20',Olaf:'2',Orianna:'61',Ornn:'516',Pantheon:'80',Poppy:'78',Pyke:'555',Qiyana:'246',Quinn:'133',Rakan:'497',Rammus:'33',RekSai:'421',Rell:'526',Renata:'888',Renekton:'58',Rengar:'107',Riven:'92',Rumble:'68',Ryze:'13',Samira:'360',Sejuani:'113',Senna:'235',Seraphine:'147',Sett:'875',Shaco:'35',Shen:'98',Shyvana:'102',Singed:'27',Sion:'14',Sivir:'15',Skarner:'72',Smolder:'901',Sona:'37',Soraka:'16',Swain:'50',Sylas:'517',Syndra:'134',TahmKench:'223',Taliyah:'163',Talon:'91',Taric:'44',Teemo:'17',Thresh:'412',Tristana:'18',Trundle:'48',Tryndamere:'23',TwistedFate:'4',Twitch:'29',Udyr:'77',Urgot:'6',Varus:'110',Vayne:'67',Veigar:'45',Velkoz:'161',Vex:'711',Vi:'254',Viego:'234',Viktor:'112',Vladimir:'8',Volibear:'106',Warwick:'19',Xayah:'498',Xerath:'101',XinZhao:'5',Yasuo:'157',Yone:'777',Yorick:'83',Yunara:'804',Yuumi:'350',Zaahen:'904',Zac:'154',Zed:'238',Zeri:'221',Ziggs:'115',Zilean:'26',Zoe:'142',Zyra:'143' };
let CHAMP_IDS_DD = null; // per-isolate cache of a SUCCESSFUL DDragon fetch (forward-compat for new champs only)
// Resolve a DDragon key ("Blitzcrank") to its numeric id ("53"). Static map first (no network);
// DDragon only for a champion absent from the map, and that result caches ONLY on success so a
// transient outage is retried next request instead of being cached as empty.
async function resolveChampId(key) {
  if (!key) return null;
  if (CHAMP_ID_MAP[key]) return CHAMP_ID_MAP[key];
  try {
    if (!CHAMP_IDS_DD) {
      const vers = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
      const cj = await (await fetch('https://ddragon.leagueoflegends.com/cdn/' + vers[0] + '/data/en_US/champion.json')).json();
      const m = {}; for (const k of Object.keys(cj.data)) m[k] = cj.data[k].key;
      CHAMP_IDS_DD = m; // cache only on success
    }
    return CHAMP_IDS_DD[key] || null;
  } catch (_) { return null; } // transient: nothing cached, retried next request
}
async function getMeta(env) {
  if (META) return META;
  try { const o = await env.BETA_BUCKET.get('builds/data/meta.json'); META = o ? (JSON.parse(await o.text()).meta || {}) : {}; }
  catch (_) { META = {}; }
  return META;
}
const fmtPct = (x) => (typeof x === 'number' && isFinite(x)) ? (x * 100).toFixed(1) + '%' : null;
const fmtInt = (x) => (typeof x === 'number' && isFinite(x)) ? Math.round(x).toLocaleString('en-US') : null;
const fmtWpa = (x) => (typeof x === 'number' && isFinite(x)) ? (x >= 0 ? '+' : '') + x.toFixed(3) : null;

// Build a crawlable, accurate analytics block from the champion's actual data. Real numbers only;
// missing/low-sample data is stated transparently. Injected into the initial HTML (crawlers see it
// without running JS); the interactive SPA stays above it untouched.
export function championContentBlock(data, numId, name, slug, role, meta) {
  const roleDisp = role ? RDISP[role] : '';
  // A role page uses ONLY that role's entry; the aggregate page uses ONLY the |all entry. Never fall
  // back to a different role (which would mislabel another role's numbers under this heading) or to an
  // arbitrary champion key — a missing entry is handled transparently below instead.
  const entry = role ? data[numId + '|' + ROLE_IDX[role]] : data[numId + '|all'];
  const patch = (meta.curPatches && meta.curPatches[0]) || meta.patch || '';
  const tier = meta.tier || 'ranked';
  const nm = ESC(name) + (roleDisp ? ' ' + ESC(roleDisp) : '');
  let h = '<section class="champ-seo" aria-label="' + nm + ' build analytics">';
  h += '<h2>' + nm + ' build' + (patch ? ' — patch ' + ESC(patch) : '') + ' · ' + ESC(tier) + '</h2>';
  h += '<p class="champ-seo-lead">Ingenious Hunter ranks ' + ESC(name) + '’s items and runes by <strong>Win Probability Added (WPA)</strong> — the measured change in win probability each choice causes in real ' + ESC(tier) + ' ranked games, not scraped pick-rates.</p>';
  if (!entry) { h += '<p class="champ-seo-note">Build data for ' + ESC(name) + ' is still being collected. See the interactive view above.</p></section>'; return h; }
  const cur = entry.cur || {};
  if (typeof cur.wr === 'number') {
    const n = fmtInt(cur.g);
    h += '<p class="champ-seo-wr"><strong>' + ESC(name) + ' win rate:</strong> ' + fmtPct(cur.wr) + (n ? ' over ' + n + ' games' : '')
      + (patch ? ' (patch ' + ESC(patch) + ', ' + ESC(tier) + ')' : '') + (cur.g && cur.g < 200 ? ' — limited sample this patch.' : '') + '</p>';
  }
  const items = Array.isArray(cur.items) ? cur.items : [];
  if (items.length) {
    h += '<h3>Best ' + ESC(name) + (roleDisp ? ' ' + ESC(roleDisp) : '') + ' items — win rate, pick rate &amp; sample</h3><ul class="champ-seo-list">';
    for (const it of items.slice(0, 7)) {
      const [id, pick, iwr, n, iname] = it;
      h += '<li><span class="cs-n">' + ESC(iname || ('Item ' + id)) + '</span> — ' + (fmtPct(iwr) || '—') + ' win rate'
        + (typeof pick === 'number' ? ', ' + pick + '% pick' : '') + (fmtInt(n) ? ', ' + fmtInt(n) + ' games' : '') + '</li>';
    }
    h += '</ul>';
  }
  const page = entry.page || {};
  const runes = (page.primary || []).filter((r) => r && r.n && typeof r.w === 'number').sort((a, b) => b.w - a.w).slice(0, 4);
  if ((page.keystone && page.keystone.n) || runes.length) {
    h += '<h3>' + ESC(name) + ' runes — ranked by WPA</h3><ul class="champ-seo-list">';
    if (page.keystone && page.keystone.n) h += '<li><span class="cs-n">Keystone: ' + ESC(page.keystone.n) + '</span> (WPA ' + (fmtWpa(page.keystone.w) || '—') + (fmtInt(page.keystone.g) ? ', ' + fmtInt(page.keystone.g) + ' games' : '') + ')</li>';
    for (const r of runes) h += '<li><span class="cs-n">' + ESC(r.n) + '</span> (WPA ' + fmtWpa(r.w) + (fmtInt(r.g) ? ', ' + fmtInt(r.g) + ' games' : '') + ')</li>';
    h += '</ul>';
  }
  if (!items.length && !runes.length && !(page.keystone && page.keystone.n)) {
    h += '<p class="champ-seo-note">Build data for ' + ESC(name) + (roleDisp ? ' ' + ESC(roleDisp) : '') + ' is still being collected for patch ' + ESC(patch) + '. Check the interactive view for the latest sample.</p>';
  }
  if (entry.matchup) h += '<p class="champ-seo-note">Matchup-specific WPA for ' + ESC(name) + ' is available in the interactive analytics above.</p>';
  // internal links: the champ's other roles + patch report + hub
  const otherRoles = Object.keys(ROLE_IDX).filter((rk) => rk !== role && data[numId + '|' + ROLE_IDX[rk]]);
  h += '<nav class="champ-seo-links" aria-label="Related analytics"><h3>Explore more</h3>';
  for (const rk of otherRoles) h += '<a href="/builds/' + slug + '/' + rk + '">' + ESC(name) + ' ' + ESC(RDISP[rk]) + '</a>';
  h += '<a href="/builds/patch">Latest patch WPA report</a><a href="/builds/">All champion builds</a></nav></section>';
  return h;
}
const CHAMP_SEO_CSS = '<style>.champ-seo{max-width:1120px;margin:30px auto 52px;padding:22px 20px 4px;border-top:1px solid rgba(255,255,255,.08)}.champ-seo h2{font-family:var(--fh,inherit);font-size:17px;color:#fff;margin:0 0 10px;text-shadow:0 1px 10px rgba(0,0,0,.92),0 0 3px rgba(0,0,0,.95)}.champ-seo h3{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#b5bac4;margin:20px 0 9px;text-shadow:0 1px 10px rgba(0,0,0,.92)}.champ-seo p{color:#d6d9df;font-size:14px;max-width:760px;margin:0 0 10px;text-shadow:0 1px 8px rgba(0,0,0,.9)}.champ-seo .champ-seo-lead strong{color:#fff}.champ-seo-wr strong{color:#fff}.champ-seo-list{list-style:none;margin:0 0 6px;padding:0;max-width:760px}.champ-seo-list li{color:#d6d9df;font-size:13.5px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);text-shadow:0 1px 8px rgba(0,0,0,.9)}.champ-seo-list .cs-n{color:#fff;font-weight:600}.champ-seo-note{color:#aeb3bd;font-style:italic}.champ-seo-links a{display:inline-block;margin:0 12px 7px 0;color:#e2e5ea;font-size:13px;font-weight:600;text-shadow:0 1px 10px rgba(0,0,0,.92)}.champ-seo-links a:hover{color:#ff3b3b}</style>';
export function injectChampionContent(html, data, numId, name, slug, role, meta) {
  const block = championContentBlock(data, numId, name, slug, role, meta);
  return withBase(html.replace('</body>', block + CHAMP_SEO_CSS + '</body>'));
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
      const rec = (await getSlugs(env))[parts[0]];
      const name = typeof rec === 'string' ? rec : (rec && rec.n);           // tolerate old (string) + new ({n,k}) slugs.json
      const key = (rec && typeof rec === 'object') ? rec.k : null;
      if (name) {
        const role = ROLE_SET.has(parts[1]) ? parts[1] : null;   // ignore an unknown 2nd segment
        const ogImage = key ? 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/' + key + '_0.jpg' : null;
        const idx = await env.BETA_BUCKET.get('builds/index.html');
        if (idx) {
          let out = injectMeta(await idx.text(), name, parts[0], role, ogImage);
          // SSR the champion's real analytics into the initial HTML (crawlable without JS)
          try {
            const numId = await resolveChampId(key);
            if (numId) {
              const cd = await env.BETA_BUCKET.get('builds/data/champ/' + numId + '.json');
              if (cd) out = injectChampionContent(out, JSON.parse(await cd.text()), numId, name, parts[0], role, await getMeta(env));
            }
          } catch (_) { /* keep the meta-only output on any data hiccup — no regression */ }
          return new Response(out, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' } });
        }
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
