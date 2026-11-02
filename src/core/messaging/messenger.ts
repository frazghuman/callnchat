import { KIND_EPHEMERAL_WRAP, KIND_WRAP, openEnvelope, sealFrame } from '@/core/nostr/envelope';
import type { NostrEvent } from '@/core/nostr/envelope';
import type { RelayTransport } from '@/core/nostr/relayPool';
import { MAX_TEXT_LENGTH, type Frame, type MsgFrame } from '@/core/protocol/frames';
import { newMessageId } from '@/core/protocol/ids';
import type { Db } from '@/data/db';
import {
  advanceOutgoing,
  duePending,
  failStalePending,
  getMessage,
  insertMessage,
  markEventSeen,
  markIncomingRead,
  pruneSeenEvents,
  scheduleRetry,
  unreadIncomingIds,
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

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const FAIL_AFTER_MS = 24 * 60 * 60 * 1000;
const SEEN_EVENTS_TTL_MS = 35 * 24 * 60 * 60 * 1000;
const SETTING_LAST_SYNC = 'lastSync';
const SETTING_PEER_LAST_SEEN = 'peerLastSeen';

/** 4 s, 8 s, 16 s … capped at 60 s. */
const retryDelay = (attempts: number) => Math.min(60_000, 2_000 * 2 ** Math.min(attempts, 5));

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
};

export type MessengerListener = {
  messagesChanged?: () => void;
  presenceChanged?: (presence: PeerPresence) => void;
  connectionChanged?: (connectedRelays: number) => void;
  peerConfirmed?: (at: number) => void;
};

export class MessageTooLongError extends Error {
  constructor() {
    super(`Message longer than ${MAX_TEXT_LENGTH} characters`);
  }
}

/**
 * Talks to the paired peer over Nostr relays: outbox with retries, inbox with dedupe,
 * delivery/read receipts, hello confirmation, presence and typing.
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
    this.emitPresence();

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
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
    await this.flushReceipts();
    // Best effort: tell the peer right away instead of letting the heartbeat time out.
    await this.publish({ t: 'presence', state: 'offline' }).catch(() => undefined);
    await this.inbox;
    this.config.transport.stop();
    await this.persistLastSeen();
  }

  /** Stores the message as pending and sends it; delivery continues via the outbox if offline. */
  async send(text: string, replyTo?: string): Promise<Message> {
    const body = text.trim();
    if (!body) throw new Error('Empty message');
    if (body.length > MAX_TEXT_LENGTH) throw new MessageTooLongError();
    const now = this.now();
    const message: Message = {
      id: newMessageId(now),
      direction: 'out',
      body,
      replyTo: replyTo ?? null,
      sentAt: now,
      receivedAt: null,
      status: 'pending',
    };
    await insertMessage(this.config.db, message);
    this.listener.messagesChanged?.();
    void this.flush();
    return message;
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

  currentPresence(): PeerPresence {
    return this.presence.current(this.now());
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

  /** Sends due pending messages, one flush at a time. */
  private flush(): Promise<void> {
    if (!this.running) return Promise.resolve();
    this.flushing ??= this.flushOutbox().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOutbox() {
    const { db } = this.config;
    for (const message of await duePending(db, this.now())) {
      if (!this.running) return;
      const frame: MsgFrame = {
        t: 'msg',
        id: message.id,
        text: message.body,
        sentAt: message.sentAt,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
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
    await pruneSeenEvents(db, now - SEEN_EVENTS_TTL_MS);
    if (!this.confirmed) void this.sendHello();
    await this.flushReceipts();
    await this.flush();
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
        const isNew = !(await getMessage(db, frame.id));
        if (isNew) {
          await insertMessage(db, {
            id: frame.id,
            direction: 'in',
            body: frame.text,
            replyTo: frame.replyTo ?? null,
            sentAt: frame.sentAt,
            receivedAt: now,
            status: 'received',
          });
          this.presence.messageReceived();
          this.listener.messagesChanged?.();
          this.emitPresence();
        }
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

      case 'presence':
        if (frame.state === 'online') {
          const wasOnline = this.presence.current(now).state === 'online';
          this.presence.heartbeat(now);
          // Answer right away so the peer doesn't wait a full heartbeat to see us online.
          if (!wasOnline) void this.sendEphemeral({ t: 'presence', state: 'online' });
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
