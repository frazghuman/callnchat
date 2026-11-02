import type { Filter } from 'nostr-tools/filter';
import { SimplePool, type SubCloser } from 'nostr-tools/pool';
import { finalizeEvent } from 'nostr-tools/pure';

import type { NostrEvent } from './envelope';

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

export type PublishResult = { ok: number; failed: number };

export type TransportHandlers = {
  /** Called on every (re)subscribe, so each reconnect asks for the current sync window. */
  filter: () => Filter;
  onEvent: (event: NostrEvent) => void;
  /** A relay finished sending stored events. */
  onSynced?: (url: string) => void;
  onConnectionChange?: (connectedRelays: number) => void;
};

export interface RelayTransport {
  start(handlers: TransportHandlers): void;
  publish(event: NostrEvent): Promise<PublishResult>;
  stop(): void;
  connectedCount(): number;
}

export type RelayTransportOptions = {
  retryDelaysMs?: number[];
  publishTimeoutMs?: number;
};

const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 60_000];

/**
 * One subscription per relay, with our own reconnect loop. nostr-tools' built-in reconnect
 * resumes from the last event's created_at, which loses NIP-59 wraps (they are backdated up to
 * two days), and it never retries if the first connection fails.
 */
export function createRelayTransport(
  urls: string[],
  secretKey: Uint8Array,
  options: RelayTransportOptions = {},
): RelayTransport {
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const publishTimeoutMs = options.publishTimeoutMs ?? 5_000;

  let pool: SimplePool | null = null;
  let handlers: TransportHandlers | null = null;
  const subs = new Map<string, SubCloser>();
  const connected = new Set<string>();
  const attempts = new Map<string, number>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const sign = (template: Parameters<typeof finalizeEvent>[0]) =>
    Promise.resolve(finalizeEvent(template, secretKey));

  function setConnected(url: string, value: boolean) {
    const changed = value ? !connected.has(url) : connected.has(url);
    if (value) connected.add(url);
    else connected.delete(url);
    if (changed) handlers?.onConnectionChange?.(connected.size);
  }

  function scheduleRetry(url: string) {
    if (!pool || retryTimers.has(url)) return;
    const n = attempts.get(url) ?? 0;
    attempts.set(url, n + 1);
    const delay = retryDelays[Math.min(n, retryDelays.length - 1)]!;
    retryTimers.set(
      url,
      setTimeout(() => {
        retryTimers.delete(url);
        subscribe(url);
      }, delay),
    );
  }

  function subscribe(url: string) {
    if (!pool || !handlers) return;
    const h = handlers;
    const current = pool;
    subs.get(url)?.close();
    const sub = current.subscribe([url], h.filter(), {
      onevent: h.onEvent,
      oneose: () => {
        attempts.set(url, 0);
        setConnected(url, true);
        h.onSynced?.(url);
      },
      onclose: () => {
        if (pool !== current || subs.get(url) !== sub) return; // stopped or replaced
        subs.delete(url);
        setConnected(url, false);
        scheduleRetry(url);
      },
      onauth: sign,
    });
    subs.set(url, sub);
  }

  return {
    start(next) {
      if (pool) return;
      handlers = next;
      pool = new SimplePool({ enableReconnect: false });
      pool.automaticallyAuth = () => sign;
      for (const url of urls) subscribe(url);
    },

    async publish(event) {
      if (!pool) return { ok: 0, failed: urls.length };
      const results = await Promise.allSettled(
        pool.publish(urls, event, { onauth: sign, maxWait: publishTimeoutMs }),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      return { ok, failed: results.length - ok };
    },

    stop() {
      const current = pool;
      pool = null;
      for (const timer of retryTimers.values()) clearTimeout(timer);
      retryTimers.clear();
      for (const sub of subs.values()) sub.close();
      subs.clear();
      attempts.clear();
      if (connected.size) {
        connected.clear();
        handlers?.onConnectionChange?.(0);
      }
      handlers = null;
      current?.destroy();
    },

    connectedCount: () => connected.size,
  };
}
