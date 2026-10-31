import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useSessionStore } from '@/features/session/sessionStore';
import { Button } from '@/ui/Button';
import { useTheme } from '@/ui/theme';

export default function ScanScreen() {
  const { colors, font } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const setDraftCode = useSessionStore((s) => s.setDraftCode);
  const handled = useRef(false);

  if (!permission) return <View style={styles.flex} />;

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text, fontSize: font.body, textAlign: 'center' }}>
          Camera access is needed to scan your contact&apos;s code. You can also paste it instead.
        </Text>
        <Button title="Allow camera" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <CameraView
        style={styles.flex}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current || !data.toLowerCase().startsWith('cnc1')) return;
          handled.current = true;
          setDraftCode(data);
          router.back();
        }}
      />
      <View style={styles.hint}>
        <Text style={styles.hintText}>Point at the QR code on your contact&apos;s phone</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 },
  hint: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
  hintText: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
