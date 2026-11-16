// rank.js — map a League rank string to a numeric ordinal for division bucketing + seeding.
// Higher ordinal = stronger. Divisions IV..I within a tier; Master+ have none.
// Pure, no I/O.

export const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIER_ALIAS = { PLAT: 'PLATINUM', EMER: 'EMERALD', DIA: 'DIAMOND', GM: 'GRANDMASTER', CHALL: 'CHALLENGER', CHALLENGER: 'CHALLENGER' };
const DIV_ROMAN = { I: 1, II: 2, III: 3, IV: 4 };

// ordinal = tierIndex*4 + (4 - division) so Iron IV = 0 ... Challenger = 39.
export function rankOrdinal(tier, division) {
  const ti = TIERS.indexOf(tier);
  if (ti < 0) return null;
  const apex = ti >= TIERS.indexOf('MASTER');
  const div = apex ? 1 : (division || 4); // apex tiers have no division
  return ti * 4 + (4 - div);
}

// Parse "Gold 2", "PLATINUM IV", "Diamond", "challenger", "plat1", "Unranked".
export function parseRank(input) {
  if (!input) return { tier: null, division: null, ordinal: null, label: 'Unranked' };
  const s = String(input).trim().toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s === 'UNRANKED' || s === 'NONE' || s === 'N A') return { tier: null, division: null, ordinal: null, label: 'Unranked' };
  const parts = s.split(' ');
  let tier = null, division = null;
  for (const p of parts) {
    const t = TIER_ALIAS[p] || (TIERS.includes(p) ? p : null);
    if (t && !tier) { tier = t; continue; }
    if (DIV_ROMAN[p]) division = DIV_ROMAN[p];
    else if (/^[1-4]$/.test(p)) division = Number(p);
  }
  // also handle glued forms like "PLAT1" / "GOLD2"
  if (!tier) {
    const m = s.match(/^([A-Z]+?)\s*([1-4]|IV|III|II|I)?$/);
    if (m) { tier = TIER_ALIAS[m[1]] || (TIERS.includes(m[1]) ? m[1] : null); if (m[2]) division = DIV_ROMAN[m[2]] || Number(m[2]); }
  }
  if (!tier) return { tier: null, division: null, ordinal: null, label: 'Unranked' };
  const apex = TIERS.indexOf(tier) >= TIERS.indexOf('MASTER');
  if (!apex && !division) division = 4; // assume lowest division if unspecified
  const ord = rankOrdinal(tier, division);
  const label = apex ? titleCase(tier) : `${titleCase(tier)} ${division}`;
  return { tier, division: apex ? null : division, ordinal: ord, label };
}

function titleCase(t) { return t.charAt(0) + t.slice(1).toLowerCase(); }
