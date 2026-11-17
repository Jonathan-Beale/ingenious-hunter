// bracket.js — read-only, auto-updating single-elimination bracket. First paint from the
// server-embedded window.__IH_BRACKETS__, then it polls /api/tournaments/:slug/bracket. Geometry
// comes from the pure, deterministic layout (assets/bracket_layout.js): cards are absolutely
// positioned so each match sits centered between the two that feed it, connectors trace the
// advancement tree, and a result update patches content in place WITHOUT moving any card.
import { computeLayout, roundName } from './bracket_layout.js';

(function () {
  var mount = document.getElementById('brackets');
  if (!mount) return;
  var slug = mount.getAttribute('data-slug');
  var state = { brackets: window.__IH_BRACKETS__ || [], active: 0 };
  var built = { key: null, nodes: null, conns: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  // status -> { label, cls } for the card footer
  function statusInfo(m, isFinal) {
    if (m.isBye) return { label: 'Bye', cls: 'bye' };
    switch (m.status) {
      case 'confirmed': return { label: isFinal ? 'Final' : 'Confirmed', cls: 'confirmed' };
      case 'disputed': return { label: 'Disputed', cls: 'disputed' };
      case 'reported': return { label: 'Reported', cls: 'reported' };
      case 'ready': return { label: 'Ready', cls: 'ready' };
      default: return { label: 'Pending', cls: 'pending' };
    }
  }
  function keyOf(b) { return (b && b.division ? b.division.id : '0') + '|' + (b && b.matches ? b.matches.map(function (m) { return m.id; }).join(',') : ''); }

  function buildStructure(b) {
    mount.innerHTML = '';
    // division status + champion header
    var head = el('div', 'bhead');
    var st = divisionStatus(b);
    head.innerHTML = '<span class="bname">' + esc(b.division ? b.division.name : '') + '</span>' +
      '<span class="bchip ' + st.cls + '">' + st.label + '</span>' +
      (b.champion ? '<span class="bchampion">👑 <span class="red">' + esc(b.champion) + '</span></span>' : '');
    mount.appendChild(head);

    var scroll = el('div', 'bracket');
    var canvas = el('div', 'bcanvas');
    var L = computeLayout(b);
    canvas.style.width = L.width + 'px';
    canvas.style.height = L.height + 'px';

    // round headers
    L.headers.forEach(function (h) {
      var hd = el('div', 'bround-h');
      hd.textContent = h.label; hd.style.left = h.x + 'px'; hd.style.width = h.w + 'px';
      canvas.appendChild(hd);
    });

    // connectors (SVG under the cards)
    var svgns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgns, 'svg');
    svg.setAttribute('class', 'bwires'); svg.setAttribute('width', L.width); svg.setAttribute('height', L.height);
    var conns = {};
    L.connectors.forEach(function (c) {
      var p = document.createElementNS(svgns, 'path');
      p.setAttribute('d', 'M' + c.x1 + ',' + c.y1 + ' H' + c.midX + ' V' + c.y2 + ' H' + c.x2);
      p.setAttribute('class', 'bwire');
      svg.appendChild(p);
      (conns[c.child] = conns[c.child] || []).push(p);
    });
    canvas.appendChild(svg);

    // cards
    var rounds = L.rounds;
    var nodes = {};
    var byId = {}; b.matches.forEach(function (m) { byId[m.id] = m; });
    L.cards.forEach(function (card) {
      var m = byId[card.id];
      var root = el('div', 'bmatch');
      root.style.left = card.x + 'px'; root.style.top = card.y + 'px';
      root.style.width = card.w + 'px'; root.style.height = card.h + 'px';
      var ra = teamRowNode(), rb = teamRowNode(), foot = el('div', 'bmfoot');
      root.appendChild(ra.row); root.appendChild(rb.row); root.appendChild(foot);
      canvas.appendChild(root);
      nodes[card.id] = { root: root, a: ra, b: rb, foot: foot, isFinal: m.round === rounds };
    });

    scroll.appendChild(canvas);
    mount.appendChild(scroll);
    built = { key: keyOf(b), nodes: nodes, conns: conns, head: head };
  }

  function teamRowNode() {
    var row = el('div', 'bteam');
    var seed = el('span', 'seed'), nm = el('span', 'nm'), sc = el('span', 'sc');
    row.appendChild(seed); row.appendChild(nm); row.appendChild(sc);
    return { row: row, seed: seed, nm: nm, sc: sc };
  }

  function divisionStatus(b) {
    if (b.champion) return { label: 'Completed', cls: 'done' };
    var any = (b.matches || []).some(function (m) { return m.status === 'confirmed'; });
    var disputed = (b.matches || []).some(function (m) { return m.status === 'disputed'; });
    if (disputed) return { label: 'In progress · dispute', cls: 'live' };
    if (any) return { label: 'In progress', cls: 'live' };
    if ((b.division && b.division.status === 'seeded')) return { label: 'Seeded', cls: 'seeded' };
    return { label: 'Not started', cls: 'idle' };
  }

  function sideScore(m, side) {
    if (m.status !== 'confirmed') return '';
    var v = side === 'a' ? m.scoreA : m.scoreB;
    return v == null ? '' : String(v);
  }

  function paintTeam(cell, side, m) {
    var isWin = m.winner && side.id === m.winner;
    var isLose = m.winner && side.id && side.id !== m.winner;
    cell.row.className = 'bteam' + (side.id ? (isWin ? ' win' : (isLose ? ' lose' : '')) : ' tbd');
    cell.seed.textContent = side.seed || '';
    cell.nm.textContent = side.name || 'TBD';
  }

  function applyState(b) {
    // header
    var st = divisionStatus(b);
    built.head.innerHTML = '<span class="bname">' + esc(b.division ? b.division.name : '') + '</span>' +
      '<span class="bchip ' + st.cls + '">' + st.label + '</span>' +
      (b.champion ? '<span class="bchampion">👑 <span class="red">' + esc(b.champion) + '</span></span>' : '');
    b.matches.forEach(function (m) {
      var n = built.nodes[m.id]; if (!n) return;
      paintTeam(n.a, m.a, m); paintTeam(n.b, m.b, m);
      n.a.sc.textContent = sideScore(m, 'a'); n.b.sc.textContent = sideScore(m, 'b');
      var info = statusInfo(m, n.isFinal);
      n.root.className = 'bmatch s-' + info.cls + (m.isBye ? ' bye' : '');
      n.foot.innerHTML = '<span class="mstatus ' + info.cls + '">' + info.label + '</span>' +
        (m.status === 'confirmed' && !m.isBye ? '<span class="mfs">' + (m.scoreA == null ? '' : m.scoreA) + '–' + (m.scoreB == null ? '' : m.scoreB) + '</span>' : '');
      // highlight the connector carrying this match's winner onward
      var cs = built.conns[m.id];
      if (cs) cs.forEach(function (p) { p.classList.toggle('adv', !!m.winner); });
    });
  }

  function render() {
    if (!state.brackets.length) { mount.innerHTML = '<p class="muted">The bracket will appear here once it is drawn.</p>'; built.key = null; return; }
    var i = Math.min(state.active, state.brackets.length - 1);
    var b = state.brackets[i];
    if (!b || !b.matches || !b.matches.length) { mount.innerHTML = '<p class="muted">Bracket not drawn yet for this division.</p>'; built.key = null; return; }
    if (built.key !== keyOf(b)) buildStructure(b);   // structure changed → rebuild (no shift within a state)
    applyState(b);                                   // always patch content in place
  }

  // division tabs
  var tabs = document.querySelectorAll('.divtab');
  tabs.forEach(function (tab, idx) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('on'); });
      tab.classList.add('on'); state.active = idx; render();
    });
  });

  async function poll() {
    if (!slug || window.__IH_NO_POLL__) return;
    try {
      var r = await fetch('/api/tournaments/' + encodeURIComponent(slug) + '/bracket', { headers: { accept: 'application/json' } });
      if (r.ok) { var data = await r.json(); if (data && data.brackets) { state.brackets = data.brackets; render(); } }
    } catch (e) { /* keep last good render */ }
  }

  render();
  poll();
  if (slug && !window.__IH_NO_POLL__) setInterval(poll, 15000);
})();
