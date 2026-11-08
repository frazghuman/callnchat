import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { appendFile, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { safeFileName, type FileStore } from '@/core/transfer/fileStore';

/** FileStore on the local disk, in a fresh temp folder per simulated phone. */
export function createNodeFileStore(): FileStore & {
  dir: string;
  bytes(id: string, name: string): Promise<Buffer>;
} {
  const dir = mkdtempSync(join(tmpdir(), 'callnchat-files-'));
  const path = (id: string, name: string) => join(dir, id, safeFileName(name));

  return {
    dir,
    async size(id, name) {
      try {
        return (await stat(path(id, name))).size;
      } catch {
        return 0;
      }
    },
    async read(id, name, offset, length) {
      const handle = await open(path(id, name), 'r');
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return new Uint8Array(buffer.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
    },
    async append(id, name, bytes) {
      await mkdir(join(dir, id), { recursive: true });
      await appendFile(path(id, name), bytes);
    },
    async sha256(id, name) {
      return createHash('sha256')
        .update(await readFile(path(id, name)))
        .digest('hex');
    },
    async remove(id) {
      await rm(join(dir, id), { recursive: true, force: true });
    },
    uri: (id, name) => `file://${path(id, name)}`,
    bytes: (id, name) => readFile(path(id, name)),
  };
}
