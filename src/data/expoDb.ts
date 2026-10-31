import { deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';

import { bytesToHex } from '@/core/crypto/bytes';

import type { Db } from './db';

const DB_NAME = 'callnchat.db';

/** Opens the SQLCipher database (expo-sqlite built with useSQLCipher) with a raw 32-byte key. */
export async function openEncryptedDb(key: Uint8Array): Promise<Db> {
  if (key.length !== 32) throw new Error('Database key must be 32 bytes');
  const db = await openDatabaseAsync(DB_NAME);
  // Must be the first statement on the connection. Raw-key form skips SQLCipher's KDF.
  await db.execAsync(`PRAGMA key = "x'${bytesToHex(key)}'";`);
  // Fails here (not later) if the key is wrong or SQLCipher is missing.
  await db.getFirstAsync('SELECT count(*) FROM sqlite_master', []);
  await db.execAsync('PRAGMA foreign_keys = ON;');

  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => {
      await db.runAsync(sql, params);
    },
    get: (sql, params = []) => db.getFirstAsync(sql, params),
    all: (sql, params = []) => db.getAllAsync(sql, params),
    transaction: (task) => db.withTransactionAsync(task),
    destroy: async () => {
      await db.closeAsync();
      await deleteDatabaseAsync(DB_NAME);
    },
  };
}
