import { router, Stack, useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';

import { useChatStore } from '@/features/chat/chatStore';
import { ChatHeaderTitle } from '@/features/chat/components/ChatHeaderTitle';
import { Composer } from '@/features/chat/components/Composer';
import { MessageBubble } from '@/features/chat/components/MessageBubble';
import { useSessionStore } from '@/features/session/sessionStore';
import { useTheme } from '@/ui/theme';

export default function ChatScreen() {
  const { colors, font, radius } = useTheme();
  const headerHeight = useHeaderHeight();
  const peer = useSessionStore((s) => s.session?.peer);
  const messages = useChatStore((s) => s.messages);
  const confirmedAt = useChatStore((s) => s.confirmedAt);
  const send = useChatStore((s) => s.send);
  const typing = useChatStore((s) => s.typing);
  const markRead = useChatStore((s) => s.markRead);

  // Anything that arrives while this screen is open counts as read.
  const newestIncoming = messages.find((m) => m.direction === 'in')?.id;
  useFocusEffect(
    useCallback(() => {
      void markRead();
    }, [markRead]),
  );
  useEffect(() => {
    if (newestIncoming) void markRead();
  }, [newestIncoming, markRead]);

  if (!peer) return null;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      style={[styles.flex, { backgroundColor: colors.chatBackground }]}
    >
      <Stack.Screen
        options={{
          headerTitle: () => <ChatHeaderTitle name={peer.displayName} />,
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

      {!confirmedAt ? (
        <View
          style={[styles.banner, { backgroundColor: colors.surface, borderRadius: radius.bubble }]}
        >
          <Text style={{ color: colors.text, fontSize: font.caption, textAlign: 'center' }}>
            Waiting for {peer.displayName} to add your code. Messages you send now are delivered
            once they do.
          </Text>
        </View>
      ) : null}

      <FlatList
        inverted
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        contentContainerStyle={styles.list}
        keyboardDismissMode="interactive"
        ListFooterComponent={
          <View style={styles.footer}>
            <Text
              style={[
                styles.notice,
                {
                  color: colors.textMuted,
                  backgroundColor: colors.surface,
                  borderRadius: radius.bubble,
                },
              ]}
            >
              🔒 End-to-end encrypted. Only {peer.displayName} and you can read these messages.
              {peer.verifiedAt ? '' : '\nVerify the security code in Settings.'}
            </Text>
          </View>
        }
      />

      <Composer onSend={(text) => void send(text)} onTyping={typing} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: { margin: 8, padding: 10 },
  list: { paddingVertical: 8 },
  footer: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 24 },
  notice: {
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
  },
});
