// GET /tournaments/:slug — public event page: overview, register CTA, divisions + live bracket.
import { page, esc, json } from './_lib/http.js';
import { getTournamentBySlug, listDivisions, bracketView } from './_lib/service.js';

export async function onRequestGet({ env, params, request }) {
  if (!env.DB) return notFound();
  const t = await getTournamentBySlug(env, params.slug);
  if (!t || t.visibility === 'private') return notFound();
  let cfg = {}; try { cfg = JSON.parse(t.config || '{}'); } catch { cfg = {}; }
  const tagline = cfg.tagline || ''; // per-event branding line (e.g. "Presented by X, powered by Y")

  const divisions = await listDivisions(env, t.id);
  const brackets = [];
  for (const d of divisions) brackets.push(await bracketView(env, d.id));
  const teamCount = (await env.DB.prepare('SELECT COUNT(*) c FROM teams WHERE tournament_id=? AND status=\'active\'').bind(t.id).first())?.c || 0;

  if ((request.headers.get('Accept') || '').includes('application/json')) {
    return json({ tournament: t, brackets });
  }

  const when = t.starts_at ? new Date(t.starts_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) : 'To be announced';
  const canRegister = t.status === 'registration' && t.registration_url;
  const ctas = [
    canRegister ? `<a class="btn primary" href="${esc(t.registration_url)}" target="_blank" rel="noopener">Register</a>` : '',
    t.discord_invite ? `<a class="btn ghost" href="${esc(t.discord_invite)}" target="_blank" rel="noopener">Join the Discord</a>` : '',
  ].filter(Boolean).join('');

  const divTabs = divisions.length > 1
    ? `<div class="divtabs" role="tablist">${divisions.map((d, i) => `<button class="divtab${i === 0 ? ' on' : ''}" data-div="${esc(d.id)}">${esc(d.name)}</button>`).join('')}</div>` : '';

  const body = `
  <section class="thero compact">
    <span class="eyebrow">${esc(statusLabel(t.status))}</span>
    <h1>${esc(t.name)}</h1>
    ${tagline ? `<p class="tbrand">${esc(tagline)}</p>` : ''}
    <p class="lede muted">${esc(t.game)} · ${esc(t.region)} · ${when}</p>
    <div class="tfacts">
      <div class="tfact"><div class="n">${teamCount}/${t.capacity}</div><div class="l">teams</div></div>
      <div class="tfact"><div class="n">${t.team_size}v${t.team_size}</div><div class="l">format</div></div>
      <div class="tfact"><div class="n">${divisions.length || '—'}</div><div class="l">division${divisions.length === 1 ? '' : 's'}</div></div>
    </div>
    <div class="btns">${ctas || '<span class="muted">Registration opens soon.</span>'}</div>
  </section>
  ${divTabs}
  <section id="brackets" class="brackets" data-slug="${esc(t.slug)}">
    <div class="muted" id="bracket-loading">Loading bracket…</div>
  </section>`;

  const boot = `<script>window.__IH_BRACKETS__=${JSON.stringify(brackets).replace(/</g, '\\u003c')};</script><script type="module" src="/assets/bracket.js"></script>`;
  return page(`${t.name} · Ingenious Hunter`, body, { description: `${t.name} — ${t.game} tournament bracket, divisions and live results.`, head: boot });
}

const statusLabel = (s) => ({ draft: 'Upcoming', registration: 'Registration open', checkin: 'Check-in open', live: 'Live now', complete: 'Completed' }[s] || s);
function notFound() {
  return page('Tournament not found · Ingenious Hunter', '<section class="thero"><h1>Not found</h1><p class="muted">This tournament does not exist or is private. <a class="red" href="/tournaments/">See all tournaments →</a></p></section>', { cache: 'no-store' });
}
