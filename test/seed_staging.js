// seed_staging.js — builds a COMPLETE 32-team test tournament by driving the REAL service code
// (import → divisions → teams/rosters → seed → check-in → results → disputes → forfeits →
// corrections → advancement → champion), asserting invariants at each step, then serializes the
// resulting rows to a SQL file for loading into the remote *staging* D1. Fictional data only.
// No Discord, no network — service.js is called directly; the announce route is never touched.
//
// Usage: node test/seed_staging.js <out.sql>
import { makeEnv } from './helpers/d1.js';
import * as svc from '../functions/tournaments/_lib/service.js';
import { genId, now } from '../functions/tournaments/_lib/ids.js';

const OUT = process.argv[2];
const APEX_MODE = process.argv[3] || 'complete'; // 'complete' (both finish) | 'partial' (Apex left mid-tournament)
if (!OUT) { console.error('usage: node test/seed_staging.js <out.sql> [complete|partial]'); process.exit(2); }

const env = makeEnv();              // in-memory SQLite loaded with migrations/0001_init.sql
const DB = env.DB;
const checks = [];
const ok = (name, cond, detail) => { checks.push({ name, pass: !!cond, detail }); if (!cond) console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); else console.log('  ✓ ' + name); };
const must = async (name, fn) => { try { await fn(); ok(name, true); } catch (e) { ok(name, false, e.code || e.message); } };
const mustThrow = async (name, fn, code) => { try { await fn(); ok(name, false, 'expected throw'); } catch (e) { ok(name, (code ? e.code === code || e.message.includes(code) : true), 'threw ' + (e.code || e.message)); } };

// ---------- fictional data ----------
const TEAM_WORDS_A = ['Crimson', 'Obsidian', 'Azure', 'Golden', 'Shadow', 'Iron', 'Frost', 'Ember', 'Storm', 'Void', 'Radiant', 'Savage', 'Lunar', 'Solar', 'Verdant', 'Onyx', 'Scarlet', 'Cobalt', 'Phantom', 'Titan', 'Astral', 'Rogue', 'Vicious', 'Noble', 'Feral', 'Arcane', 'Blazing', 'Grim', 'Mythic', 'Wicked', 'Zenith', 'Primal'];
const TEAM_WORDS_B = ['Wolves', 'Drakes', 'Sentinels', 'Serpents', 'Ravens', 'Titans', 'Reapers', 'Vipers', 'Griffins', 'Hydras', 'Phoenix', 'Wraiths', 'Krakens', 'Golems', 'Nagas', 'Chimeras', 'Basilisks', 'Manticores', 'Direwolves', 'Cinders', 'Specters', 'Juggernauts', 'Minotaurs', 'Gargoyles', 'Leviathans', 'Banshees', 'Cerberus', 'Behemoths', 'Harpies', 'Revenants', 'Djinn', 'Colossi'];
const HANDLES = ['Zylation', 'Mortimus', 'Kael', 'Nyxie', 'Voxel', 'Grimbald', 'Sylphie', 'Draveth', 'Quill', 'Rhyzen', 'Tovald', 'Mireille', 'Caskett', 'Pyre', 'Vandar', 'Solenne', 'Brik', 'Ashlock', 'Fenwick', 'Mara', 'Oswin', 'Thessaly', 'Garrick', 'Lune', 'Vesper', 'Kobald', 'Niamh', 'Doran', 'Riven', 'Sett', 'Yone', 'Ekko'];
const ROLES = ['top', 'jungle', 'mid', 'bot', 'support'];
// 16 Apex ranks (ordinal >= 24) + 16 Contender ranks (12..23), spread for distinct-ish seeds.
const APEX_RANKS = ['Challenger', 'Grandmaster', 'Master', 'Diamond 1', 'Diamond 2', 'Diamond 3', 'Diamond 4', 'Diamond 1', 'Master', 'Diamond 2', 'Grandmaster', 'Diamond 3', 'Diamond 1', 'Diamond 4', 'Master', 'Diamond 2'];
const CONT_RANKS = ['Emerald 1', 'Emerald 2', 'Emerald 3', 'Emerald 4', 'Platinum 1', 'Platinum 2', 'Platinum 3', 'Platinum 4', 'Gold 1', 'Gold 2', 'Gold 3', 'Gold 4', 'Emerald 2', 'Platinum 1', 'Gold 1', 'Platinum 3'];

