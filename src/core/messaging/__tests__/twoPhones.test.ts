/**
 * @jest-environment node
 */
// Not a React hook, despite the name.
import {
  SimplePool,
  useWebSocketImplementation as setWebSocketImplementation,
} from 'nostr-tools/pool';
import { generateSecretKey } from 'nostr-tools/pure';
import WebSocket from 'ws';

import { sealFrame } from '@/core/nostr/envelope';
import { newMessageId } from '@/core/protocol/ids';

import { startLocalRelay, type LocalRelay } from '../../../../test/localRelay';
import {
  createPhone as makePhone,
  createSessions,
  waitFor,
  type Phone,
} from '../../../../test/phones';
import type { Session } from '@/features/session/session';

setWebSocketImplementation(WebSocket);
jest.setTimeout(20_000);

let relays: LocalRelay[] = [];

const createPhone = (session: Session) =>
  makePhone(
    session,
    relays.map((r) => r.url),
  );

const statusOf = async (phone: Phone, id: string) =>
  (await phone.messages()).find((m) => m.id === id)?.status;

beforeEach(async () => {
  relays = [await startLocalRelay(), await startLocalRelay()];
});

afterEach(async () => {
  await Promise.all(relays.map((r) => r.stop()));
});

it('confirms pairing, delivers while the peer is offline, and reports delivered/read', async () => {
  const [aliceSession, bobSession] = await createSessions();
  const alice = createPhone(aliceSession);
  const bob = createPhone(bobSession);

  // Alice comes online first; Bob is offline.
  await alice.messenger.start();
  const sent = await alice.messenger.send('Hello Bob 👋');
  await waitFor(async () => (await statusOf(alice, sent.id)) === 'sent');

  // Bob starts later: the hello and the message come from the relays' stored wraps.
  await bob.messenger.start();
  await waitFor(async () => (await bob.messages()).length === 1);
  const [received] = await bob.messages();
  expect(received).toMatchObject({ id: sent.id, direction: 'in', body: 'Hello Bob 👋' });

  await waitFor(() => alice.confirmedAt !== null && bob.confirmedAt !== null);
  await waitFor(async () => (await statusOf(alice, sent.id)) === 'delivered');

  await bob.messenger.markRead();
  await waitFor(async () => (await statusOf(alice, sent.id)) === 'read');

  // Same wrap arrived from both relays, yet Bob stored it once.
  expect(await bob.messages()).toHaveLength(1);

  await alice.messenger.stop();
  await bob.messenger.stop();
});

it('tracks presence and typing live, and offline on stop', async () => {
  const [aliceSession, bobSession] = await createSessions();
  const alice = createPhone(aliceSession);
  const bob = createPhone(bobSession);
  await alice.messenger.start();
  await bob.messenger.start();

  await waitFor(() => alice.presence?.state === 'online' && bob.presence?.state === 'online');

  bob.messenger.typing();
  await waitFor(() => alice.presence?.state === 'online' && alice.presence.typing);

  await bob.messenger.stop();
  await waitFor(() => alice.presence?.state === 'offline');
  expect(alice.presence).toMatchObject({ state: 'offline' });
  expect((alice.presence as { lastSeen: number }).lastSeen).toBeGreaterThan(0);

  await alice.messenger.stop();
});

it('keeps a message pending while relays are down and delivers after they return', async () => {
  const [aliceSession, bobSession] = await createSessions();
  const alice = createPhone(aliceSession);
  const bob = createPhone(bobSession);
  await alice.messenger.start();
  await bob.messenger.start();
  await waitFor(() => alice.confirmedAt !== null);

  const ports = relays.map((r) => r.port);
  const stores = relays.map((r) => r.store);
  await Promise.all(relays.map((r) => r.stop()));

  const sent = await alice.messenger.send('Are you there?');
  await new Promise((r) => setTimeout(r, 300));
  expect(await statusOf(alice, sent.id)).toBe('pending');

  relays = await Promise.all(ports.map((port, i) => startLocalRelay({ port, store: stores[i] })));
  await waitFor(async () => (await statusOf(alice, sent.id)) === 'delivered', 15_000);
  expect((await bob.messages()).map((m) => m.body)).toEqual(['Are you there?']);

  await alice.messenger.stop();
  await bob.messenger.stop();
});

it("ignores wraps from anyone who isn't the paired peer", async () => {
  const [aliceSession, bobSession] = await createSessions();
  const bob = createPhone(bobSession);
  await bob.messenger.start();

  const mallory = generateSecretKey();
  const forged = sealFrame(
    { t: 'msg', id: newMessageId(Date.now()), text: 'hi, it is Alice', sentAt: Date.now() },
    mallory,
    aliceSession.peer!.publicKey, // Bob's public key, as Alice knows it
    Date.now(),
  );
  const pool = new SimplePool();
  await Promise.allSettled(pool.publish([relays[0]!.url], forged));
  pool.destroy();

  await new Promise((r) => setTimeout(r, 300));
  expect(await bob.messages()).toHaveLength(0);
  await bob.messenger.stop();
});
