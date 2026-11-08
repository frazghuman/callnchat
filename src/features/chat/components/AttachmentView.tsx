import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import type { ChatMessage } from '@/data/messages';
import { useTheme } from '@/ui/theme';

import { useChatStore } from '../chatStore';
import {
  explainLinkFailure,
  formatBytes,
  formatDuration,
  formatTime,
  transferLabel,
} from '../format';

const MEDIA_WIDTH = 240;
const ABSOLUTE_FILL = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;
const SPEEDS = [1, 1.5, 2] as const;

type Props = {
  message: ChatMessage;
  peerName: string;
  onOpen: (message: ChatMessage) => void;
};

/** The attachment or location part of a bubble. */
export function AttachmentView({ message, peerName, onOpen }: Props) {
  if (message.location) return <LocationView message={message} onOpen={onOpen} />;
  if (!message.attachment) return null;
  return (
    <View>
      {message.attachment.kind === 'image' || message.attachment.kind === 'video' ? (
        <MediaView message={message} onOpen={onOpen} />
      ) : message.attachment.kind === 'audio' ? (
        <VoiceNote message={message} />
      ) : (
        <DocumentView message={message} onOpen={onOpen} />
      )}
      <TransferStatus message={message} peerName={peerName} />
    </View>
  );
}

function TransferStatus({ message, peerName }: { message: ChatMessage; peerName: string }) {
  const { colors } = useTheme();
  const bytes = useChatStore((s) => s.progress[message.id] ?? message.transferBytes);
  const peerOnline = useChatStore((s) => s.presence?.state === 'online');
  const unreachable = useChatStore((s) => s.linkStatus === 'unreachable');
  const label = transferLabel({
    direction: message.direction,
    state: message.transferState,
    size: message.attachment?.size ?? 0,
    bytes,
    peerOnline,
    unreachable,
    peerName,
  });
  if (!label) return null;

  if (unreachable && peerOnline && message.transferState !== 'failed') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Explains why and lets you try again"
        onPress={() => {
          const { linkDiagnostics, retryTransfers } = useChatStore.getState();
          Alert.alert("Can't connect directly", explainLinkFailure(linkDiagnostics, peerName), [
            { text: 'OK', style: 'cancel' },
            { text: 'Try again', onPress: retryTransfers },
          ]);
        }}
      >
        <Text style={[styles.status, { color: colors.textMuted }]}>{label} ⓘ</Text>
      </Pressable>
    );
  }

  return (
    <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.textMuted }]}>
      {label}
    </Text>
  );
}

