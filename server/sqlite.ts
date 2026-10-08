import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** What a prepared statement hands back: SQLite's own scalar types, keyed by column name. */
export type Row = Record<string, unknown>;

/** Opens a SQLite file with the pragmas both workflow stores want, creating its directory first. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // WAL lets the dashboard read while a workflow writes; NORMAL trades one fsync per commit for speed.
  for (const pragma of ['journal_mode = WAL', 'synchronous = NORMAL', 'foreign_keys = ON', 'busy_timeout = 5000']) {
    db.exec(`PRAGMA ${pragma}`);
  }
  return db;
}

/**
 * `node:sqlite` has no `db.transaction()` wrapper (better-sqlite3 did), so this is the
 * stand-in: runs `body` between BEGIN and COMMIT, rolling back if it throws.
 */
export function transaction<A extends unknown[], R>(db: DatabaseSync, body: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => {
    db.exec('BEGIN');
    try {
      const result = body(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

/** `run()` reports `changes` as number|bigint depending on the value; callers only ever want a count. */
export const changed = (result: { changes: number | bigint }): number => Number(result.changes);

/** Column names of an existing table, for the add-missing-columns migrations below. */
export function columnsOf(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
  return new Set(rows.map((column) => String(column.name)));
}
