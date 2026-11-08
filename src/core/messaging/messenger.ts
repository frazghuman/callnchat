import { KIND_EPHEMERAL_WRAP, KIND_WRAP, openEnvelope, sealFrame } from '@/core/nostr/envelope';
import type { NostrEvent } from '@/core/nostr/envelope';
import type { RelayTransport } from '@/core/nostr/relayPool';
import {
  DELETE_FOR_EVERYONE_WINDOW_MS,
  DISAPPEAR_OPTIONS,
  EDIT_WINDOW_MS,
  MAX_TEXT_LENGTH,
  parseFrame,
  type Attachment,
  type DisappearSeconds,
  type Frame,
  type MsgFrame,
  type SharedLocation,
} from '@/core/protocol/frames';
import { newMessageId } from '@/core/protocol/ids';
import {
  TransferManager,
  type LinkStatus,
  type TransferConfig,
} from '@/core/transfer/transferManager';
import type { Db } from '@/data/db';
import {
  advanceOutgoing,
  applyEdit,
  completeIncoming,
  dropStaleOutbox,
  duePending,
  dueOutbox,
  endLiveLocation,
  enqueueOutbox,
  failStalePending,
  getMessage,
  hideMessages,
  insertMessage,
  markDeleted,
  markEventSeen,
  markIncomingRead,
  newMessage,
  pruneSeenEvents,
  pruneTombstones,
  purgeExpired,
  removeOutbox,
  retryOutbox,
  scheduleRetry,
  setReaction,
  unreadIncomingIds,
  updateLiveLocation,
  type Message,
} from '@/data/messages';
import { getSetting, markPeerConfirmed, setSetting } from '@/data/repositories';

import { helloProof, verifyHelloProof } from './helloProof';
import {
  HEARTBEAT_MS,
  PresenceTracker,
  TYPING_SEND_INTERVAL_MS,
  type PeerPresence,
} from './presence';

const DAY_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 2 * DAY_MS;
const FAIL_AFTER_MS = DAY_MS;
const SEEN_EVENTS_TTL_MS = 35 * DAY_MS;
const OUTBOX_TTL_MS = 7 * DAY_MS;
/** Allow some clock skew before rejecting a peer's late edit. */
const EDIT_SKEW_MS = 5 * 60 * 1000;
const SETTING_LAST_SYNC = 'lastSync';
const SETTING_PEER_LAST_SEEN = 'peerLastSeen';
const SETTING_DISAPPEAR = 'disappear';

/** 4 s, 8 s, 16 s … capped at 60 s. */
const retryDelay = (attempts: number) => Math.min(60_000, 2_000 * 2 ** Math.min(attempts, 5));

export type DisappearSetting = { seconds: DisappearSeconds; at: number };

/** Body of a system row recording a timer change. */
export type TimerNotice = { type: 'timer'; seconds: DisappearSeconds; by: 'me' | 'peer' };

export type MessengerConfig = {
  transport: RelayTransport;
  db: Db;
  secretKey: Uint8Array;
  publicKeyHex: string;
  profileName: string;
  peer: { publicKeyHex: string; pairSecretHex: string; confirmed: boolean };
  now?: () => number;
  heartbeatMs?: number;
  /** Outbox retry / housekeeping tick. */
  tickMs?: number;
  receiptDebounceMs?: number;
  /** Direct-link file transfers; without it attachments are only announced, never moved. */
  transfer?: TransferConfig;
};

export type MessengerListener = {
  messagesChanged?: () => void;
  presenceChanged?: (presence: PeerPresence) => void;
  connectionChanged?: (connectedRelays: number) => void;
  peerConfirmed?: (at: number) => void;
  disappearChanged?: (seconds: DisappearSeconds) => void;
  /** Bytes moved so far for an attachment (live; persisted coarsely). */
  transferProgress?: (id: string, bytes: number) => void;
  linkStatus?: (status: LinkStatus) => void;
};

export class MessageTooLongError extends Error {
  constructor() {
    super(`Message longer than ${MAX_TEXT_LENGTH} characters`);
  }
}

export class MessageActionError extends Error {
  constructor(readonly reason: 'not-found' | 'not-own' | 'too-late' | 'deleted') {
    super(`Cannot change message: ${reason}`);
    this.name = 'MessageActionError';
  }
}

/**
 * Talks to the paired peer over Nostr relays: outbox with retries, inbox with dedupe,
 * delivery/read receipts, hello confirmation, presence, typing, reactions, edits, deletes and
 * disappearing messages.
 *
 * Relays replay stored wraps in (randomized) timestamp order, so every frame handler is written to
 * give the same result whatever order frames arrive in.
 */
