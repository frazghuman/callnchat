/**
 * @jest-environment node
 */
// Not a React hook, despite the name.
import {
  SimplePool,
  useWebSocketImplementation as setWebSocketImplementation,
} from 'nostr-tools/pool';
import WebSocket from 'ws';

import { bytesToHex } from '@/core/crypto/bytes';
import { sealFrame } from '@/core/nostr/envelope';
import type { Frame } from '@/core/protocol/frames';
import { newMessageId } from '@/core/protocol/ids';
import { searchMessages } from '@/data/messages';
import type { Session } from '@/features/session/session';

import { startLocalRelay, type LocalRelay } from '../../../../test/localRelay';
import { createPhone, createSessions, waitFor, type Phone } from '../../../../test/phones';
import { MessageActionError } from '../messenger';

setWebSocketImplementation(WebSocket);
jest.setTimeout(20_000);

let relay: LocalRelay;
const running: Phone[] = [];

async function pair(options: { now?: () => number } = {}) {
  const [aliceSession, bobSession] = await createSessions();
  const alice = createPhone(aliceSession, [relay.url], options);
  const bob = createPhone(bobSession, [relay.url], options);
  await alice.messenger.start();
  await bob.messenger.start();
  running.push(alice, bob);
  await waitFor(() => alice.confirmedAt !== null && bob.confirmedAt !== null);
  return { alice, bob, aliceSession, bobSession };
}

/** Publishes frames as if Alice sent them, in exactly the given order. */
async function publishAsAlice(alice: Session, frames: Frame[], now: number) {
  const pool = new SimplePool();
  for (const frame of frames) {
    await Promise.allSettled(
      pool.publish(
        [relay.url],
        sealFrame(frame, alice.identity.secretKey, alice.peer!.publicKey, now),
      ),
    );
  }
  pool.destroy();
}

beforeEach(async () => {
  relay = await startLocalRelay();
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((p) => p.messenger.stop()));
  await relay.stop();
});

it('shows replies with a quote on the other phone', async () => {
  const { alice, bob } = await pair();
  const question = await alice.messenger.send('Lunch at 1?');
  await waitFor(async () => !!(await bob.message(question.id)));

  const answer = await bob.messenger.send('Yes 👍', question.id);
  await waitFor(async () => !!(await alice.message(answer.id)));
  expect((await alice.message(answer.id))?.reply).toEqual({
    id: question.id,
    direction: 'out',
    body: 'Lunch at 1?',
    deleted: false,
  });
});

it('adds, changes and removes reactions on both phones', async () => {
  const { alice, bob } = await pair();
  const m = await alice.messenger.send('Big news');
  await waitFor(async () => !!(await bob.message(m.id)));

  await bob.messenger.react(m.id, '❤️');
  await waitFor(async () => (await alice.message(m.id))?.reactions.peer === '❤️');
  expect((await bob.message(m.id))?.reactions).toEqual({ me: '❤️', peer: null });

  await bob.messenger.react(m.id, '😂');
  await waitFor(async () => (await alice.message(m.id))?.reactions.peer === '😂');

  await bob.messenger.react(m.id, null);
  await waitFor(async () => (await alice.message(m.id))?.reactions.peer === null);
});

it('edits within the window and refuses edits of others or after 15 minutes', async () => {
  let clock = Date.now();
  const { alice, bob } = await pair({ now: () => clock });
  const m = await alice.messenger.send('See you at 7');
  await waitFor(async () => !!(await bob.message(m.id)));

  await alice.messenger.edit(m.id, 'See you at 8');
  await waitFor(async () => (await bob.message(m.id))?.body === 'See you at 8');
  expect((await bob.message(m.id))?.editedAt).not.toBeNull();

  await expect(bob.messenger.edit(m.id, 'hacked')).rejects.toThrow(MessageActionError);
  clock += 16 * 60 * 1000;
  await expect(alice.messenger.edit(m.id, 'too late')).rejects.toThrow(MessageActionError);
});