const CSV_HEADERS = ['Response ID', 'Timestamp', 'Riot ID', 'Display Name', 'Email', 'Discord', 'Rank', 'Preferred Role', 'Team Name', 'Entry Type'];
function buildRegistrants() {
  const rows = [];
  for (let i = 0; i < 32; i++) {
    const apex = i < 16;
    const rank = apex ? APEX_RANKS[i] : CONT_RANKS[i - 16];
    const handle = HANDLES[i];
    rows.push({
      response_id: `RESP-${1000 + i}`,
      riot_id: `${handle}#NA${i}`,
      display_name: handle,
      email: `${handle.toLowerCase()}@example.test`,
      discord: `${handle.toLowerCase()}#${1000 + i}`,
      rank,
      role: ROLES[i % ROLES.length],
      team_name: `${TEAM_WORDS_A[i]} ${TEAM_WORDS_B[i]}`,
      entry_type: 'Team',
    });
  }
  return rows;
}
function toCSV(rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const line = (arr) => arr.map(esc).join(',');
  const body = rows.map((r) => line([r.response_id, r.timestamp || '2026-11-10 12:00:00', r.riot_id, r.display_name, r.email, r.discord, r.rank, r.role, r.team_name, r.entry_type]));
  return [line(CSV_HEADERS), ...body].join('\n');
}

// raw participant insert for non-captain roster members (they aren't separate Form registrants).
async function addMember(tournamentId, teamId, name, role) {
  const id = genId('p');
  await DB.prepare(`INSERT INTO participants (id,tournament_id,external_ref,kind,display_name,riot_id,riot_id_norm,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?, 'registered', ?, ?)`).bind(id, tournamentId, 'mem:' + id, 'team_member', name, name + '#NA1', (name + '#na1').toLowerCase(), now(), now()).run();
  await svc.addRosterMember(env, teamId, id, { role });
}

// ======================================================================
console.log('\n[1] Registration import (idempotent)');
const registrants = buildRegistrants();
const t = await svc.createTournament(env, {
  slug: 'staging-shakedown',
  name: 'IH Shakedown — STAGING TEST (not the Dec 19 event)',
  status: 'live', visibility: 'public',
  starts_at: Date.parse('2026-11-22T19:00:00Z'),
  checkin_opens_at: Date.parse('2026-11-22T18:00:00Z'),
  checkin_closes_at: Date.parse('2026-11-22T18:45:00Z'),
  capacity: 32, team_size: 5,
  registration_url: 'https://example.test/staging-form',
  config: { test: true, note: 'staging smoke test — safe to delete' },
  actorId: 'seed@staging',
});
ok('tournament created with distinct test slug', t.slug === 'staging-shakedown' && /STAGING TEST/.test(t.name));

const csv = toCSV(registrants);
const imp1 = await svc.importParticipants(env, t.id, csv, null, { filename: 'registrations.csv', id: 'admin@staging' });
ok('first import inserts all 32', imp1.inserted === 32 && imp1.updated === 0, JSON.stringify(imp1));
const imp2 = await svc.importParticipants(env, t.id, csv, null, { filename: 'registrations.csv', id: 'admin@staging' });
ok('re-import is idempotent (0 new, 0 updated, 32 skipped)', imp2.inserted === 0 && imp2.updated === 0 && imp2.skipped === 32, JSON.stringify(imp2));
const modified = structuredClone(registrants); modified[0].rank = 'Diamond 4'; // was Challenger -> changes rank_ordinal
const imp3 = await svc.importParticipants(env, t.id, toCSV(modified), null, { filename: 'registrations_v2.csv', id: 'admin@staging' });
ok('modified re-import updates exactly 1', imp3.inserted === 0 && imp3.updated === 1 && imp3.skipped === 31, JSON.stringify(imp3));
// restore the original strong rank so seeding stays realistic
await svc.importParticipants(env, t.id, csv, null, { filename: 'registrations_v3.csv', id: 'admin@staging' });

