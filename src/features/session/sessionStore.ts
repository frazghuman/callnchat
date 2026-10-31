import { create } from 'zustand';

import {
  addPeer,
  loadSession,
  resetAll,
  setAppLock,
  updateProfile,
  verifyPeer,
  type Session,
  type SessionServices,
} from './session';

export type SessionStatus = 'loading' | 'error' | 'needsProfile' | 'needsPairing' | 'paired';

type SessionState = {
  status: SessionStatus;
  session: Session | null;
  error: string | null;
  locked: boolean;
  /** Contact code being entered on the pairing screen; the QR scanner fills it too. */
  draftCode: string;

  init(services: SessionServices): Promise<void>;
  setProfile(name: string): Promise<void>;
  pair(code: string, name: string): Promise<void>;
  verify(): Promise<void>;
  setAppLock(enabled: boolean): Promise<void>;
  reset(): Promise<void>;
  lock(): void;
  unlock(): void;
  setDraftCode(code: string): void;
};

let services: SessionServices | null = null;

function statusOf(session: Session): SessionStatus {
  if (!session.profile) return 'needsProfile';
  if (!session.peer) return 'needsPairing';
  return 'paired';
}

export const useSessionStore = create<SessionState>((set, get) => {
  function requireSession(): { session: Session; services: SessionServices } {
    const { session } = get();
    if (!session || !services) throw new Error('Session not loaded');
    return { session, services };
  }

  function apply(session: Session) {
    set({ session, status: statusOf(session) });
  }

  return {
    status: 'loading',
    session: null,
    error: null,
    locked: false,
    draftCode: '',

    async init(next) {
      services = next;
      set({ status: 'loading', error: null });
      try {
        const session = await loadSession(next);
        set({ locked: session.appLockEnabled });
        apply(session);
      } catch (e) {
        set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    },

    async setProfile(name) {
      const { session } = requireSession();
      apply(await updateProfile(session, name));
    },

    async pair(code, name) {
      const { session, services: s } = requireSession();
      apply(await addPeer(session, s, code, name));
      set({ draftCode: '' });
    },

    async verify() {
      const { session, services: s } = requireSession();
      apply(await verifyPeer(session, s));
    },

    async setAppLock(enabled) {
      const { session } = requireSession();
      apply(await setAppLock(session, enabled));
    },

    async reset() {
      const { session, services: s } = requireSession();
      await resetAll(session, s);
      set({ session: null, locked: false, draftCode: '' });
      await get().init(s);
    },

    lock() {
      if (get().session?.appLockEnabled) set({ locked: true });
    },

    unlock() {
      set({ locked: false });
    },

    setDraftCode(code) {
      set({ draftCode: code });
    },
  };
});
