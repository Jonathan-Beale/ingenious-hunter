// http.js — shared helpers for the tournament Pages Functions: JSON responses, Cloudflare Access
// verification (server-side authorization for admin), and a branded HTML shell that matches the
// existing site (dark bg, red accents, shared header).
import { verifyAccessJwt } from './auth.js';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

// Verify the Cloudflare Access assertion server-side. Returns { email, sub } or null. Even with the
// edge Access policy in place, every admin handler calls this so a direct hit is rejected too.
export async function requireAccess(context) {
  const { request, env } = context;
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
    || (request.headers.get('Cookie') || '').match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return null;
  const claims = await verifyAccessJwt(token, { teamDomain: env.CF_ACCESS_TEAM_DOMAIN, aud: env.CF_ACCESS_AUD });
  if (!claims) return null;
  return { email: claims.email || claims.sub, sub: claims.sub };
}

const HEAD_CSS = `:root{--bg:#0a0a0a;--bg-2:#101010;--panel:#141414;--panel-2:#1b1b1b;--line:#242424;--line-red:#7a0909;--text:#fff;--muted:#9aa0a6;--red:#ff1e1e;--red-deep:#7a0909;--green:#32ff5e;--amber:#ffb000;--radius:14px;--maxw:1120px}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}.wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}
.ihhdr-bar{position:sticky;top:0;z-index:60;background:rgba(8,8,10,.86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid #242424}
.ihhdr{display:flex;align-items:center;justify-content:space-between;height:66px;max-width:1160px;margin:0 auto;padding:0 20px}
.ihhdr-brand{display:flex;align-items:center;gap:11px;font-weight:800;letter-spacing:.3px;color:#fff;font-size:16px}
.ihhdr-brand img{width:30px;height:30px;mix-blend-mode:lighten}.ihhdr-nav{display:flex;align-items:center;gap:20px}
.ihhdr-link{color:#e6e8ec;font-weight:700;letter-spacing:.2px;white-space:nowrap;font-size:14px}.ihhdr-link:hover{color:var(--red)}
.ihhdr-cta{font-weight:700;background:var(--red);color:#fff;padding:9px 17px;border-radius:10px;font-size:14px;white-space:nowrap}.ihhdr-cta:hover{filter:brightness(1.08)}
@media(max-width:520px){.ihhdr{height:58px;padding:0 14px}.ihhdr-nav{gap:12px}.ihhdr-link,.ihhdr-cta{font-size:13px}.ihhdr-cta{padding:8px 12px}}`;

const HEADER_HTML = `<header class="ihhdr-bar"><div class="ihhdr"><a class="ihhdr-brand" href="/"><img src="/assets/logo.png" alt="Ingenious Hunter"> Ingenious Hunter</a><nav class="ihhdr-nav"><a class="ihhdr-link" href="/builds/">Builds</a><a class="ihhdr-link" href="/tournaments/">Tournaments</a><a class="ihhdr-cta" href="/#beta">Get the App</a></nav></div></header>`;

// Full HTML page matching the site shell. `opts`: { description, head, bodyClass, cache }
export function page(title, bodyHtml, opts = {}) {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><base href="/">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(opts.description || 'Ingenious Hunter tournaments — brackets, standings and results.')}">
<meta name="theme-color" content="#0A0A0A"><link rel="icon" href="/assets/favicon.ico">
<meta property="og:title" content="${esc(title)}"><meta property="og:image" content="https://ingenioushunter.gg/assets/og.png">
<style>${HEAD_CSS}</style><link rel="stylesheet" href="/assets/tournament.css">${opts.head || ''}</head>
<body class="${opts.bodyClass || ''}">${HEADER_HTML}<main class="wrap tmain">${bodyHtml}</main>
<footer class="tfoot"><div class="wrap">Ingenious Hunter is not endorsed by Riot Games. · <a href="/">ingenioushunter.gg</a></div></footer></body></html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': opts.cache || 'no-cache', 'x-content-type-options': 'nosniff' },
  });
}
