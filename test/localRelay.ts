import type { AddressInfo } from 'node:net';

import { matchFilters, type Filter } from 'nostr-tools/filter';
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure';
import { WebSocketServer, type WebSocket } from 'ws';

/** Events survive relay restarts when the same store is passed back in. */
export type RelayStore = Map<string, NostrEvent>;

export type LocalRelay = {
  url: string;
  port: number;
  store: RelayStore;
  stop(): Promise<void>;
};

const isEphemeral = (kind: number) => kind >= 20000 && kind < 30000;

/** Minimal NIP-01 relay for tests: EVENT (verified), REQ with stored + live events, CLOSE. */
export async function startLocalRelay(
  options: { port?: number; store?: RelayStore } = {},
): Promise<LocalRelay> {
  const store: RelayStore = options.store ?? new Map();
  const server = new WebSocketServer({ port: options.port ?? 0, host: '127.0.0.1' });
  const subs = new Map<WebSocket, Map<string, Filter[]>>();

  await new Promise<void>((resolve) => server.once('listening', resolve));

  const send = (ws: WebSocket, msg: unknown[]) => ws.send(JSON.stringify(msg));

  server.on('connection', (ws) => {
    subs.set(ws, new Map());
    ws.on('close', () => subs.delete(ws));
    ws.on('message', (raw) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const [type, ...rest] = msg;

      if (type === 'EVENT') {
        const event = rest[0] as NostrEvent;
        if (!verifyEvent(event)) return send(ws, ['OK', event?.id, false, 'invalid: bad event']);
        if (!isEphemeral(event.kind)) store.set(event.id, event);
        for (const [client, clientSubs] of subs) {
          for (const [id, filters] of clientSubs) {
            if (matchFilters(filters, event)) send(client, ['EVENT', id, event]);
          }
        }
        return send(ws, ['OK', event.id, true, '']);
      }

      if (type === 'REQ') {
        const [id, ...filters] = rest as [string, ...Filter[]];
        subs.get(ws)?.set(id, filters);
        for (const event of store.values()) {
          if (matchFilters(filters, event)) send(ws, ['EVENT', id, event]);
        }
        return send(ws, ['EOSE', id]);
      }

      if (type === 'CLOSE') subs.get(ws)?.delete(rest[0] as string);
    });
  });

  const port = (server.address() as AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${port}`,
    port,
    store,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const ws of server.clients) ws.terminate();
        server.close(() => resolve());
      }),
  };
}
