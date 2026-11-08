import { FlashList, type FlashListRef } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { DELETE_FOR_EVERYONE_WINDOW_MS, EDIT_WINDOW_MS } from '@/core/protocol/frames';
import type { ChatMessage } from '@/data/messages';
import { showAttachMenu } from '@/features/attachments/attachMenu';
import { prepareVoiceNote } from '@/features/attachments/prepare';
import { useChatStore } from '@/features/chat/chatStore';
import { ChatHeaderTitle } from '@/features/chat/components/ChatHeaderTitle';
import { Composer } from '@/features/chat/components/Composer';
import {
  MessageActions,
  type MessageActionsTarget,
} from '@/features/chat/components/MessageActions';
import { MessageBubble } from '@/features/chat/components/MessageBubble';
import { SwipeToReply } from '@/features/chat/components/SwipeToReply';
import { dayKey, formatDay } from '@/features/chat/format';
import { useSessionStore } from '@/features/session/sessionStore';
import { useTheme } from '@/ui/theme';

type Item =
  | { type: 'message'; key: string; message: ChatMessage }
  | { type: 'day'; key: string; label: string };

/** Show the jump-to-latest button once scrolled this far up (inverted list: 0 is the bottom). */
const JUMP_THRESHOLD = 400;

/** Newest-first messages with a day separator above the first message of each day. */
function buildItems(messages: ChatMessage[], now: number): Item[] {
  const items: Item[] = [];
  messages.forEach((message, i) => {
    items.push({ type: 'message', key: message.id, message });
    const older = messages[i + 1];
    const day = dayKey(message.sentAt);
    if (!older || dayKey(older.sentAt) !== day) {
      items.push({ type: 'day', key: `day-${day}`, label: formatDay(message.sentAt, now) });
    }
  });
  return items;
}

async function attempt(title: string, action: () => Promise<void>) {
  try {
    await action();
  } catch (e) {
    Alert.alert(title, e instanceof Error ? e.message : String(e));
  }
}

