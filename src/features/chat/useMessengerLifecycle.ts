import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useSessionStore } from '@/features/session/sessionStore';

import { useChatStore } from './chatStore';

/**
 * Runs the messenger while paired and in the foreground. iOS suspends the app in the background,
 * so we say "offline" and disconnect instead of letting sockets die silently.
 */
export function useMessengerLifecycle() {
  const session = useSessionStore((s) => (s.status === 'paired' ? s.session : null));
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!session || !active) return;
    void useChatStore.getState().start(session);
    return () => {
      void useChatStore.getState().stop();
    };
  }, [session, active]);
}