export class Messenger {
  private readonly now: () => number;
  private readonly heartbeatMs: number;
  private readonly tickMs: number;
  private readonly receiptDebounceMs: number;
  private presence: PresenceTracker = new PresenceTracker(null);
  private lastPresenceKey = '';
  private confirmed: boolean;
  private running = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private inbox: Promise<void> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  private lastTypingSent = 0;
  private pendingReceipts = { delivered: new Set<string>(), read: new Set<string>() };
  private receiptTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSync: number | null = null;
  private disappear: DisappearSetting = { seconds: 0, at: 0 };
  private transfers: TransferManager | null = null;

  constructor(
    private readonly config: MessengerConfig,
    private readonly listener: MessengerListener = {},
  ) {
    this.now = config.now ?? Date.now;
    this.heartbeatMs = config.heartbeatMs ?? HEARTBEAT_MS;
    this.tickMs = config.tickMs ?? 30_000;
    this.receiptDebounceMs = config.receiptDebounceMs ?? 300;
    this.confirmed = config.peer.confirmed;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const { db } = this.config;

    const lastSync = await getSetting(db, SETTING_LAST_SYNC);
    this.lastSync = lastSync ? Number(lastSync) : null;
    const lastSeen = await getSetting(db, SETTING_PEER_LAST_SEEN);
    this.presence = new PresenceTracker(lastSeen ? Number(lastSeen) : null);
    this.disappear = await loadDisappear(db);
    this.listener.disappearChanged?.(this.disappear.seconds);
    this.emitPresence();
    // Before purging, so files of messages that expired while the app was closed are deleted too.
    this.transfers = this.createTransfers();
    await this.purge();

    this.config.transport.start({
      filter: () => ({
        kinds: [KIND_WRAP, KIND_EPHEMERAL_WRAP],
        '#p': [this.config.publicKeyHex],
        // Wraps are backdated up to two days; on first run fetch everything addressed to us.
        ...(this.lastSync === null
          ? {}
          : { since: Math.floor((this.lastSync - TWO_DAYS_MS) / 1000) - 60 }),
      }),
      onEvent: (event) => this.enqueue(event),
      onSynced: () => void this.synced(),
      onConnectionChange: (n) => {
        this.listener.connectionChanged?.(n);
        if (n > 0) void this.flush();
      },
    });

    void this.sendEphemeral({ t: 'presence', state: 'online' });
    if (!this.confirmed) void this.sendHello();
    void this.flush();
    void this.transfers?.wake();

    this.timers.push(
      setInterval(
        () => void this.sendEphemeral({ t: 'presence', state: 'online' }),
        this.heartbeatMs,
      ),
      setInterval(() => void this.tick(), this.tickMs),
    );
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    // Close the direct link first, while we can still send the peer its "bye".
    this.transfers?.stop();
    this.transfers = null;
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
    await this.flushReceipts();
    // Best effort: tell the peer right away instead of letting the heartbeat time out.
    await this.publish({ t: 'presence', state: 'offline' }).catch(() => undefined);
    await this.inbox;
    await this.flushing;
    this.config.transport.stop();
    await this.persistLastSeen();
  }

  // --- user actions -----------------------------------------------------------------------------

  /** Stores the message as pending and sends it; delivery continues via the outbox if offline. */
  async send(text: string, replyTo?: string): Promise<Message> {
    const body = text.trim();
    if (!body) throw new Error('Empty message');
    if (body.length > MAX_TEXT_LENGTH) throw new MessageTooLongError();
    const now = this.now();
    const ttl = this.disappear.seconds;
    const message = newMessage({
      id: newMessageId(now),
      direction: 'out',
      body,
      replyTo: replyTo ?? null,
      sentAt: now,
      status: 'pending',
      expiresAt: ttl ? now + ttl * 1000 : null,
    });
    await insertMessage(this.config.db, message);
    this.listener.messagesChanged?.();
    void this.flush();
    return message;
  }

