import type { Attachment, SharedLocation } from '@/core/protocol/frames';

import type { Db, SqlValue } from './db';

export type OutgoingStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type IncomingStatus = 'received' | 'read';

/** Direct-link file transfer progress: pending (not started) → active → done, or failed. */
export type TransferState = 'pending' | 'active' | 'done' | 'failed';

export type StoredLocation = SharedLocation & {
  /** Time of the position shown (sender's clock, ms). */
  updatedAt: number;
  /** Live sharing stopped early. */
  endedAt: number | null;
};

export type Message = {
  id: string;
  direction: 'in' | 'out';
  /** 'system' rows are local notices (e.g. disappearing timer changed); body is JSON. */
  kind: 'text' | 'system';
  body: string;
  replyTo: string | null;
  /** Sender's clock, ms. */
  sentAt: number;
  receivedAt: number | null;
  status: OutgoingStatus | IncomingStatus;
  editedAt: number | null;
  /** Deleted for everyone: kept as a tombstone ("This message was deleted"). */
  deletedAt: number | null;
  expiresAt: number | null;
  attachment: Attachment | null;
  transferState: TransferState | null;
  /** Bytes received (incoming) or confirmed by the peer (outgoing). */
  transferBytes: number;
  location: StoredLocation | null;
};

export type Reactions = { me: string | null; peer: string | null };

export type ReplyPreview = {
  id: string;
  direction: 'in' | 'out';
  body: string;
  deleted: boolean;
};

/** A message as the chat screen shows it. */
export type ChatMessage = Message & { reactions: Reactions; reply: ReplyPreview | null };

type MessageRow = {
  id: string;
  direction: 'in' | 'out';
  kind: 'text' | 'system';
  body: string;
  reply_to: string | null;
  sent_at: number;
  received_at: number | null;
  status: Message['status'];
  edited_at: number | null;
  deleted_at: number | null;
  expires_at: number | null;
  attachment: string | null;
  transfer_state: TransferState | null;
  transfer_bytes: number;
  location: string | null;
};

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  direction: r.direction,
  kind: r.kind,
  body: r.body,
  replyTo: r.reply_to,
  sentAt: r.sent_at,
  receivedAt: r.received_at,
  status: r.status,
  editedAt: r.edited_at,
  deletedAt: r.deleted_at,
  expiresAt: r.expires_at,
  attachment: parseJson<Attachment>(r.attachment),
  transferState: r.transfer_state,
  transferBytes: r.transfer_bytes,
  location: parseJson<StoredLocation>(r.location),
});

/** One-line description for quotes, previews and screen readers. */
export function previewText(m: {
  body: string;
  attachment: Attachment | null;
  location: StoredLocation | null;
}): string {
  if (m.body) return m.body;
  if (m.location) return m.location.liveUntil ? '📍 Live location' : '📍 Location';
  switch (m.attachment?.kind) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'audio':
      return '🎤 Voice message';
    case 'file':
      return `📄 ${m.attachment.name}`;
    default:
      return '';
  }
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Defaults for the optional parts of a new row. */
export function newMessage(
  m: Pick<Message, 'id' | 'direction' | 'body' | 'sentAt' | 'status'> & Partial<Message>,
): Message {
  return {
    kind: 'text',
    replyTo: null,
    receivedAt: null,
    editedAt: null,
    deletedAt: null,
    expiresAt: null,
    attachment: null,
    transferState: null,
    transferBytes: 0,
    location: null,
    ...m,
  };
}

// Outgoing status only moves forward; 'failed' can still be revived by a late receipt.
const BEFORE: Record<'sent' | 'delivered' | 'read', OutgoingStatus[]> = {
  sent: ['pending', 'failed'],
  delivered: ['pending', 'failed', 'sent'],
  read: ['pending', 'failed', 'sent', 'delivered'],
};

/** Visible messages only (not deleted-for-me or expired). */
export async function getMessage(db: Db, id: string): Promise<Message | null> {
  const row = await db.get<MessageRow>('SELECT * FROM messages WHERE id = ? AND hidden = 0', [id]);
  return row ? toMessage(row) : null;
}

