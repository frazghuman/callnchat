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
  `
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    body TEXT NOT NULL,
    reply_to TEXT,
    sent_at INTEGER NOT NULL,
    received_at INTEGER,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER
  );
  CREATE INDEX messages_sent_at ON messages (sent_at);
  CREATE INDEX messages_status ON messages (status);
  CREATE TABLE seen_events (
    event_id TEXT PRIMARY KEY,
    seen_at INTEGER NOT NULL
  );
  ALTER TABLE peer ADD COLUMN confirmed_at INTEGER;
  `,
  `
  ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
  ALTER TABLE messages ADD COLUMN edited_at INTEGER;
  ALTER TABLE messages ADD COLUMN deleted_at INTEGER;
  ALTER TABLE messages ADD COLUMN expires_at INTEGER;
  ALTER TABLE messages ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX messages_expires_at ON messages (expires_at) WHERE expires_at IS NOT NULL;
  CREATE TABLE reactions (
    message_id TEXT NOT NULL,
    author TEXT NOT NULL CHECK (author IN ('me', 'peer')),
    emoji TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, author)
  );
  CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    frame TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER
  );
  `,
  `
  ALTER TABLE messages ADD COLUMN attachment TEXT;
  ALTER TABLE messages ADD COLUMN transfer_state TEXT;
  ALTER TABLE messages ADD COLUMN transfer_bytes INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE messages ADD COLUMN location TEXT;
  CREATE INDEX messages_transfer ON messages (transfer_state) WHERE transfer_state IS NOT NULL;
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
