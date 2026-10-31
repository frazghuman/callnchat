import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useSessionStore } from '@/features/session/sessionStore';
import { useTheme } from '@/ui/theme';

/** Routes to the right step for the current session state. */
export default function Index() {
  const { colors } = useTheme();
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);

  switch (status) {
    case 'needsProfile':
      return <Redirect href="/onboarding/profile" />;
    case 'needsPairing':
      return <Redirect href="/onboarding/pair" />;
    case 'paired':
      return <Redirect href="/chat" />;
    case 'error':
      return (
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <Text style={{ color: colors.danger, textAlign: 'center' }}>
            Couldn&apos;t open secure storage.{'\n'}
            {error}
          </Text>
        </View>
      );
    default:
      return (
        <View style={[styles.center, { backgroundColor: colors.header }]}>
          <ActivityIndicator color={colors.headerText} />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
