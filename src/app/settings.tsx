import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useChatStore } from '@/features/chat/chatStore';
import { authenticate } from '@/features/lock/biometrics';
import { MyCodeCard } from '@/features/session/components/MyCodeCard';
import { useSessionStore } from '@/features/session/sessionStore';
import { Button } from '@/ui/Button';
import { useTheme } from '@/ui/theme';

export default function SettingsScreen() {
  const { colors, font, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const session = useSessionStore((s) => s.session);
  const setAppLock = useSessionStore((s) => s.setAppLock);
  const reset = useSessionStore((s) => s.reset);
  const [busy, setBusy] = useState(false);

  if (!session) return null;
  const rowStyle = [styles.row, { backgroundColor: colors.surface, borderRadius: radius.card }];

  async function toggleLock(enabled: boolean) {
    if (enabled) {
      const result = await authenticate('Turn on app lock');
      if (result === 'unavailable') {
        Alert.alert('Face ID unavailable', 'Set up Face ID or a passcode in iOS Settings first.');
        return;
      }
      if (result !== 'ok') return;
    }
    await setAppLock(enabled);
  }

  function confirmReset() {
    Alert.alert(
      'Unpair and erase everything?',
      'This deletes your keys, your contact and all data on this phone. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              // Stop talking to relays before the database and keys are deleted.
              await useChatStore.getState().stop();
              await reset();
              router.replace('/');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 24 }]}
    >
      <View style={rowStyle}>
        <Text style={{ color: colors.textMuted, fontSize: font.caption }}>Your name</Text>
        <Text style={{ color: colors.text, fontSize: font.body }}>
          {session.profile?.displayName}
        </Text>
      </View>

      {session.peer ? (
        <Pressable style={rowStyle} onPress={() => router.push('/verify')}>
          <Text style={{ color: colors.text, fontSize: font.body }}>Security code</Text>
          <Text style={{ color: session.peer.verifiedAt ? colors.accent : colors.textMuted }}>
            {session.peer.verifiedAt ? '✓ Verified' : 'Not verified ›'}
          </Text>
        </Pressable>
      ) : null}

      <View style={[rowStyle, styles.inline]}>
        <Text style={{ color: colors.text, fontSize: font.body }}>Lock with Face ID</Text>
        <Switch
          value={session.appLockEnabled}
          onValueChange={toggleLock}
          trackColor={{ true: colors.accent }}
        />
      </View>

      <Text style={[styles.section, { color: colors.textMuted }]}>Your pairing code</Text>
      <MyCodeCard code={session.ownCodeText} />

      <View style={styles.danger}>
        <Button title="Unpair & erase" variant="danger" onPress={confirmReset} busy={busy} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  row: { paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { marginTop: 12, fontSize: 13, textTransform: 'uppercase' },
  danger: { marginTop: 24 },
});
