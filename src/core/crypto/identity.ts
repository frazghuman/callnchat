import { schnorr } from '@noble/curves/secp256k1.js';

export type Identity = {
  secretKey: Uint8Array;
  /** 32-byte x-only secp256k1 public key (Nostr-compatible). */
  publicKey: Uint8Array;
};

export function generateIdentity(): Identity {
  const secretKey = schnorr.utils.randomSecretKey();
  return { secretKey, publicKey: schnorr.getPublicKey(secretKey) };
}

/** Throws if the secret key is not a valid secp256k1 scalar. */
export function identityFromSecretKey(secretKey: Uint8Array): Identity {
  return { secretKey, publicKey: schnorr.getPublicKey(secretKey) };
}

export function isValidPublicKey(publicKey: Uint8Array): boolean {
  if (publicKey.length !== 32) return false;
  try {
    schnorr.utils.lift_x(bytesToBigInt(publicKey));
    return true;
  } catch {
    return false;
  }
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}
