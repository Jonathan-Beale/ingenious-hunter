// bracket_layout.js — PURE, deterministic single-elimination bracket geometry. No DOM.
// Positions depend ONLY on the advancement tree (rounds + which match feeds which), never on
// winners/scores/status — so a live result update never shifts the layout. Shared by the browser
// renderer (assets/bracket.js) and the node tests (test/bracket_layout.test.js).
//
// Input: a bracket-like object { matches: [{ id, round, slot, nextId, nextSlot, isBye? }, ...] }.
// Each later-round match is centered on the average of the children that advance into it, so the
// tree reads correctly for 8/16/32/64 teams and for byes.

export const DEFAULTS = Object.freeze({
  cardW: 208,   // match card width
  cardH: 76,    // match card height (2 team rows + status footer); fixed so there is no reflow
  hGap: 60,     // horizontal gap between round columns (room for connector elbows)
  vGap: 22,     // min vertical gap between round-1 cards
  padX: 10,
  padY: 6,
  headerH: 30,  // round-label band above the cards
});

// Compute absolute positions + connector polylines for a bracket.
// Returns { cards, connectors, headers, width, height, rounds, cardW, cardH }.
export function computeLayout(bracket, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const matches = (bracket && bracket.matches) || [];
  if (!matches.length) return { cards: [], connectors: [], headers: [], width: 0, height: 0, rounds: 0, cardW: o.cardW, cardH: o.cardH };

  const rounds = matches.reduce((mx, m) => Math.max(mx, m.round), 0);
  const byRound = {};
  for (const m of matches) (byRound[m.round] = byRound[m.round] || []).push(m);
  for (const r of Object.keys(byRound)) byRound[r].sort((a, b) => a.slot - b.slot);

  const pitch = o.cardH + o.vGap;                 // round-1 vertical pitch
  const xOfRound = (r) => o.padX + (r - 1) * (o.cardW + o.hGap);
  const baseY = o.padY + o.headerH;

  // children map: every match that advances INTO a given parent id
  const childrenOf = {};
  for (const m of matches) if (m.nextId != null) (childrenOf[m.nextId] = childrenOf[m.nextId] || []).push(m);

  // center-y for each match, computed round by round (children before parents)
  const center = {};
  const r1 = byRound[1] || [];
  r1.forEach((m, i) => { center[m.id] = baseY + i * pitch + o.cardH / 2; });
  for (let r = 2; r <= rounds; r++) {
    for (const m of (byRound[r] || [])) {
      const kids = (childrenOf[m.id] || []).map((k) => center[k.id]).filter((v) => v != null);
      center[m.id] = kids.length ? kids.reduce((s, v) => s + v, 0) / kids.length : baseY + m.slot * pitch + o.cardH / 2;
    }
  }

  const cards = matches.map((m) => ({
    id: m.id, round: m.round, slot: m.slot, isBye: !!m.isBye,
    x: xOfRound(m.round), y: center[m.id] - o.cardH / 2, w: o.cardW, h: o.cardH, cy: center[m.id],
  }));

  // connectors: child right-center -> elbow -> parent left-center
  const connectors = [];
  for (let r = 2; r <= rounds; r++) {
    for (const m of (byRound[r] || [])) {
      const px = xOfRound(r), pcy = center[m.id];
      for (const kid of (childrenOf[m.id] || [])) {
        const kx = xOfRound(kid.round) + o.cardW, kcy = center[kid.id];
        const midX = kx + (px - kx) / 2;
        connectors.push({ parent: m.id, child: kid.id, x1: kx, y1: kcy, midX, x2: px, y2: pcy });
      }
    }
  }

  const headers = [];
  for (let r = 1; r <= rounds; r++) headers.push({ round: r, x: xOfRound(r), w: o.cardW, label: roundName(r, rounds) });

  const lastR1 = r1.length ? baseY + (r1.length - 1) * pitch + o.cardH : baseY + o.cardH;
  const height = Math.max(lastR1, ...cards.map((c) => c.y + c.h)) + o.padY;
  const width = o.padX * 2 + rounds * o.cardW + (rounds - 1) * o.hGap;
  return { cards, connectors, headers, width, height, rounds, cardW: o.cardW, cardH: o.cardH };
}

export function roundName(round, rounds) {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  if (fromEnd === 3) return 'Round of 16';
  if (fromEnd === 4) return 'Round of 32';
  return 'Round ' + round;
}