// ======================================================================
console.log('\n[2] Divisions + auto-assignment by rank');
const apex = await svc.createDivision(env, t.id, { name: 'Apex Division', rank_floor: 24, rank_ceiling: null, best_of_default: 1, final_best_of: 3, sort_order: 1 });     // Diamond+ (24..39)
const cont = await svc.createDivision(env, t.id, { name: 'Contender Division', rank_floor: 12, rank_ceiling: 23, best_of_default: 1, final_best_of: 3, sort_order: 2 }); // Gold..Emerald (12..23)
const asg = await svc.autoAssignDivisions(env, t.id, { id: 'admin@staging' });
ok('all 32 captains assigned, 0 unassigned', asg.assigned === 32 && asg.unassigned.length === 0, JSON.stringify({ assigned: asg.assigned, unassigned: asg.unassigned.length }));
const caps = await DB.prepare(`SELECT * FROM participants WHERE tournament_id=? AND kind='team_captain'`).bind(t.id).all().then((r) => r.results);
const apexCaps = caps.filter((p) => p.division_id === apex.id);
const contCaps = caps.filter((p) => p.division_id === cont.id);
ok('divisions split 16 / 16 by rank band', apexCaps.length === 16 && contCaps.length === 16, `apex=${apexCaps.length} cont=${contCaps.length}`);

// ======================================================================
console.log('\n[3] Teams + full 5-player rosters');
const teamByCap = new Map();
for (const p of caps) {
  const tm = await svc.createTeam(env, t.id, { name: p.proposed_team_name, division_id: p.division_id, seed_rank_ordinal: p.rank_ordinal });
  await svc.addRosterMember(env, tm.id, p.id, { role: p.preferred_role || 'fill', isCaptain: true });
  const used = new Set([p.preferred_role]);
  let added = 1;
  for (const role of ROLES) {
    if (added >= 5) break;
    if (used.has(role)) continue;
    await addMember(t.id, tm.id, `${p.display_name}_${role}`, role);
    used.add(role); added++;
  }
  teamByCap.set(p.id, tm.id);
}
const teamCount = await DB.prepare(`SELECT count(*) n FROM teams WHERE tournament_id=?`).bind(t.id).first();
const rosterCount = await DB.prepare(`SELECT count(*) n FROM rosters`).first();
ok('32 teams created', teamCount.n === 32, `teams=${teamCount.n}`);
ok('160 roster slots (32 × 5)', rosterCount.n === 160, `rosters=${rosterCount.n}`);

// ======================================================================
console.log('\n[4] Seeding both brackets');
const seedA = await svc.seedDivision(env, apex.id, { seedMethod: 'rank', actorId: 'admin@staging' });
const seedC = await svc.seedDivision(env, cont.id, { seedMethod: 'rank', actorId: 'admin@staging' });
ok('Apex: 16 teams → 15 matches, 0 byes', seedA.teams === 16 && seedA.matches === 15 && seedA.byes === 0, JSON.stringify(seedA));
ok('Contender: 16 teams → 15 matches, 0 byes', seedC.teams === 16 && seedC.matches === 15 && seedC.byes === 0, JSON.stringify(seedC));

// ======================================================================
console.log('\n[5] Captain tokens + check-in (+ revocation / scope / tamper)');
const allTeams = await DB.prepare(`SELECT * FROM teams WHERE tournament_id=? ORDER BY division_id, seed`).bind(t.id).all().then((r) => r.results);
const token = new Map();
for (const tm of allTeams) token.set(tm.id, await svc.issueCaptainToken(env, tm.id));

