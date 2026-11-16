// d1.js (test helper) — a node:sqlite-backed stand-in for the Cloudflare D1 prepared-statement
// interface (prepare/bind/first/all/run/batch). Lets the integration tests run the REAL service
// code against the REAL migration SQL, in-memory, with zero external deps.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION = fileURLToPath(new URL('../../migrations/0001_init.sql', import.meta.url));

export function makeEnv(extra = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(MIGRATION, 'utf8'));
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async first() { const row = db.prepare(sql).get(...args); return row ?? null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { const i = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(i.changes), last_row_id: Number(i.lastInsertRowid) } }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
  return { DB, TOURNEY_TOKEN_SECRET: 'test-tourney-secret', _db: db, ...extra };
}
