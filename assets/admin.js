// admin.js — tournament control dashboard. All actions call the Access-protected /api/admin/*;
// the browser carries the Cloudflare Access cookie automatically. No secrets live here.
(function () {
  var S = { tournaments: [], current: null, detail: null, matchFilter: 'all' };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function toast(msg, bad) { var t = $('a-toast'); t.textContent = msg; t.style.borderColor = bad ? '#ff1e1e' : '#32ff5e'; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2600); }
  function winsNeeded(bo) { return Math.floor((bo || 1) / 2) + 1; }

  async function api(path, method, body) {
    var opt = { method: method || 'GET', headers: {} };
    if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    var r = await fetch('/api/admin/' + path, opt);
    var data = {}; try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(data.detail || data.error || ('HTTP ' + r.status));
    return data;
  }

  // ---- load ----
  async function loadTournaments() {
    var d = await api('tournaments');
    S.tournaments = d.tournaments || [];
    var sel = $('a-tournament');
    sel.innerHTML = S.tournaments.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + ' (' + esc(t.status) + ')</option>'; }).join('') || '<option value="">— no tournaments —</option>';
    if (S.tournaments.length) { S.current = sel.value = (S.current || S.tournaments[0].id); await loadDetail(); }
  }
  async function loadDetail() {
    if (!S.current) return;
    S.detail = await api('tournaments/' + S.current);
    renderAll();
  }

  function renderAll() { renderOverview(); renderImport(); renderDivisions(); renderTeams(); renderMatches(); renderAudit(); }

  // ---------- Overview ----------
  var STATUS_CHIP = { draft: ['idle', 'Draft'], registration: ['live', 'Registration'], checkin: ['live', 'Check-in'], live: ['live', 'Live'], complete: ['done', 'Complete'], archived: ['idle', 'Archived'] };
  function statusChip(s) { var m = STATUS_CHIP[s] || ['idle', s]; return '<span class="bchip ' + m[0] + '">' + esc(m[1]) + '</span>'; }

  function metrics() {
    var d = S.detail, teams = d.teams, parts = d.participants, ms = d.matches, divs = d.divisions, size = d.tournament.team_size || 5;
    var roster = {}; parts.forEach(function (p) { if (p.team_id) roster[p.team_id] = (roster[p.team_id] || 0) + 1; });
    var complete = teams.filter(function (t) { return (roster[t.id] || 0) >= size; }).length;
    var checkedIn = teams.filter(function (t) { return t.checkin_status === 'checked_in'; }).length;
    var byst = {}; ms.forEach(function (m) { if (!m.is_bye) byst[m.status] = (byst[m.status] || 0) + 1; });
    var completedDivs = divs.filter(function (dv) { var md = ms.filter(function (m) { return m.division_id === dv.id && !m.is_bye; }); return md.length > 0 && md.every(function (m) { return m.status === 'confirmed'; }); }).length;
    return { players: parts.length, teams: teams.length, complete: complete, checkedIn: checkedIn, missing: teams.length - checkedIn,
      ready: byst.ready || 0, pending: byst.pending || 0, reported: byst.reported || 0, disputed: byst.disputed || 0, confirmed: byst.confirmed || 0,
      completedDivs: completedDivs, divs: divs.length };
  }
  function tile(n, label, cls) { return '<div class="ostat ' + (cls || '') + '"><div class="n">' + n + '</div><div class="l">' + esc(label) + '</div></div>'; }

  function renderOverview() {
    var t = S.detail.tournament, m = metrics();
    var tiles = [
      tile(m.players, 'Registered players'),
      tile(m.complete + '<span class="muted" style="font-size:14px">/' + m.teams + '</span>', 'Complete teams'),
      tile(m.checkedIn + '<span class="muted" style="font-size:14px">/' + m.teams + '</span>', 'Checked in', m.missing > 0 ? 'warn' : (m.teams ? 'good' : '')),
      tile(m.ready, 'Active (ready)'),
      tile(m.pending, 'Pending matches'),
      tile(m.disputed, 'Unresolved disputes', m.disputed > 0 ? 'bad' : 'good'),
      tile(m.completedDivs + '<span class="muted" style="font-size:14px">/' + m.divs + '</span>', 'Divisions complete', m.completedDivs && m.completedDivs === m.divs ? 'good' : ''),
    ].join('');
    $('pane-overview').innerHTML = '<div class="acard"><h3>' + esc(t.name) + ' ' + statusChip(t.status) + '</h3>' +
      '<p class="muted small">Registration form: ' + (t.registration_url ? '<a class="red" href="' + esc(t.registration_url) + '" target="_blank" rel="noopener">link</a>' : '—') + '</p>' +
      '<div class="asub">Operational overview</div><div class="ostats">' + tiles + '</div>' +
      '<div class="asub">Lifecycle status</div><div class="ablock">' + statusButtons(t) + '</div>' +
      '<div class="asub">Announcements</div><div class="ablock">' +
        '<button class="btn ghost sm" data-act="announce" data-kind="published">Announce: registration</button>' +
        '<button class="btn ghost sm" data-act="announce" data-kind="checkin">Announce: check-in</button>' +
        '<span class="muted small">Posting an announcement does not change the tournament status — use the Lifecycle buttons for that.</span>' +
      '</div></div>';
  }
  function statusButtons(t) {
    return ['registration', 'checkin', 'live', 'complete'].map(function (s) {
      return '<button class="btn sm' + (t.status === s ? ' primary' : ' ghost') + '" data-act="status" data-status="' + s + '">' + s + '</button>';
    }).join('');
  }

  function renderImport() {
    var ps = S.detail.participants;
    $('a-participants').innerHTML = ps.length ? table(['Name', 'Riot ID', 'Rank', 'Role', 'Type', 'Team', 'Div'],
      ps.map(function (p) { return [p.display_name, p.riot_id || '', p.rank_tier || 'Unranked', p.preferred_role || '', p.kind, teamName(p.team_id) || '—', divName(p.division_id) || '—']; })) : '<p class="muted small">No registrations imported yet.</p>';
  }

  function renderDivisions() {
    var ds = S.detail.divisions;
    $('a-divisions').innerHTML = ds.length ? ds.map(function (d) {
      var teams = S.detail.teams.filter(function (t) { return t.division_id === d.id; });
      var md = S.detail.matches.filter(function (m) { return m.division_id === d.id && !m.is_bye; });
      var done = md.length > 0 && md.every(function (m) { return m.status === 'confirmed'; });
      var chip = done ? '<span class="bchip done">Complete</span>' : (md.length ? '<span class="bchip live">In progress</span>' : statusChip2(d.status));
      return '<div class="acard"><b>' + esc(d.name) + '</b> ' + chip + ' <span class="muted small">· ' + teams.length + ' teams · BO' + d.best_of_default + ' (final BO' + d.final_best_of + ')</span>' +
        ' <button class="btn sm primary" data-act="seed" data-div="' + esc(d.id) + '">' + (md.length ? 'Re-seed' : 'Seed bracket') + '</button></div>';
    }).join('') : '<p class="muted small">No divisions yet.</p>';
    var sel = $('t-div');
    if (sel) sel.innerHTML = ds.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>'; }).join('');
  }
  function statusChip2(s) { return '<span class="bchip ' + (s === 'seeded' ? 'seeded' : 'idle') + '">' + esc(s || 'open') + '</span>'; }

  function renderTeams() {
    var ts = S.detail.teams;
    if (!ts.length) { $('a-teams').innerHTML = '<p class="muted small">No teams yet. Create teams or assemble them from solo registrations.</p>'; return; }
    var rows = ts.map(function (t) {
      var ci = t.checkin_status === 'checked_in' ? '<span class="badge win">checked in</span>' : (t.checkin_status === 'no_show' ? '<span class="badge disputed">no-show</span>' : '<span class="badge">pending</span>');
      return '<tr data-team-row="' + esc(t.id) + '"><td>' + esc(t.name) + '</td><td>' + (divName(t.division_id) || '—') + '</td><td>' + (t.seed || '') + '</td><td>' + ci +
        '</td><td><button class="btn sm ghost" data-act="token" data-team="' + esc(t.id) + '">Get link</button></td></tr>';
    }).join('');
    $('a-teams').innerHTML = '<table class="atable"><thead><tr><th>Team</th><th>Div</th><th>Seed</th><th>Check-in</th><th>Captain link</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // ---------- Matches ----------
  function forfeitSet() {
    var s = new Set(), seen = new Set();
    (S.detail.audit || []).forEach(function (x) { // audit is newest-first; first decisive action per match wins
      if (!x.entity_id || seen.has(x.entity_id)) return;
      if (['forfeit', 'admin_confirm', 'confirm_result', 'correct'].indexOf(x.action) >= 0) { seen.add(x.entity_id); if (x.action === 'forfeit') s.add(x.entity_id); }
    });
    return s;
  }
  function teamLink(id) { var nm = teamName(id); return id ? '<span class="tlink" data-act="goteam" data-team-id="' + esc(id) + '">' + esc(nm || 'TBD') + '</span>' : '<span class="muted">TBD</span>'; }

  function matchCard(m, isForfeit) {
    var a = teamName(m.team_a_id) || 'TBD', b = teamName(m.team_b_id) || 'TBD';
    var canReport = m.team_a_id && m.team_b_id;
    var confirmed = m.status === 'confirmed';
    var badge = confirmed ? (isForfeit ? '<span class="badge forfeit">Forfeit</span>' : '<span class="badge win">Win</span>') : (m.status === 'disputed' ? '<span class="badge disputed">Needs resolution</span>' : '');
    var cardCls = 'acard' + (m.status === 'disputed' ? ' disputed' : (confirmed ? ' confirmed' : ''));
    var winLine = confirmed && m.winner_team_id ? ' · ' + (isForfeit ? 'forfeit to ' : '🏆 ') + esc(teamName(m.winner_team_id)) : '';
    return '<div class="' + cardCls + '" data-match="' + esc(m.id) + '">' +
      '<div><b>' + esc(divName(m.division_id)) + '</b> · R' + m.round + ' · BO' + m.best_of + ' · <span class="mstatus ' + esc(m.status) + '">' + esc(m.status) + '</span> ' + badge + '</div>' +
      '<div class="mvs">' + teamLink(m.team_a_id) + ' <span class="muted">' + (confirmed ? (m.score_a + '–' + m.score_b) : 'vs') + '</span> ' + teamLink(m.team_b_id) + winLine + '</div>' +
      (canReport ? '<div class="arow">' +
        '<select class="ainput m-win"><option value="' + esc(m.team_a_id) + '">' + esc(a) + '</option><option value="' + esc(m.team_b_id) + '">' + esc(b) + '</option></select>' +
        '<input class="ainput m-sa" type="number" min="0" max="9" value="' + (m.score_a || 0) + '" style="width:60px" title="' + esc(a) + ' games">' +
        '<input class="ainput m-sb" type="number" min="0" max="9" value="' + (m.score_b || 0) + '" style="width:60px" title="' + esc(b) + ' games">' +
        '<button class="btn sm primary" data-act="' + (confirmed ? 'correct' : 'confirm') + '" data-match="' + esc(m.id) + '">' + (confirmed ? 'Correct' : 'Confirm') + '</button>' +
        (confirmed ? '<button class="btn sm ghost" data-act="reopen" data-match="' + esc(m.id) + '">Reopen</button>'
          : '<button class="btn sm ghost" data-act="forfeit" data-match="' + esc(m.id) + '" data-loser="' + esc(m.team_a_id) + '" data-loser-name="' + esc(a) + '">' + esc(a) + ' forfeits</button>' +
            '<button class="btn sm ghost" data-act="forfeit" data-match="' + esc(m.id) + '" data-loser="' + esc(m.team_b_id) + '" data-loser-name="' + esc(b) + '">' + esc(b) + ' forfeits</button>') +
      '</div>' : '<span class="muted small">Waiting on earlier rounds.</span>') + '</div>';
  }

  function renderMatches() {
    var all = S.detail.matches.filter(function (m) { return !m.is_bye; });
    if (!all.length) { $('a-matches').innerHTML = '<p class="muted small">No matches yet — seed a division first.</p>'; return; }
    var forf = forfeitSet();
    var counts = { all: all.length };
    ['ready', 'pending', 'reported', 'disputed', 'confirmed'].forEach(function (s) { counts[s] = all.filter(function (m) { return m.status === s; }).length; });
    var f = S.matchFilter || 'all';
    var chips = [['all', 'All'], ['ready', 'Ready'], ['pending', 'Pending'], ['reported', 'Reported'], ['disputed', 'Disputed'], ['confirmed', 'Confirmed']].map(function (p) {
      return '<button class="mfilter' + (f === p[0] ? ' on' : '') + '" data-act="mfilter" data-f="' + p[0] + '">' + p[1] + '<span class="ct">' + (counts[p[0]] || 0) + '</span></button>';
    }).join('');
    var disputed = all.filter(function (m) { return m.status === 'disputed'; });
    var banner = disputed.length ? '<div class="dispute-banner"><b>' + disputed.length + ' dispute' + (disputed.length > 1 ? 's need' : ' needs') + ' resolution.</b>' +
      disputed.map(function (m) {
        var need = winsNeeded(m.best_of);
        return '<div class="mquick"><span class="small">' + esc(divName(m.division_id)) + ' · R' + m.round + ': ' + esc(teamName(m.team_a_id)) + ' vs ' + esc(teamName(m.team_b_id)) + '</span>' +
          '<button class="btn sm primary" data-act="resolve" data-match="' + esc(m.id) + '" data-winner="' + esc(m.team_a_id) + '" data-won="a" data-need="' + need + '">' + esc(teamName(m.team_a_id)) + ' wins</button>' +
          '<button class="btn sm primary" data-act="resolve" data-match="' + esc(m.id) + '" data-winner="' + esc(m.team_b_id) + '" data-won="b" data-need="' + need + '">' + esc(teamName(m.team_b_id)) + ' wins</button></div>';
      }).join('') + '</div>' : '';
    var list = all.filter(function (m) { return f === 'all' || m.status === f; });
    var cards = list.length ? list.map(function (m) { return matchCard(m, forf.has(m.id)); }).join('') : '<p class="muted small">No ' + esc(f) + ' matches.</p>';
    $('a-matches').innerHTML = '<div class="mfilters">' + chips + '</div>' + banner + cards;
  }

  function renderAudit() {
    var a = S.detail.audit || [];
    $('a-audit').innerHTML = a.length ? table(['When', 'Actor', 'Action', 'Entity', 'Note'],
      a.map(function (x) { return [new Date(x.created_at).toLocaleString(), (x.actor_type + ':' + (x.actor_id || '')), x.action, x.entity || '', x.note || '']; })) : '<p class="muted small">No activity yet.</p>';
  }

  // helpers
  function teamName(id) { if (!id || !S.detail) return null; var t = S.detail.teams.find(function (x) { return x.id === id; }); return t ? t.name : null; }
  function divName(id) { if (!id || !S.detail) return null; var d = S.detail.divisions.find(function (x) { return x.id === id; }); return d ? d.name : null; }
  function table(cols, rows, raw) {
    return '<table class="atable"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + (raw ? c : esc(c)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }

  // ---- actions (event delegation) ----
  document.addEventListener('click', async function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act');
    // client-only actions (no network)
    if (act === 'mfilter') { S.matchFilter = el.getAttribute('data-f'); renderMatches(); return; }
    if (act === 'goteam') {
      var tid = el.getAttribute('data-team-id'); var tab = document.querySelector('.atab[data-tab="teams"]'); if (tab) tab.click();
      setTimeout(function () { var row = document.querySelector('[data-team-row="' + tid + '"]'); if (row) { row.classList.remove('team-hi'); void row.offsetWidth; row.classList.add('team-hi'); row.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 40);
      return;
    }
    try {
      if (act === 'status') { await api('tournaments/' + S.current + '/update', 'POST', { status: el.getAttribute('data-status') }); toast('Status → ' + el.getAttribute('data-status')); await loadDetail(); }
      else if (act === 'seed') { var r = await api('divisions/' + el.getAttribute('data-div') + '/seed', 'POST', {}); toast('Seeded: ' + r.teams + ' teams, ' + r.byes + ' byes'); await loadDetail(); }
      else if (act === 'token') {
        var tk = await api('teams/' + el.getAttribute('data-team') + '/token', 'POST', {});
        prompt('Captain magic link (send privately to the captain):', tk.link);
      }
      else if (act === 'confirm' || act === 'correct') {
        var card = el.closest('[data-match]');
        var win = card.querySelector('.m-win').value, sa = +card.querySelector('.m-sa').value, sb = +card.querySelector('.m-sb').value;
        if (act === 'correct' && !confirm('Correct this confirmed result? It reopens the match and re-records the winner/score (downstream must not be decided).')) return;
        await api('matches/' + el.getAttribute('data-match') + '/' + act, 'POST', { winner: win, scoreA: sa, scoreB: sb });
        toast(act === 'correct' ? 'Corrected' : 'Confirmed'); await loadDetail();
      }
      else if (act === 'resolve') {
        var need = +el.getAttribute('data-need') || 1, won = el.getAttribute('data-won');
        var sa2 = won === 'a' ? need : 0, sb2 = won === 'b' ? need : 0, wn = teamName(el.getAttribute('data-winner'));
        if (!confirm('Resolve dispute — ' + wn + ' wins ' + sa2 + '–' + sb2 + '? (You can fine-tune the score on the match card instead.)')) return;
        await api('matches/' + el.getAttribute('data-match') + '/confirm', 'POST', { winner: el.getAttribute('data-winner'), scoreA: sa2, scoreB: sb2 });
        toast('Dispute resolved'); await loadDetail();
      }
      else if (act === 'forfeit') {
        var ln = el.getAttribute('data-loser-name');
        if (!confirm('Record a forfeit — ' + ln + ' loses and the opponent advances. Continue?')) return;
        await api('matches/' + el.getAttribute('data-match') + '/forfeit', 'POST', { loserTeamId: el.getAttribute('data-loser') });
        toast('Forfeit recorded'); await loadDetail();
      }
      else if (act === 'reopen') { if (confirm('Reopen this match? It clears the result and pulls the team back out of the next round (the next match must not be decided).')) { await api('matches/' + el.getAttribute('data-match') + '/reopen', 'POST', {}); toast('Reopened'); await loadDetail(); } }
      else if (act === 'announce') { var res = await api('announce', 'POST', { tournamentId: S.current, kind: el.getAttribute('data-kind') }); toast(res.ok ? 'Announced to Discord' : 'Webhook not configured', !res.ok); }
    } catch (x) { toast('Error: ' + x.message, true); }
  });

  // tabs
  document.querySelectorAll('.atab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.atab').forEach(function (t) { t.classList.remove('on'); });
      document.querySelectorAll('.apane').forEach(function (p) { p.classList.add('hide'); });
      tab.classList.add('on'); $('pane-' + tab.getAttribute('data-tab')).classList.remove('hide');
    });
  });

  // top controls
  $('a-tournament').addEventListener('change', function (e) { S.current = e.target.value; loadDetail(); });
  $('a-refresh').addEventListener('click', loadDetail);
  $('a-new').addEventListener('click', async function () {
    var name = prompt('Tournament name:'); if (!name) return;
    var slug = (prompt('URL slug:', name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) || '').trim();
    if (!slug) return;
    try { var t = await api('tournaments', 'POST', { name: name, slug: slug, status: 'registration', capacity: 32 }); S.current = t.id; await loadTournaments(); toast('Created'); }
    catch (x) { toast('Error: ' + x.message, true); }
  });
  $('a-import').addEventListener('click', async function () {
    var csv = $('a-csv').value.trim(); if (!csv) { toast('Paste or choose a CSV first', true); return; }
    $('a-import-msg').textContent = 'Importing…';
    try { var r = await api('tournaments/' + S.current + '/import', 'POST', { csv: csv }); $('a-import-msg').className = 'amsg ok'; $('a-import-msg').textContent = 'Imported: +' + r.inserted + ' new, ' + r.updated + ' updated, ' + r.skipped + ' unchanged.'; await loadDetail(); }
    catch (x) { $('a-import-msg').className = 'amsg err'; $('a-import-msg').textContent = 'Error: ' + x.message; }
  });
  $('a-csvfile').addEventListener('change', function (e) { var f = e.target.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { $('a-csv').value = rd.result; }; rd.readAsText(f); });
  $('a-adddiv').addEventListener('click', async function () {
    var name = $('d-name').value.trim(); if (!name) { toast('Division name required', true); return; }
    try {
      await api('divisions', 'POST', { tournamentId: S.current, name: name, floorRank: $('d-floor').value.trim(), ceilingRank: $('d-ceil').value.trim(), best_of_default: +$('d-bo').value || 1, final_best_of: +$('d-fbo').value || 3 });
      $('d-name').value = ''; toast('Division added'); await loadDetail();
    } catch (x) { toast('Error: ' + x.message, true); }
  });
  $('a-assign').addEventListener('click', async function () { try { var r = await api('tournaments/' + S.current + '/assign', 'POST', {}); toast('Assigned ' + r.assigned + ', unassigned ' + r.unassigned.length); await loadDetail(); } catch (x) { toast('Error: ' + x.message, true); } });
  $('a-addteam').addEventListener('click', async function () { var name = $('t-name').value.trim(); if (!name) return; try { await api('teams', 'POST', { tournamentId: S.current, name: name, division_id: $('t-div').value }); $('t-name').value = ''; toast('Team created'); await loadDetail(); } catch (x) { toast('Error: ' + x.message, true); } });

  // boot — live, or from an injected demo payload (used by the offline screenshot harness; inert in production)
  if (window.__ADMIN_DEMO__) {
    S.tournaments = window.__ADMIN_DEMO__.tournaments || [];
    S.current = (S.tournaments[0] || {}).id; S.detail = window.__ADMIN_DEMO__.detail;
    if (window.__ADMIN_DEMO__.matchFilter) S.matchFilter = window.__ADMIN_DEMO__.matchFilter;
    var sel = $('a-tournament'); if (sel) sel.innerHTML = S.tournaments.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + ' (' + esc(t.status) + ')</option>'; }).join('');
    renderAll();
  } else {
    loadTournaments().catch(function (x) { toast('Load error: ' + x.message, true); });
  }
})();
