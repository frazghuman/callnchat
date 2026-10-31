import type { Db, SqlValue } from '@/data/db';

// node:sqlite (Node 22+) runs the real SQL in tests; the app uses expo-sqlite + SQLCipher.
type Statement = {
  run(...params: SqlValue[]): unknown;
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
};
type SyncDatabase = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports -- app tsconfig has no Node types
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SyncDatabase;
};

export function createNodeSqliteDb(): Db {
  const db = new DatabaseSync(':memory:');
  return {
    exec: async (sql) => db.exec(sql),
    run: async (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    get: async <T>(sql: string, params: SqlValue[] = []) =>
      (db.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    transaction: async (task) => {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    destroy: async () => db.close(),
  };
}
