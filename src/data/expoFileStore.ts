import { Directory, File, Paths } from 'expo-file-system';

import { safeFileName, type FileStore } from '@/core/transfer/fileStore';

const ROOT = 'attachments';

function folder(id: string): Directory {
  return new Directory(Paths.document, ROOT, id);
}

function file(id: string, name: string): File {
  return new File(folder(id), safeFileName(name));
}

/** Attachments in the app's Documents folder (iOS Data Protection encrypts them at rest). */
export const expoFileStore: FileStore & {
  /** Copies a picked or recorded file in, so it survives the picker's temp folder being cleared. */
  importFile(id: string, name: string, sourceUri: string): Promise<void>;
} = {
  async size(id, name) {
    const f = file(id, name);
    return f.exists ? f.size : 0;
  },

  async read(id, name, offset, length) {
    const handle = file(id, name).open();
    try {
      handle.offset = offset;
      return await handle.readBytes(length);
    } finally {
      handle.close();
    }
  },

  async append(id, name, bytes) {
    const f = file(id, name);
    if (!f.exists) {
      folder(id).create({ intermediates: true, idempotent: true });
      f.create();
    }
    const handle = f.open();
    try {
      handle.offset = handle.size ?? 0;
      await handle.writeBytes(bytes);
    } finally {
      handle.close();
    }
  },

  async sha256(id, name) {
    return (await file(id, name).digest('SHA-256')).toLowerCase();
  },

  async remove(id) {
    const dir = folder(id);
    if (dir.exists) dir.delete();
  },

  uri: (id, name) => file(id, name).uri,

  async importFile(id, name, sourceUri) {
    folder(id).create({ intermediates: true, idempotent: true });
    const target = file(id, name);
    if (target.exists) target.delete();
    await new File(sourceUri).copy(target);
  },
};
