import { sha256 } from '@noble/hashes/sha2.js';

import { concatBytes, sortPair, utf8ToBytes } from './bytes';

// 64 visually distinct emoji: 6 bits each, so 6 emoji carry 36 bits.
// prettier-ignore
const EMOJI = [
  '🐶', '🐱', '🦁', '🐴', '🦄', '🐮', '🐷', '🐘',
  '🐰', '🐼', '🐔', '🐧', '🐢', '🐟', '🐙', '🦋',
  '🌷', '🌳', '🌵', '🍄', '🌍', '🌙', '⭐', '🔥',
  '🌈', '⛄', '💧', '🍎', '🍌', '🍇', '🍓', '🍒',
  '🥕', '🌽', '🍕', '🎂', '🍩', '☕', '🍦', '⚽',
  '🏀', '🎸', '🎺', '🎻', '🎲', '🎯', '🚗', '🚲',
  '🚀', '✈️', '⛵', '🏠', '⏰', '🔑', '🔨', '📎',
  '✂️', '📌', '🔔', '🎁', '🎈', '👓', '👑', '☂️',
] as const;

const DOMAIN = utf8ToBytes('callnchat/safety/v1');

export type SafetyCode = {
  emoji: string[];
  /** 12 digits in three groups of four, e.g. "0421 9935 1170". */
  digits: string;
};

/** Same result on both phones: the two keys are sorted before hashing. */
export function safetyCode(publicKeyA: Uint8Array, publicKeyB: Uint8Array): SafetyCode {
  const [first, second] = sortPair(publicKeyA, publicKeyB);
  const hash = sha256(concatBytes(DOMAIN, first, second));

  const emoji: string[] = [];
  let bits = 0;
  let acc = 0;
  for (let i = 0; emoji.length < 6; i++) {
    acc = (acc << 8) | hash[i]!;
    bits += 8;
    while (bits >= 6 && emoji.length < 6) {
      bits -= 6;
      emoji.push(EMOJI[(acc >> bits) & 63]!);
    }
  }

  // Bytes 16..20 (independent of the emoji bytes) → 40-bit number → 12 digits.
  let n = 0;
  for (let i = 16; i < 21; i++) n = n * 256 + hash[i]!;
  const raw = String(n % 1e12).padStart(12, '0');
  const digits = `${raw.slice(0, 4)} ${raw.slice(4, 8)} ${raw.slice(8)}`;

  return { emoji, digits };
}
