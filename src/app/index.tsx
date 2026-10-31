import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

// Placeholder home until pairing lands in Phase 1.
export default function HomeScreen() {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.font.title }]}>
        Not paired yet
      </Text>
      <Text style={[styles.body, { color: theme.colors.textMuted, fontSize: theme.font.body }]}>
        Pair with your contact by sharing a secret code. Coming in the next build.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontWeight: '600' },
  body: { textAlign: 'center' },
});
