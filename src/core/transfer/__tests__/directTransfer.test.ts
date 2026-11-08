/**
 * @jest-environment node
 */
import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

import { RTCPeerConnection } from '@roamhq/wrtc';
// Not a React hook, despite the name.
import { useWebSocketImplementation as setWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';

import type { PeerConnectionLike, RtcFactory } from '@/core/rtc/types';
import type { Attachment } from '@/core/protocol/frames';
import { newMessageId } from '@/core/protocol/ids';
import type { Session } from '@/features/session/session';

import { startLocalRelay, type LocalRelay } from '../../../../test/localRelay';
import { createNodeFileStore } from '../../../../test/nodeFileStore';
import { createPhone, createSessions, waitFor, type Phone } from '../../../../test/phones';
import { decodeChunk, encodeChunk } from '../chunks';
import type { FileStore } from '../fileStore';

setWebSocketImplementation(WebSocket);
jest.setTimeout(30_000);

// Loopback host candidates are enough between two processes on one machine.
const rtc: RtcFactory = (config) => new RTCPeerConnection(config) as unknown as PeerConnectionLike;

let relay: LocalRelay;
const running: Phone[] = [];

type Device = { session: Session; store: ReturnType<typeof createNodeFileStore> };

function phone(device: Device, store: FileStore = device.store) {
  const p = createPhone(device.session, [relay.url], {
    transfer: { store, rtc, iceServers: [], connectTimeoutMs: 8_000 },
  });
  running.push(p);
  return p;
}

async function devices(): Promise<[Device, Device]> {
  const [a, b] = await createSessions();
  return [
    { session: a, store: createNodeFileStore() },
    { session: b, store: createNodeFileStore() },
  ];
}

/** Puts `bytes` into the sender's store the way the app does before announcing the file. */
async function stage(store: FileStore, bytes: Buffer, name = 'report.pdf') {
  const id = newMessageId(Date.now());
  await store.append(id, name, new Uint8Array(bytes));
  const attachment: Attachment = {
    kind: 'file',
    name,
    mime: 'application/pdf',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return { id, attachment };
}

beforeEach(async () => {
  relay = await startLocalRelay();
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((p) => p.messenger.stop()));
  await relay.stop();
});

it('encodes chunks with ids and large offsets', () => {
  const id = newMessageId(Date.now());
  const payload = new Uint8Array([1, 2, 3]);
  const decoded = decodeChunk(encodeChunk({ id, offset: 5 * 2 ** 32 + 7, payload }));
  expect(decoded).toEqual({ id, offset: 5 * 2 ** 32 + 7, payload });
  expect(decodeChunk(new Uint8Array(10))).toBeNull();
});

it('sends a file directly while both phones are online, verified by hash', async () => {
  const [a, b] = await devices();
  const alice = phone(a);
  const bob = phone(b);
  await alice.messenger.start();
  await bob.messenger.start();
  await waitFor(() => alice.presence?.state === 'online' && bob.presence?.state === 'online');

  const bytes = nodeRandomBytes(300_000);
  const { id, attachment } = await stage(a.store, bytes);
  await alice.messenger.sendFile(id, attachment, 'Here is the report');

  await waitFor(async () => (await bob.message(id))?.transferState === 'done', 20_000);
  expect((await b.store.bytes(id, attachment.name)).equals(bytes)).toBe(true);
  expect(await bob.message(id)).toMatchObject({ body: 'Here is the report', attachment });
  await waitFor(async () => (await alice.message(id))?.transferState === 'done');
});

it('waits for the receiver to come online, then delivers', async () => {
  const [a, b] = await devices();
  const alice = phone(a);
  await alice.messenger.start();
  const bytes = nodeRandomBytes(50_000);
  const { id, attachment } = await stage(a.store, bytes, 'photo.jpg');
  await alice.messenger.sendFile(id, { ...attachment, kind: 'image', mime: 'image/jpeg' });
  await new Promise((r) => setTimeout(r, 500));
  expect((await alice.message(id))?.transferState).toBe('pending');

  const bob = phone(b);
  await bob.messenger.start();
  await waitFor(async () => (await bob.message(id))?.transferState === 'done', 20_000);
  expect((await b.store.bytes(id, 'photo.jpg')).equals(bytes)).toBe(true);
});

it('resumes an interrupted transfer from the bytes already received', async () => {
  const [a, b] = await devices();
  const reads: number[] = [];
  const aliceStore: FileStore = {
    ...a.store,
    read: (id, name, offset, length) => {
      reads.push(offset);
      return a.store.read(id, name, offset, length);
    },
  };
  const alice = phone(a, aliceStore);
  const bob = phone(b);
  await alice.messenger.start();
  await bob.messenger.start();
  await waitFor(() => alice.presence?.state === 'online' && bob.presence?.state === 'online');

  const bytes = nodeRandomBytes(4_000_000);
  const { id, attachment } = await stage(a.store, bytes, 'video.mov');
  await alice.messenger.sendFile(id, attachment);

  // Bob's app goes to the background part-way through.
  await waitFor(() => (bob.progress.get(id) ?? 0) > 500_000, 20_000);
  await bob.messenger.stop();
  const partial = await b.store.size(id, attachment.name);
  expect(partial).toBeGreaterThan(0);
  expect(partial).toBeLessThan(bytes.length);

  reads.length = 0;
  const bobAgain = phone(b);
  await bobAgain.messenger.start();
  await waitFor(async () => (await bobAgain.message(id))?.transferState === 'done', 25_000);
  expect((await b.store.bytes(id, attachment.name)).equals(bytes)).toBe(true);
  // Alice served the rest, not the whole file again.
  expect(Math.min(...reads)).toBeGreaterThanOrEqual(partial);
});

it('rejects a file whose bytes do not match the announced hash', async () => {
  const [a, b] = await devices();
  const alice = phone(a);
  const bob = phone(b);
  await alice.messenger.start();
  await bob.messenger.start();
  await waitFor(() => alice.presence?.state === 'online' && bob.presence?.state === 'online');

  const { id, attachment } = await stage(a.store, nodeRandomBytes(40_000));
  await alice.messenger.sendFile(id, { ...attachment, sha256: '0'.repeat(64) });

  await waitFor(async () => (await bob.message(id))?.transferState === 'failed', 20_000);
  expect(await b.store.size(id, attachment.name)).toBe(0);
});

it('deletes the received file when the sender deletes the message for everyone', async () => {
  const [a, b] = await devices();
  const alice = phone(a);
  const bob = phone(b);
  await alice.messenger.start();
  await bob.messenger.start();
  await waitFor(() => alice.presence?.state === 'online' && bob.presence?.state === 'online');

  const { id, attachment } = await stage(a.store, nodeRandomBytes(20_000));
  await alice.messenger.sendFile(id, attachment);
  await waitFor(async () => (await bob.message(id))?.transferState === 'done', 20_000);

  await alice.messenger.deleteForEveryone([id]);
  await waitFor(async () => (await bob.message(id))?.deletedAt != null);
  // The row is marked first, then the file goes.
  await waitFor(async () => (await b.store.size(id, attachment.name)) === 0);
  expect((await bob.message(id))?.attachment).toBeNull();
});

it('shares a pin and live location, with updates and an early stop', async () => {
  const [a, b] = await devices();
  const alice = phone(a);
  const bob = phone(b);
  await alice.messenger.start();
  await bob.messenger.start();
  await waitFor(() => alice.presence?.state === 'online' && bob.presence?.state === 'online');

  const pin = await alice.messenger.sendLocation({ lat: 31.5204, lng: 74.3587, acc: 12 });
  await waitFor(async () => !!(await bob.message(pin.id))?.location);
  expect((await bob.message(pin.id))?.location).toMatchObject({ lat: 31.5204, lng: 74.3587 });

  const live = await alice.messenger.sendLocation({
    lat: 31.5,
    lng: 74.3,
    liveUntil: Date.now() + 15 * 60_000,
  });
  await waitFor(async () => !!(await bob.message(live.id))?.location);
  await new Promise((r) => setTimeout(r, 20));
  await alice.messenger.updateLiveLocation(live.id, { lat: 31.6, lng: 74.4 });
  await waitFor(async () => (await bob.message(live.id))?.location?.lat === 31.6);

  await alice.messenger.stopLiveLocation(live.id);
  await waitFor(async () => (await bob.message(live.id))?.location?.endedAt != null);
  expect(await alice.messenger.updateLiveLocation(live.id, { lat: 1, lng: 1 })).toBe(false);
});

it('deletes files of disappearing messages when they expire', async () => {
  let clock = Date.now();
  const [a, b] = await devices();
  const alice = createPhone(a.session, [relay.url], {
    now: () => clock,
    transfer: { store: a.store, rtc, iceServers: [], connectTimeoutMs: 8_000 },
  });
  const bob = createPhone(b.session, [relay.url], {
    now: () => clock,
    transfer: { store: b.store, rtc, iceServers: [], connectTimeoutMs: 8_000 },
  });
  running.push(alice, bob);
  await alice.messenger.start();
  await bob.messenger.start();
  await waitFor(() => alice.presence?.state === 'online' && bob.presence?.state === 'online');

  await alice.messenger.setDisappearing(86_400);
  await waitFor(() => bob.disappear === 86_400);
  const { id, attachment } = await stage(a.store, nodeRandomBytes(10_000));
  await alice.messenger.sendFile(id, attachment);
  await waitFor(async () => (await bob.message(id))?.transferState === 'done', 20_000);

  clock += 86_400_000 + 1_000;
  await waitFor(async () => (await b.store.size(id, attachment.name)) === 0);
  await waitFor(async () => (await a.store.size(id, attachment.name)) === 0);
});
