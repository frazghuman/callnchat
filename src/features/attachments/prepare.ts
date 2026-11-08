import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { MAX_FILE_SIZE, type Attachment } from '@/core/protocol/frames';
import { newMessageId } from '@/core/protocol/ids';
import { expoFileStore } from '@/data/expoFileStore';

export type PreparedAttachment = { id: string; attachment: Attachment };

export class FileTooLargeError extends Error {
  constructor() {
    super(`Files up to ${MAX_FILE_SIZE / 1024 / 1024} MB can be sent.`);
    this.name = 'FileTooLargeError';
  }
}

/** Longest side of a sent photo unless "original" is chosen; ~300 KB JPEGs. */
const PHOTO_MAX_SIDE = 1600;
/** Thumbnail that travels inside the message so the bubble shows something immediately. */
const THUMB_WIDTH = 48;

async function tinyThumbnail(uri: string): Promise<string | undefined> {
  try {
    const image = await ImageManipulator.manipulate(uri)
      .resize({ width: THUMB_WIDTH })
      .renderAsync();
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.4, base64: true });
    return result.base64 && result.base64.length <= 16_000 ? result.base64 : undefined;
  } catch {
    return undefined;
  }
}

/** Copies the file into the store, then hashes it there so the hash matches what is sent. */
async function finish(
  sourceUri: string,
  meta: Omit<Attachment, 'size' | 'sha256'>,
): Promise<PreparedAttachment> {
  const id = newMessageId(Date.now());
  await expoFileStore.importFile(id, meta.name, sourceUri);
  const size = await expoFileStore.size(id, meta.name);
  if (size > MAX_FILE_SIZE) {
    await expoFileStore.remove(id);
    throw new FileTooLargeError();
  }
  if (size === 0) {
    await expoFileStore.remove(id);
    throw new Error('The file is empty or could not be read.');
  }
  return { id, attachment: { ...meta, size, sha256: await expoFileStore.sha256(id, meta.name) } };
}

export async function preparePhoto(
  asset: { uri: string; width: number; height: number; fileName?: string | null },
  original = false,
): Promise<PreparedAttachment> {
  let { uri, width, height } = asset;
  let name = asset.fileName ?? 'photo.jpg';
  if (!original && Math.max(width, height) > PHOTO_MAX_SIDE) {
    const scale = PHOTO_MAX_SIDE / Math.max(width, height);
    const image = await ImageManipulator.manipulate(uri)
      .resize({ width: Math.round(width * scale) })
      .renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    ({ uri, width, height } = saved);
    name = name.replace(/\.[^.]+$/, '') + '.jpg';
  }
  return finish(uri, {
    kind: 'image',
    name,
    mime: name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
    width,
    height,
    thumb: await tinyThumbnail(uri),
  });
}

export async function prepareVideo(asset: {
  uri: string;
  width: number;
  height: number;
  fileName?: string | null;
  mimeType?: string;
  duration?: number | null;
}): Promise<PreparedAttachment> {
  return finish(asset.uri, {
    kind: 'video',
    name: asset.fileName ?? 'video.mov',
    mime: asset.mimeType ?? 'video/quicktime',
    width: asset.width || undefined,
    height: asset.height || undefined,
    duration: asset.duration ? Math.round(asset.duration) : undefined,
  });
}

export async function prepareDocument(asset: {
  uri: string;
  name: string;
  mimeType?: string;
}): Promise<PreparedAttachment> {
  return finish(asset.uri, {
    kind: 'file',
    name: asset.name,
    mime: asset.mimeType || 'application/octet-stream',
  });
}

export async function prepareVoiceNote(
  uri: string,
  durationMs: number,
): Promise<PreparedAttachment> {
  return finish(uri, {
    kind: 'audio',
    name: 'voice-note.m4a',
    mime: 'audio/mp4',
    duration: Math.round(durationMs),
  });
}
