import * as nip44 from 'nostr-tools/nip44';
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  verifyEvent,
  type Event as NostrEvent,
} from 'nostr-tools/pure';

import { isEphemeral, parseFrame, type Frame } from '@/core/protocol/frames';

export type { NostrEvent };

export const KIND_RUMOR = 14;
export const KIND_SEAL = 13;
/** NIP-59 gift wrap: stored by relays (offline mailbox). */
export const KIND_WRAP = 1059;
/** Same wrap in the ephemeral range: relays forward it live and never store it. */
export const KIND_EPHEMERAL_WRAP = 21059;

const TWO_DAYS_S = 2 * 24 * 60 * 60;
const EXPIRY_S = 30 * 24 * 60 * 60;

type Rumor = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
};

export type OpenedEnvelope = {
  frame: Frame;
  /** Sender's clock, from the inner (unrandomized) rumor timestamp, in ms. */
  sentAt: number;
  eventId: string;
};

function encryptJson(value: unknown, sk: Uint8Array, peerPubHex: string): string {
  return nip44.encrypt(JSON.stringify(value), nip44.getConversationKey(sk, peerPubHex));
}

function decryptJson(payload: string, sk: Uint8Array, senderPubHex: string): unknown {
  return JSON.parse(nip44.decrypt(payload, nip44.getConversationKey(sk, senderPubHex)));
}

/**
 * Rumor (frame) → seal signed by our identity → wrap signed by a one-time key.
 * Durable wraps are backdated randomly up to two days (NIP-59) and expire after 30 days.
 */
export function sealFrame(
  frame: Frame,
  sk: Uint8Array,
  peerPubHex: string,
  nowMs: number,
): NostrEvent {
  const now = Math.floor(nowMs / 1000);
  const ephemeral = isEphemeral(frame);
  const blurred = () => (ephemeral ? now : now - Math.floor(Math.random() * TWO_DAYS_S));

  const rumor: Omit<Rumor, 'id'> & { id?: string } = {
    kind: KIND_RUMOR,
    created_at: now,
    content: JSON.stringify(frame),
    tags: [['p', peerPubHex]],
    pubkey: getPublicKey(sk),
  };
  rumor.id = getEventHash(rumor);

  const seal = finalizeEvent(
    {
      kind: KIND_SEAL,
      created_at: blurred(),
      tags: [],
      content: encryptJson(rumor, sk, peerPubHex),
    },
    sk,
  );

  const wrapKey = generateSecretKey();
  const tags = [['p', peerPubHex]];
  if (!ephemeral) tags.push(['expiration', String(now + EXPIRY_S)]);
  return finalizeEvent(
    {
      kind: ephemeral ? KIND_EPHEMERAL_WRAP : KIND_WRAP,
      created_at: blurred(),
      tags,
      content: encryptJson(seal, wrapKey, peerPubHex),
    },
    wrapKey,
  );
}

function isRumor(value: unknown): value is Rumor {
  const r = value as Rumor;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.id === 'string' &&
    typeof r.pubkey === 'string' &&
    typeof r.created_at === 'number' &&
    r.kind === KIND_RUMOR &&
    Array.isArray(r.tags) &&
    typeof r.content === 'string'
  );
}

/**
 * Opens a wrap addressed to us. Returns null unless the seal is validly signed by the pinned peer,
 * the rumor claims the same author, and the payload is a well-formed frame of the right durability.
 */
export function openEnvelope(
  event: NostrEvent,
  sk: Uint8Array,
  pinnedPeerHex: string,
): OpenedEnvelope | null {
  if (event.kind !== KIND_WRAP && event.kind !== KIND_EPHEMERAL_WRAP) return null;
  try {
    const seal = decryptJson(event.content, sk, event.pubkey) as NostrEvent;
    if (seal?.kind !== KIND_SEAL || seal.pubkey !== pinnedPeerHex || !verifyEvent(seal)) {
      return null;
    }

    const rumor = decryptJson(seal.content, sk, seal.pubkey);
    if (!isRumor(rumor) || rumor.pubkey !== seal.pubkey) return null;
    const { id, ...unsigned } = rumor;
    if (getEventHash(unsigned) !== id) return null;

    const frame = parseFrame(JSON.parse(rumor.content));
    if (!frame || isEphemeral(frame) !== (event.kind === KIND_EPHEMERAL_WRAP)) return null;

    return { frame, sentAt: rumor.created_at * 1000, eventId: event.id };
  } catch {
    return null;
  }
}