it('deletes for everyone, leaving a tombstone on both phones', async () => {
  const { alice, bob } = await pair();
  const m = await alice.messenger.send('oops, wrong chat');
  await waitFor(async () => !!(await bob.message(m.id)));
  await bob.messenger.react(m.id, '😮');

  await alice.messenger.deleteForEveryone([m.id]);
  await waitFor(async () => (await bob.message(m.id))?.deletedAt != null);
  for (const phone of [alice, bob]) {
    const row = await phone.message(m.id);
    expect(row).toMatchObject({ body: '', reactions: { me: null, peer: null } });
    expect(row?.deletedAt).not.toBeNull();
  }

  await bob.messenger.deleteForMe([m.id]);
  expect(await bob.message(m.id)).toBeUndefined();
});

it('ends in the right state when edits and deletes arrive before their messages', async () => {
  const [aliceSession, bobSession] = await createSessions();
  const now = Date.now();
  const edited = newMessageId(now);
  const deleted = newMessageId(now + 1);

  // Relay replays in this order: the edit and delete come before the originals.
  await publishAsAlice(
    aliceSession,
    [
      { t: 'edit', id: edited, text: 'final text', sentAt: now, editedAt: now + 5_000 },
      { t: 'delete', items: [{ id: deleted, sentAt: now + 1 }] },
      { t: 'msg', id: edited, text: 'first text', sentAt: now, replyTo: deleted },
      { t: 'msg', id: deleted, text: 'secret', sentAt: now + 1 },
    ],
    now,
  );

  const bob = createPhone(bobSession, [relay.url]);
  running.push(bob);
  await bob.messenger.start();
  await waitFor(async () => (await bob.messages()).length === 2);

  const editedRow = await bob.message(edited);
  expect(editedRow).toMatchObject({ body: 'final text', replyTo: deleted });
  expect(editedRow?.reply?.deleted).toBe(true);
  const deletedRow = await bob.message(deleted);
  expect(deletedRow?.body).toBe('');
  expect(deletedRow?.deletedAt).not.toBeNull();
  expect(await searchMessages(bobSession.db, 'secret')).toHaveLength(0);
});

it('applies the disappearing timer on both phones and purges expired messages', async () => {
  let clock = Date.now();
  const { alice, bob } = await pair({ now: () => clock });

  await alice.messenger.setDisappearing(86_400);
  await waitFor(() => bob.disappear === 86_400);
  const notices = (await bob.messages()).filter((m) => m.kind === 'system');
  expect(JSON.parse(notices[0]!.body)).toEqual({ type: 'timer', seconds: 86_400, by: 'peer' });

  const m = await bob.messenger.send('this will vanish');
  await waitFor(async () => !!(await alice.message(m.id)));
  expect((await alice.message(m.id))?.expiresAt).toBe(m.sentAt + 86_400_000);

  clock += 86_400_000 + 1_000;
  await waitFor(async () => !(await alice.message(m.id)) && !(await bob.message(m.id)));
});

it('delivers reactions queued while the relay was down', async () => {
  const { alice, bob } = await pair();
  const m = await alice.messenger.send('ping');
  await waitFor(async () => !!(await bob.message(m.id)));

  const { port, store } = relay;
  await relay.stop();
  await bob.messenger.react(m.id, '🙏');
  relay = await startLocalRelay({ port, store });

  await waitFor(async () => (await alice.message(m.id))?.reactions.peer === '🙏', 15_000);
});

it('finds messages by text, ignoring LIKE wildcards in the query', async () => {
  const { alice, aliceSession } = await pair();
  await alice.messenger.send('100% sure');
  await alice.messenger.send('1000 sheep');
  expect((await searchMessages(aliceSession.db, '100%')).map((m) => m.body)).toEqual(['100% sure']);
  expect(await searchMessages(aliceSession.db, 'SHEEP')).toHaveLength(1);
  expect(bytesToHex(aliceSession.identity.publicKey)).toHaveLength(64);
});