  /**
   * Announces a file already placed in the transfer store under `id`; the bytes follow over the
   * direct link once both phones are online.
   */
  async sendFile(
    id: string,
    attachment: Attachment,
    caption = '',
    replyTo?: string,
  ): Promise<Message> {
    const body = caption.trim();
    if (body.length > MAX_TEXT_LENGTH) throw new MessageTooLongError();
    const now = this.now();
    const ttl = this.disappear.seconds;
    const message = newMessage({
      id,
      direction: 'out',
      body,
      replyTo: replyTo ?? null,
      sentAt: now,
      status: 'pending',
      expiresAt: ttl ? now + ttl * 1000 : null,
      attachment,
      transferState: 'pending',
    });
    await insertMessage(this.config.db, message);
    this.listener.messagesChanged?.();
    void this.flush();
    void this.transfers?.wake();
    return message;
  }

  /** A location pin, or live location when `liveUntil` is set. Small enough for relays. */
  async sendLocation(location: SharedLocation, replyTo?: string): Promise<Message> {
    const now = this.now();
    const ttl = this.disappear.seconds;
    const message = newMessage({
      id: newMessageId(now),
      direction: 'out',
      body: '',
      replyTo: replyTo ?? null,
      sentAt: now,
      status: 'pending',
      expiresAt: ttl ? now + ttl * 1000 : null,
      location: { ...location, updatedAt: now, endedAt: null },
    });
    await insertMessage(this.config.db, message);
    this.listener.messagesChanged?.();
    void this.flush();
    return message;
  }

  /** New position for our own live location; dropped once sharing has ended. */
  async updateLiveLocation(id: string, position: Pick<SharedLocation, 'lat' | 'lng' | 'acc'>) {
    const message = await this.requireOwn(id);
    const at = this.now();
    if (!(await updateLiveLocation(this.config.db, message.id, position, at))) return false;
    this.listener.messagesChanged?.();
    void this.sendEphemeral({ t: 'locLive', id, ...position, at });
    return true;
  }

  async stopLiveLocation(id: string): Promise<void> {
    await this.requireOwn(id);
    const at = this.now();
    if (!(await endLiveLocation(this.config.db, id, at))) return;
    this.listener.messagesChanged?.();
    await this.queueControl({ t: 'locEnd', id, at });
  }

  /** Marks everything received as read and tells the peer. */
  async markRead(): Promise<void> {
    const ids = await unreadIncomingIds(this.config.db);
    if (!ids.length) return;
    await markIncomingRead(this.config.db, ids);
    this.listener.messagesChanged?.();
    for (const id of ids) this.pendingReceipts.read.add(id);
    await this.flushReceipts();
  }

  /** Call on every keystroke; throttled to one typing frame per interval. */
  typing(): void {
    const now = this.now();
    if (now - this.lastTypingSent < TYPING_SEND_INTERVAL_MS) return;
    this.lastTypingSent = now;
    void this.sendEphemeral({ t: 'typing' });
  }

  /** Sets our reaction (or removes it with null). */
  async react(id: string, emoji: string | null): Promise<void> {
    const message = await this.requireMessage(id);
    if (message.kind !== 'text') throw new MessageActionError('not-found');
    const at = this.now();
    await setReaction(this.config.db, id, 'me', emoji, at);
    this.listener.messagesChanged?.();
    await this.queueControl({ t: 'react', id, emoji, at });
  }

  async edit(id: string, text: string): Promise<void> {
    const body = text.trim();
    if (!body) throw new Error('Empty message');
    if (body.length > MAX_TEXT_LENGTH) throw new MessageTooLongError();
    const message = await this.requireOwn(id);
    const at = this.now();
    if (at - message.sentAt > EDIT_WINDOW_MS) throw new MessageActionError('too-late');
    await applyEdit(this.config.db, id, 'out', body, at);
    this.listener.messagesChanged?.();
    await this.queueControl({ t: 'edit', id, text: body, sentAt: message.sentAt, editedAt: at });
  }

  async deleteForEveryone(ids: string[]): Promise<void> {
    const messages = await Promise.all(ids.map((id) => this.requireOwn(id)));
    const at = this.now();
    if (messages.some((m) => at - m.sentAt > DELETE_FOR_EVERYONE_WINDOW_MS)) {
      throw new MessageActionError('too-late');
    }
    await markDeleted(this.config.db, ids, 'out', at);
    await this.transfers?.removeFiles(ids);
    this.listener.messagesChanged?.();
    await this.queueControl({
      t: 'delete',
      items: messages.map((m) => ({ id: m.id, sentAt: m.sentAt })),
    });
  }

  /** Removes messages from this phone only. */
  async deleteForMe(ids: string[]): Promise<void> {
    await hideMessages(this.config.db, ids);
    await this.transfers?.removeFiles(ids);
    this.listener.messagesChanged?.();
  }

