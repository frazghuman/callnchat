import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@/core/crypto/bytes';

const DOMAIN = utf8ToBytes('callnchat/hello/v1');

/** Proves the sender derived the same pair secret, i.e. both sides added each other's code. */
export function helloProof(pairSecretHex: string, senderPubHex: string): string {
  return bytesToHex(
    hmac(sha256, hexToBytes(pairSecretHex), concatBytes(DOMAIN, hexToBytes(senderPubHex))),
  );
}

export function verifyHelloProof(pairSecretHex: string, senderPubHex: string, proof: string) {
  const expected = helloProof(pairSecretHex, senderPubHex);
  if (expected.length !== proof.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ proof.charCodeAt(i);
  return diff === 0;
}
