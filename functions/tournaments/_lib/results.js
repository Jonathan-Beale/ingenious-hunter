// results.js — pure result-reconciliation for a match. Captains each report; agreement auto-
// confirms, a mismatch flags a dispute for the admin. Forfeits and admin overrides supported.
// Advancement itself is done by bracket.js once a winner is confirmed.

export class ResultError extends Error {
  constructor(code, message) { super(message || code); this.code = code; this.name = 'ResultError'; }
}

export function winsNeeded(bestOf) { return Math.floor((bestOf || 1) / 2) + 1; }

// Validate a single captain (or admin) report against the match.
export function validateReport(match, { teamId, winner, scoreA = 0, scoreB = 0, source = 'captain' }) {
  if (match.is_bye || match.isBye) throw new ResultError('bye_match', 'cannot report a bye');
  const a = match.team_a_id ?? match.aTeam, b = match.team_b_id ?? match.bTeam;
  if (!a || !b) throw new ResultError('not_ready', 'both teams must be set');
  if (source === 'captain' && teamId !== a && teamId !== b) {
    throw new ResultError('not_a_participant', 'reporting team is not in this match');
  }
  if (winner !== a && winner !== b) throw new ResultError('bad_winner', 'winner must be one of the two teams');
  const need = winsNeeded(match.best_of ?? match.bestOf ?? 1);
  const wScore = winner === a ? scoreA : scoreB;
  const lScore = winner === a ? scoreB : scoreA;
  if (wScore < lScore) throw new ResultError('bad_score', 'winner cannot have fewer games than loser');
  if ((match.best_of ?? match.bestOf ?? 1) > 1 && wScore !== need) {
    throw new ResultError('bad_score', `winner must reach ${need} games in a best-of-${match.best_of ?? match.bestOf}`);
  }
  return true;
}

// Reconcile all submissions for a match into a decision.
//   submissions: [{ teamId, winner, scoreA, scoreB, source }]
// Returns { status, winner?, scoreA?, scoreB?, reason }.
export function reconcile(match, submissions) {
  const a = match.team_a_id ?? match.aTeam, b = match.team_b_id ?? match.bTeam;
  const subs = (submissions || []).filter((s) => s && (s.teamId === a || s.teamId === b || s.source === 'admin'));

  const admin = subs.find((s) => s.source === 'admin');
  if (admin) {
    return { status: 'confirmed', winner: admin.winner, scoreA: admin.scoreA | 0, scoreB: admin.scoreB | 0, reason: 'admin_override' };
  }
  if (subs.length === 0) return { status: (a && b) ? 'ready' : 'pending', reason: 'no_reports' };
  if (subs.length === 1) return { status: 'reported', reason: 'awaiting_other_captain' };

  // two captain submissions
  const [s1, s2] = subs;
  if (s1.winner === s2.winner) {
    // agree on winner -> confirm. Prefer the winning captain's score line.
    const winnerSub = s1.teamId === s1.winner ? s1 : (s2.teamId === s2.winner ? s2 : s1);
    const scoreMismatch = (s1.scoreA | 0) !== (s2.scoreA | 0) || (s1.scoreB | 0) !== (s2.scoreB | 0);
    return {
      status: 'confirmed', winner: s1.winner,
      scoreA: winnerSub.scoreA | 0, scoreB: winnerSub.scoreB | 0,
      reason: scoreMismatch ? 'both_agree_winner_score_mismatch' : 'both_agree',
    };
  }
  return { status: 'disputed', reason: 'winner_mismatch' };
}

// Forfeit: the other team wins by the minimum series score.
export function forfeitDecision(match, loserTeamId, source = 'admin') {
  const a = match.team_a_id ?? match.aTeam, b = match.team_b_id ?? match.bTeam;
  if (loserTeamId !== a && loserTeamId !== b) throw new ResultError('bad_winner', 'forfeiting team not in match');
  const winner = loserTeamId === a ? b : a;
  if (!winner) throw new ResultError('not_ready', 'opponent not set');
  const need = winsNeeded(match.best_of ?? match.bestOf ?? 1);
  const scoreA = winner === a ? need : 0;
  const scoreB = winner === b ? need : 0;
  return { status: 'confirmed', winner, scoreA, scoreB, reason: 'forfeit', forfeit: true, source };
}