// designate the seed-15 Apex team (Solar Golems) as a no-show so its R1 match ends in a forfeit
const apexTeams = allTeams.filter((tm) => tm.division_id === apex.id).sort((a, b) => a.seed - b.seed);
const noShow = apexTeams.find((tm) => tm.seed === 15) || apexTeams[14];
let checkedIn = 0;
for (const tm of allTeams) { if (tm.id === noShow.id) continue; await svc.checkIn(env, token.get(tm.id)); checkedIn++; }
await DB.prepare(`UPDATE teams SET checkin_status='no_show', updated_at=? WHERE id=?`).bind(now(), noShow.id).run();
ok('31 of 32 teams checked in (1 deliberate no-show)', checkedIn === 31, `checkedIn=${checkedIn}`);

// revocation: rotating a team's token invalidates the previous one
const revTeam = apexTeams[0];
const oldTok = token.get(revTeam.id);
const newTok = await svc.issueCaptainToken(env, revTeam.id);
token.set(revTeam.id, newTok);
await must('rotated token still resolves', async () => { if (!(await svc.resolveCaptain(env, newTok))) throw new Error('new token failed'); });
ok('revoked (old) captain token no longer resolves', (await svc.resolveCaptain(env, oldTok)) === null);
ok('tampered/garbage token rejected', (await svc.resolveCaptain(env, 'not.a.valid.token')) === null);

// ======================================================================
console.log('\n[6] Play both brackets → results, disputes, forfeits, correction, advancement, champion');

async function playDivision(div, opts) {
  const forfeitTeamId = opts.forfeitTeamId || null;
  const flags = { dispute: false, forfeit: false, correction: false, adminDirect: false };
  const names = await DB.prepare(`SELECT id,name,seed FROM teams WHERE division_id=?`).bind(div.id).all().then((r) => Object.fromEntries(r.results.map((x) => [x.id, x])));
  const tok = (id) => token.get(id);
  let guard = 0;
  for (;;) {
    if (++guard > 50) throw new Error('runaway loop');
    const view = await svc.bracketView(env, div.id);
    // resolve any disputed match via admin (higher seed wins)
    const disputed = view.matches.filter((m) => m.status === 'disputed');
    for (const m of disputed) {
      const winner = m.a.seed <= m.b.seed ? m.a.id : m.b.id;
      const r = await svc.adminConfirm(env, m.id, { winner, scoreA: m.a.id === winner ? 1 : 0, scoreB: m.b.id === winner ? 1 : 0, actorId: 'admin@staging' });
      if (!r.ok) throw new Error('admin dispute-resolve failed: ' + r.reason);
    }
    const ready = view.matches.filter((m) => m.status === 'ready' && m.a.id && m.b.id);
    if (ready.length === 0 && disputed.length === 0) break;

    for (const m of ready) {
      // FORFEIT: no-show team loses by forfeit
      if (forfeitTeamId && (m.a.id === forfeitTeamId || m.b.id === forfeitTeamId)) {
        const r = await svc.adminForfeit(env, m.id, { loserTeamId: forfeitTeamId, actorId: 'admin@staging' });
        if (!r.ok) throw new Error('forfeit failed');
        flags.forfeit = true; continue;
      }
      const need = svc.winsNeeded(m.bestOf);
      const winner = m.a.seed <= m.b.seed ? m.a.id : m.b.id; // higher seed (lower number) wins deterministically
      const wA = winner === m.a.id;
      const scoreA = wA ? need : 0, scoreB = wA ? 0 : need;

      // DISPUTE path (once, round 1): captains report conflicting winners -> admin resolves next pass
      if (!flags.dispute && m.round === 1) {
        await svc.submitResult(env, tok(m.a.id), m.id, { winner: m.a.id, scoreA: need, scoreB: 0 });
        await svc.submitResult(env, tok(m.b.id), m.id, { winner: m.b.id, scoreA: 0, scoreB: need });
        const after = await svc.bracketView(env, div.id);
        if (after.matches.find((x) => x.id === m.id).status !== 'disputed') throw new Error('expected disputed');
        flags.dispute = true; continue;
      }

      // ADMIN DIRECT confirm (once): admin records the result without captain reports
      if (!flags.adminDirect && m.round === 1) {
        const r = await svc.adminConfirm(env, m.id, { winner, scoreA, scoreB, actorId: 'admin@staging' });
        if (!r.ok) throw new Error('admin confirm failed');
        flags.adminDirect = true; continue;
      }

      // DEFAULT: both captains agree -> auto-confirm + advance
      await svc.submitResult(env, tok(m.a.id), m.id, { winner, scoreA, scoreB });
      const res = await svc.submitResult(env, tok(m.b.id), m.id, { winner, scoreA, scoreB });
      if (res.status !== 'confirmed') throw new Error('captain agreement did not confirm: ' + res.status);

      // CORRECTION (once): immediately reopen+re-confirm this match with a corrected score line
      if (!flags.correction && m.round === 1) {
        const fixA = wA ? need : 0, fixB = wA ? 0 : need; // same winner, explicit corrected score
        const c = await svc.correctResult(env, m.id, { winner, scoreA: fixA, scoreB: fixB, actorId: 'admin@staging' });
        if (!c.ok) throw new Error('correction failed');
        flags.correction = true;
      }
    }
  }
  const finalView = await svc.bracketView(env, div.id);
  return { champion: finalView.champion, flags, view: finalView };
}

