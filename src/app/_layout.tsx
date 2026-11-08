import '@/polyfills';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useMessengerLifecycle } from '@/features/chat/useMessengerLifecycle';
import { LockScreen } from '@/features/lock/LockScreen';
import { useAppLock } from '@/features/lock/useAppLock';
import { expoSessionServices } from '@/features/session/expoServices';
import { useSessionStore } from '@/features/session/sessionStore';
import { useTheme } from '@/ui/theme';

export default function RootLayout() {
  const theme = useTheme();
  const init = useSessionStore((s) => s.init);
  const locked = useSessionStore((s) => s.locked);
  useAppLock();
  useMessengerLifecycle();

  useEffect(() => {
    void init(expoSessionServices);
  }, [init]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.header },
          headerTintColor: theme.colors.headerText,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/profile" options={{ title: 'Your name' }} />
        <Stack.Screen
          name="onboarding/pair"
          options={{ title: 'Pair with your contact', headerBackVisible: false }}
        />
        <Stack.Screen
          name="onboarding/scan"
          options={{ title: 'Scan code', presentation: 'modal' }}
        />
        <Stack.Screen name="verify" options={{ title: 'Verify security' }} />
        <Stack.Screen name="chat" options={{ headerBackVisible: false }} />
        <Stack.Screen name="search" options={{ title: 'Search' }} />
        <Stack.Screen
          name="media/[id]"
          options={{
            title: '',
            headerStyle: { backgroundColor: '#000000' },
            headerTintColor: '#FFFFFF',
          }}
        />
        <Stack.Screen name="location/[id]" options={{ title: 'Location' }} />
        <Stack.Screen name="relay" options={{ title: 'Connection relay' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
      {locked ? <LockScreen /> : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
