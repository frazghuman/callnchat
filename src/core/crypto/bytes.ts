export {
  bytesToHex,
  concatBytes,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
} from '@noble/hashes/utils.js';

/** Lexicographic comparison, used to order two peers' values deterministically. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && compareBytes(a, b) === 0;
}

/** Returns [a, b] in a fixed order so both peers derive identical values. */
export function sortPair(a: Uint8Array, b: Uint8Array): [Uint8Array, Uint8Array] {
  return compareBytes(a, b) <= 0 ? [a, b] : [b, a];
}
