import { StyleSheet, Text, TextInput, type TextInputProps, View, type ViewStyle } from "react-native";

import { colors, fontSize, radius, spacing } from "@/constants/theme";

interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  /** Amber border: parser was not sure about this value. */
  warn?: boolean;
  containerStyle?: ViewStyle;
}

export function Input({ label, hint, error, warn, containerStyle, style, ...rest }: InputProps) {
  const borderColor = error ? colors.lost : warn ? colors.oneAway : colors.border;
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        selectionColor={colors.live}
        keyboardAppearance="dark"
        {...rest}
        style={[styles.input, { borderColor }, style]}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { color: colors.muted, fontSize: fontSize.sm, marginBottom: spacing.xs, fontWeight: "500" },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.md,
  },
  hint: { color: colors.muted, fontSize: fontSize.xs, marginTop: spacing.xs },
  error: { color: colors.lost, fontSize: fontSize.xs, marginTop: spacing.xs },
});
