// admin.js — tournament control dashboard. All actions call the Access-protected /api/admin/*;
// the browser carries the Cloudflare Access cookie automatically. No secrets live here.
(function () {
  var S = { tournaments: [], current: null, detail: null };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function toast(msg, bad) { var t = $('a-toast'); t.textContent = msg; t.style.borderColor = bad ? '#ff1e1e' : '#32ff5e'; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2600); }

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

  function renderOverview() {
    var t = S.detail.tournament;
    $('pane-overview').innerHTML = '<div class="acard"><h3>' + esc(t.name) + '</h3>' +
      '<p class="muted">Status <b>' + esc(t.status) + '</b> · ' + (S.detail.participants.length) + ' registrations · ' + (S.detail.teams.length) + ' teams · ' + (S.detail.divisions.length) + ' divisions</p>' +
      '<div class="arow">' + statusButtons(t) +
      '<button class="btn ghost sm" data-act="announce" data-kind="published">Announce: registration</button>' +
      '<button class="btn ghost sm" data-act="announce" data-kind="checkin">Announce: check-in</button></div>' +
      '<p class="muted small">Registration form: ' + (t.registration_url ? '<a class="red" href="' + esc(t.registration_url) + '" target="_blank">link</a>' : '—') + '</p></div>';
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
      return '<div class="acard"><b>' + esc(d.name) + '</b> <span class="muted small">· ' + esc(d.status) + ' · ' + teams.length + ' teams · BO' + d.best_of_default + ' (final BO' + d.final_best_of + ')</span>' +
        ' <button class="btn sm primary" data-act="seed" data-div="' + esc(d.id) + '">Seed bracket</button></div>';
    }).join('') : '<p class="muted small">No divisions yet.</p>';
    var sel = $('t-div');
    if (sel) sel.innerHTML = ds.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>'; }).join('');
  }

  function renderTeams() {
    var ts = S.detail.teams;
    $('a-teams').innerHTML = ts.length ? table(['Team', 'Div', 'Seed', 'Check-in', 'Captain link'],
      ts.map(function (t) {
        return [esc(t.name), divName(t.division_id) || '—', t.seed || '', t.checkin_status,
          '<button class="btn sm ghost" data-act="token" data-team="' + esc(t.id) + '">Get link</button>'];
      }), true) : '<p class="muted small">No teams yet. Create teams or assemble them from solo registrations.</p>';
  }

  function renderMatches() {
    var ms = S.detail.matches.filter(function (m) { return !m.is_bye; });
    if (!ms.length) { $('a-matches').innerHTML = '<p class="muted small">No matches yet — seed a division first.</p>'; return; }
    var disputed = ms.filter(function (m) { return m.status === 'disputed'; });
    var html = disputed.length ? '<div class="acard"><b class="red">' + disputed.length + ' disputed match(es) need resolution.</b></div>' : '';
    html += ms.map(function (m) {
      var a = teamName(m.team_a_id) || 'TBD', b = teamName(m.team_b_id) || 'TBD';
      var canReport = m.team_a_id && m.team_b_id;
      return '<div class="acard" data-match="' + esc(m.id) + '">' +
        '<div><b>' + esc(divName(m.division_id)) + '</b> · R' + m.round + ' · BO' + m.best_of + ' · <span class="mstatus ' + esc(m.status) + '">' + esc(m.status) + '</span></div>' +
        '<div style="margin:6px 0">' + esc(a) + ' <span class="muted">' + (m.status === 'confirmed' ? (m.score_a + '–' + m.score_b) : 'vs') + '</span> ' + esc(b) + (m.winner_team_id ? ' · 🏆 ' + esc(teamName(m.winner_team_id)) : '') + '</div>' +
        (canReport ? '<div class="arow">' +
          '<select class="ainput m-win"><option value="' + esc(m.team_a_id) + '">' + esc(a) + '</option><option value="' + esc(m.team_b_id) + '">' + esc(b) + '</option></select>' +
          '<input class="ainput m-sa" type="number" min="0" max="9" value="' + (m.score_a || 0) + '" style="width:64px" title="' + esc(a) + ' games">' +
          '<input class="ainput m-sb" type="number" min="0" max="9" value="' + (m.score_b || 0) + '" style="width:64px" title="' + esc(b) + ' games">' +
          '<button class="btn sm primary" data-act="' + (m.status === 'confirmed' ? 'correct' : 'confirm') + '" data-match="' + esc(m.id) + '">' + (m.status === 'confirmed' ? 'Correct' : 'Confirm') + '</button>' +
          '<button class="btn sm ghost" data-act="forfeit" data-match="' + esc(m.id) + '" data-a="' + esc(m.team_a_id) + '" data-b="' + esc(m.team_b_id) + '">Forfeit…</button>' +
          (m.status === 'confirmed' ? '<button class="btn sm ghost" data-act="reopen" data-match="' + esc(m.id) + '">Reopen</button>' : '') +
        '</div>' : '<span class="muted small">Waiting on earlier rounds.</span>') + '</div>';
    }).join('');
    $('a-matches').innerHTML = html;
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
    try {
      if (act === 'status') { await api('tournaments/' + S.current + '/update', 'POST', { status: el.getAttribute('data-status') }); toast('Status → ' + el.getAttribute('data-status')); await loadDetail(); }
      else if (act === 'seed') { var r = await api('divisions/' + el.getAttribute('data-div') + '/seed', 'POST', {}); toast('Seeded: ' + r.teams + ' teams, ' + r.byes + ' byes'); await loadDetail(); }
      else if (act === 'token') {
        var t = await api('teams/' + el.getAttribute('data-team') + '/token', 'POST', {});
        prompt('Captain magic link (send privately to the captain):', t.link);
      }
      else if (act === 'confirm' || act === 'correct') {
        var card = el.closest('[data-match]');
        var win = card.querySelector('.m-win').value, sa = +card.querySelector('.m-sa').value, sb = +card.querySelector('.m-sb').value;
        await api('matches/' + el.getAttribute('data-match') + '/' + act, 'POST', { winner: win, scoreA: sa, scoreB: sb });
        toast(act === 'correct' ? 'Corrected' : 'Confirmed'); await loadDetail();
      }
      else if (act === 'forfeit') {
        var loser = confirm('OK = Team A forfeits, Cancel = Team B forfeits') ? el.getAttribute('data-a') : el.getAttribute('data-b');
        await api('matches/' + el.getAttribute('data-match') + '/forfeit', 'POST', { loserTeamId: loser });
        toast('Forfeit recorded'); await loadDetail();
      }
      else if (act === 'reopen') { if (confirm('Reopen this match? Downstream must not be decided.')) { await api('matches/' + el.getAttribute('data-match') + '/reopen', 'POST', {}); toast('Reopened'); await loadDetail(); } }
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

  loadTournaments().catch(function (x) { toast('Load error: ' + x.message, true); });
})();
