import { bytesToHex, randomBytes } from '@/core/crypto/bytes';

/** 16-byte id: 48-bit millisecond timestamp + 80 random bits, hex. Sorts by creation time. */
export function newMessageId(nowMs: number): string {
  const bytes = new Uint8Array(16);
  let t = Math.floor(nowMs);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }
  bytes.set(randomBytes(10), 6);
  return bytesToHex(bytes);
}
