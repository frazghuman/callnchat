export const SecretKeys = {
  identity: 'identity.secretKey',
  pairingSecret: 'pairing.secret',
  dbKey: 'db.key',
} as const;

export type SecretKey = (typeof SecretKeys)[keyof typeof SecretKeys];

/** Hex-encoded secrets kept outside the database (Keychain on iOS). */
export interface SecretStore {
  get(key: SecretKey): Promise<string | null>;
  set(key: SecretKey, value: string): Promise<void>;
  remove(key: SecretKey): Promise<void>;
}

export function createMemorySecretStore(): SecretStore {
  const values = new Map<SecretKey, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}
