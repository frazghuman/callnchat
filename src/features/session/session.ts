import { bytesToHex, equalBytes, hexToBytes, randomBytes } from '@/core/crypto/bytes';
import { generateIdentity, identityFromSecretKey, type Identity } from '@/core/crypto/identity';
import { decodePairingCode, encodePairingCode, type PairingCode } from '@/core/crypto/pairingCode';
import { derivePairSecret } from '@/core/crypto/pairSecret';
import type { Db } from '@/data/db';
import { migrate } from '@/data/migrations';
import {
  getPeer,
  getProfile,
  getSetting,
  insertPeer,
  markPeerVerified,
  saveProfile,
  setSetting,
  type Peer,
  type Profile,
} from '@/data/repositories';
import { SecretKeys, type SecretStore } from '@/data/secretStore';

export type SessionServices = {
  secrets: SecretStore;
  openDb: (key: Uint8Array) => Promise<Db>;
  now: () => number;
};

export type Session = {
  identity: Identity;
  /** This device's code, stable until reset, so a code shared earlier stays valid. */
  ownCode: PairingCode;
  ownCodeText: string;
  profile: Profile | null;
  peer: Peer | null;
  appLockEnabled: boolean;
  db: Db;
};

export class PairingError extends Error {
  constructor(readonly reason: 'own-code' | 'already-paired' | 'empty-name') {
    super(`Cannot pair: ${reason}`);
    this.name = 'PairingError';
  }
}

const APP_LOCK_SETTING = 'appLock';

async function loadOrCreateSecret(
  secrets: SecretStore,
  key: (typeof SecretKeys)[keyof typeof SecretKeys],
  create: () => Uint8Array,
): Promise<Uint8Array> {
  const stored = await secrets.get(key);
  if (stored) return hexToBytes(stored);
  const value = create();
  await secrets.set(key, bytesToHex(value));
  return value;
}

export async function loadSession(services: SessionServices): Promise<Session> {
  const { secrets } = services;
  const identity = identityFromSecretKey(
    await loadOrCreateSecret(secrets, SecretKeys.identity, () => generateIdentity().secretKey),
  );
  const pairingSecret = await loadOrCreateSecret(secrets, SecretKeys.pairingSecret, () =>
    randomBytes(32),
  );
  const dbKey = await loadOrCreateSecret(secrets, SecretKeys.dbKey, () => randomBytes(32));

  const db = await services.openDb(dbKey);
  await migrate(db);

  const ownCode = { publicKey: identity.publicKey, secret: pairingSecret };
  return {
    identity,
    ownCode,
    ownCodeText: encodePairingCode(ownCode),
    profile: await getProfile(db),
    peer: await getPeer(db),
    appLockEnabled: (await getSetting(db, APP_LOCK_SETTING)) === 'on',
    db,
  };
}

export async function updateProfile(session: Session, displayName: string): Promise<Session> {
  const name = displayName.trim();
  if (!name) throw new PairingError('empty-name');
  await saveProfile(session.db, { displayName: name });
  return { ...session, profile: { displayName: name } };
}

/** Adds the contact from their pairing code. Throws PairingCodeError or PairingError. */
export async function addPeer(
  session: Session,
  services: SessionServices,
  codeText: string,
  displayName: string,
): Promise<Session> {
  if (session.peer) throw new PairingError('already-paired');
  const name = displayName.trim();
  if (!name) throw new PairingError('empty-name');

  const peerCode = decodePairingCode(codeText);
  if (equalBytes(peerCode.publicKey, session.identity.publicKey)) {
    throw new PairingError('own-code');
  }

  const peer: Peer = {
    publicKey: bytesToHex(peerCode.publicKey),
    displayName: name,
    pairSecret: bytesToHex(derivePairSecret(session.ownCode, peerCode)),
    pairedAt: services.now(),
    verifiedAt: null,
  };
  await insertPeer(session.db, peer);
  return { ...session, peer };
}

export async function verifyPeer(session: Session, services: SessionServices): Promise<Session> {
  if (!session.peer) return session;
  const at = services.now();
  await markPeerVerified(session.db, at);
  return { ...session, peer: { ...session.peer, verifiedAt: at } };
}

export async function setAppLock(session: Session, enabled: boolean): Promise<Session> {
  await setSetting(session.db, APP_LOCK_SETTING, enabled ? 'on' : 'off');
  return { ...session, appLockEnabled: enabled };
}

/** Deletes the database and every key. The next loadSession starts as a fresh install. */
export async function resetAll(session: Session, services: SessionServices): Promise<void> {
  await session.db.destroy();
  for (const key of Object.values(SecretKeys)) await services.secrets.remove(key);
}
