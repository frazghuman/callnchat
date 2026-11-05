import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

import { useChatStore } from '../chatStore';
import { presenceLabel } from '../format';

export function ChatHeaderTitle({ name }: { name: string }) {
  const { colors } = useTheme();
  const presence = useChatStore((s) => s.presence);
  const connectedRelays = useChatStore((s) => s.connectedRelays);
  const statusAt = useChatStore((s) => s.statusAt);
  const disappear = useChatStore((s) => s.disappear);
  const subtitle = presenceLabel(presence, connectedRelays, statusAt);

  return (
    <View style={styles.container}>
      <Text numberOfLines={1} style={[styles.name, { color: colors.headerText }]}>
        {name}
        {disappear ? <Text accessibilityLabel="Disappearing messages on"> ⏱</Text> : null}
      </Text>
      {subtitle ? (
        <Text
          numberOfLines={1}
          accessibilityLabel={`Status: ${subtitle}`}
          style={[styles.subtitle, { color: colors.headerText }]}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-start' },
  name: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 12, opacity: 0.85 },
});
