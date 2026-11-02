import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MAX_TEXT_LENGTH } from '@/core/protocol/frames';
import { useTheme } from '@/ui/theme';

type Props = {
  onSend: (text: string) => void;
  onTyping: () => void;
};

export function Composer({ onSend, onTyping }: Props) {
  const { colors, font } = useTheme();
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0;
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

  function send() {
    if (!canSend) return;
    onSend(text);
    setText('');
  }

  return (
    <View style={[styles.bar, edgePadding, { backgroundColor: colors.chatBackground }]}>
      <TextInput
        accessibilityLabel="Message"
        placeholder="Message"
        placeholderTextColor={colors.textMuted}
        value={text}
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
        accessibilityLabel="Send"
        disabled={!canSend}
        onPress={send}
        style={[styles.send, { backgroundColor: colors.accent, opacity: canSend ? 1 : 0.5 }]}
      >
        <Text style={styles.sendIcon}>➤</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
