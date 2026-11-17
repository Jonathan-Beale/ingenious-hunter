// simulate.js — full-tournament simulation. Seeds a division of N teams (default 32), plays every
// match through to a single champion, and verifies the invariants. Run: `npm run simulate [N]`.
import { makeEnv } from './helpers/d1.js';
import * as svc from '../functions/tournaments/_lib/service.js';
import { winsNeeded } from '../functions/tournaments/_lib/results.js';

const N = Number(process.argv[2] || 32);
const env = makeEnv();

const t = await svc.createTournament(env, { slug: 'sim', name: 'Simulation Cup', capacity: N, status: 'live' });
const div = await svc.createDivision(env, t.id, { name: 'Open', best_of_default: 1, final_best_of: 3 });
for (let i = 1; i <= N; i++) {
  await svc.createTeam(env, t.id, { name: `Team ${i}`, division_id: div.id, seed_rank_ordinal: N - i });
}
const seed = await svc.seedDivision(env, div.id, { seedMethod: 'rank' });
console.log(`Seeded ${div.name}: ${seed.teams} teams → ${seed.matches} matches, ${seed.byes} byes.`);

let played = 0, round = 0;
for (;;) {
  const view = await svc.bracketView(env, div.id);
  const ready = view.matches.filter((m) => m.status === 'ready' && m.a.id && m.b.id);
  if (ready.length === 0) break;
  round++;
  for (const m of ready) {
    // higher seed wins 70% of the time
    const higher = m.a.seed <= m.b.seed ? m.a.id : m.b.id;
    const lower = higher === m.a.id ? m.b.id : m.a.id;
    const winner = Math.random() < 0.7 ? higher : lower;
    const need = winsNeeded(m.bestOf);
    const loserGames = m.bestOf > 1 ? Math.floor(Math.random() * need) : 0;
    const scoreA = winner === m.a.id ? need : loserGames;
    const scoreB = winner === m.b.id ? need : loserGames;
    const r = await svc.adminConfirm(env, m.id, { winner, scoreA, scoreB, actorId: 'sim' });
    if (r.ok) played++;
  }
  const remaining = (await svc.bracketView(env, div.id)).matches.filter((m) => m.status === 'ready').length;
  console.log(`  round ${round}: played ${ready.length}, ${remaining} ready next`);
  if (round > 30) { console.error('runaway'); process.exit(1); }
}

const final = await svc.bracketView(env, div.id);
console.log(`\nChampion: ${final.champion}`);
console.log(`Matches played: ${played} (expected ${N - 1})`);

let ok = true;
if (!final.champion) { console.error('FAIL: no champion'); ok = false; }
if (played !== N - 1) { console.error(`FAIL: expected ${N - 1} played, got ${played}`); ok = false; }
const unresolved = final.matches.filter((m) => m.status !== 'confirmed' && m.status !== 'bye');
if (unresolved.length) { console.error(`FAIL: ${unresolved.length} matches unresolved`); ok = false; }

console.log(ok ? '\n✅ SIMULATION OK — full bracket resolved to one champion.' : '\n❌ SIMULATION FAILED');
process.exit(ok ? 0 : 1);
