import { PeerLink, type LinkDiagnostics, type Signal } from '@/core/rtc/peerLink';
import type { DataChannelLike, IceServer, RtcFactory } from '@/core/rtc/types';
import type { Db } from '@/data/db';
import { getMessage, setTransfer, unfinishedTransfers, type Message } from '@/data/messages';

import {
  CHUNK_PAYLOAD,
  decodeChunk,
  encodeChunk,
  parseControl,
  type ControlMessage,
} from './chunks';
import type { FileStore } from './fileStore';

/** Pause sending above this much buffered data; resume once it drains to the low mark. */
const BUFFER_HIGH = 1024 * 1024;
const BUFFER_LOW = 256 * 1024;
/** Persist receive progress at most this often (bytes), so resume points survive a crash. */
const PROGRESS_STEP = 512 * 1024;
const IDLE_CLOSE_MS = 30_000;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

export type TransferConfig = {
  store: FileStore;
  rtc: RtcFactory;
  iceServers: IceServer[];
  connectTimeoutMs?: number;
};

export type LinkStatus = 'idle' | 'connecting' | 'open' | 'unreachable';

type Hooks = {
  db: Db;
  initiator: boolean;
  sendSignal: (signal: Signal) => void;
  peerOnline: () => boolean;
  /** A message's transfer state changed (UI reloads). */
  changed: () => void;
  /** Live progress for the UI, not persisted every chunk. */
  progress: (id: string, bytes: number) => void;
  /** Diagnostics come with failures, to explain them. */
  status: (status: LinkStatus, diagnostics?: LinkDiagnostics) => void;
};

type Incoming = { message: Message; name: string; size: number; received: number; saved: number };

/**
 * Moves attachment bytes over a direct WebRTC link while both phones are online. The receiver
 * drives: it asks for each unfinished file from the bytes it already has, so transfers resume
 * after any interruption, and only accepts a file whose SHA-256 matches the signed message.
 */
export class TransferManager {
  private link: PeerLink | null = null;
  private channel: DataChannelLike | null = null;
  private incoming = new Map<string, Incoming>();
  private writes: Promise<void> = Promise.resolve();
  private serving: Promise<void> = Promise.resolve();
  private servingAbort = { aborted: false };
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private checking = false;

  constructor(
    private readonly config: TransferConfig,
    private readonly hooks: Hooks,
  ) {}

  /** Re-evaluates whether a link is needed; call when messages or presence change. */
  async wake(): Promise<void> {
    if (this.stopped || this.checking) return;
    this.checking = true;
    try {
      const work = await this.hasWork();
      if (this.channel) {
        if (work) {
          this.clearIdle();
          await this.requestIncoming();
        } else this.armIdle();
        return;
      }
      if (work && !this.link && !this.retryTimer && this.hooks.peerOnline()) this.connect();
    } finally {
      this.checking = false;
    }
  }

  async handleSignal(signal: Signal): Promise<void> {
    if (this.stopped) return;
    // The other side started a connection (or asks us to): accept it even if we have no work.
    if (!this.link && (signal.kind === 'offer' || signal.kind === 'want')) {
      if (signal.kind === 'want' && !this.hooks.initiator) return;
      this.createLink();
    }
    await this.link?.handleSignal(signal);
  }

