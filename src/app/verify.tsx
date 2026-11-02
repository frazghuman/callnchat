import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hexToBytes } from '@/core/crypto/bytes';
import { safetyCode } from '@/core/crypto/safetyCode';
import { useSessionStore } from '@/features/session/sessionStore';
import { Button } from '@/ui/Button';
import { useTheme } from '@/ui/theme';

export default function VerifyScreen() {
  const { colors, font, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const session = useSessionStore((s) => s.session);
  const verify = useSessionStore((s) => s.verify);
  const [busy, setBusy] = useState(false);

  const code = useMemo(() => {
    if (!session?.peer) return null;
    return safetyCode(session.identity.publicKey, hexToBytes(session.peer.publicKey));
  }, [session]);

  if (!session?.peer || !code) return null;
  const { peer } = session;

  function done() {
    if (router.canGoBack()) router.back();
    else router.replace('/chat');
  }

  async function confirm() {
    setBusy(true);
    try {
      await verify();
      done();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 24 }]}>
      <Text style={{ color: colors.text, fontSize: font.body, textAlign: 'center' }}>
        Compare these with {peer.displayName}, in person or on a call. If they match, nobody is
        intercepting your conversation.
      </Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radius.card }]}>
        <Text style={styles.emoji} accessibilityLabel="Safety emoji">
          {code.emoji.join(' ')}
        </Text>
        <Text style={[styles.digits, { color: colors.text }]} selectable>
          {code.digits}
        </Text>
      </View>
      {peer.verifiedAt ? (
        <Text style={{ color: colors.accent, textAlign: 'center', fontWeight: '600' }}>
          ✓ Verified
        </Text>
      ) : (
        <Button title="They match" onPress={confirm} busy={busy} />
      )}
      <Button title={peer.verifiedAt ? 'Done' : 'Later'} variant="secondary" onPress={done} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 20, justifyContent: 'center' },
  card: { alignItems: 'center', paddingVertical: 28, gap: 16 },
  emoji: { fontSize: 36, letterSpacing: 4 },
  digits: { fontSize: 22, fontFamily: 'Menlo', letterSpacing: 2 },
});
