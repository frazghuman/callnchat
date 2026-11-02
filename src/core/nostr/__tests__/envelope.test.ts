import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';

import { bytesToHex } from '@/core/crypto/bytes';
import { helloProof, verifyHelloProof } from '@/core/messaging/helloProof';
import { newMessageId } from '@/core/protocol/ids';
import { parseFrame, type Frame } from '@/core/protocol/frames';

import { KIND_EPHEMERAL_WRAP, KIND_WRAP, openEnvelope, sealFrame } from '../envelope';

const NOW = 1_800_000_000_000;

function party() {
  const sk = generateSecretKey();
  return { sk, pub: getPublicKey(sk) };
}

const msg = (): Frame => ({ t: 'msg', id: newMessageId(NOW), text: 'hi 👋', sentAt: NOW });

describe('envelope', () => {
  const alice = party();
  const bob = party();

  it('round-trips a durable frame as an expiring, backdated gift wrap', () => {
    const frame = msg();
    const wrap = sealFrame(frame, alice.sk, bob.pub, NOW);

    expect(wrap.kind).toBe(KIND_WRAP);
    expect(wrap.pubkey).not.toBe(alice.pub);
    expect(wrap.tags).toContainEqual(['p', bob.pub]);
    expect(wrap.tags.find((t) => t[0] === 'expiration')).toBeTruthy();
    expect(wrap.created_at).toBeLessThanOrEqual(NOW / 1000);
    expect(wrap.created_at).toBeGreaterThanOrEqual(NOW / 1000 - 2 * 24 * 3600);

    const opened = openEnvelope(wrap, bob.sk, alice.pub);
    expect(opened?.frame).toEqual(frame);
    expect(opened?.sentAt).toBe(NOW);
    expect(opened?.eventId).toBe(wrap.id);
  });

  it('sends presence and typing as ephemeral wraps without expiration', () => {
    const wrap = sealFrame({ t: 'typing' }, alice.sk, bob.pub, NOW);
    expect(wrap.kind).toBe(KIND_EPHEMERAL_WRAP);
    expect(wrap.created_at).toBe(NOW / 1000);
    expect(wrap.tags.some((t) => t[0] === 'expiration')).toBe(false);
    expect(openEnvelope(wrap, bob.sk, alice.pub)?.frame).toEqual({ t: 'typing' });
  });

  it('rejects wraps from anyone but the pinned peer', () => {
    const mallory = party();
    const wrap = sealFrame(msg(), mallory.sk, bob.pub, NOW);
    expect(openEnvelope(wrap, bob.sk, alice.pub)).toBeNull();
  });

  it('rejects wraps addressed to someone else', () => {
    const carol = party();
    const wrap = sealFrame(msg(), alice.sk, carol.pub, NOW);
    expect(openEnvelope(wrap, bob.sk, alice.pub)).toBeNull();
  });

  it('rejects a seal whose rumor claims a different author', () => {
    const mallory = party();
    // Mallory seals (validly, with her own key) a rumor claiming to be from Alice.
    const rumor = {
      kind: 14,
      created_at: NOW / 1000,
      content: JSON.stringify(msg()),
      tags: [],
      pubkey: alice.pub,
      id: '0'.repeat(64),
    };
    const seal = finalizeEvent(
      {
        kind: 13,
        created_at: NOW / 1000,
        tags: [],
        content: nip44.encrypt(
          JSON.stringify(rumor),
          nip44.getConversationKey(mallory.sk, bob.pub),
        ),
      },
      mallory.sk,
    );
    const wrapKey = generateSecretKey();
    const wrap = finalizeEvent(
      {
        kind: KIND_WRAP,
        created_at: NOW / 1000,
        tags: [['p', bob.pub]],
        content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(wrapKey, bob.pub)),
      },
      wrapKey,
    );
    expect(openEnvelope(wrap, bob.sk, alice.pub)).toBeNull();
    expect(openEnvelope(wrap, bob.sk, mallory.pub)).toBeNull();
  });

  it('rejects a tampered wrap and a durable frame sent as ephemeral', () => {
    const wrap = sealFrame(msg(), alice.sk, bob.pub, NOW);
    expect(
      openEnvelope({ ...wrap, content: wrap.content.slice(0, -4) + 'AAAA' }, bob.sk, alice.pub),
    ).toBeNull();
    expect(openEnvelope({ ...wrap, kind: KIND_EPHEMERAL_WRAP }, bob.sk, alice.pub)).toBeNull();
  });
});

describe('frames', () => {
  it('accepts valid frames and rejects malformed ones', () => {
    expect(parseFrame({ t: 'presence', state: 'online' })).toEqual({
      t: 'presence',
      state: 'online',
    });
    expect(parseFrame({ t: 'msg', id: 'nothex', text: 'x', sentAt: 1 })).toBeNull();
    expect(parseFrame({ t: 'msg', id: newMessageId(NOW), text: '', sentAt: 1 })).toBeNull();
    expect(parseFrame({ t: 'nope' })).toBeNull();
    expect(parseFrame('msg')).toBeNull();
  });

  it('orders ids by creation time', () => {
    const a = newMessageId(NOW);
    const b = newMessageId(NOW + 1);
    expect(a < b).toBe(true);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('hello proof', () => {
  it('verifies only with the same pair secret and sender', () => {
    const secret = bytesToHex(generateSecretKey());
    const sender = getPublicKey(generateSecretKey());
    const proof = helloProof(secret, sender);
    expect(verifyHelloProof(secret, sender, proof)).toBe(true);
    expect(verifyHelloProof(bytesToHex(generateSecretKey()), sender, proof)).toBe(false);
    expect(verifyHelloProof(secret, getPublicKey(generateSecretKey()), proof)).toBe(false);
  });
});
