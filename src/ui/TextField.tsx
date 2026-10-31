import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from './theme';

type Props = TextInputProps & { label: string; error?: string | null };

export function TextField({ label, error, style, ...input }: Props) {
  const { colors, radius, spacing, font } = useTheme();

  return (
    <View style={{ gap: spacing(1) }}>
      <Text style={{ color: colors.textMuted, fontSize: font.caption }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderRadius: radius.card,
            borderColor: error ? colors.danger : 'transparent',
            fontSize: font.body,
          },
          style,
        ]}
        {...input}
      />
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: font.caption }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
});
