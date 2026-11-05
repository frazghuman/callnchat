import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ChatMessage } from '@/data/messages';
import { useTheme } from '@/ui/theme';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export type MessageActionsTarget = {
  message: ChatMessage;
  /** Decided when the sheet opened (time-limited actions). */
  canEdit: boolean;
  canDeleteForEveryone: boolean;
};

type Props = {
  target: MessageActionsTarget | null;
  onClose: () => void;
  onReact: (emoji: string | null) => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
};

/** Long-press sheet: quick reactions on top, actions below. */
export function MessageActions({ target, onClose, ...actions }: Props) {
  const { colors, radius, font } = useTheme();
  const insets = useSafeAreaInsets();
  const mine = target?.message.reactions.me ?? null;

  const rows: { label: string; onPress: () => void; danger?: boolean; show: boolean }[] = [
    { label: 'Reply', onPress: actions.onReply, show: true },
    { label: 'Copy', onPress: actions.onCopy, show: true },
    { label: 'Edit', onPress: actions.onEdit, show: !!target?.canEdit },
    { label: 'Delete for me', onPress: actions.onDeleteForMe, danger: true, show: true },
    {
      label: 'Delete for everyone',
      onPress: actions.onDeleteForEveryone,
      danger: true,
      show: !!target?.canDeleteForEveryone,
    },
  ];

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderRadius: radius.card,
              marginBottom: insets.bottom + 16,
            },
          ]}
        >
          <Text numberOfLines={3} style={[styles.preview, { color: colors.textMuted }]}>
            {target?.message.body}
          </Text>

          <View style={[styles.emojiRow, { backgroundColor: colors.surface }]}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`React ${emoji}`}
                accessibilityState={{ selected: mine === emoji }}
                onPress={() => actions.onReact(mine === emoji ? null : emoji)}
                style={[styles.emoji, mine === emoji && { backgroundColor: colors.separator }]}
              >
                <Text style={styles.emojiText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>

          {rows
            .filter((r) => r.show)
            .map((r) => (
              <Pressable
                key={r.label}
                accessibilityRole="button"
                onPress={r.onPress}
                style={({ pressed }) => [
                  styles.action,
                  { borderTopColor: colors.separator, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text
                  style={{ color: r.danger ? colors.danger : colors.text, fontSize: font.body }}
                >
                  {r.label}
                </Text>
              </Pressable>
            ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { marginHorizontal: 12, overflow: 'hidden' },
  preview: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, fontSize: 13 },
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 24,
    paddingVertical: 4,
  },
  emoji: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: { fontSize: 26 },
  action: { minHeight: 50, justifyContent: 'center', paddingHorizontal: 16, borderTopWidth: 1 },
});
