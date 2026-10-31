import { router, Stack } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSessionStore } from '@/features/session/sessionStore';
import { useTheme } from '@/ui/theme';

// Placeholder conversation until messaging lands in Phase 3.
export default function ChatScreen() {
  const { colors, font, radius } = useTheme();
  const peer = useSessionStore((s) => s.session?.peer);

  if (!peer) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.chatBackground }]}>
      <Stack.Screen
        options={{
          title: peer.displayName,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              hitSlop={12}
              onPress={() => router.push('/settings')}
            >
              <Text style={{ color: colors.headerText, fontSize: 20 }}>⚙︎</Text>
            </Pressable>
          ),
        }}
      />
      <View
        style={[
          styles.notice,
          { backgroundColor: colors.bubbleIncoming, borderRadius: radius.bubble },
        ]}
      >
        <Text style={{ color: colors.text, fontSize: font.caption, textAlign: 'center' }}>
          🔒 Paired with {peer.displayName}
          {peer.verifiedAt ? ' · verified' : ' · not verified yet'}
          {'\n'}Messaging arrives in the next build.
        </Text>
      </View>
      {!peer.verifiedAt ? (
        <Pressable onPress={() => router.push('/verify')}>
          <Text style={{ color: colors.header, fontWeight: '600' }}>Verify security code</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', paddingTop: 24, gap: 12 },
  notice: { paddingHorizontal: 16, paddingVertical: 8, marginHorizontal: 32 },
});
