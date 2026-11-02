import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";

import { colors, fontSize, radius, spacing } from "@/constants/theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;
  const bg =
    variant === "primary"
      ? colors.live
      : variant === "danger"
        ? colors.lost
        : variant === "secondary"
          ? colors.surfaceRaised
          : "transparent";
  const fg = variant === "primary" || variant === "danger" ? colors.white : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        size === "sm" && styles.sm,
        { backgroundColor: bg, opacity: inactive ? 0.5 : pressed ? 0.8 : 1 },
        variant === "secondary" && styles.outlined,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.label, size === "sm" && styles.labelSm, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sm: { minHeight: 36, paddingHorizontal: spacing.md },
  outlined: { borderWidth: 1, borderColor: colors.border },
  label: { fontSize: fontSize.md, fontWeight: "600" },
  labelSm: { fontSize: fontSize.sm },
});
