-- ih_tournaments — schema for the Ingenious Hunter tournament system (Cloudflare D1 / SQLite).
-- Reusable across events. All timestamps are unix epoch milliseconds (INTEGER).
-- Idempotent import keys on participants.external_ref; advancement via matches.next_match_id.

PRAGMA foreign_keys = ON;

-- One tournament/event. `config` is JSON for forward-compatible knobs.
CREATE TABLE IF NOT EXISTS tournaments (
  id            TEXT PRIMARY KEY,                 -- ulid/uuid
  slug          TEXT NOT NULL UNIQUE,             -- /tournaments/<slug>
  name          TEXT NOT NULL,
  game          TEXT NOT NULL DEFAULT 'League of Legends',
  region        TEXT NOT NULL DEFAULT 'NA',
  format        TEXT NOT NULL DEFAULT 'single_elim',
  status        TEXT NOT NULL DEFAULT 'draft',    -- draft|registration|checkin|live|complete|archived
  visibility    TEXT NOT NULL DEFAULT 'public',   -- public|unlisted|private
  starts_at     INTEGER,                          -- event start (epoch ms)
  checkin_opens_at INTEGER,
  checkin_closes_at INTEGER,
  capacity      INTEGER NOT NULL DEFAULT 32,      -- configurable team cap
  team_size     INTEGER NOT NULL DEFAULT 5,
  registration_url TEXT,                          -- Google Form
  discord_invite TEXT,
  config        TEXT NOT NULL DEFAULT '{}',       -- JSON
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Rank-based divisions. Created from turnout; higher-skilled players are never auto-merged down.
CREATE TABLE IF NOT EXISTS divisions (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                    -- e.g. "Open", "Gold-", "Plat+"
  rank_floor    INTEGER,                          -- inclusive rank ordinal (see rank_ordinal), null = no floor
  rank_ceiling  INTEGER,                          -- inclusive, null = no ceiling
  best_of_default INTEGER NOT NULL DEFAULT 1,     -- BO for non-final rounds
  final_best_of INTEGER NOT NULL DEFAULT 3,
  seed_method   TEXT NOT NULL DEFAULT 'rank',     -- rank|manual|random
  status        TEXT NOT NULL DEFAULT 'open',     -- open|seeded|live|complete
  bracket_json  TEXT,                             -- materialized bracket snapshot (public read)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_divisions_tournament ON divisions(tournament_id);

-- A registrant: a solo player OR a pre-formed team captain's row. One row per real person/entry.
-- external_ref makes CSV import idempotent (re-import updates, never duplicates).
CREATE TABLE IF NOT EXISTS participants (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  external_ref  TEXT NOT NULL,                    -- stable key from the Google Form (response id / hash)
  kind          TEXT NOT NULL DEFAULT 'solo',     -- solo|team_captain|team_member
  display_name  TEXT NOT NULL,
  riot_id       TEXT,                             -- "Name#TAG"
  riot_id_norm  TEXT,                             -- lowercased, for matching
  discord       TEXT,
  email_hash    TEXT,                             -- sha256(lowercased email); never store raw email
  rank_tier     TEXT,                             -- IRON..CHALLENGER (raw)
  rank_ordinal  INTEGER,                          -- numeric rank for division math (see _lib/rank.js)
  preferred_role TEXT,
  proposed_team_name TEXT,                         -- what they typed if registering as/with a team
  team_id       TEXT REFERENCES teams(id) ON DELETE SET NULL,
  division_id   TEXT REFERENCES divisions(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'registered', -- registered|assigned|withdrawn
  notes         TEXT,
  raw_json      TEXT,                             -- original CSV row (for correction/audit)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tournament_id, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_participants_tournament ON participants(tournament_id);
CREATE INDEX IF NOT EXISTS idx_participants_team ON participants(team_id);
CREATE INDEX IF NOT EXISTS idx_participants_riot ON participants(tournament_id, riot_id_norm);

-- A competing team (pre-formed or assembled from solos by the admin).
CREATE TABLE IF NOT EXISTS teams (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id   TEXT REFERENCES divisions(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  seed          INTEGER,                          -- 1..N within division once seeded
  captain_participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
  captain_token_hash TEXT,                        -- sha256 of the HMAC captain token (lookup + revoke)
  checkin_status TEXT NOT NULL DEFAULT 'pending', -- pending|checked_in|no_show
  checked_in_at INTEGER,
  status        TEXT NOT NULL DEFAULT 'active',   -- active|withdrawn|disqualified
  seed_rank_ordinal INTEGER,                      -- avg/median rank used for seeding
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_teams_division ON teams(division_id);

-- Team membership (many participants per team).
CREATE TABLE IF NOT EXISTS rosters (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  role          TEXT,                             -- top|jungle|mid|bot|support|fill
  is_captain    INTEGER NOT NULL DEFAULT 0,
  is_sub        INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  UNIQUE (team_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_rosters_team ON rosters(team_id);

-- A bracket match. Single-elim tree: winner flows to (next_match_id, next_slot).
CREATE TABLE IF NOT EXISTS matches (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id   TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  round         INTEGER NOT NULL,                 -- 1 = first round
  slot          INTEGER NOT NULL,                 -- index within the round (0-based)
  best_of       INTEGER NOT NULL DEFAULT 1,
  team_a_id     TEXT REFERENCES teams(id) ON DELETE SET NULL,
  team_b_id     TEXT REFERENCES teams(id) ON DELETE SET NULL,
  a_seed        INTEGER,
  b_seed        INTEGER,
  winner_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  loser_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  score_a       INTEGER NOT NULL DEFAULT 0,       -- games won
  score_b       INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|ready|reported|confirmed|disputed|bye
  is_bye        INTEGER NOT NULL DEFAULT 0,
  next_match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  next_slot     TEXT,                             -- 'a' | 'b'
  version       INTEGER NOT NULL DEFAULT 0,       -- optimistic concurrency guard
  scheduled_at  INTEGER,
  confirmed_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (division_id, round, slot)
);
CREATE INDEX IF NOT EXISTS idx_matches_division ON matches(division_id);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);

-- A captain's claimed result for a match (one per captain). Agreement auto-confirms; mismatch disputes.
CREATE TABLE IF NOT EXISTS result_submissions (
  id            TEXT PRIMARY KEY,
  match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,   -- which captain submitted
  claimed_winner_team_id TEXT NOT NULL REFERENCES teams(id),
  score_a       INTEGER NOT NULL DEFAULT 0,
  score_b       INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'captain',  -- captain|admin
  created_at    INTEGER NOT NULL,
  UNIQUE (match_id, team_id)                      -- one submission per team per match (re-submit overwrites via upsert)
);
CREATE INDEX IF NOT EXISTS idx_submissions_match ON result_submissions(match_id);

-- Append-only audit of every mutation (reversible ops + dispute trail).
CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT,
  actor_type    TEXT NOT NULL,                    -- admin|captain|system
  actor_id      TEXT,                             -- admin email / captain team id / 'system'
  action        TEXT NOT NULL,                    -- e.g. import, seed, report_result, confirm, correct, reopen
  entity        TEXT,                             -- table name
  entity_id     TEXT,
  before_json   TEXT,
  after_json    TEXT,
  note          TEXT,
  cc            TEXT,                             -- coarse country, no IP
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tournament ON audit_log(tournament_id, created_at);

-- CSV import batches (provenance for idempotent imports).
CREATE TABLE IF NOT EXISTS import_batches (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  filename      TEXT,
  row_count     INTEGER NOT NULL DEFAULT 0,
  inserted      INTEGER NOT NULL DEFAULT 0,
  updated       INTEGER NOT NULL DEFAULT 0,
  skipped       INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT,
  created_at    INTEGER NOT NULL
);
