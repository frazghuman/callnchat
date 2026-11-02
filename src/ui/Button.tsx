import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from './theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
};

export function Button({ title, onPress, variant = 'primary', disabled, busy }: Props) {
  const { colors, radius, spacing } = useTheme();
  const filled = variant === 'primary';
  const color = variant === 'danger' ? colors.danger : filled ? '#FFFFFF' : colors.header;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.base,
        {
          borderRadius: radius.pill,
          paddingVertical: spacing(3),
          backgroundColor: filled ? colors.accent : 'transparent',
          borderColor: filled ? colors.accent : colors.separator,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.title, { color }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 20,
    minHeight: 48,
  },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
});
