// Cloudflare Pages middleware — anonymous page-visit analytics (edge-side).
//
// Runs on every request; logs ONLY top-level page navigations (GET + Accept: text/html,
// excluding /assets/*). For each page view it records, from what the browser and edge
// already provide, WHERE the visitor came from (Referer header + any UTM params) and
// WHICH COUNTRY (Cloudflare's coarse geo) — then serves the page normally.
//
// Privacy stance (deliberately light — this is anonymized server-log analysis, not
// visitor tracking): NO IP stored, NO cookie, NO per-visitor id, no client-side script.
// We keep the referrer (the source site sends it; often origin-only), coarse country,
// UTM tags, and the User-Agent (to split real traffic from bots). Fire-and-forget so it
// can never slow or break page delivery.
export async function onRequest(context) {
  const { request, env, next } = context;
  try {
    const url = new URL(request.url);
    const accept = request.headers.get('Accept') || '';
    const isPageView =
      request.method === 'GET' &&
      accept.includes('text/html') &&
      !url.pathname.startsWith('/assets/');
    if (isPageView && env.BETA_BUCKET) {
      context.waitUntil(logVisit(env, request, url));
    }
  } catch (_) {
    /* never let analytics affect serving */
  }
  return next();
}

async function logVisit(env, request, url) {
  try {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const ref = (request.headers.get('Referer') || '').slice(0, 300);
    let refHost = '';
    try { refHost = ref ? new URL(ref).host : ''; } catch (_) { /* malformed referrer */ }

    const utm = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const v = url.searchParams.get(k);
      if (v) utm[k] = v.slice(0, 100);
    }

    const rec = {
      event: 'visit',
      ts: now,
      path: url.pathname.slice(0, 200),
      referrer: ref,               // full referrer the source sent (may be origin-only)
      referrer_host: refHost,      // just the host, for easy source aggregation
      utm: Object.keys(utm).length ? utm : undefined,
      cc: (request.cf && request.cf.country) || null,   // coarse country — no IP
      ua: (request.headers.get('User-Agent') || '').slice(0, 200), // real-vs-bot signal
      server_ts: now,
    };
    const key = `visit/${day}/${now}-${Math.random().toString(36).slice(2, 8)}.json`;
    await env.BETA_BUCKET.put(key, JSON.stringify(rec), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch (_) {
    /* swallow — logging must never surface to the visitor */
  }
}
