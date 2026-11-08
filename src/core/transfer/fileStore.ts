/**
 * Attachment bytes on disk, one folder per message id holding the file under its original name
 * (viewers need the extension). Partial files grow by `append` while a transfer is in progress.
 */
export interface FileStore {
  /** Bytes currently stored (0 if nothing yet). */
  size(id: string, name: string): Promise<number>;
  read(id: string, name: string, offset: number, length: number): Promise<Uint8Array>;
  append(id: string, name: string, bytes: Uint8Array): Promise<void>;
  /** Lowercase hex SHA-256 of the stored bytes. */
  sha256(id: string, name: string): Promise<string>;
  /** Deletes everything stored for the message. */
  remove(id: string): Promise<void>;
  uri(id: string, name: string): string;
}

/** Keeps a peer-chosen name from escaping the message's folder or hiding as a dotfile. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\:\0]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'file';
}
