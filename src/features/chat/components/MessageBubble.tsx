import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Message } from '@/data/messages';
import { useTheme } from '@/ui/theme';

import { formatTime } from '../format';

const TICKS: Record<Message['status'], string> = {
  pending: '🕓',
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓',
  failed: '!',
  received: '',
};

const STATUS_LABEL: Record<Message['status'], string> = {
  pending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
  received: '',
};

export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const { colors, radius, font } = useTheme();
  const outgoing = message.direction === 'out';
  const tickColor =
    message.status === 'read'
      ? colors.tickRead
      : message.status === 'failed'
        ? colors.danger
        : colors.textMuted;

  return (
    <View style={[styles.row, outgoing ? styles.right : styles.left]}>
      <View
        accessibilityLabel={`${outgoing ? 'You' : 'Them'}: ${message.body}. ${formatTime(message.sentAt)}${outgoing ? `, ${STATUS_LABEL[message.status]}` : ''}`}
        style={[
          styles.bubble,
          {
            backgroundColor: outgoing ? colors.bubbleOutgoing : colors.bubbleIncoming,
            borderRadius: radius.bubble,
          },
        ]}
      >
        <Text style={{ color: colors.text, fontSize: font.body }}>{message.body}</Text>
        <View style={styles.meta}>
          <Text style={[styles.time, { color: colors.textMuted }]}>
            {formatTime(message.sentAt)}
          </Text>
          {outgoing ? (
            <Text testID={`ticks-${message.id}`} style={[styles.ticks, { color: tickColor }]}>
              {TICKS[message.status]}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: 10, paddingVertical: 2, flexDirection: 'row' },
  right: { justifyContent: 'flex-end' },
  left: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', paddingHorizontal: 9, paddingTop: 6, paddingBottom: 4 },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 3, marginTop: 2 },
  time: { fontSize: 11 },
  ticks: { fontSize: 11, fontWeight: '700' },
});
