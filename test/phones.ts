import { bytesToHex } from '@/core/crypto/bytes';
import { Messenger } from '@/core/messaging/messenger';
import type { PeerPresence } from '@/core/messaging/presence';
import type { TransferConfig } from '@/core/transfer/transferManager';
import { createRelayTransport } from '@/core/nostr/relayPool';
import type { DisappearSeconds } from '@/core/protocol/frames';
import { listMessages, type ChatMessage } from '@/data/messages';
import { createMemorySecretStore } from '@/data/secretStore';
import { addPeer, loadSession, updateProfile, type Session } from '@/features/session/session';

import { createNodeSqliteDb } from './nodeSqliteDb';

/** A simulated phone: real messenger, real SQL, real relay transport. */
export type Phone = {
  session: Session;
  messenger: Messenger;
  presence: PeerPresence | null;
  confirmedAt: number | null;
  disappear: DisappearSeconds;
  /** Latest live progress per attachment id. */
  progress: Map<string, number>;
  messages(): Promise<ChatMessage[]>;
  message(id: string): Promise<ChatMessage | undefined>;
};

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Two paired sessions (Alice and Bob) that already exchanged codes. */
export async function createSessions(): Promise<[Session, Session]> {
  const device = async (name: string) => {
    const db = createNodeSqliteDb();
    const services = { secrets: createMemorySecretStore(), openDb: async () => db, now: Date.now };
    return { session: await updateProfile(await loadSession(services), name), services };
  };
  const a = await device('Alice');
  const b = await device('Bob');
  const alice = await addPeer(a.session, a.services, b.session.ownCodeText, 'Bob');
  const bob = await addPeer(b.session, b.services, a.session.ownCodeText, 'Alice');
  return [alice, bob];
}

export function createPhone(
  session: Session,
  relayUrls: string[],
  options: { now?: () => number; transfer?: TransferConfig } = {},
): Phone {
  const phone: Phone = {
    session,
    presence: null,
    confirmedAt: session.peer!.confirmedAt,
    disappear: 0,
    progress: new Map(),
    messages: () => listMessages(session.db, 100),
    message: async (id) => (await listMessages(session.db, 100)).find((m) => m.id === id),
    messenger: null as unknown as Messenger,
  };
  phone.messenger = new Messenger(
    {
      transport: createRelayTransport(relayUrls, session.identity.secretKey, {
        retryDelaysMs: [100],
        publishTimeoutMs: 1_000,
      }),
      db: session.db,
      secretKey: session.identity.secretKey,
      publicKeyHex: bytesToHex(session.identity.publicKey),
      profileName: session.profile!.displayName,
      peer: {
        publicKeyHex: session.peer!.publicKey,
        pairSecretHex: session.peer!.pairSecret,
        confirmed: session.peer!.confirmedAt !== null,
      },
      now: options.now,
      transfer: options.transfer,
      heartbeatMs: 200,
      tickMs: 200,
      receiptDebounceMs: 20,
    },
    {
      presenceChanged: (p) => (phone.presence = p),
      peerConfirmed: (at) => (phone.confirmedAt = at),
      disappearChanged: (s) => (phone.disappear = s),
      transferProgress: (id, bytes) => phone.progress.set(id, bytes),
    },
  );
  return phone;
}
