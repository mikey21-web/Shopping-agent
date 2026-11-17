/**
 * SQLite access layer built on Node's built-in `node:sqlite`.
 *
 * `node:sqlite` ships with Node 22.5+, so SahiPick needs no native database
 * driver — a decisive advantage on Termux/aarch64 where compiling
 * better-sqlite3 is slow and frequently breaks.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.ts';

const here = dirname(fileURLToPath(import.meta.url));

export type Row = Record<string, unknown>;

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  if (config.databasePath !== ':memory:') {
    mkdirSync(dirname(config.databasePath), { recursive: true });
  }
  db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function applySchema(): void {
  const sql = readFileSync(resolve(here, 'schema.sql'), 'utf8');
  getDb().exec(sql);
}

/** Run a SELECT returning typed rows. */
export function select<T = Row>(sql: string, ...params: unknown[]): T[] {
  return getDb()
    .prepare(sql)
    .all(...(params as never[])) as T[];
}

export function selectOne<T = Row>(sql: string, ...params: unknown[]): T | null {
  const rows = select<T>(sql, ...params);
  return rows.length > 0 ? (rows[0] ?? null) : null;
}

/** Run an INSERT/UPDATE/DELETE. */
export function run(sql: string, ...params: unknown[]): void {
  getDb()
    .prepare(sql)
    .run(...(params as never[]));
}

/** Execute `fn` inside a transaction, rolling back on error. */
export function transaction<T>(fn: () => T): T {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* rollback of an already-closed transaction is not an error we can act on */
    }
    throw error;
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