function MediaView({ message, onOpen }: Omit<Props, 'peerName'>) {
  const file = message.attachment!;
  const uri = useChatStore.getState().fileUri(message);
  const ratio = file.width && file.height ? file.height / file.width : 0.75;
  const height = Math.min(320, Math.max(120, Math.round(MEDIA_WIDTH * ratio)));
  const placeholder = file.thumb ? `data:image/jpeg;base64,${file.thumb}` : undefined;
  const video = file.kind === 'video';

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={video ? 'Video' : 'Photo'}
      disabled={!uri}
      onPress={() => onOpen(message)}
      style={[styles.media, { width: MEDIA_WIDTH, height }]}
    >
      {uri && !video ? (
        <Image source={{ uri }} placeholder={placeholder} contentFit="cover" style={styles.fill} />
      ) : placeholder ? (
        <Image
          source={{ uri: placeholder }}
          blurRadius={8}
          contentFit="cover"
          style={styles.fill}
        />
      ) : (
        <View style={[styles.fill, styles.dark]} />
      )}
      {video ? (
        <View style={styles.overlay}>
          <Text style={styles.play}>▶</Text>
          {file.duration ? (
            <Text style={styles.overlayText}>{formatDuration(file.duration)}</Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function DocumentView({ message, onOpen }: Omit<Props, 'peerName'>) {
  const { colors, font } = useTheme();
  const file = message.attachment!;
  const ready = !!useChatStore.getState().fileUri(message);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Document ${file.name}, ${formatBytes(file.size)}`}
      disabled={!ready}
      onPress={() => onOpen(message)}
      style={[styles.document, { backgroundColor: colors.surface }]}
    >
      <Text style={styles.docIcon}>📄</Text>
      <View style={styles.flex}>
        <Text numberOfLines={2} style={{ color: colors.text, fontSize: font.body }}>
          {file.name}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: font.caption }}>
          {formatBytes(file.size)}
        </Text>
      </View>
    </Pressable>
  );
}

function VoiceNote({ message }: { message: ChatMessage }) {
  const { colors } = useTheme();
  const uri = useChatStore.getState().fileUri(message);
  const player = useAudioPlayer(uri ? { uri } : null);
  const status = useAudioPlayerStatus(player);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const duration = (status.duration || 0) * 1000 || (message.attachment?.duration ?? 0);
  const position = status.currentTime * 1000;
  const progress = duration ? Math.min(1, position / duration) : 0;

  function toggle() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || (duration && position >= duration - 50)) void player.seekTo(0);
    player.setPlaybackRate(speed);
    player.play();
  }

  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    setSpeed(next);
    player.setPlaybackRate(next);
  }

  return (
    <View style={styles.voice}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice note' : 'Play voice note'}
        disabled={!uri}
        onPress={toggle}
        style={[styles.voiceButton, { backgroundColor: colors.accent, opacity: uri ? 1 : 0.4 }]}
      >
        <Text style={styles.voiceIcon}>{status.playing ? '❚❚' : '▶'}</Text>
      </Pressable>
      <View style={styles.flex}>
        <View style={[styles.track, { backgroundColor: colors.separator }]}>
          <View
            style={[
              styles.trackFill,
              { width: `${progress * 100}%`, backgroundColor: colors.accent },
            ]}
          />
        </View>
        <Text style={[styles.status, { color: colors.textMuted }]}>
          {formatDuration(status.playing || position > 0 ? position : duration)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Playback speed ${speed}x`}
        onPress={cycleSpeed}
        style={[styles.speed, { backgroundColor: colors.surface }]}
      >
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{speed}×</Text>
      </Pressable>
    </View>
  );
}

function LocationView({ message, onOpen }: Omit<Props, 'peerName'>) {
  const { colors, font } = useTheme();
  const loc = message.location!;
  const region = {
    latitude: loc.lat,
    longitude: loc.lng,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };
  const live = !!loc.liveUntil;
  // Recomputed whenever the message re-renders (each live update or status change).
  const [now] = useState(() => Date.now());
  const ongoing = live && !loc.endedAt && (loc.liveUntil ?? 0) > now;
  const label = !live
    ? '📍 Location'
    : ongoing
      ? `🟢 Live location until ${formatTime(loc.liveUntil!)}`
      : 'Live location ended';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onOpen(message)}
      style={styles.locationBox}
    >
      <View pointerEvents="none" style={styles.map}>
        <MapView
          style={styles.fill}
          region={region}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          <Marker coordinate={{ latitude: loc.lat, longitude: loc.lng }} />
        </MapView>
      </View>
      <Text style={{ color: colors.text, fontSize: font.caption, marginTop: 4 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fill: { ...ABSOLUTE_FILL },
  dark: { backgroundColor: '#1F2C34' },
  media: { borderRadius: 6, overflow: 'hidden', marginBottom: 4 },
  overlay: {
    ...ABSOLUTE_FILL,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  play: { color: '#FFFFFF', fontSize: 34 },
  overlayText: { color: '#FFFFFF', fontSize: 12, position: 'absolute', left: 8, bottom: 6 },
  document: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 6,
    minWidth: 220,
    marginBottom: 4,
  },
  docIcon: { fontSize: 28 },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 220, paddingVertical: 4 },
  voiceButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceIcon: { color: '#FFFFFF', fontSize: 14 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6 },
  trackFill: { height: 4 },
  speed: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  status: { fontSize: 12, marginTop: 2 },
  locationBox: { width: MEDIA_WIDTH, marginBottom: 2 },
  map: { width: MEDIA_WIDTH, height: 140, borderRadius: 6, overflow: 'hidden' },
});
