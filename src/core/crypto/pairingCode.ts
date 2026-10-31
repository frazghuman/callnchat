import { bech32m } from '@scure/base';

import { isValidPublicKey } from './identity';

const PREFIX = 'cnc';
const VERSION = 1;
const KEY_LENGTH = 32;
const SECRET_LENGTH = 32;
const PAYLOAD_LENGTH = 1 + KEY_LENGTH + SECRET_LENGTH;
// bech32m's default 90-char limit is too short for a 65-byte payload.
const MAX_LENGTH = 200;

export type PairingCode = {
  publicKey: Uint8Array;
  secret: Uint8Array;
};

export type PairingCodeErrorReason = 'malformed' | 'unsupported-version' | 'invalid-key';

export class PairingCodeError extends Error {
  constructor(readonly reason: PairingCodeErrorReason) {
    super(`Invalid pairing code: ${reason}`);
    this.name = 'PairingCodeError';
  }
}

export function encodePairingCode({ publicKey, secret }: PairingCode): string {
  if (publicKey.length !== KEY_LENGTH || secret.length !== SECRET_LENGTH) {
    throw new Error('Pairing code needs a 32-byte key and a 32-byte secret');
  }
  const payload = new Uint8Array(PAYLOAD_LENGTH);
  payload[0] = VERSION;
  payload.set(publicKey, 1);
  payload.set(secret, 1 + KEY_LENGTH);
  return bech32m.encode(PREFIX, bech32m.toWords(payload), MAX_LENGTH);
}

export function decodePairingCode(input: string): PairingCode {
  const text = input.trim().toLowerCase();
  let payload: Uint8Array;
  try {
    const { prefix, words } = bech32m.decode(text as `${string}1${string}`, MAX_LENGTH);
    if (prefix !== PREFIX) throw new PairingCodeError('malformed');
    payload = bech32m.fromWords(words);
  } catch (e) {
    if (e instanceof PairingCodeError) throw e;
    throw new PairingCodeError('malformed');
  }
  if (payload.length < 1) throw new PairingCodeError('malformed');
  if (payload[0] !== VERSION) throw new PairingCodeError('unsupported-version');
  if (payload.length !== PAYLOAD_LENGTH) throw new PairingCodeError('malformed');

  const publicKey = payload.slice(1, 1 + KEY_LENGTH);
  if (!isValidPublicKey(publicKey)) throw new PairingCodeError('invalid-key');
  return { publicKey, secret: payload.slice(1 + KEY_LENGTH) };
}
