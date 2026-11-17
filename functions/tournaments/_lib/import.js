// import.js — normalize Google Forms CSV rows into participant records and plan an IDEMPOTENT
// import: a re-import UPDATES changed rows and never duplicates (keyed on external_ref). Pure.
import { parseRank } from './rank.js';

// Heuristic header matching — Google Form column titles vary, so match on keywords. Admin can
// override any mapping from the dashboard; this just gives a sensible default.
const FIELD_HINTS = {
  response_id: [/response\s*id/i, /submission\s*id/i, /^id$/i],
  timestamp: [/timestamp/i, /time\b/i, /date/i],
  display_name: [/summoner/i, /display\s*name/i, /\bname\b/i, /nickname/i, /ign/i],
  riot_id: [/riot\s*id/i, /riot/i, /game\s*name/i, /ign/i, /summoner/i],
  email: [/e-?mail/i],
  discord: [/discord/i],
  rank: [/rank/i, /tier/i, /elo/i, /division/i],
  preferred_role: [/role/i, /position/i, /lane/i],
  team_name: [/team\s*name/i, /\bteam\b/i],
  entry_type: [/register.*(solo|team)/i, /solo.*team/i, /entry\s*type/i, /individually/i],
};

export function guessMapping(headers) {
  const map = {};
  for (const [field, pats] of Object.entries(FIELD_HINTS)) {
    const hit = headers.find((h) => pats.some((p) => p.test(h)));
    if (hit) map[field] = hit;
  }
  return map;
}

// Deterministic, non-reversible dedup key (FNV-1a) so we never store a raw email in external_ref.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const norm = (s) => String(s || '').trim();
const lower = (s) => norm(s).toLowerCase();

// Stable external_ref: prefer the form's own response id; else a hash of the strongest available
// identity (email, then riot id, then name+timestamp). Same registrant -> same ref across imports.
export function makeExternalRef(row, map) {
  const rid = map.response_id && norm(row[map.response_id]);
  if (rid) return `rid:${rid}`;
  const email = map.email && lower(row[map.email]);
  if (email) return `e:${fnv1a(email)}`;
  const riot = map.riot_id && lower(row[map.riot_id]);
  if (riot) return `r:${fnv1a(riot)}`;
  const ts = map.timestamp && norm(row[map.timestamp]);
  const name = map.display_name && lower(row[map.display_name]);
  return `c:${fnv1a((ts || '') + '|' + (name || ''))}`;
}

// The comparable subset — if any of these change between imports, it's an UPDATE.
const COMPARE_FIELDS = ['display_name', 'riot_id_norm', 'discord', 'email_hash', 'rank_tier', 'rank_ordinal', 'preferred_role', 'proposed_team_name', 'kind'];

export function normalizeRow(row, map, emailHasher) {
  const display_name = (map.display_name && norm(row[map.display_name])) || (map.riot_id && norm(row[map.riot_id])) || 'Unnamed';
  const riot_id = map.riot_id ? norm(row[map.riot_id]) : '';
  const email = map.email ? lower(row[map.email]) : '';
  const rankStr = map.rank ? norm(row[map.rank]) : '';
  const parsed = parseRank(rankStr);
  const entry = map.entry_type ? lower(row[map.entry_type]) : '';
  const team_name = map.team_name ? norm(row[map.team_name]) : '';
  const kind = /team/.test(entry) || (team_name && !/solo|individual/.test(entry)) ? 'team_captain' : 'solo';
  return {
    external_ref: makeExternalRef(row, map),
    display_name,
    riot_id,
    riot_id_norm: lower(riot_id),
    email_hash: email ? (emailHasher ? emailHasher(email) : `fnv:${fnv1a(email)}`) : null,
    discord: map.discord ? norm(row[map.discord]) : '',
    rank_tier: parsed.tier,
    rank_ordinal: parsed.ordinal,
    rank_label: parsed.label,
    preferred_role: map.preferred_role ? lower(row[map.preferred_role]).slice(0, 16) : '',
    proposed_team_name: team_name,
    kind,
    raw_json: JSON.stringify(row),
  };
}

function differs(existing, incoming) {
  return COMPARE_FIELDS.some((f) => String(existing?.[f] ?? '') !== String(incoming?.[f] ?? ''));
}

// Plan an idempotent import. `existingByRef` maps external_ref -> current participant record.
// Returns inserts/updates/skipped (unchanged) + the deduped, normalized records.
export function planImport(existingByRef, rows, map, emailHasher) {
  const get = (ref) => (existingByRef instanceof Map ? existingByRef.get(ref) : existingByRef[ref]);
  const seen = new Map(); // external_ref -> normalized (last row wins within a batch)
  for (const row of rows) {
    const n = normalizeRow(row, map, emailHasher);
    if (!n.external_ref) continue;
    seen.set(n.external_ref, n); // dedup within the file
  }
  const inserts = [], updates = [], skipped = [];
  for (const [ref, n] of seen) {
    const cur = get(ref);
    if (!cur) inserts.push(n);
    else if (differs(cur, n)) updates.push({ ...n, id: cur.id });
    else skipped.push(n);
  }
  return { inserts, updates, skipped, deduped: [...seen.values()] };
}
