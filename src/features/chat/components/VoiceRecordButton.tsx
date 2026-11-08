import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/ui/theme';

/** Shorter presses are treated as taps (and explained) rather than sent as empty notes. */
const MIN_DURATION_MS = 800;

type Props = {
  onRecordingChange: (startedAt: number | null) => void;
  onRecorded: (uri: string, durationMs: number) => void;
};

/** Hold to record a voice note, release to send — like WhatsApp. */
export function VoiceRecordButton({ onRecordingChange, onRecorded }: Props) {
  const { colors } = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Press-in starts asynchronously; release may come before recording has begun.
  const session = useRef<{ startedAt: number; released: boolean; started: boolean } | null>(null);

  async function begin() {
    const current = { startedAt: Date.now(), released: false, started: false };
    session.current = current;
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      session.current = null;
      Alert.alert(
        'Microphone access needed',
        'Allow the microphone for CallNChat in iOS Settings.',
      );
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    if (current.released) {
      session.current = null;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      return;
    }
    recorder.record();
    current.started = true;
    current.startedAt = Date.now();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRecordingChange(current.startedAt);
  }

  async function end() {
    const current = session.current;
    if (!current) return;
    current.released = true;
    if (!current.started) return;
    session.current = null;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    onRecordingChange(null);
    const duration = Date.now() - current.startedAt;
    if (duration < MIN_DURATION_MS || !recorder.uri) {
      Alert.alert('Hold to record', 'Keep holding the microphone while you speak, then release.');
      return;
    }
    onRecorded(recorder.uri, duration);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Record voice message"
      accessibilityHint="Hold to record, release to send"
      onPressIn={() => void begin().catch(() => (session.current = null))}
      onPressOut={() => void end()}
      style={[styles.button, { backgroundColor: colors.accent }]}
    >
      <Text style={styles.icon}>🎤</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 18 },
});
