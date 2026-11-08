import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useChatStore } from '@/features/chat/chatStore';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { useTheme } from '@/ui/theme';

/** Optional TURN relay for networks where phones can't reach each other directly. */
export default function RelayScreen() {
  const { colors, font } = useTheme();
  const insets = useSafeAreaInsets();
  const [urls, setUrls] = useState('');
  const [username, setUsername] = useState('');
  const [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void useChatStore
      .getState()
      .getRelay()
      .then((relay) => {
        if (!active || !relay) return;
        setUrls(relay.urls);
        setUsername(relay.username);
        setCredential(relay.credential);
      });
    return () => {
      active = false;
    };
  }, []);

  const valid = /^turns?:\S+$/.test(urls.trim()) && !!username.trim() && !!credential;

  async function save(clear: boolean) {
    setBusy(true);
    try {
      await useChatStore
        .getState()
        .setRelay(clear ? null : { urls: urls.trim(), username: username.trim(), credential });
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 24 }]}
    >
      <Text style={{ color: colors.text, fontSize: font.body }}>
        Photos, voice notes and files go straight between your phones. Some mobile networks and
        office Wi-Fi block that. A TURN relay passes the already-encrypted data through a server so
        it still arrives.
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: font.caption }}>
        Use a TURN service you trust (for example Metered or Cloudflare, both have free tiers) and
        paste its details here. It only sees encrypted data. Setting it on one phone is enough.
      </Text>
      <TextField
        label="TURN address"
        value={urls}
        onChangeText={setUrls}
        placeholder="turn:relay.example.com:3478"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Password"
        value={credential}
        onChangeText={setCredential}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <Button title="Save" onPress={() => void save(false)} disabled={!valid} busy={busy} />
      <Button title="Remove relay" variant="secondary" onPress={() => void save(true)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14 },
});
