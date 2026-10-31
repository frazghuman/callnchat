import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { concatBytes, sortPair, utf8ToBytes } from './bytes';
import type { PairingCode } from './pairingCode';

const INFO = utf8ToBytes('callnchat/pair/v1');

/**
 * Shared 32-byte secret for the pair. Both sides compute the same value from the two exchanged
 * codes, regardless of which one is "own", so no handshake message is needed offline.
 */
export function derivePairSecret(own: PairingCode, peer: PairingCode): Uint8Array {
  const [keyA, keyB] = sortPair(own.publicKey, peer.publicKey);
  const [secretA, secretB] = sortPair(own.secret, peer.secret);
  return hkdf(sha256, concatBytes(secretA, secretB), concatBytes(keyA, keyB), INFO, 32);
}
