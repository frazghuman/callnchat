import type { Db, SqlValue } from './db';

export type OutgoingStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type IncomingStatus = 'received' | 'read';

export type Message = {
  id: string;
  direction: 'in' | 'out';
  body: string;
  replyTo: string | null;
  /** Sender's clock, ms. */
  sentAt: number;
  receivedAt: number | null;
  status: OutgoingStatus | IncomingStatus;
};

type MessageRow = {
  id: string;
  direction: 'in' | 'out';
  body: string;
  reply_to: string | null;
  sent_at: number;
  received_at: number | null;
  status: Message['status'];
};

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  direction: r.direction,
  body: r.body,
  replyTo: r.reply_to,
  sentAt: r.sent_at,
  receivedAt: r.received_at,
  status: r.status,
});

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

// Outgoing status only moves forward; 'failed' can still be revived by a late receipt.
const BEFORE: Record<'sent' | 'delivered' | 'read', OutgoingStatus[]> = {
  sent: ['pending', 'failed'],
  delivered: ['pending', 'failed', 'sent'],
  read: ['pending', 'failed', 'sent', 'delivered'],
};

export async function getMessage(db: Db, id: string): Promise<Message | null> {
  const row = await db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', [id]);
  return row ? toMessage(row) : null;
}

export async function insertMessage(db: Db, m: Message): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO messages (id, direction, body, reply_to, sent_at, received_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [m.id, m.direction, m.body, m.replyTo, m.sentAt, m.receivedAt, m.status],
  );
}

/** Newest first, `limit` rows sent before `beforeSentAt` (for paging back through history). */
export async function listMessages(
  db: Db,
  limit: number,
  beforeSentAt?: number,
): Promise<Message[]> {
  const rows =
    beforeSentAt === undefined
      ? await db.all<MessageRow>('SELECT * FROM messages ORDER BY sent_at DESC, id DESC LIMIT ?', [
          limit,
        ])
      : await db.all<MessageRow>(
          'SELECT * FROM messages WHERE sent_at < ? ORDER BY sent_at DESC, id DESC LIMIT ?',
          [beforeSentAt, limit],
        );
  return rows.map(toMessage);
}

/** Advances outgoing messages to `status`; returns the ids that actually changed. */
export async function advanceOutgoing(
  db: Db,
  ids: string[],
  status: 'sent' | 'delivered' | 'read',
): Promise<string[]> {
  if (!ids.length) return [];
  const before = BEFORE[status];
  const where = `direction = 'out' AND id IN (${placeholders(ids.length)}) AND status IN (${placeholders(before.length)})`;
  const params: SqlValue[] = [...ids, ...before];
  const changed = await db.all<{ id: string }>(`SELECT id FROM messages WHERE ${where}`, params);
  if (changed.length) {
    await db.run(`UPDATE messages SET status = ?, next_attempt_at = NULL WHERE ${where}`, [
      status,
      ...params,
    ]);
  }
  return changed.map((r) => r.id);
}

/** Pending outgoing messages whose retry time has come, oldest first. */
export async function duePending(db: Db, now: number): Promise<Message[]> {
  const rows = await db.all<MessageRow>(
    `SELECT * FROM messages
     WHERE direction = 'out' AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY sent_at`,
    [now],
  );
  return rows.map(toMessage);
}

/** Counts a failed send and schedules the next try `delay(attempts)` ms after `now`. */
export async function scheduleRetry(
  db: Db,
  id: string,
  now: number,
  delay: (attempts: number) => number,
): Promise<void> {
  const row = await db.get<{ attempts: number }>('SELECT attempts FROM messages WHERE id = ?', [
    id,
  ]);
  const attempts = (row?.attempts ?? 0) + 1;
  await db.run('UPDATE messages SET attempts = ?, next_attempt_at = ? WHERE id = ?', [
    attempts,
    now + delay(attempts),
    id,
  ]);
}

export async function failStalePending(db: Db, olderThan: number): Promise<string[]> {
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM messages WHERE direction = 'out' AND status = 'pending' AND sent_at < ?`,
    [olderThan],
  );
  if (rows.length) {
    await db.run(
      `UPDATE messages SET status = 'failed' WHERE direction = 'out' AND status = 'pending' AND sent_at < ?`,
      [olderThan],
    );
  }
  return rows.map((r) => r.id);
}

export async function unreadIncomingIds(db: Db): Promise<string[]> {
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM messages WHERE direction = 'in' AND status = 'received' ORDER BY sent_at`,
  );
  return rows.map((r) => r.id);
}

export async function markIncomingRead(db: Db, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.run(
    `UPDATE messages SET status = 'read' WHERE direction = 'in' AND id IN (${placeholders(ids.length)})`,
    ids,
  );
}

/** Records a relay event id; returns false if it was already seen (same wrap from another relay). */
export async function markEventSeen(db: Db, eventId: string, at: number): Promise<boolean> {
  const row = await db.get('SELECT 1 FROM seen_events WHERE event_id = ?', [eventId]);
  if (row) return false;
  await db.run('INSERT INTO seen_events (event_id, seen_at) VALUES (?, ?)', [eventId, at]);
  return true;
}

export async function pruneSeenEvents(db: Db, olderThan: number): Promise<void> {
  await db.run('DELETE FROM seen_events WHERE seen_at < ?', [olderThan]);
}
