// GET /tournaments/admin — admin dashboard (behind Cloudflare Access via _middleware + server-side
// verification). The page is a thin shell; all data/actions go through the authorized /api/admin/*.
import { page, esc } from '../_lib/http.js';

export async function onRequestGet({ data }) {
  const who = esc(data?.admin?.email || 'admin');
  const body = `
  <section class="thero compact">
    <span class="eyebrow">Admin · ${who}</span>
    <h1>Tournament control</h1>
    <div class="arow">
      <select id="a-tournament" class="ainput"></select>
      <button class="btn ghost" id="a-new">New tournament</button>
      <button class="btn ghost" id="a-refresh">Refresh</button>
    </div>
  </section>

  <nav class="atabs">
    <button class="atab on" data-tab="overview">Overview</button>
    <button class="atab" data-tab="import">Registrations</button>
    <button class="atab" data-tab="divisions">Divisions</button>
    <button class="atab" data-tab="teams">Teams &amp; check-in</button>
    <button class="atab" data-tab="matches">Matches</button>
    <button class="atab" data-tab="audit">Audit</button>
  </nav>

  <section class="apane" id="pane-overview"></section>

  <section class="apane hide" id="pane-import">
    <h3>Import Google Forms CSV</h3>
    <p class="muted small">Export your Form responses as CSV and paste them (or choose the file). Re-importing updates existing registrations and never duplicates (keyed on a stable per-response id).</p>
    <input type="file" id="a-csvfile" accept=".csv,text/csv" class="ainput">
    <textarea id="a-csv" class="ainput mono" rows="8" placeholder="Timestamp,Email Address,Summoner Name,…"></textarea>
    <button class="btn primary" id="a-import">Import</button>
    <div id="a-import-msg" class="amsg"></div>
    <div id="a-participants"></div>
  </section>

  <section class="apane hide" id="pane-divisions">
    <h3>Divisions</h3>
    <p class="muted small">Rank-based divisions are driven by turnout. A stronger player is never auto-placed into a lower division.</p>
    <div class="aform">
      <input class="ainput" id="d-name" placeholder="Division name (e.g. Plat+)">
      <input class="ainput" id="d-floor" placeholder="Rank floor (e.g. Platinum 4 or blank)">
      <input class="ainput" id="d-ceil" placeholder="Rank ceiling (e.g. Gold 1 or blank)">
      <input class="ainput" id="d-bo" type="number" min="1" max="7" value="1" title="Best-of (non-final)">
      <input class="ainput" id="d-fbo" type="number" min="1" max="7" value="3" title="Final best-of">
      <button class="btn primary" id="a-adddiv">Add division</button>
    </div>
    <button class="btn ghost" id="a-assign">Auto-assign solo players by rank</button>
    <div id="a-divisions"></div>
  </section>

  <section class="apane hide" id="pane-teams">
    <h3>Teams &amp; check-in</h3>
    <div class="aform">
      <input class="ainput" id="t-name" placeholder="New team name">
      <select class="ainput" id="t-div"></select>
      <button class="btn primary" id="a-addteam">Create team</button>
    </div>
    <div id="a-teams"></div>
  </section>

  <section class="apane hide" id="pane-matches"><div id="a-matches"></div></section>
  <section class="apane hide" id="pane-audit"><div id="a-audit"></div></section>

  <div id="a-toast" class="atoast"></div>`;
  return page('Admin · Ingenious Hunter', body, { cache: 'no-store', head: '<script src="/assets/admin.js" defer></script>' });
}