/** True if any row (including hidden tombstones) exists for this id. */
async function exists(db: Db, id: string): Promise<boolean> {
  return (await db.get('SELECT 1 FROM messages WHERE id = ?', [id])) !== null;
}

/** Inserts unless the id already exists (duplicates, or a tombstone that must not be revived). */
export async function insertMessage(db: Db, m: Message): Promise<boolean> {
  if (await exists(db, m.id)) return false;
  await db.run(
    `INSERT INTO messages
       (id, direction, kind, body, reply_to, sent_at, received_at, status, edited_at, deleted_at,
        expires_at, attachment, transfer_state, transfer_bytes, location)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      m.id,
      m.direction,
      m.kind,
      m.body,
      m.replyTo,
      m.sentAt,
      m.receivedAt,
      m.status,
      m.editedAt,
      m.deletedAt,
      m.expiresAt,
      m.attachment ? JSON.stringify(m.attachment) : null,
      m.transferState,
      m.transferBytes,
      m.location ? JSON.stringify(m.location) : null,
    ],
  );
  return true;
}

/**
 * The original `msg` arrived after an edit already created the row: fill in what the edit
 * didn't carry (reply target, expiry). Never touches deleted rows.
 */
export async function completeIncoming(
  db: Db,
  id: string,
  replyTo: string | null,
  expiresAt: number | null,
): Promise<void> {
  await db.run(
    `UPDATE messages SET reply_to = COALESCE(reply_to, ?), expires_at = COALESCE(expires_at, ?)
     WHERE id = ? AND direction = 'in' AND deleted_at IS NULL`,
    [replyTo, expiresAt, id],
  );
}

export type Cursor = { sentAt: number; id: string };

/** Newest first; pass the oldest loaded message as `before` to page back through history. */
export async function listMessages(db: Db, limit: number, before?: Cursor): Promise<ChatMessage[]> {
  const rows = before
    ? await db.all<MessageRow>(
        `SELECT * FROM messages WHERE hidden = 0 AND (sent_at < ? OR (sent_at = ? AND id < ?))
         ORDER BY sent_at DESC, id DESC LIMIT ?`,
        [before.sentAt, before.sentAt, before.id, limit],
      )
    : await db.all<MessageRow>(
        'SELECT * FROM messages WHERE hidden = 0 ORDER BY sent_at DESC, id DESC LIMIT ?',
        [limit],
      );
  return decorate(db, rows.map(toMessage));
}

async function decorate(db: Db, messages: Message[]): Promise<ChatMessage[]> {
  if (!messages.length) return [];
  const ids = messages.map((m) => m.id);
  const reactions = await db.all<{ message_id: string; author: 'me' | 'peer'; emoji: string }>(
    `SELECT message_id, author, emoji FROM reactions
     WHERE emoji IS NOT NULL AND message_id IN (${placeholders(ids.length)})`,
    ids,
  );
  const replyIds = [...new Set(messages.map((m) => m.replyTo).filter((id): id is string => !!id))];
  const replies = replyIds.length
    ? await db.all<{
        id: string;
        direction: 'in' | 'out';
        body: string;
        deleted_at: number | null;
        hidden: number;
        attachment: string | null;
        location: string | null;
      }>(
        `SELECT id, direction, body, deleted_at, hidden, attachment, location FROM messages
         WHERE id IN (${placeholders(replyIds.length)})`,
        replyIds,
      )
    : [];
  const replyById = new Map(replies.map((r) => [r.id, r]));

  return messages.map((m) => {
    const r: Reactions = { me: null, peer: null };
    // A reaction can arrive after the message was deleted for everyone; never show it then.
    if (!m.deletedAt) for (const x of reactions) if (x.message_id === m.id) r[x.author] = x.emoji;
    const target = m.replyTo ? replyById.get(m.replyTo) : undefined;
    return {
      ...m,
      reactions: r,
      reply: target
        ? {
            id: target.id,
            direction: target.direction,
            body:
              target.hidden || target.deleted_at
                ? ''
                : previewText({
                    body: target.body,
                    attachment: parseJson<Attachment>(target.attachment),
                    location: parseJson<StoredLocation>(target.location),
                  }),
            deleted: !!(target.hidden || target.deleted_at),
          }
        : null,
    };
  });
}

/** Case-insensitive (ASCII) substring search over visible text messages, newest first. */
export async function searchMessages(db: Db, query: string, limit = 100): Promise<ChatMessage[]> {
  const q = query.trim();
  if (!q) return [];
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.all<MessageRow>(
    `SELECT * FROM messages
     WHERE hidden = 0 AND deleted_at IS NULL AND kind = 'text' AND body LIKE ? ESCAPE '\\'
     ORDER BY sent_at DESC, id DESC LIMIT ?`,
    [pattern, limit],
  );
  return decorate(db, rows.map(toMessage));
}

/** Edits a message's text if `editedAt` is newer than the last applied edit (last writer wins). */
export async function applyEdit(
  db: Db,
  id: string,
  direction: 'in' | 'out',
  text: string,
  editedAt: number,
): Promise<boolean> {
  const row = await db.get<{ edited_at: number | null }>(
    `SELECT edited_at FROM messages
     WHERE id = ? AND direction = ? AND kind = 'text' AND deleted_at IS NULL AND hidden = 0`,
    [id, direction],
  );
  if (!row || (row.edited_at !== null && row.edited_at >= editedAt)) return false;
  await db.run('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', [text, editedAt, id]);
  return true;
}

/** Deleted for everyone: text is erased, the bubble stays as "This message was deleted". */
export async function markDeleted(db: Db, ids: string[], direction: 'in' | 'out', at: number) {
  if (!ids.length) return;
  await db.run(
    `UPDATE messages SET body = '', deleted_at = ?, expires_at = NULL, attachment = NULL,
       transfer_state = NULL, location = NULL
     WHERE direction = ? AND deleted_at IS NULL AND id IN (${placeholders(ids.length)})`,
    [at, direction, ...ids],
  );
  await db.run(`DELETE FROM reactions WHERE message_id IN (${placeholders(ids.length)})`, ids);
}

/**
 * Hides messages on this phone only. The row stays as a contentless tombstone so a late
 * duplicate from a relay can't bring it back.
 */
export async function hideMessages(db: Db, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.run(
    `UPDATE messages SET hidden = 1, body = '', attachment = NULL, transfer_state = NULL,
       location = NULL
     WHERE id IN (${placeholders(ids.length)})`,
    ids,
  );
  await db.run(`DELETE FROM reactions WHERE message_id IN (${placeholders(ids.length)})`, ids);
}

/** Hides every message whose disappearing timer ran out; returns their ids. */
export async function purgeExpired(db: Db, now: number): Promise<string[]> {
  const rows = await db.all<{ id: string }>(
    'SELECT id FROM messages WHERE hidden = 0 AND expires_at IS NOT NULL AND expires_at <= ?',
    [now],
  );
  const ids = rows.map((r) => r.id);
  await hideMessages(db, ids);
  return ids;
}

/** Tombstones older than relay retention can't be resurrected any more. */
export async function pruneTombstones(db: Db, olderThan: number): Promise<void> {
  await db.run('DELETE FROM messages WHERE hidden = 1 AND sent_at < ?', [olderThan]);
}

/** Sets (or with null, removes) one person's reaction; last writer wins by `at`. */
export async function setReaction(
  db: Db,
  messageId: string,
  author: 'me' | 'peer',
  emoji: string | null,
  at: number,
): Promise<boolean> {
  const row = await db.get<{ updated_at: number }>(
    'SELECT updated_at FROM reactions WHERE message_id = ? AND author = ?',
    [messageId, author],
  );
  if (row && row.updated_at >= at) return false;
  await db.run(
    `INSERT INTO reactions (message_id, author, emoji, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(message_id, author) DO UPDATE SET emoji = excluded.emoji, updated_at = excluded.updated_at`,
    [messageId, author, emoji, at],
  );
  return true;
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

/** Pending outgoing messages whose retry time has come, oldest first. Deleted ones are never sent. */
export async function duePending(db: Db, now: number): Promise<Message[]> {
  const rows = await db.all<MessageRow>(
    `SELECT * FROM messages
     WHERE direction = 'out' AND kind = 'text' AND status = 'pending' AND deleted_at IS NULL
       AND hidden = 0 AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
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
    `SELECT id FROM messages
     WHERE direction = 'in' AND kind = 'text' AND status = 'received' AND hidden = 0
     ORDER BY sent_at`,
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

// --- control-frame outbox (reactions, edits, deletes, timer) ------------------------------------

export type OutboxItem = { id: string; frame: string; createdAt: number };

export async function enqueueOutbox(db: Db, id: string, frame: string, at: number) {
  await db.run('INSERT INTO outbox (id, frame, created_at) VALUES (?, ?, ?)', [id, frame, at]);
}

export async function dueOutbox(db: Db, now: number): Promise<OutboxItem[]> {
  const rows = await db.all<{ id: string; frame: string; created_at: number }>(
    `SELECT id, frame, created_at FROM outbox
     WHERE next_attempt_at IS NULL OR next_attempt_at <= ? ORDER BY created_at, id`,
    [now],
  );
  return rows.map((r) => ({ id: r.id, frame: r.frame, createdAt: r.created_at }));
}

export async function removeOutbox(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM outbox WHERE id = ?', [id]);
}

export async function retryOutbox(
  db: Db,
  id: string,
  now: number,
  delay: (attempts: number) => number,
): Promise<void> {
  const row = await db.get<{ attempts: number }>('SELECT attempts FROM outbox WHERE id = ?', [id]);
  const attempts = (row?.attempts ?? 0) + 1;
  await db.run('UPDATE outbox SET attempts = ?, next_attempt_at = ? WHERE id = ?', [
    attempts,
    now + delay(attempts),
    id,
  ]);
}

export async function dropStaleOutbox(db: Db, olderThan: number): Promise<void> {
  await db.run('DELETE FROM outbox WHERE created_at < ?', [olderThan]);
}

// --- file transfers ------------------------------------------------------------------------------

export async function setTransfer(
  db: Db,
  id: string,
  state: TransferState,
  bytes: number,
): Promise<void> {
  await db.run(
    'UPDATE messages SET transfer_state = ?, transfer_bytes = ? WHERE id = ? AND attachment IS NOT NULL',
    [state, bytes, id],
  );
}

/** Visible file messages whose transfer isn't finished, oldest first. */
export async function unfinishedTransfers(db: Db, direction: 'in' | 'out'): Promise<Message[]> {
  const rows = await db.all<MessageRow>(
    `SELECT * FROM messages
     WHERE direction = ? AND attachment IS NOT NULL AND hidden = 0 AND deleted_at IS NULL
       AND transfer_state IN ('pending', 'active')
     ORDER BY sent_at`,
    [direction],
  );
  return rows.map(toMessage);
}

// --- live location -------------------------------------------------------------------------------

/** Applies a live position if sharing is still on and the position is newer than the stored one. */
export async function updateLiveLocation(
  db: Db,
  id: string,
  position: Pick<SharedLocation, 'lat' | 'lng' | 'acc'>,
  at: number,
): Promise<boolean> {
  const message = await getMessage(db, id);
  const current = message?.location;
  if (!current?.liveUntil || current.endedAt || at > current.liveUntil || at <= current.updatedAt) {
    return false;
  }
  const next: StoredLocation = { ...current, ...position, updatedAt: at };
  await db.run('UPDATE messages SET location = ? WHERE id = ?', [JSON.stringify(next), id]);
  return true;
}

export async function endLiveLocation(db: Db, id: string, at: number): Promise<boolean> {
  const message = await getMessage(db, id);
  const current = message?.location;
  if (!current?.liveUntil || current.endedAt) return false;
  const next: StoredLocation = { ...current, endedAt: at };
  await db.run('UPDATE messages SET location = ? WHERE id = ?', [JSON.stringify(next), id]);
  return true;
}
