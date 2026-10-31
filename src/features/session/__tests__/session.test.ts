import { generateIdentity } from '@/core/crypto/identity';
import { encodePairingCode, PairingCodeError } from '@/core/crypto/pairingCode';
import { randomBytes } from '@/core/crypto/bytes';
import type { Db } from '@/data/db';
import { migrate, SCHEMA_VERSION } from '@/data/migrations';
import { createMemorySecretStore } from '@/data/secretStore';

import { createNodeSqliteDb } from '../../../../test/nodeSqliteDb';
import {
  addPeer,
  loadSession,
  PairingError,
  resetAll,
  setAppLock,
  updateProfile,
  verifyPeer,
  type SessionServices,
} from '../session';

/** One simulated phone: a keychain plus a database that survives "app restarts". */
function createDevice() {
  const secrets = createMemorySecretStore();
  let db: Db | null = null;
  const services: SessionServices = {
    secrets,
    now: () => 1_700_000_000_000,
    openDb: async () => {
      db ??= createNodeSqliteDb();
      const current = db;
      return { ...current, destroy: async () => ((db = null), current.destroy()) };
    },
  };
  return services;
}

describe('migrations', () => {
  it('upgrades to the latest schema and is idempotent', async () => {
    const db = createNodeSqliteDb();
    await migrate(db);
    await migrate(db);
    expect(await db.get('PRAGMA user_version')).toEqual({ user_version: SCHEMA_VERSION });
  });
});

describe('session', () => {
  it('keeps identity and own code across restarts', async () => {
    const device = createDevice();
    const first = await loadSession(device);
    const second = await loadSession(device);
    expect(second.ownCodeText).toBe(first.ownCodeText);
    expect(first.profile).toBeNull();
    expect(first.peer).toBeNull();
  });

  it('pairs two devices that exchange codes, with the same pair secret on both', async () => {
    const alice = createDevice();
    const bob = createDevice();
    let a = await updateProfile(await loadSession(alice), 'Alice');
    let b = await updateProfile(await loadSession(bob), 'Bob');

    a = await addPeer(a, alice, b.ownCodeText, 'Bob');
    b = await addPeer(b, bob, a.ownCodeText, 'Alice');

    expect(a.peer?.pairSecret).toBe(b.peer?.pairSecret);
    expect(a.peer?.verifiedAt).toBeNull();

    a = await verifyPeer(a, alice);
    const reloaded = await loadSession(alice);
    expect(reloaded.profile).toEqual({ displayName: 'Alice' });
    expect(reloaded.peer?.displayName).toBe('Bob');
    expect(reloaded.peer?.verifiedAt).toBe(1_700_000_000_000);
  });

  it('rejects own code, a second peer, empty names and bad codes', async () => {
    const device = createDevice();
    let s = await loadSession(device);
    const other = encodePairingCode({
      publicKey: generateIdentity().publicKey,
      secret: randomBytes(32),
    });

    await expect(addPeer(s, device, s.ownCodeText, 'Me')).rejects.toThrow(PairingError);
    await expect(addPeer(s, device, other, '   ')).rejects.toThrow(PairingError);
    await expect(addPeer(s, device, 'cnc1nope', 'X')).rejects.toThrow(PairingCodeError);

    s = await addPeer(s, device, other, 'Friend');
    const third = encodePairingCode({
      publicKey: generateIdentity().publicKey,
      secret: randomBytes(32),
    });
    await expect(addPeer(s, device, third, 'Another')).rejects.toThrow(PairingError);
  });

  it('persists the app lock setting', async () => {
    const device = createDevice();
    await setAppLock(await loadSession(device), true);
    expect((await loadSession(device)).appLockEnabled).toBe(true);
  });

  it('reset wipes keys and data so the device starts fresh', async () => {
    const device = createDevice();
    let s = await updateProfile(await loadSession(device), 'Alice');
    s = await addPeer(
      s,
      device,
      encodePairingCode({ publicKey: generateIdentity().publicKey, secret: randomBytes(32) }),
      'Bob',
    );
    const oldCode = s.ownCodeText;

    await resetAll(s, device);
    const fresh = await loadSession(device);
    expect(fresh.ownCodeText).not.toBe(oldCode);
    expect(fresh.profile).toBeNull();
    expect(fresh.peer).toBeNull();
  });
});
