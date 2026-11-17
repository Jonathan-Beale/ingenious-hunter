// divisions.js — assign entities (teams or solo players) to rank divisions WITHOUT ever merging a
// higher-skilled entity down into a lower division just to fill a bracket. Pure.
//
// A division has an inclusive rank band [floor, ceiling] (null = open-ended). An entity is eligible
// for a division only if its rank_ordinal falls within the band. Among eligible divisions we pick
// the STRONGEST (highest floor) — so strong players stay in strong divisions. An entity stronger
// than every division's ceiling is left UNASSIGNED for the admin to place deliberately; it is never
// auto-dropped into a weaker division.

export function assignDivisions(entities, divisions) {
  const assignments = {};
  const unassigned = [];
  for (const e of entities) {
    const ord = e.rank_ordinal ?? e.rankOrdinal ?? null;
    const eligible = divisions.filter((d) => inBand(ord, d));
    if (eligible.length === 0) { assignments[e.id] = null; unassigned.push(e.id); continue; }
    // Prefer a SPECIFIC (bounded) division over a fully-open catch-all; among those pick the
    // strongest band (highest floor). Eligibility already forbids merging a strong player down.
    const bounded = eligible.filter((d) => d.rank_floor != null || d.rank_ceiling != null);
    const pool = bounded.length ? bounded : eligible;
    pool.sort((a, b) => (floorOf(b) - floorOf(a)) || (ceilOf(a) - ceilOf(b)) || ((a.sort_order ?? 0) - (b.sort_order ?? 0)));
    assignments[e.id] = pool[0].id;
  }
  return { assignments, unassigned };
}

function inBand(ord, d) {
  if (ord == null) return d.rank_floor == null && d.rank_ceiling == null; // unranked -> open only
  return ord >= floorOf(d) && ord <= ceilOf(d);
}
function floorOf(d) { return d.rank_floor == null ? -Infinity : d.rank_floor; }
function ceilOf(d) { return d.rank_ceiling == null ? Infinity : d.rank_ceiling; }

// Convenience: group assigned entities by division id.
export function groupByDivision(entities, assignments) {
  const out = {};
  for (const e of entities) {
    const d = assignments[e.id];
    if (!d) continue;
    (out[d] = out[d] || []).push(e);
  }
  return out;
}