  /** Try again now instead of waiting for the backoff (user tapped "Try again"). */
  retry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.failures = 0;
    this.hooks.status('connecting');
    void this.wake();
  }

  /** Deletes stored bytes for messages that were deleted or expired. */
  async removeFiles(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.incoming.delete(id);
      await this.config.store.remove(id);
    }
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearIdle();
    this.servingAbort.aborted = true;
    this.link?.close();
    this.link = null;
    this.channel = null;
  }

  private async hasWork(): Promise<boolean> {
    const { db } = this.hooks;
    return (
      (await unfinishedTransfers(db, 'in')).length > 0 ||
      (await unfinishedTransfers(db, 'out')).length > 0
    );
  }

  private connect() {
    this.createLink().start();
  }

  private createLink(): PeerLink {
    this.hooks.status('connecting');
    const link = new PeerLink({
      rtc: this.config.rtc,
      iceServers: this.config.iceServers,
      initiator: this.hooks.initiator,
      connectTimeoutMs: this.config.connectTimeoutMs,
      sendSignal: this.hooks.sendSignal,
      onOpen: (channel) => {
        if (this.link !== link) return;
        this.channel = channel;
        this.failures = 0;
        this.hooks.status('open');
        channel.bufferedAmountLowThreshold = BUFFER_LOW;
        channel.addEventListener('message', ({ data }) => this.onMessage(data));
        void this.wake();
      },
      onClose: (reason, diagnostics) => {
        if (this.link !== link) return;
        this.link = null;
        this.channel = null;
        this.servingAbort.aborted = true;
        this.incoming.clear();
        if (this.stopped) return;
        if (reason === 'closed') {
          this.hooks.status('idle');
          void this.wake();
          return;
        }
        this.failures += 1;
        this.hooks.status(this.failures >= 3 ? 'unreachable' : 'connecting', diagnostics);
        const delay = RETRY_DELAYS_MS[Math.min(this.failures - 1, RETRY_DELAYS_MS.length - 1)]!;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.wake();
        }, delay);
      },
    });
    this.link = link;
    return link;
  }

  private send(message: ControlMessage) {
    try {
      this.channel?.send(JSON.stringify(message));
    } catch {
      // Link closed underneath us; the request is repeated on the next connection.
    }
  }

  private onMessage(data: unknown) {
    if (typeof data === 'string') {
      const control = parseControl(data);
      if (control) void this.onControl(control);
      return;
    }
    if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      const chunk = decodeChunk(data);
      // Copy: some WebRTC stacks reuse the receive buffer.
      if (!chunk) return;
      const payload = chunk.payload.slice();
      // A failed write must not poison the chain: later chunks and files still need it.
      this.writes = this.writes
        .then(() => this.onChunk(chunk.id, chunk.offset, payload))
        .catch(() => {
          this.incoming.delete(chunk.id);
        });
    }
  }

  private async onControl(control: ControlMessage) {
    const { db } = this.hooks;
    switch (control.t) {
      case 'get': {
        const message = await getMessage(db, control.id);
        const file = message?.direction === 'out' ? message.attachment : null;
        if (!file || (await this.config.store.size(control.id, file.name)) < file.size) {
          this.send({ t: 'missing', id: control.id });
          return;
        }
        this.serve(control.id, file.name, file.size, control.offset);
        return;
      }
      case 'have': {
        const message = await getMessage(db, control.id);
        if (message?.direction === 'out' && message.attachment) {
          await setTransfer(db, control.id, 'done', message.attachment.size);
          this.hooks.changed();
          void this.wake();
        }
        return;
      }
      case 'missing': {
        const message = await getMessage(db, control.id);
        if (message?.direction === 'in' && message.attachment) {
          this.incoming.delete(control.id);
          await setTransfer(db, control.id, 'failed', 0);
          this.hooks.changed();
        }
        return;
      }
    }
  }

  /** Asks for every unfinished incoming file we aren't already receiving. */
  private async requestIncoming() {
    const { db } = this.hooks;
    for (const message of await unfinishedTransfers(db, 'in')) {
      const file = message.attachment;
      if (!file || this.incoming.has(message.id)) continue;
      let received = await this.config.store.size(message.id, file.name);
      if (received > file.size) {
        await this.config.store.remove(message.id);
        received = 0;
      }
      this.incoming.set(message.id, {
        message,
        name: file.name,
        size: file.size,
        received,
        saved: received,
      });
      if (received === file.size) {
        await this.complete(message.id);
        continue;
      }
      await setTransfer(db, message.id, 'active', received);
      this.hooks.changed();
      this.send({ t: 'get', id: message.id, offset: received });
    }
  }

  private async onChunk(id: string, offset: number, payload: Uint8Array) {
    const state = this.incoming.get(id);
    // Ordered, reliable channel: anything out of sequence belongs to an abandoned request.
    if (!state || offset !== state.received || state.received + payload.length > state.size) return;
    await this.config.store.append(id, state.name, payload);
    state.received += payload.length;
    this.hooks.progress(id, state.received);
    if (state.received === state.size) {
      await this.complete(id);
    } else if (state.received - state.saved >= PROGRESS_STEP) {
      state.saved = state.received;
      await setTransfer(this.hooks.db, id, 'active', state.received);
    }
  }

  private async complete(id: string) {
    const state = this.incoming.get(id);
    if (!state) return;
    this.incoming.delete(id);
    const { db } = this.hooks;
    const expected = state.message.attachment?.sha256;
    const actual = await this.config.store.sha256(id, state.name);
    if (actual === expected) {
      await setTransfer(db, id, 'done', state.size);
      this.send({ t: 'have', id });
    } else {
      // Corrupt or tampered: throw the bytes away and mark it failed rather than show it.
      await this.config.store.remove(id);
      await setTransfer(db, id, 'failed', 0);
    }
    this.hooks.changed();
    void this.wake();
  }

  /** Streams one file at a time with backpressure; a closed link aborts the queue. */
  private serve(id: string, name: string, size: number, from: number) {
    const abort = this.servingAbort.aborted
      ? (this.servingAbort = { aborted: false })
      : this.servingAbort;
    // Each file is served after the previous one; a failure ends this file only, never the queue.
    this.serving = this.serving
      .then(async () => {
        let offset = from;
        while (offset < size && !abort.aborted) {
          const channel = this.channel;
          if (!channel || channel.readyState !== 'open') return;
          if (channel.bufferedAmount > BUFFER_HIGH) await drained(channel);
          const payload = await this.config.store.read(
            id,
            name,
            offset,
            Math.min(CHUNK_PAYLOAD, size - offset),
          );
          if (!payload.length || abort.aborted) return;
          try {
            channel.send(encodeChunk({ id, offset, payload }));
          } catch {
            return; // link closed between the check and the send; the receiver will resume
          }
          offset += payload.length;
          this.hooks.progress(id, offset);
        }
      })
      .catch(() => undefined);
  }

  private armIdle() {
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.hasWork().then((work) => {
        if (!work && this.link) {
          this.link.close();
        }
      });
    }, IDLE_CLOSE_MS);
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

function drained(channel: DataChannelLike): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', finish);
    channel.addEventListener('close', finish);
    // Some stacks skip the event; poll as a fallback.
    const poll = setInterval(() => {
      if (channel.bufferedAmount <= BUFFER_LOW || channel.readyState !== 'open') finish();
    }, 50);
  });
}
