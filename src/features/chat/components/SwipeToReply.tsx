import * as Haptics from 'expo-haptics';
import { useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { useTheme } from '@/ui/theme';

/** Swipe a bubble right to reply, like WhatsApp. The bubble springs back on its own. */
export function SwipeToReply({
  enabled,
  onReply,
  children,
}: {
  enabled: boolean;
  onReply: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const ref = useRef<SwipeableMethods>(null);

  if (!enabled) return <>{children}</>;

  return (
    <Swipeable
      ref={ref}
      friction={2}
      leftThreshold={56}
      overshootLeft={false}
      // The reply icon sits underneath the row; an opaque row keeps it hidden until a swipe.
      childrenContainerStyle={{ backgroundColor: colors.chatBackground }}
      renderLeftActions={() => (
        <View style={styles.action}>
          <View style={[styles.icon, { backgroundColor: colors.surface }]}>
            <Text style={{ color: colors.text }}>↩︎</Text>
          </View>
        </View>
      )}
      onSwipeableWillOpen={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onReply();
        ref.current?.close();
      }}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: { width: 56, justifyContent: 'center', alignItems: 'center' },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