// Leave Apex mid-tournament: a realistic spread of completed / ready / pending / disputed / forfeit.
// Driven through the real service calls so advancement pointers and the audit trail stay consistent.
async function playApexPartial(div) {
  const DID = div.id;
  const mid = (r, s) => `${DID}:R${r}M${s}`;
  const tok = (tid) => token.get(tid);
  const view = () => svc.bracketView(env, div.id);
  async function agree(matchId) { // both captains agree -> confirm + advance
    const mm = (await view()).matches.find((x) => x.id === matchId);
    const winner = (mm.a.seed ?? 1) <= (mm.b.seed ?? 99) ? mm.a.id : mm.b.id; // higher seed, or slot-a when seeds already spent
    const wA = winner === mm.a.id, need = svc.winsNeeded(mm.bestOf);
    await svc.submitResult(env, tok(mm.a.id), matchId, { winner, scoreA: wA ? need : 0, scoreB: wA ? 0 : need });
    const r = await svc.submitResult(env, tok(mm.b.id), matchId, { winner, scoreA: wA ? need : 0, scoreB: wA ? 0 : need });
    if (r.status !== 'confirmed') throw new Error('agree did not confirm: ' + r.status);
  }
  // Round 1: four clean completions (winners advance)
  await agree(mid(1, 0)); // Crimson Wolves advance -> R2M0.a
  await agree(mid(1, 1)); // Ember Vipers advance  -> R2M0.b
  await agree(mid(1, 2)); // Azure Sentinels advance -> R2M1.a (will await its opponent)
  await agree(mid(1, 6)); // Radiant Phoenix advance -> R2M3.a (will await its opponent)
  // Round 1: one FORFEIT (Solar Golems no-show) -> Obsidian Drakes advance -> R2M2.a
  const r1m4 = (await view()).matches.find((x) => x.id === mid(1, 4));
  const loser = r1m4.a.id === noShow.id ? r1m4.a.id : r1m4.b.id;
  await svc.adminForfeit(env, mid(1, 4), { loserTeamId: loser, actorId: 'admin@staging' });
  // Round 1: one DISPUTED result left for the admin to resolve (both captains claim the win)
  const r1m3 = (await view()).matches.find((x) => x.id === mid(1, 3));
  await svc.submitResult(env, tok(r1m3.a.id), mid(1, 3), { winner: r1m3.a.id, scoreA: 1, scoreB: 0 });
  await svc.submitResult(env, tok(r1m3.b.id), mid(1, 3), { winner: r1m3.b.id, scoreA: 0, scoreB: 1 });
  // Round 1: R1M5 and R1M7 left untouched -> 'ready' (playable, not yet reported)
  // Round 2: complete the one R2 match whose feeders are both done -> deeper advancement
  await agree(mid(2, 0)); // Crimson Wolves advance -> R3M0.a (awaits opponent from the unresolved half)
}

