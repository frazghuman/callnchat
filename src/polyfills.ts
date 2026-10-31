import { getRandomValues } from 'expo-crypto';

// Hermes has no Web Crypto; noble reads globalThis.crypto.getRandomValues at call time.
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    value: { ...globalThis.crypto, getRandomValues },
    configurable: true,
  });
}
