import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { previewText, type ChatMessage, type Message } from '@/data/messages';
import { useTheme } from '@/ui/theme';

import { formatTime, systemNoticeText } from '../format';

import { AttachmentView } from './AttachmentView';

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

type Props = {
  message: ChatMessage;
  peerName: string;
  highlighted?: boolean;
  onLongPress?: (message: ChatMessage) => void;
  onQuotePress?: (id: string) => void;
  onOpenAttachment?: (message: ChatMessage) => void;
};

export const MessageBubble = memo(function MessageBubble({
  message,
  peerName,
  highlighted,
  onLongPress,
  onQuotePress,
  onOpenAttachment,
}: Props) {
  const { colors, radius, font } = useTheme();

  if (message.kind === 'system') {
    return (
      <View style={styles.systemRow}>
        <Text
          style={[
            styles.system,
            {
              color: colors.textMuted,
              backgroundColor: colors.surface,
              borderRadius: radius.bubble,
            },
          ]}
        >
          ⏱ {systemNoticeText(message.body, peerName)}
        </Text>
      </View>
    );
  }

  const outgoing = message.direction === 'out';
  const deleted = message.deletedAt !== null;
  const tickColor =
    message.status === 'read'
      ? colors.tickRead
      : message.status === 'failed'
        ? colors.danger
        : colors.textMuted;
  const reactions = [message.reactions.peer, message.reactions.me].filter((e): e is string => !!e);
  const reactionText =
    reactions.length === 2 && reactions[0] === reactions[1]
      ? `${reactions[0]} 2`
      : reactions.join(' ');

  const label = deleted
    ? 'Deleted message'
    : `${outgoing ? 'You' : peerName}: ${previewText(message)}. ${formatTime(message.sentAt)}${
        message.editedAt ? ', edited' : ''
      }${outgoing ? `, ${STATUS_LABEL[message.status]}` : ''}`;

  return (
    <View style={[styles.row, outgoing ? styles.right : styles.left]}>
      <View style={styles.column}>
        <Pressable
          accessibilityLabel={label}
          accessibilityHint={deleted ? undefined : 'Long press for reactions and options'}
          delayLongPress={350}
          disabled={deleted || !onLongPress}
          onLongPress={() => onLongPress?.(message)}
          style={[
            styles.bubble,
            {
              backgroundColor: outgoing ? colors.bubbleOutgoing : colors.bubbleIncoming,
              borderRadius: radius.bubble,
              opacity: highlighted ? 0.6 : 1,
            },
          ]}
        >
          {message.reply && !deleted ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Reply to ${message.reply.direction === 'out' ? 'you' : peerName}`}
              onPress={() => onQuotePress?.(message.reply!.id)}
              style={[
                styles.quote,
                { borderLeftColor: colors.accent, backgroundColor: colors.surface },
              ]}
            >
              <Text style={[styles.quoteName, { color: colors.accent }]}>
                {message.reply.direction === 'out' ? 'You' : peerName}
              </Text>
              <Text numberOfLines={2} style={{ color: colors.textMuted, fontSize: font.caption }}>
                {message.reply.deleted ? '🚫 Deleted message' : message.reply.body}
              </Text>
            </Pressable>
          ) : null}

          {deleted ? (
            <Text style={[styles.deleted, { color: colors.textMuted, fontSize: font.body }]}>
              🚫 {outgoing ? 'You deleted this message' : 'This message was deleted'}
            </Text>
          ) : (
            <>
              <AttachmentView
                message={message}
                peerName={peerName}
                onOpen={(m) => onOpenAttachment?.(m)}
              />
              {message.body ? (
                <Text style={{ color: colors.text, fontSize: font.body }}>{message.body}</Text>
              ) : null}
            </>
          )}

          <View style={styles.meta}>
            {message.expiresAt && !deleted ? <Text style={styles.time}>⏱</Text> : null}
            {message.editedAt && !deleted ? (
              <Text style={[styles.time, { color: colors.textMuted }]}>edited</Text>
            ) : null}
            <Text style={[styles.time, { color: colors.textMuted }]}>
              {formatTime(message.sentAt)}
            </Text>
            {outgoing && !deleted ? (
              <Text testID={`ticks-${message.id}`} style={[styles.ticks, { color: tickColor }]}>
                {TICKS[message.status]}
              </Text>
            ) : null}
          </View>
        </Pressable>

        {reactionText ? (
          <View
            accessibilityLabel={`Reactions: ${reactionText}`}
            style={[
              styles.reactions,
              outgoing ? styles.reactionsRight : styles.reactionsLeft,
              { backgroundColor: colors.bubbleIncoming, borderColor: colors.chatBackground },
            ]}
          >
            <Text style={styles.reactionText}>{reactionText}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: 10, paddingVertical: 2, flexDirection: 'row' },
  right: { justifyContent: 'flex-end' },
  left: { justifyContent: 'flex-start' },
  column: { maxWidth: '82%' },
  bubble: { paddingHorizontal: 9, paddingTop: 6, paddingBottom: 4 },
  quote: {
    borderLeftWidth: 4,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 4,
  },
  quoteName: { fontSize: 13, fontWeight: '600' },
  deleted: { fontStyle: 'italic' },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4, marginTop: 2 },
  time: { fontSize: 11 },
  ticks: { fontSize: 11, fontWeight: '700' },
  reactions: {
    marginTop: -6,
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  reactionsRight: { alignSelf: 'flex-end', marginRight: 8 },
  reactionsLeft: { alignSelf: 'flex-start', marginLeft: 8 },
  reactionText: { fontSize: 13 },
  systemRow: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 6 },
  system: {
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
  },
});