export default function ChatScreen() {
  const { colors, font, radius } = useTheme();
  const headerHeight = useHeaderHeight();
  const peer = useSessionStore((s) => s.session?.peer);
  const messages = useChatStore((s) => s.messages);
  const confirmedAt = useChatStore((s) => s.confirmedAt);
  const replyTo = useChatStore((s) => s.replyTo);
  const editing = useChatStore((s) => s.editing);
  const highlightId = useChatStore((s) => s.highlightId);
  const store = useChatStore.getState;

  const listRef = useRef<FlashListRef<Item>>(null);
  const [today] = useState(() => Date.now());
  const [target, setTarget] = useState<MessageActionsTarget | null>(null);
  const [awayAt, setAwayAt] = useState<number | null>(null);

  const items = useMemo(() => buildItems(messages, today), [messages, today]);
  const newWhileAway =
    awayAt === null
      ? 0
      : messages.filter((m) => m.direction === 'in' && (m.receivedAt ?? 0) > awayAt).length;

  // Anything that arrives while this screen is open counts as read.
  const newestIncoming = messages.find((m) => m.direction === 'in')?.id;
  useFocusEffect(
    useCallback(() => {
      void store().markRead();
    }, [store]),
  );
  useEffect(() => {
    if (newestIncoming) void store().markRead();
  }, [newestIncoming, store]);

  // Scroll to a message picked in search or a tapped reply quote, flash it, then clear.
  useEffect(() => {
    if (!highlightId) return;
    const index = items.findIndex((i) => i.type === 'message' && i.key === highlightId);
    if (index >= 0)
      void listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    const timer = setTimeout(() => store().clearHighlight(), 1_500);
    return () => clearTimeout(timer);
  }, [highlightId, items, store]);

  const openActions = useCallback((message: ChatMessage) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const age = Date.now() - message.sentAt;
    const own = message.direction === 'out';
    const plainText = !message.attachment && !message.location;
    setTarget({
      message,
      canEdit: own && plainText && age <= EDIT_WINDOW_MS,
      canDeleteForEveryone: own && age <= DELETE_FOR_EVERYONE_WINDOW_MS,
    });
  }, []);

  const jumpTo = useCallback(
    (id: string) => {
      void store()
        .jumpTo(id)
        .then((found) => {
          if (!found) Alert.alert('Message not found', 'It may have been deleted.');
        });
    },
    [store],
  );

  const openAttachment = useCallback((message: ChatMessage) => {
    if (message.location) {
      router.push({ pathname: '/location/[id]', params: { id: message.id } });
      return;
    }
    const kind = message.attachment?.kind;
    if (kind === 'image' || kind === 'video') {
      router.push({ pathname: '/media/[id]', params: { id: message.id } });
      return;
    }
    const uri = useChatStore.getState().fileUri(message);
    if (!uri) return;
    // Quick Look where iOS can show the file, otherwise the share sheet ("Open in…").
    new File(uri).preview().catch(() => Sharing.shareAsync(uri));
  }, []);

  if (!peer) return null;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const away = e.nativeEvent.contentOffset.y > JUMP_THRESHOLD;
    if (away && awayAt === null) setAwayAt(Date.now());
    if (!away && awayAt !== null) setAwayAt(null);
  }

  function closeActions(then?: (message: ChatMessage) => void) {
    const message = target?.message;
    setTarget(null);
    if (message && then) then(message);
  }

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
            <View style={styles.headerButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search messages"
                hitSlop={12}
                onPress={() => router.push('/search')}
              >
                <Text style={[styles.headerIcon, { color: colors.headerText }]}>⌕</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Settings"
                hitSlop={12}
                onPress={() => router.push('/settings')}
              >
                <Text style={[styles.headerIcon, { color: colors.headerText }]}>⚙︎</Text>
              </Pressable>
            </View>
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

      <View style={styles.flex}>
        <FlashList
          ref={listRef}
          inverted
          data={items}
          keyExtractor={(item) => item.key}
          getItemType={(item) =>
            item.type === 'day' ? 'day' : `${item.message.kind}-${item.message.direction}`
          }
          renderItem={({ item }) =>
            item.type === 'day' ? (
              <View style={styles.dayRow}>
                <Text
                  style={[styles.day, { color: colors.textMuted, backgroundColor: colors.surface }]}
                >
                  {item.label}
                </Text>
              </View>
            ) : (
              <SwipeToReply
                enabled={item.message.kind === 'text' && !item.message.deletedAt}
                onReply={() => store().setReplyTo(item.message)}
              >
                <MessageBubble
                  message={item.message}
                  peerName={peer.displayName}
                  highlighted={item.key === highlightId}
                  onLongPress={openActions}
                  onQuotePress={jumpTo}
                  onOpenAttachment={openAttachment}
                />
              </SwipeToReply>
            )
          }
          onEndReached={() => void store().loadOlder()}
          onEndReachedThreshold={0.5}
          onScroll={onScroll}
          scrollEventThrottle={100}
          keyboardDismissMode="interactive"
          contentContainerStyle={styles.list}
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

        {awayAt !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              newWhileAway ? `${newWhileAway} new messages, jump to latest` : 'Jump to latest'
            }
            onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
            style={[styles.jump, { backgroundColor: colors.bubbleIncoming }]}
          >
            {newWhileAway ? (
              <Text style={[styles.jumpBadge, { backgroundColor: colors.accent }]}>
                {newWhileAway}
              </Text>
            ) : null}
            <Text style={{ color: colors.textMuted, fontSize: 18 }}>⌄</Text>
          </Pressable>
        ) : null}
      </View>

      <Composer
        key={editing?.id ?? 'new'}
        peerName={peer.displayName}
        replyTo={replyTo}
        editing={editing}
        onSend={(text) => void attempt("Couldn't send", () => store().send(text))}
        onSubmitEdit={(text) => void attempt("Couldn't edit", () => store().submitEdit(text))}
        onCancel={() => (editing ? store().setEditing(null) : store().setReplyTo(null))}
        onTyping={() => store().typing()}
        onAttach={() =>
          showAttachMenu({
            send: (prepared) => store().sendAttachment(prepared),
            sendLocation: (minutes) => store().sendLocation(minutes),
          })
        }
        onVoiceNote={(uri, ms) =>
          void attempt("Couldn't send voice message", async () =>
            store().sendAttachment(await prepareVoiceNote(uri, ms)),
          )
        }
      />

      <MessageActions
        target={target}
        onClose={() => closeActions()}
        onReact={(emoji) =>
          closeActions((m) => void attempt("Couldn't react", () => store().react(m.id, emoji)))
        }
        onReply={() => closeActions((m) => store().setReplyTo(m))}
        onCopy={() => closeActions((m) => void Clipboard.setStringAsync(m.body))}
        onEdit={() => closeActions((m) => store().setEditing(m))}
        onDeleteForMe={() =>
          closeActions((m) => void attempt("Couldn't delete", () => store().deleteForMe(m.id)))
        }
        onDeleteForEveryone={() =>
          closeActions((m) =>
            Alert.alert(
              'Delete for everyone?',
              `This removes the message for ${peer.displayName} too.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () =>
                    void attempt("Couldn't delete", () => store().deleteForEveryone(m.id)),
                },
              ],
            ),
          )
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: { margin: 8, padding: 10 },
  list: { paddingVertical: 8 },
  headerButtons: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  headerIcon: { fontSize: 22 },
  dayRow: { alignItems: 'center', paddingVertical: 8 },
  day: {
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  footer: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 24 },
  notice: {
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  jump: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  jumpBadge: {
    position: 'absolute',
    top: -6,
    right: -4,
    minWidth: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    overflow: 'hidden',
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
});
