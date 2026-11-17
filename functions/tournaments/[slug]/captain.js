// GET /tournaments/:slug/captain?t=<token> — captain portal (no account; the link is the identity).
// Check in and report results for your team's matches. Mutations go through /api/captain/* which
// re-verify the token server-side.
import { page, esc } from '../_lib/http.js';
import { resolveCaptain, getTournament } from '../_lib/service.js';

export async function onRequestGet({ env, request }) {
  if (!env.DB) return page('Captain', '<section class="thero"><h1>Unavailable</h1></section>', { cache: 'no-store' });
  const token = new URL(request.url).searchParams.get('t') || '';
  const team = await resolveCaptain(env, token);
  if (!team) {
    return page('Captain check-in · Ingenious Hunter',
      '<section class="thero"><h1>Invalid or expired link</h1><p class="muted">Ask an admin for a fresh captain link. Do not share your link — it controls your team.</p></section>',
      { cache: 'no-store' });
  }
  const t = await getTournament(env, team.tournament_id);
  const roster = (await env.DB.prepare('SELECT p.display_name, r.role, r.is_captain FROM rosters r JOIN participants p ON p.id=r.participant_id WHERE r.team_id=? ORDER BY r.is_captain DESC').bind(team.id).all()).results;
  const matches = (await env.DB.prepare(
    "SELECT * FROM matches WHERE (team_a_id=? OR team_b_id=?) AND status IN ('ready','reported','disputed') ORDER BY round, slot").bind(team.id, team.id).all()).results;
  const names = await teamNames(env, team.tournament_id);

  const rosterHtml = roster.map((m) => `<li>${esc(m.display_name)}${m.is_captain ? ' <span class="cap">captain</span>' : ''}${m.role ? ` · ${esc(m.role)}` : ''}</li>`).join('') || '<li class="muted">No roster yet.</li>';

  const matchHtml = matches.length ? matches.map((m) => {
    const a = m.team_a_id, b = m.team_b_id;
    const opp = a === team.id ? b : a;
    return `<div class="cmatch" data-match="${esc(m.id)}" data-a="${esc(a)}" data-b="${esc(b)}" data-bestof="${m.best_of}">
      <div class="cmatch-h">Round ${m.round} · Best of ${m.best_of} · <span class="mstatus ${esc(m.status)}">${esc(m.status)}</span></div>
      <div class="cmatch-vs"><b>${esc(names[a] || 'TBD')}</b> vs <b>${esc(names[b] || 'TBD')}</b></div>
      <div class="cform">
        <label>Winner
          <select class="c-winner"><option value="${esc(a)}">${esc(names[a])}</option><option value="${esc(b)}">${esc(names[b])}</option></select>
        </label>
        <label>Your games <input class="c-mine" type="number" min="0" max="9" value="0"></label>
        <label>Their games <input class="c-theirs" type="number" min="0" max="9" value="0"></label>
        <button class="btn primary c-submit" data-me="${esc(team.id)}" data-opp="${esc(opp)}">Report result</button>
      </div>
      <div class="cmsg" role="status" aria-live="polite"></div>
    </div>`;
  }).join('') : '<p class="muted">No matches to report right now. Check back when your bracket is live.</p>';

  const checkedIn = team.checkin_status === 'checked_in';
  const body = `
  <section class="thero compact">
    <span class="eyebrow">${esc(t?.name || 'Tournament')} · Captain</span>
    <h1>${esc(team.name)}</h1>
    <div class="checkin">
      ${checkedIn ? '<span class="pill ok">✓ Checked in</span>' : `<button class="btn primary" id="checkin-btn">Check in</button> <span class="muted">Check in to lock your spot before the bracket is drawn.</span>`}
    </div>
  </section>
  <section class="ccard"><h3>Roster</h3><ul class="roster">${rosterHtml}</ul></section>
  <section class="ccard"><h3>Your matches</h3>${matchHtml}</section>
  <p class="muted small">Results you report are confirmed automatically when the opposing captain agrees. A mismatch is flagged for an admin.</p>`;

  const boot = `<script>window.__IH_TOKEN__=${JSON.stringify(token)};</script><script src="/assets/captain.js" defer></script>`;
  return page(`Captain · ${team.name}`, body, { cache: 'no-store', head: boot });
}

async function teamNames(env, tournamentId) {
  const rows = (await env.DB.prepare('SELECT id,name FROM teams WHERE tournament_id=?').bind(tournamentId).all()).results;
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}
