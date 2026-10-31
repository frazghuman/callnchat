import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MyCodeCard } from '@/features/session/components/MyCodeCard';
import { pairingErrorMessage } from '@/features/session/messages';
import { useSessionStore } from '@/features/session/sessionStore';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { useTheme } from '@/ui/theme';

export default function PairScreen() {
  const { colors, font } = useTheme();
  const ownCode = useSessionStore((s) => s.session?.ownCodeText ?? '');
  const pair = useSessionStore((s) => s.pair);
  const code = useSessionStore((s) => s.draftCode);
  const setCode = useSessionStore((s) => s.setDraftCode);

  const [name, setName] = useState('');
  // Kept with the code it was raised for, so editing or scanning a new code clears it.
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const error = failure?.code === code ? failure.message : null;

  async function paste() {
    setCode((await Clipboard.getStringAsync()).trim());
  }

  async function submit() {
    setBusy(true);
    try {
      await pair(code, name);
      router.replace('/verify');
    } catch (e) {
      setFailure({ code, message: pairingErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.heading, { color: colors.text, fontSize: font.body }]}>
          1. Send your code to your contact
        </Text>
        <MyCodeCard code={ownCode} />

        <Text style={[styles.heading, { color: colors.text, fontSize: font.body }]}>
          2. Add your contact&apos;s code
        </Text>
        <TextField
          label="Contact name"
          value={name}
          onChangeText={setName}
          maxLength={40}
          placeholder="e.g. Sara"
        />
        <TextField
          label="Their pairing code"
          value={code}
          onChangeText={setCode}
          error={error}
          placeholder="cnc1…"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={styles.codeInput}
          testID="peer-code-input"
        />
        <View style={styles.row}>
          <View style={styles.flex}>
            <Button title="Paste" variant="secondary" onPress={paste} />
          </View>
          <View style={styles.flex}>
            <Button
              title="Scan QR"
              variant="secondary"
              onPress={() => router.push('/onboarding/scan')}
            />
          </View>
        </View>
        <Button
          title="Add contact"
          onPress={submit}
          disabled={!name.trim() || !code.trim()}
          busy={busy}
        />
        <Text style={{ color: colors.textMuted, fontSize: font.caption, textAlign: 'center' }}>
          Both of you add each other&apos;s code. Codes never leave your phones except when you
          share them.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 20, gap: 16, paddingBottom: 48 },
  heading: { fontWeight: '600' },
  row: { flexDirection: 'row', gap: 12 },
  codeInput: { minHeight: 72, fontFamily: 'Menlo', fontSize: 13 },
});
