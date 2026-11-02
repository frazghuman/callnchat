import type { Db } from './db';

export type Profile = { displayName: string };

export type Peer = {
  publicKey: string;
  displayName: string;
  pairSecret: string;
  pairedAt: number;
  verifiedAt: number | null;
  /** When the peer proved it added our code too (valid hello). */
  confirmedAt: number | null;
};

type PeerRow = {
  public_key: string;
  display_name: string;
  pair_secret: string;
  paired_at: number;
  verified_at: number | null;
  confirmed_at: number | null;
};

export async function getProfile(db: Db): Promise<Profile | null> {
  const row = await db.get<{ display_name: string }>(
    'SELECT display_name FROM profile WHERE id = 1',
  );
  return row ? { displayName: row.display_name } : null;
}

export async function saveProfile(db: Db, profile: Profile): Promise<void> {
  await db.run(
    `INSERT INTO profile (id, display_name) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name`,
    [profile.displayName],
  );
}

export async function getPeer(db: Db): Promise<Peer | null> {
  const row = await db.get<PeerRow>('SELECT * FROM peer WHERE id = 1');
  if (!row) return null;
  return {
    publicKey: row.public_key,
    displayName: row.display_name,
    pairSecret: row.pair_secret,
    pairedAt: row.paired_at,
    verifiedAt: row.verified_at,
    confirmedAt: row.confirmed_at,
  };
}

/** Fails if a peer already exists: this app pairs with exactly one contact. */
export async function insertPeer(db: Db, peer: Peer): Promise<void> {
  await db.run(
    `INSERT INTO peer (id, public_key, display_name, pair_secret, paired_at, verified_at)
     VALUES (1, ?, ?, ?, ?, ?)`,
    [peer.publicKey, peer.displayName, peer.pairSecret, peer.pairedAt, peer.verifiedAt],
  );
}

export async function markPeerVerified(db: Db, at: number): Promise<void> {
  await db.run('UPDATE peer SET verified_at = ? WHERE id = 1', [at]);
}

export async function markPeerConfirmed(db: Db, at: number): Promise<void> {
  await db.run('UPDATE peer SET confirmed_at = ? WHERE id = 1 AND confirmed_at IS NULL', [at]);
}

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