// scope check: a non-participant captain cannot submit a result for someone else's match
const anApexMatch = (await svc.bracketView(env, apex.id)).matches.find((m) => m.status === 'ready');
const outsiderTeam = contCaps.length ? teamByCap.get(contCaps[0].id) : null;
await mustThrow('captain cannot report a match their team is not in', async () => {
  await svc.submitResult(env, token.get(outsiderTeam), anApexMatch.id, { winner: anApexMatch.a.id, scoreA: 1, scoreB: 0 });
}, 'not_a_participant');

// Contender always runs to completion.
const resCont = await playDivision(cont, {});
ok('Contender bracket produced a champion', !!resCont.champion, resCont.champion || 'none');
ok('Contender exercised dispute + admin-confirm + correction', resCont.flags.dispute && resCont.flags.adminDirect && resCont.flags.correction, JSON.stringify(resCont.flags));
{
  const v = await svc.bracketView(env, cont.id);
  const confirmed = v.matches.filter((m) => m.status === 'confirmed').length;
  const unresolved = v.matches.filter((m) => m.status !== 'confirmed' && m.status !== 'bye');
  ok('Contender: all 15 matches confirmed', confirmed === 15, `confirmed=${confirmed}`);
  ok('Contender: no unresolved matches', unresolved.length === 0, `unresolved=${unresolved.length}`);
}

if (APEX_MODE === 'partial') {
  console.log('\n[6b] Apex left MID-TOURNAMENT (partial)');
  await playApexPartial(apex);
  const va = await svc.bracketView(env, apex.id);
  const by = {};
  for (const m of va.matches) by[m.status] = (by[m.status] || 0) + 1;
  const mById = Object.fromEntries(va.matches.map((m) => [m.id, m]));
  const slotTeam = (m, slot) => (slot === 'a' ? m.a.id : m.b.id);
  let consistent = true;
  for (const m of va.matches) {
    if (m.status === 'confirmed' && m.nextId) { const n = mById[m.nextId]; if (n && slotTeam(n, m.nextSlot) !== m.winner) consistent = false; }
    if (m.status !== 'confirmed' && m.status !== 'bye' && m.winner) consistent = false; // no winner unless confirmed
  }
  const awaiting = va.matches.filter((m) => m.round >= 2 && ((m.a.id && !m.b.id) || (!m.a.id && m.b.id)));
  const ff = await DB.prepare(`SELECT count(*) n FROM audit_log WHERE tournament_id=? AND action='forfeit'`).bind(t.id).first();
  ok('Apex: has completed matches with advancing winners', (by.confirmed || 0) >= 5, JSON.stringify(by));
  ok('Apex: exactly one disputed match awaiting admin resolution', (by.disputed || 0) === 1, JSON.stringify(by));
  ok('Apex: has ready (playable, unreported) matches', (by.ready || 0) >= 1, JSON.stringify(by));
  ok('Apex: has pending matches (incl. teams awaiting opponents)', (by.pending || 0) >= 1, JSON.stringify(by));
  ok('Apex: at least one team awaiting its next opponent', awaiting.length >= 1, `awaiting=${awaiting.length}`);
  ok('Apex: a forfeit is recorded', ff.n >= 1, `forfeit_audits=${ff.n}`);
  ok('Apex: NOT complete — no champion yet', !va.champion, va.champion || 'none');
  ok('Apex: advancement pointers consistent (winners placed, no phantom winners)', consistent);
} else {
  const resApex = await playDivision(apex, { forfeitTeamId: noShow.id });
  ok('Apex bracket produced a champion', !!resApex.champion, resApex.champion || 'none');
  ok('Apex exercised dispute + forfeit + admin-confirm + correction', resApex.flags.dispute && resApex.flags.forfeit && resApex.flags.adminDirect && resApex.flags.correction, JSON.stringify(resApex.flags));
  const v = await svc.bracketView(env, apex.id);
  const confirmed = v.matches.filter((m) => m.status === 'confirmed').length;
  ok('Apex: all 15 matches confirmed', confirmed === 15, `confirmed=${confirmed}`);
}