  async setDisappearing(seconds: DisappearSeconds): Promise<void> {
    if (!DISAPPEAR_OPTIONS.includes(seconds)) throw new Error('Unsupported timer');
    const at = this.now();
    await this.applyTimer({ seconds, at }, 'me');
    await this.queueControl({ t: 'timer', seconds, at });
  }

  get disappearSeconds(): DisappearSeconds {
    return this.disappear.seconds;
  }

  currentPresence(): PeerPresence {
    return this.presence.current(this.now());
  }

  private async requireMessage(id: string): Promise<Message> {
    const message = await getMessage(this.config.db, id);
    if (!message) throw new MessageActionError('not-found');
    if (message.deletedAt) throw new MessageActionError('deleted');
    return message;
  }

  private async requireOwn(id: string): Promise<Message> {
    const message = await this.requireMessage(id);
    if (message.direction !== 'out' || message.kind !== 'text') {
      throw new MessageActionError('not-own');
    }
    return message;
  }

  // --- outgoing -------------------------------------------------------------------------------

  private async publish(frame: Frame) {
    const { secretKey, peer, transport } = this.config;
    return transport.publish(sealFrame(frame, secretKey, peer.publicKeyHex, this.now()));
  }

  private async sendEphemeral(frame: Frame) {
    if (!this.running) return;
    await this.publish(frame).catch(() => undefined);
  }

  private async sendHello() {
    const { peer, publicKeyHex, profileName } = this.config;
    await this.publish({
      t: 'hello',
      proof: helloProof(peer.pairSecretHex, publicKeyHex),
      name: profileName.slice(0, 40),
    }).catch(() => undefined);
  }

  /** Durable control frames go through the outbox so they survive being offline. */
  private async queueControl(frame: Frame) {
    const at = this.now();
    await enqueueOutbox(this.config.db, newMessageId(at), JSON.stringify(frame), at);
    void this.flush();
  }

