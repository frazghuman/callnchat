import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useChatStore } from '@/features/chat/chatStore';
import { formatDay, formatTime } from '@/features/chat/format';

function Video({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => p.play());
  return <VideoView player={player} style={styles.fill} contentFit="contain" nativeControls />;
}

/** Full-screen photo or video. */
export default function MediaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const message = useChatStore((s) => s.messages.find((m) => m.id === id));
  const uri = message ? useChatStore.getState().fileUri(message) : null;

  if (!message || !uri) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={styles.text}>This file isn&apos;t available yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: `${formatDay(message.sentAt, message.sentAt)} ${formatTime(message.sentAt)}`,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share"
              hitSlop={12}
              onPress={() => void Sharing.shareAsync(uri)}
            >
              <Text style={styles.share}>Share</Text>
            </Pressable>
          ),
        }}
      />
      {message.attachment?.kind === 'video' ? (
        <Video uri={uri} />
      ) : (
        <Image
          source={{ uri }}
          contentFit="contain"
          style={styles.fill}
          accessibilityLabel={message.body || 'Photo'}
        />
      )}
      {message.body ? <Text style={[styles.text, styles.caption]}>{message.body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#FFFFFF', fontSize: 16 },
  caption: { padding: 16, paddingBottom: 40, textAlign: 'center' },
  share: { color: '#FFFFFF', fontSize: 16 },
});
