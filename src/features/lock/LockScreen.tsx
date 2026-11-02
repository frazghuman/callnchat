import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessionStore } from '@/features/session/sessionStore';
import { Button } from '@/ui/Button';
import { useTheme } from '@/ui/theme';

import { authenticate, type BiometricResult } from './biometrics';

export function LockScreen() {
  const { colors, font } = useTheme();
  const insets = useSafeAreaInsets();
  const unlock = useSessionStore((s) => s.unlock);
  const [message, setMessage] = useState<string | null>(null);

  const handle = useCallback(
    (result: BiometricResult) => {
      // 'unavailable': Face ID and passcode were removed, so don't lock the owner out.
      if (result === 'cancelled') setMessage('Locked');
      else unlock();
    },
    [unlock],
  );

  const tryUnlock = () => authenticate('Unlock CallNChat').then(handle);

  // Prompt once as soon as the lock screen appears.
  useEffect(() => {
    let active = true;
    authenticate('Unlock CallNChat').then((result) => {
      if (active) handle(result);
    });
    return () => {
      active = false;
    };
  }, [handle]);

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.container,
        { backgroundColor: colors.header, paddingBottom: insets.bottom },
      ]}
    >
      <Text style={[styles.title, { color: colors.headerText, fontSize: font.title }]}>
        🔒 CallNChat
      </Text>
      {message ? <Text style={{ color: colors.headerText }}>{message}</Text> : null}
      <View style={styles.button}>
        <Button title="Unlock" onPress={tryUnlock} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 10 },
  title: { fontWeight: '700' },
  button: { width: 200 },
});
