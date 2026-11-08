import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useChatStore } from '@/features/chat/chatStore';
import { formatTime } from '@/features/chat/format';
import { mapsUrl } from '@/features/location/location';
import { useSessionStore } from '@/features/session/sessionStore';
import { Button } from '@/ui/Button';
import { useTheme } from '@/ui/theme';

/** Full map for a shared pin or live location, following live updates. */
export default function LocationScreen() {
  const { colors, font } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const message = useChatStore((s) => s.messages.find((m) => m.id === id));
  const peerName = useSessionStore((s) => s.session?.peer?.displayName ?? '');
  const [openedAt] = useState(() => Date.now());

  const loc = message?.location;
  if (!message || !loc) {
    return (
      <View style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textMuted }}>This location is no longer available.</Text>
      </View>
    );
  }

  const who = message.direction === 'out' ? 'You' : peerName;
  const ongoing = !!loc.liveUntil && !loc.endedAt && loc.liveUntil > openedAt;
  const coordinate = { latitude: loc.lat, longitude: loc.lng };
  const status = !loc.liveUntil
    ? `${who} shared this location at ${formatTime(message.sentAt)}`
    : ongoing
      ? `Live until ${formatTime(loc.liveUntil)} · updated ${formatTime(loc.updatedAt)}`
      : `Live location ended · last updated ${formatTime(loc.updatedAt)}`;

  return (
    <View style={styles.flex}>
      <MapView
        style={styles.flex}
        region={{ ...coordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
        showsUserLocation
      >
        <Marker coordinate={coordinate} title={who} />
      </MapView>
      <View
        style={[
          styles.panel,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <Text style={{ color: colors.text, fontSize: font.body }}>{status}</Text>
        {loc.acc ? (
          <Text style={{ color: colors.textMuted, fontSize: font.caption }}>
            Accurate to about {loc.acc} m
          </Text>
        ) : null}
        <Button
          title="Open in Maps"
          variant="secondary"
          onPress={() => void Linking.openURL(mapsUrl(loc, `${who}'s location`))}
        />
        {ongoing && message.direction === 'out' ? (
          <Button
            title="Stop sharing"
            variant="danger"
            onPress={() =>
              useChatStore
                .getState()
                .stopLiveLocation(message.id)
                .catch((e: unknown) =>
                  Alert.alert("Couldn't stop", e instanceof Error ? e.message : String(e)),
                )
            }
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  panel: { padding: 16, gap: 10 },
});
