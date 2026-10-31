import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useSessionStore } from '@/features/session/sessionStore';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { useTheme } from '@/ui/theme';

export default function ProfileScreen() {
  const { colors, font } = useTheme();
  const setProfile = useSessionStore((s) => s.setProfile);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await setProfile(name);
      router.replace('/onboarding/pair');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={{ color: colors.textMuted, fontSize: font.body }}>
        Your contact will see this name. It stays on your phones only.
      </Text>
      <TextField
        label="Your name"
        value={name}
        onChangeText={setName}
        autoFocus
        maxLength={40}
        returnKeyType="done"
        onSubmitEditing={() => name.trim() && save()}
      />
      <Button title="Next" onPress={save} disabled={!name.trim()} busy={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 20 },
});
