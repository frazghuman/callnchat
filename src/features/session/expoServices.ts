import { openEncryptedDb } from '@/data/expoDb';
import { expoSecretStore } from '@/data/expoSecretStore';

import type { SessionServices } from './session';

export const expoSessionServices: SessionServices = {
  secrets: expoSecretStore,
  openDb: openEncryptedDb,
  now: () => Date.now(),
};
