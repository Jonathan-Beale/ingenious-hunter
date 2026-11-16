// bracket.js — read-only, auto-updating single-elimination bracket renderer. First paint comes from
// window.__IH_BRACKETS__ (server-embedded); then it polls /api/tournaments/:slug/bracket.
(function () {
  var mount = document.getElementById('brackets');
  if (!mount) return;
  var slug = mount.getAttribute('data-slug');
  var state = { brackets: window.__IH_BRACKETS__ || [], active: 0 };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function roundName(round, rounds) {
    var fromEnd = rounds - round;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'Semifinals';
    if (fromEnd === 2) return 'Quarterfinals';
    return 'Round ' + round;
  }

  function teamRow(side, winnerId) {
    var isWin = winnerId && side.id === winnerId;
    var isLose = winnerId && side.id && side.id !== winnerId;
    var cls = 'bteam' + (side.id ? (isWin ? ' win' : (isLose ? ' lose' : '')) : ' tbd');
    return '<div class="' + cls + '"><span class="seed">' + (side.seed || '') + '</span>' +
      '<span class="nm">' + esc(side.name || 'TBD') + '</span>' +
      '<span class="sc">' + (side.score == null ? '' : side.score) + '</span></div>';
  }

  function renderBracket(b) {
    if (!b || !b.matches || !b.matches.length) return '<p class="muted">Bracket not drawn yet.</p>';
    var rounds = Math.max.apply(null, b.matches.map(function (m) { return m.round; }));
    var byRound = {};
    b.matches.forEach(function (m) { (byRound[m.round] = byRound[m.round] || []).push(m); });
    var cols = '';
    for (var r = 1; r <= rounds; r++) {
      var ms = (byRound[r] || []).sort(function (a, c) { return a.slot - c.slot; });
      cols += '<div class="bround"><div class="bround-h">' + roundName(r, rounds) + '</div>' +
        ms.map(function (m) {
          var a = { id: m.a.id, name: m.a.name, seed: m.a.seed, score: m.winner != null || m.scoreA ? m.scoreA : (m.status === 'confirmed' ? m.scoreA : null) };
          var bb = { id: m.b.id, name: m.b.name, seed: m.b.seed, score: m.winner != null || m.scoreB ? m.scoreB : (m.status === 'confirmed' ? m.scoreB : null) };
          if (m.status !== 'confirmed') { a.score = null; bb.score = null; }
          var cls = 'bmatch' + (m.isBye ? ' bye' : '');
          return '<div class="' + cls + '" title="' + esc(m.status) + '">' + teamRow(a, m.winner) + teamRow(bb, m.winner) + '</div>';
        }).join('') + '</div>';
    }
    var champ = b.champion ? '<div class="bchampion">👑 Champion: <span class="red">' + esc(b.champion) + '</span></div>' : '';
    return champ + '<div class="bracket"><div class="brounds">' + cols + '</div></div>';
  }

  function render() {
    if (!state.brackets.length) { mount.innerHTML = '<p class="muted">The bracket will appear here once it is drawn.</p>'; return; }
    var i = Math.min(state.active, state.brackets.length - 1);
    mount.innerHTML = renderBracket(state.brackets[i]);
  }

  // division tabs (if present on the page)
  var tabs = document.querySelectorAll('.divtab');
  tabs.forEach(function (tab, idx) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('on'); });
      tab.classList.add('on'); state.active = idx; render();
    });
  });

  async function poll() {
    try {
      var r = await fetch('/api/tournaments/' + encodeURIComponent(slug) + '/bracket', { headers: { accept: 'application/json' } });
      if (r.ok) { var data = await r.json(); if (data && data.brackets) { state.brackets = data.brackets; render(); } }
    } catch (e) { /* keep last good render */ }
  }

  render();
  poll();
  setInterval(poll, 15000);
})();
