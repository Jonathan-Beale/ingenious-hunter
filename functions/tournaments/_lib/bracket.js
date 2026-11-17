// bracket.js — PURE single-elimination bracket engine. No I/O, no framework; same module runs
// on Cloudflare Pages Functions and under node:test. Operates on plain objects so the whole
// thing is unit-testable with zero infrastructure.
//
// A `bracket` is: { size, rounds, matches: [match] }  where a `match` is:
//   { id, round, slot, bestOf, aSeed, bSeed, aTeam, bTeam, winner, loser,
//     scoreA, scoreB, status, isBye, nextId, nextSlot }
// Teams are referenced by opaque id strings (or null for an empty/bye slot).

export class BracketError extends Error {
  constructor(code, message) { super(message || code); this.code = code; this.name = 'BracketError'; }
}

export function nextPow2(n) { let s = 1; while (s < n) s <<= 1; return s; }

// Standard seeding slot order for a power-of-two bracket: returns an array of length `size`
// giving the 1-based seed that belongs in each slot, arranged so seed 1 and 2 can only meet in
// the final, 1 plays the lowest seed, etc.  size=4 -> [1,4,2,3]; size=8 -> [1,8,4,5,2,7,3,6].
export function seedSlots(size) {
  if (size < 2) return [1];
  let slots = [1, 2];
  while (slots.length < size) {
    const n = slots.length * 2;
    const out = [];
    for (const s of slots) { out.push(s); out.push(n + 1 - s); }
    slots = out;
  }
  return slots;
}

// Build a bracket from seeded teams. `teams` = [{ id, seed? }, ...]. If seeds are absent, array
// order is the seeding (index 0 = seed 1). Byes are given to the TOP seeds automatically.
//   opts: { bestOf=1, finalBestOf=bestOf }  (final round can be a longer series, e.g. BO3)
export function buildBracket(teams, opts = {}) {
  const bestOf = opts.bestOf || 1;
  const finalBestOf = opts.finalBestOf || bestOf;
  const seeded = teams.map((t, i) => ({ id: t.id, seed: t.seed || i + 1 }))
    .sort((a, b) => a.seed - b.seed)
    .map((t, i) => ({ id: t.id, seed: i + 1 })); // normalize to 1..N dense
  const n = seeded.length;
  if (n < 1) throw new BracketError('no_teams', 'at least one team is required');

  const size = Math.max(1, nextPow2(n));
  const rounds = size < 2 ? 0 : Math.log2(size);
  const bySeed = new Map(seeded.map((t) => [t.seed, t.id]));

  // Single-team tournament: trivially the champion, no matches.
  if (size < 2) return { size: 1, rounds: 0, matches: [], championTeam: seeded[0].id };

  // Create empty match skeletons for every round, wire next pointers.
  const matches = [];
  const byRound = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / Math.pow(2, r);
    const arr = [];
    for (let s = 0; s < count; s++) {
      const m = {
        id: `R${r}M${s}`, round: r, slot: s,
        bestOf: r === rounds ? finalBestOf : bestOf,
        aSeed: null, bSeed: null, aTeam: null, bTeam: null,
        winner: null, loser: null, scoreA: 0, scoreB: 0,
        status: 'pending', isBye: false, nextId: null, nextSlot: null,
      };
      matches.push(m); arr.push(m);
    }
    byRound.push(arr);
  }
  for (let r = 1; r < rounds; r++) {
    for (const m of byRound[r - 1]) {
      const parent = byRound[r][Math.floor(m.slot / 2)];
      m.nextId = parent.id;
      m.nextSlot = m.slot % 2 === 0 ? 'a' : 'b';
    }
  }

  // Fill round 1 from the seed slot order.
  const slots = seedSlots(size);
  const r1 = byRound[0];
  for (let i = 0; i < r1.length; i++) {
    const aSeed = slots[i * 2], bSeed = slots[i * 2 + 1];
    const m = r1[i];
    m.aSeed = aSeed <= n ? aSeed : null;
    m.bSeed = bSeed <= n ? bSeed : null;
    m.aTeam = m.aSeed ? bySeed.get(m.aSeed) : null;
    m.bTeam = m.bSeed ? bySeed.get(m.bSeed) : null;
  }

  const bracket = { size, rounds, matches };

  // Resolve byes: a round-1 match with exactly one present team auto-advances that team.
  for (const m of r1) {
    const present = m.aTeam && !m.bTeam ? m.aTeam : (!m.aTeam && m.bTeam ? m.bTeam : null);
    if (present && (m.aTeam || m.bTeam) && !(m.aTeam && m.bTeam)) {
      m.isBye = true; m.status = 'bye'; m.winner = present;
      advanceWinner(bracket, m, present);
    }
  }
  markReady(bracket);
  return bracket;
}

