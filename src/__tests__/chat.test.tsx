import { Stack } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import Chat from '@/app/chat';
import Search from '@/app/search';
import { bytesToHex, randomBytes } from '@/core/crypto/bytes';
import { generateIdentity } from '@/core/crypto/identity';
import { encodePairingCode } from '@/core/crypto/pairingCode';
import { sealFrame } from '@/core/nostr/envelope';
import type { RelayTransport, TransportHandlers } from '@/core/nostr/relayPool';
import type { Frame } from '@/core/protocol/frames';
import { newMessageId } from '@/core/protocol/ids';
import { createMemorySecretStore } from '@/data/secretStore';
import { useChatStore } from '@/features/chat/chatStore';
import { useSessionStore } from '@/features/session/sessionStore';

import { createNodeSqliteDb } from '../../test/nodeSqliteDb';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

/** Accepts every publish and lets the test inject events "from the relay". */
function fakeTransport() {
  let handlers: TransportHandlers | null = null;
  const transport: RelayTransport = {
    start(h) {
      handlers = h;
      h.onConnectionChange?.(1);
    },
    publish: async () => ({ ok: 1, failed: 0 }),
    stop() {},
    connectedCount: () => 1,
  };
  return {
    transport,
    deliver: (event: Parameters<TransportHandlers['onEvent']>[0]) => handlers?.onEvent(event),
  };
}

const bob = generateIdentity();
let deliver: ReturnType<typeof fakeTransport>['deliver'];

async function fromBob(frame: Frame) {
  const me = bytesToHex(useSessionStore.getState().session!.identity.publicKey);
  deliver(sealFrame(frame, bob.secretKey, me, Date.now()));
}

beforeEach(async () => {
  const db = createNodeSqliteDb();
  await useSessionStore.getState().init({
    secrets: createMemorySecretStore(),
    openDb: async () => db,
    now: Date.now,
  });
  await useSessionStore.getState().setProfile('Alice');
  await useSessionStore
    .getState()
    .pair(encodePairingCode({ publicKey: bob.publicKey, secret: randomBytes(32) }), 'Bob');
  const fake = fakeTransport();
  deliver = fake.deliver;
  await useChatStore
    .getState()
    .start(useSessionStore.getState().session!, { transport: fake.transport, transfer: null });
});

afterEach(async () => {
  await useChatStore.getState().stop();
});

const routes = { _layout: () => <Stack />, chat: Chat, search: Search };

async function receive(text: string) {
  const id = newMessageId(Date.now());
  await fromBob({ t: 'msg', id, text, sentAt: Date.now() });
  await screen.findByLabelText(new RegExp(`^Bob: ${text}`));
  return id;
}

it('sends a message and shows it with a sent tick', async () => {
  await renderRouter(routes, { initialUrl: '/chat' });
  await fireEvent.changeText(screen.getByLabelText('Message'), 'Hello Bob');
  await fireEvent.press(screen.getByLabelText('Send'));
  expect(await screen.findByLabelText(/^You: Hello Bob\..*, Sent$/)).toBeTruthy();
});

it('replies to a message from the long-press menu, and the bubble shows the quote', async () => {
  await renderRouter(routes, { initialUrl: '/chat' });
  await receive('Dinner tonight?');

  await fireEvent(screen.getByLabelText(/^Bob: Dinner tonight\?/), 'longPress');
  await fireEvent.press(await screen.findByText('Reply'));
  expect(await screen.findByText('Replying to Bob')).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText('Message'), 'Sure!');
  await fireEvent.press(screen.getByLabelText('Send'));
  expect(await screen.findByLabelText('Reply to Bob')).toBeTruthy();
  expect(screen.queryByText('Replying to Bob')).toBeNull();
});

it('reacts, then edits and deletes its own message', async () => {
  await renderRouter(routes, { initialUrl: '/chat' });
  await receive('Got the tickets');

  await fireEvent(screen.getByLabelText(/^Bob: Got the tickets/), 'longPress');
  await fireEvent.press(await screen.findByLabelText('React ❤️'));
  expect(await screen.findByLabelText('Reactions: ❤️')).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText('Message'), 'Great, see you at 7');
  await fireEvent.press(screen.getByLabelText('Send'));
  const own = await screen.findByLabelText(/^You: Great, see you at 7/);

  await fireEvent(own, 'longPress');
  await fireEvent.press(await screen.findByText('Edit'));
  expect(await screen.findByText('Editing message')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Message'), 'Great, see you at 8');
  await fireEvent.press(screen.getByLabelText('Save edit'));
  expect(await screen.findByLabelText(/^You: Great, see you at 8\..*, edited/)).toBeTruthy();

  await fireEvent(screen.getByLabelText(/^You: Great, see you at 8/), 'longPress');
  await fireEvent.press(await screen.findByText('Delete for me'));
  await waitFor(() => expect(screen.queryByLabelText(/^You: Great/)).toBeNull());
});

it("shows Bob's deletion as a placeholder", async () => {
  await renderRouter(routes, { initialUrl: '/chat' });
  const id = await receive('wrong chat, sorry');
  await fromBob({ t: 'delete', items: [{ id, sentAt: Date.now() }] });
  expect(await screen.findByText(/This message was deleted/)).toBeTruthy();
});

it('finds a message in search', async () => {
  await renderRouter(routes, { initialUrl: '/chat' });
  await receive('The wifi password is pancake');

  await fireEvent.press(screen.getByLabelText('Search messages'));
  await waitFor(() => expect(screen).toHavePathname('/search'));
  await fireEvent.changeText(screen.getByLabelText('Search messages'), 'pancake');
  expect(await screen.findByText('pancake')).toBeTruthy();
});

it('shows an incoming document waiting for the sender, and a location pin', async () => {
  await renderRouter(routes, { initialUrl: '/chat' });
  const fileId = newMessageId(Date.now());
  await fromBob({
    t: 'msg',
    id: fileId,
    text: '',
    sentAt: Date.now(),
    file: {
      kind: 'file',
      name: 'contract.pdf',
      mime: 'application/pdf',
      size: 2_500_000,
      sha256: 'a'.repeat(64),
    },
  });
  expect(await screen.findByLabelText('Document contract.pdf, 2.4 MB')).toBeTruthy();
  expect(screen.getByText('Downloads when Bob opens the app')).toBeTruthy();

  // Attachments can be reacted to and replied to, but not edited.
  await fireEvent(screen.getByLabelText(/^Bob: 📄 contract\.pdf/), 'longPress');
  expect(await screen.findByText('Reply')).toBeTruthy();
  expect(screen.queryByText('Edit')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Close'));

  await fromBob({
    t: 'msg',
    id: newMessageId(Date.now()),
    text: '',
    sentAt: Date.now(),
    loc: { lat: 31.52, lng: 74.35 },
  });
  expect(await screen.findByLabelText('📍 Location')).toBeTruthy();
});
