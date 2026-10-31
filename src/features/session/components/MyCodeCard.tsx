import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '@/ui/Button';
import { useTheme } from '@/ui/theme';

/** QR + text form of this device's pairing code, with copy and share. */
export function MyCodeCard({ code }: { code: string }) {
  const { colors, radius, spacing, font } = useTheme();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing(4) },
      ]}
    >
      <View style={[styles.qr, { borderRadius: radius.card }]}>
        <QRCode value={code} size={200} backgroundColor="#FFFFFF" color="#111B21" />
      </View>
      <Text
        selectable
        accessibilityLabel="Your pairing code"
        style={[styles.code, { color: colors.text, fontSize: font.caption }]}
      >
        {code}
      </Text>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title={copied ? 'Copied' : 'Copy'} variant="secondary" onPress={copy} />
        </View>
        <View style={styles.flex}>
          <Button
            title="Share"
            variant="secondary"
            onPress={() => Share.share({ message: code })}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 12 },
  qr: { backgroundColor: '#FFFFFF', padding: 12 },
  code: { fontFamily: 'Menlo', textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12, alignSelf: 'stretch' },
  flex: { flex: 1 },
});