export function getMatch(bracket, id) {
  const m = bracket.matches.find((x) => x.id === id);
  if (!m) throw new BracketError('no_match', `no match ${id}`);
  return m;
}

// Place `teamId` into this match's next slot. Internal; does not validate the result itself.
function advanceWinner(bracket, m, teamId) {
  if (!m.nextId) return; // final
  const nxt = getMatch(bracket, m.nextId);
  if (m.nextSlot === 'a') { nxt.aTeam = teamId; } else { nxt.bTeam = teamId; }
}

// A match is 'ready' once both its teams are known and it isn't already decided or a bye.
function markReady(bracket) {
  for (const m of bracket.matches) {
    if (m.status === 'pending' && m.aTeam && m.bTeam) m.status = 'ready';
  }
}

// Record a CONFIRMED winner for a match and advance them. Idempotent for the same winner;
// refuses a conflicting change unless the match is reopened first. `scores` optional {a,b}.
export function recordResult(bracket, matchId, winnerTeamId, scores) {
  const m = getMatch(bracket, matchId);
  if (m.isBye) throw new BracketError('bye_match', 'cannot report a bye match');
  if (!m.aTeam || !m.bTeam) throw new BracketError('not_ready', 'both teams must be set before a result');
  if (winnerTeamId !== m.aTeam && winnerTeamId !== m.bTeam) {
    throw new BracketError('bad_winner', 'winner must be one of the two teams in the match');
  }
  if (m.status === 'confirmed') {
    if (m.winner === winnerTeamId) return { ok: true, idempotent: true, match: m }; // no-op
    throw new BracketError('already_decided', 'match already confirmed; reopen it before changing the winner');
  }
  if (scores) { m.scoreA = scores.a | 0; m.scoreB = scores.b | 0; }
  m.winner = winnerTeamId;
  m.loser = winnerTeamId === m.aTeam ? m.bTeam : m.aTeam;
  m.status = 'confirmed';
  advanceWinner(bracket, m, winnerTeamId);
  markReady(bracket);
  return { ok: true, match: m, advancedTo: m.nextId };
}

// Reverse a confirmed result (score correction / mistake). Guards against inconsistency: if the
// downstream match is already CONFIRMED, you must reopen that one first (reversible, top-down).
export function reopenResult(bracket, matchId) {
  const m = getMatch(bracket, matchId);
  if (m.isBye) throw new BracketError('bye_match', 'cannot reopen a bye');
  if (m.status !== 'confirmed') return { ok: true, idempotent: true, match: m };
  if (m.nextId) {
    const nxt = getMatch(bracket, m.nextId);
    if (nxt.status === 'confirmed') {
      throw new BracketError('downstream_locked', `reopen ${nxt.id} first — it is already decided`);
    }
    // pull our team back out of the downstream slot
    if (m.nextSlot === 'a') nxt.aTeam = null; else nxt.bTeam = null;
    if (nxt.status === 'ready') nxt.status = 'pending';
  }
  m.winner = null; m.loser = null; m.scoreA = 0; m.scoreB = 0;
  m.status = m.aTeam && m.bTeam ? 'ready' : 'pending';
  return { ok: true, match: m };
}

// The final's winner, or null if not yet decided.
export function bracketChampion(bracket) {
  if (bracket.championTeam) return bracket.championTeam;
  const final = bracket.matches.find((m) => m.round === bracket.rounds);
  return final && final.status === 'confirmed' ? final.winner : null;
}

export function countByes(bracket) { return bracket.matches.filter((m) => m.isBye).length; }
