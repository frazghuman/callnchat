import { bytesToHex, hexToBytes } from '@/core/crypto/bytes';

/** 16-byte message id + 8-byte offset. */
export const CHUNK_HEADER = 24;
/** Header + payload stays at 16 KiB, the largest message every WebRTC stack delivers whole. */
export const CHUNK_PAYLOAD = 16 * 1024 - CHUNK_HEADER;

export type Chunk = { id: string; offset: number; payload: Uint8Array };

export function encodeChunk({ id, offset, payload }: Chunk): Uint8Array {
  const out = new Uint8Array(CHUNK_HEADER + payload.length);
  out.set(hexToBytes(id), 0);
  const view = new DataView(out.buffer);
  view.setUint32(16, Math.floor(offset / 2 ** 32));
  view.setUint32(20, offset >>> 0);
  out.set(payload, CHUNK_HEADER);
  return out;
}

export function decodeChunk(data: ArrayBuffer | Uint8Array): Chunk | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < CHUNK_HEADER) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    id: bytesToHex(bytes.subarray(0, 16)),
    offset: view.getUint32(16) * 2 ** 32 + view.getUint32(20),
    payload: bytes.subarray(CHUNK_HEADER),
  };
}

/** JSON control messages on the file channel. */
export type ControlMessage =
  /** Receiver asks for a file starting at `offset` (resume). */
  | { t: 'get'; id: string; offset: number }
  /** Receiver has the whole file and its hash matched. */
  | { t: 'have'; id: string }
  /** Sender no longer has the file (deleted on its side). */
  | { t: 'missing'; id: string };

export function parseControl(text: string): ControlMessage | null {
  try {
    const m = JSON.parse(text) as ControlMessage;
    if (typeof m?.id !== 'string' || !/^[0-9a-f]{32}$/.test(m.id)) return null;
    if (m.t === 'get') {
      return Number.isSafeInteger(m.offset) && m.offset >= 0 ? m : null;
    }
    return m.t === 'have' || m.t === 'missing' ? m : null;
  } catch {
    return null;
  }
}