  /** Sends due pending messages and control frames, one flush at a time. */
  private flush(): Promise<void> {
    if (!this.running) return Promise.resolve();
    this.flushing ??= this.flushAll().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushAll() {
    const { db } = this.config;
    for (const message of await duePending(db, this.now())) {
      if (!this.running) return;
      const ttl =
        message.expiresAt !== null ? Math.round((message.expiresAt - message.sentAt) / 1000) : 0;
      const frame: MsgFrame = {
        t: 'msg',
        id: message.id,
        text: message.body,
        sentAt: message.sentAt,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(ttl > 0 ? { ttl } : {}),
        ...(message.attachment ? { file: message.attachment } : {}),
        ...(message.location
          ? {
              loc: {
                lat: message.location.lat,
                lng: message.location.lng,
                ...(message.location.acc !== undefined ? { acc: message.location.acc } : {}),
                ...(message.location.liveUntil ? { liveUntil: message.location.liveUntil } : {}),
              },
            }
          : {}),
      };
      const result = await this.publish(frame).catch(() => ({ ok: 0, failed: 1 }));
      if (result.ok > 0) {
        if ((await advanceOutgoing(db, [message.id], 'sent')).length) {
          this.listener.messagesChanged?.();
        }
      } else {
        await scheduleRetry(db, message.id, this.now(), retryDelay);
      }
    }

    // Control frames after messages, so an edit or reaction never overtakes its message.
    for (const item of await dueOutbox(db, this.now())) {
      if (!this.running) return;
      const frame = parseFrame(JSON.parse(item.frame));
      if (!frame) {
        await removeOutbox(db, item.id);
        continue;
      }
      const result = await this.publish(frame).catch(() => ({ ok: 0, failed: 1 }));
      if (result.ok > 0) await removeOutbox(db, item.id);
      else await retryOutbox(db, item.id, this.now(), retryDelay);
    }
  }

  private scheduleReceipts() {
    if (this.receiptTimer) return;
    this.receiptTimer = setTimeout(() => {
      this.receiptTimer = null;
      void this.flushReceipts();
    }, this.receiptDebounceMs);
  }

  private async flushReceipts() {
    if (this.receiptTimer) clearTimeout(this.receiptTimer);
    this.receiptTimer = null;
    for (const state of ['delivered', 'read'] as const) {
      const set = this.pendingReceipts[state];
      while (set.size) {
        const ids = [...set].slice(0, 500);
        const result = await this.publish({ t: 'receipt', ids, state }).catch(() => ({ ok: 0 }));
        if (result.ok === 0) return; // keep them; retried on the next tick
        for (const id of ids) set.delete(id);
      }
    }
  }

  private async tick() {
    const { db } = this.config;
    const now = this.now();
    const failed = await failStalePending(db, now - FAIL_AFTER_MS);
    if (failed.length) this.listener.messagesChanged?.();
    await this.purge();
    await pruneSeenEvents(db, now - SEEN_EVENTS_TTL_MS);
    await pruneTombstones(db, now - SEEN_EVENTS_TTL_MS);
    await dropStaleOutbox(db, now - OUTBOX_TTL_MS);
    if (!this.confirmed) void this.sendHello();
    await this.flushReceipts();
    await this.flush();
    void this.transfers?.wake();
  }

  /** Hides expired messages and deletes their files. */
  private async purge() {
    const ids = await purgeExpired(this.config.db, this.now());
    if (!ids.length) return;
    await this.transfers?.removeFiles(ids);
    this.listener.messagesChanged?.();
  }

  private createTransfers(): TransferManager | null {
    const { transfer, publicKeyHex, peer, db } = this.config;
    if (!transfer) return null;
    return new TransferManager(transfer, {
      db,
      initiator: publicKeyHex < peer.publicKeyHex,
      sendSignal: (signal) => void this.sendEphemeral({ t: 'rtc', ...signal }),
      peerOnline: () => this.presence.current(this.now()).state === 'online',
      changed: () => this.listener.messagesChanged?.(),
      progress: (id, bytes) => this.listener.transferProgress?.(id, bytes),
      status: (status) => this.listener.linkStatus?.(status),
    });
  }

  // --- incoming -------------------------------------------------------------------------------

  /** Events are processed strictly in order so dedupe checks can't race. */
  private enqueue(event: NostrEvent) {
    this.inbox = this.inbox.then(() => this.receive(event)).catch(() => undefined);
  }

  private async receive(event: NostrEvent) {
    const { db, secretKey, peer } = this.config;
    if (!(await markEventSeen(db, event.id, this.now()))) return;
    const opened = openEnvelope(event, secretKey, peer.publicKeyHex);
    if (!opened) return;
    const { frame } = opened;
    const now = this.now();

    switch (frame.t) {
      case 'hello':
        if (!verifyHelloProof(peer.pairSecretHex, peer.publicKeyHex, frame.proof)) return;
        if (!this.confirmed) {
          this.confirmed = true;
          await markPeerConfirmed(db, now);
          this.listener.peerConfirmed?.(now);
          // Make sure the peer gets our proof too, even if our earlier hellos were missed.
          void this.sendHello();
        }
        return;

      case 'msg': {
        const expiresAt = frame.ttl ? frame.sentAt + frame.ttl * 1000 : null;
        const inserted = await insertMessage(
          db,
          newMessage({
            id: frame.id,
            direction: 'in',
            body: frame.text,
            replyTo: frame.replyTo ?? null,
            sentAt: frame.sentAt,
            receivedAt: now,
            status: 'received',
            expiresAt,
            attachment: frame.file ?? null,
            transferState: frame.file ? 'pending' : null,
            location: frame.loc ? { ...frame.loc, updatedAt: frame.sentAt, endedAt: null } : null,
          }),
        );
        if (inserted) {
          this.presence.messageReceived();
          this.emitPresence();
        } else {
          // An edit may have created the row first; add what only the original carries.
          await completeIncoming(db, frame.id, frame.replyTo ?? null, expiresAt);
        }
        if (inserted || expiresAt !== null) {
          await this.purge();
          this.listener.messagesChanged?.();
        }
        if (inserted && frame.file) void this.transfers?.wake();
        // Acknowledge duplicates too: our earlier receipt may have been lost.
        this.pendingReceipts.delivered.add(frame.id);
        this.scheduleReceipts();
        return;
      }

      case 'receipt':
        if ((await advanceOutgoing(db, frame.ids, frame.state)).length) {
          this.listener.messagesChanged?.();
        }
        return;

      case 'react':
        if (await setReaction(db, frame.id, 'peer', frame.emoji, frame.at)) {
          this.listener.messagesChanged?.();
        }
        return;

      case 'edit': {
        if (frame.editedAt - frame.sentAt > EDIT_WINDOW_MS + EDIT_SKEW_MS) return;
        const created = await insertMessage(
          db,
          newMessage({
            id: frame.id,
            direction: 'in',
            body: frame.text,
            sentAt: frame.sentAt,
            receivedAt: now,
            status: 'received',
            editedAt: frame.editedAt,
          }),
        );
        if (created || (await applyEdit(db, frame.id, 'in', frame.text, frame.editedAt))) {
          this.listener.messagesChanged?.();
        }
        return;
      }

      case 'delete':
        for (const item of frame.items) {
          // Not here yet: leave a tombstone so the late original can't appear.
          await insertMessage(
            db,
            newMessage({
              id: item.id,
              direction: 'in',
              body: '',
              sentAt: item.sentAt,
              receivedAt: now,
              status: 'received',
              deletedAt: now,
            }),
          );
        }
        await markDeleted(
          db,
          frame.items.map((i) => i.id),
          'in',
          now,
        );
        await this.transfers?.removeFiles(frame.items.map((i) => i.id));
        this.listener.messagesChanged?.();
        return;

      case 'rtc': {
        const { t: _t, ...signal } = frame;
        await this.transfers?.handleSignal(signal);
        return;
      }

      case 'locLive': {
        const message = await getMessage(db, frame.id);
        if (message?.direction !== 'in') return;
        const { lat, lng, acc } = frame;
        if (await updateLiveLocation(db, frame.id, { lat, lng, acc }, frame.at)) {
          this.listener.messagesChanged?.();
        }
        return;
      }

      case 'locEnd': {
        const message = await getMessage(db, frame.id);
        if (message?.direction === 'in' && (await endLiveLocation(db, frame.id, frame.at))) {
          this.listener.messagesChanged?.();
        }
        return;
      }

      case 'timer':
        await this.applyTimer({ seconds: frame.seconds, at: frame.at }, 'peer');
        return;

      case 'presence':
        if (frame.state === 'online') {
          const wasOnline = this.presence.current(now).state === 'online';
          this.presence.heartbeat(now);
          // Answer right away so the peer doesn't wait a full heartbeat to see us online.
          if (!wasOnline) {
            void this.sendEphemeral({ t: 'presence', state: 'online' });
            void this.transfers?.wake();
          }
        } else {
          this.presence.wentOffline(now);
          await this.persistLastSeen();
        }
        this.emitPresence();
        return;

      case 'typing':
        this.presence.typing(now);
        this.emitPresence();
        return;
    }
  }

  /** Last change wins; each change leaves a notice in the chat, deduplicated by its id. */
  private async applyTimer(setting: DisappearSetting, by: 'me' | 'peer') {
    const { db } = this.config;
    const notice: TimerNotice = { type: 'timer', seconds: setting.seconds, by };
    await insertMessage(
      db,
      newMessage({
        id: `timer:${by}:${setting.at}`,
        direction: by === 'me' ? 'out' : 'in',
        kind: 'system',
        body: JSON.stringify(notice),
        sentAt: setting.at,
        status: by === 'me' ? 'sent' : 'read',
      }),
    );
    if (setting.at > this.disappear.at) {
      this.disappear = setting;
      await setSetting(db, SETTING_DISAPPEAR, JSON.stringify(setting));
      this.listener.disappearChanged?.(setting.seconds);
    }
    this.listener.messagesChanged?.();
  }

  private async synced() {
    // Only advance the sync point once everything before it has been processed.
    await this.inbox;
    this.lastSync = this.now();
    await setSetting(this.config.db, SETTING_LAST_SYNC, String(this.lastSync));
  }

  // --- presence -------------------------------------------------------------------------------

  private emitPresence() {
    const now = this.now();
    const presence = this.presence.current(now);
    const key = JSON.stringify(presence);
    if (key !== this.lastPresenceKey) {
      this.lastPresenceKey = key;
      this.listener.presenceChanged?.(presence);
    }
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
    const next = this.presence.nextChangeAt(now);
    if (next !== null && this.running) {
      this.presenceTimer = setTimeout(() => this.emitPresence(), next - now + 1);
    }
  }

  private async persistLastSeen() {
    const at = this.presence.lastSeenAt;
    if (at !== null) await setSetting(this.config.db, SETTING_PEER_LAST_SEEN, String(at));
  }
}

async function loadDisappear(db: Db): Promise<DisappearSetting> {
  const raw = await getSetting(db, SETTING_DISAPPEAR);
  if (!raw) return { seconds: 0, at: 0 };
  try {
    const value = JSON.parse(raw) as DisappearSetting;
    return DISAPPEAR_OPTIONS.includes(value.seconds) ? value : { seconds: 0, at: 0 };
  } catch {
    return { seconds: 0, at: 0 };
  }
}
