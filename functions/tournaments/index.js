// GET /tournaments — public directory of events.
import { page, esc, json } from './_lib/http.js';
import { listTournaments } from './_lib/service.js';

const STATUS_LABEL = { draft: 'Draft', registration: 'Registration open', checkin: 'Check-in', live: 'Live', complete: 'Complete' };

export async function onRequestGet({ env, request }) {
  if ((request.headers.get('Accept') || '').includes('application/json')) {
    if (!env.DB) return json({ tournaments: [] });
    return json({ tournaments: await listTournaments(env) });
  }
  let events = [];
  try { events = env.DB ? await listTournaments(env) : []; } catch { events = []; }

  const cards = events.length ? events.map((t) => {
    const when = t.starts_at ? new Date(t.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBA';
    const st = STATUS_LABEL[t.status] || t.status;
    return `<a class="tcard" href="/tournaments/${esc(t.slug)}">
      <div class="tcard-top"><span class="tbadge ${t.status === 'live' ? 'live' : ''}">${esc(st)}</span><span class="tcard-date">${esc(when)}</span></div>
      <h3>${esc(t.name)}</h3>
      <div class="tcard-meta">${esc(t.game)} · ${esc(t.region)} · up to ${t.capacity} teams</div>
    </a>`;
  }).join('') : `<div class="tempty"><h3>No tournaments yet</h3><p class="muted">The inaugural Ingenious Hunter Community Cup is coming soon. Join the Discord to be the first to know.</p></div>`;

  const body = `
  <section class="thero">
    <span class="eyebrow">Tournaments</span>
    <h1>Ingenious Hunter <span class="red">Cups</span></h1>
    <p class="lede muted">Community League of Legends tournaments — rank-based divisions, live brackets, and results you can trust.</p>
  </section>
  <section class="tgrid">${cards}</section>`;
  return page('Tournaments · Ingenious Hunter', body, { description: 'Ingenious Hunter community League of Legends tournaments — brackets, divisions and live results.' });
}
