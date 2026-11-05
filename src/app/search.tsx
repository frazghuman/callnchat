import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ChatMessage } from '@/data/messages';
import { useChatStore } from '@/features/chat/chatStore';
import { formatDay, formatTime } from '@/features/chat/format';
import { useSessionStore } from '@/features/session/sessionStore';
import { useTheme } from '@/ui/theme';

/** Splits `text` around case-insensitive matches of `query` for highlighting. */
function highlight(text: string, query: string): { part: string; match: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ part: text, match: false }];
  const parts: { part: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(q, i);
    if (at < 0) break;
    if (at > i) parts.push({ part: text.slice(i, at), match: false });
    parts.push({ part: text.slice(at, at + q.length), match: true });
    i = at + q.length;
  }
  if (i < text.length) parts.push({ part: text.slice(i), match: false });
  return parts;
}

export default function SearchScreen() {
  const { colors, font, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const peerName = useSessionStore((s) => s.session?.peer?.displayName ?? '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [searchedAt] = useState(() => Date.now());

  async function onChange(text: string) {
    setQuery(text);
    setResults(await useChatStore.getState().search(text));
  }

  async function open(id: string) {
    router.back();
    await useChatStore.getState().jumpTo(id);
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <TextInput
        accessibilityLabel="Search messages"
        placeholder="Search messages"
        placeholderTextColor={colors.textMuted}
        value={query}
        onChangeText={(t) => void onChange(t)}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={[
          styles.input,
          { backgroundColor: colors.surface, color: colors.text, borderRadius: radius.card },
        ]}
      />
      <FlatList
        data={results}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          query.trim() ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>No messages found</Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => void open(item.id)}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: colors.separator, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View style={styles.rowHeader}>
              <Text style={[styles.author, { color: colors.text }]}>
                {item.direction === 'out' ? 'You' : peerName}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: font.caption }}>
                {formatDay(item.sentAt, searchedAt)} {formatTime(item.sentAt)}
              </Text>
            </View>
            <Text numberOfLines={2} style={{ color: colors.textMuted, fontSize: font.body }}>
              {highlight(item.body, query).map((p, i) => (
                <Text
                  key={i}
                  style={p.match ? { color: colors.text, fontWeight: '700' } : undefined}
                >
                  {p.part}
                </Text>
              ))}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  input: { margin: 12, paddingHorizontal: 14, minHeight: 44, fontSize: 16 },
  empty: { textAlign: 'center', marginTop: 32 },
  row: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  author: { fontWeight: '600' },
});
