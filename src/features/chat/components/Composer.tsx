import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MAX_TEXT_LENGTH } from '@/core/protocol/frames';
import type { ChatMessage } from '@/data/messages';
import { useTheme } from '@/ui/theme';

type Props = {
  peerName: string;
  replyTo: ChatMessage | null;
  /** When set, the composer edits this message; remount (key) to load its text. */
  editing: ChatMessage | null;
  onSend: (text: string) => void;
  onSubmitEdit: (text: string) => void;
  onCancel: () => void;
  onTyping: () => void;
};

export function Composer({
  peerName,
  replyTo,
  editing,
  onSend,
  onSubmitEdit,
  onCancel,
  onTyping,
}: Props) {
  const { colors, font } = useTheme();
  const [text, setText] = useState(editing?.body ?? '');
  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && (!editing || trimmed !== editing.body);
  const insets = useSafeAreaInsets();
  const [keyboardShown, setKeyboardShown] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardShown(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Keep clear of the home indicator and rounded corners; with the keyboard up, the
  // KeyboardAvoidingView already lifts the bar, so the inset would only leave a gap.
  const edgePadding = {
    paddingBottom: keyboardShown ? 6 : Math.max(insets.bottom, 6),
    paddingLeft: Math.max(insets.left, 6),
    paddingRight: Math.max(insets.right, 6),
  };

  function submit() {
    if (!canSend) return;
    if (editing) onSubmitEdit(trimmed);
    else onSend(text);
    setText('');
  }

  const context = editing
    ? { title: 'Editing message', body: editing.body }
    : replyTo
      ? {
          title: `Replying to ${replyTo.direction === 'out' ? 'yourself' : peerName}`,
          body: replyTo.body,
        }
      : null;

  return (
    <View style={[edgePadding, { backgroundColor: colors.chatBackground }]}>
      {context ? (
        <View
          style={[
            styles.context,
            { backgroundColor: colors.surface, borderLeftColor: colors.accent },
          ]}
        >
          <View style={styles.contextText}>
            <Text style={[styles.contextTitle, { color: colors.accent }]}>{context.title}</Text>
            <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: font.caption }}>
              {context.body}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Cancel editing' : 'Cancel reply'}
            hitSlop={12}
            onPress={onCancel}
          >
            <Text style={{ color: colors.textMuted, fontSize: 18 }}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.bar}>
        <TextInput
          accessibilityLabel="Message"
          placeholder="Message"
          placeholderTextColor={colors.textMuted}
          value={text}
          autoFocus={!!editing}
          onChangeText={(t) => {
            setText(t);
            if (t) onTyping();
          }}
          multiline
          maxLength={MAX_TEXT_LENGTH}
          style={[
            styles.input,
            { backgroundColor: colors.bubbleIncoming, color: colors.text, fontSize: font.body },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Save edit' : 'Send'}
          disabled={!canSend}
          onPress={submit}
          style={[styles.send, { backgroundColor: colors.accent, opacity: canSend ? 1 : 0.5 }]}
        >
          <Text style={styles.sendIcon}>{editing ? '✓' : '➤'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    borderLeftWidth: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  contextText: { flex: 1 },
  contextTitle: { fontSize: 13, fontWeight: '600' },
  bar: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: 6, gap: 6 },
  input: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    minHeight: 44,
    maxHeight: 140,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: '#FFFFFF', fontSize: 18 },
});
