import type { Db } from './db';

// Append only. Index + 1 is the schema version stored in PRAGMA user_version.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    display_name TEXT NOT NULL
  );
  CREATE TABLE peer (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    pair_secret TEXT NOT NULL,
    paired_at INTEGER NOT NULL,
    verified_at INTEGER
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: Db): Promise<void> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(`Database schema ${current} is newer than this app (${SCHEMA_VERSION})`);
  }
  for (let version = current + 1; version <= SCHEMA_VERSION; version++) {
    await db.transaction(async () => {
      await db.exec(MIGRATIONS[version - 1]!);
      await db.exec(`PRAGMA user_version = ${version}`);
    });
  }
}
