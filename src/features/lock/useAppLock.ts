import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useSessionStore } from '@/features/session/sessionStore';

/** Locks the app whenever it goes to the background, if app lock is enabled. */
export function useAppLock() {
  const lock = useSessionStore((s) => s.lock);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') lock();
    });
    return () => sub.remove();
  }, [lock]);
}