// ======================================================================
console.log('\n[7] Public read model carries no PII');
const pub = JSON.stringify(await svc.bracketView(env, apex.id));
ok('public bracket view exposes no email/discord/raw_json', !/email|discord|raw_json|@example\.test/.test(pub));

// mark the event complete now that both brackets have champions
await svc.updateTournament(env, t.id, { status: 'live' }, { id: 'admin@staging' }); // keep visible as a browsable event
const auditCount = await DB.prepare(`SELECT count(*) n FROM audit_log WHERE tournament_id=?`).bind(t.id).first();
ok('audit trail recorded', auditCount.n > 50, `audit rows=${auditCount.n}`);

// ======================================================================
// Serialize final state → SQL for the remote staging D1.
console.log('\n[8] Serializing staging seed SQL');
const TABLES = ['tournaments', 'divisions', 'participants', 'teams', 'rosters', 'matches', 'result_submissions', 'import_batches', 'audit_log'];
const lit = (v) => v === null || v === undefined ? 'NULL' : (typeof v === 'number' || typeof v === 'bigint') ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const lines = ['PRAGMA foreign_keys=OFF;'];
// wipe prior test data (staging is test-only); child-first
for (const tbl of [...TABLES].reverse()) lines.push(`DELETE FROM ${tbl};`);
const deferred = []; // participants.team_id is a forward ref to teams — set it after teams exist
for (const tbl of TABLES) {
  const cols = (await DB.prepare(`PRAGMA table_info(${tbl})`).all().then((r) => r.results)).map((c) => c.name);
  let rows = await DB.prepare(`SELECT * FROM ${tbl}`).all().then((r) => r.results);
  if (tbl === 'matches') rows = rows.sort((a, b) => b.round - a.round); // self-FK: later rounds first
  for (const row of rows) {
    const out = { ...row };
    if (tbl === 'participants' && row.team_id != null) { deferred.push([row.id, row.team_id]); out.team_id = null; }
    lines.push(`INSERT INTO ${tbl} (${cols.join(',')}) VALUES (${cols.map((c) => lit(out[c])).join(',')});`);
  }
}
for (const [pid, tid] of deferred) lines.push(`UPDATE participants SET team_id=${lit(tid)} WHERE id=${lit(pid)};`);
const { writeFileSync } = await import('node:fs');
writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

const rowCounts = {};
for (const tbl of TABLES) rowCounts[tbl] = (await DB.prepare(`SELECT count(*) n FROM ${tbl}`).first()).n;

const passed = checks.filter((c) => c.pass).length, failed = checks.length - passed;
console.log('\n================ SUMMARY ================');
console.log(`checks: ${passed}/${checks.length} passed` + (failed ? `, ${failed} FAILED` : ''));
console.log('champions:', { Apex: (await svc.bracketView(env, apex.id)).champion || '(in progress — Apex is mid-tournament)', Contender: (await svc.bracketView(env, cont.id)).champion });
console.log('apex mode:', APEX_MODE);
console.log('row counts:', rowCounts);
console.log('seed sql:', OUT, `(${lines.length} statements)`);
console.log('tournament slug: staging-shakedown');
if (failed) { console.error('\n❌ ' + failed + ' CHECK(S) FAILED'); process.exit(1); }
console.log('\n✅ ALL CHECKS PASSED');
