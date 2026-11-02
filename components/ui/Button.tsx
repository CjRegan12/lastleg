import * as Haptics from "expo-haptics";
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";

import { colors, fonts, fontSize, radius, spacing } from "@/constants/theme";

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

/**
 * Primary is light-on-ink (the brand amber is reserved for one-leg-away).
 * Secondary is a bordered surface; ghost is text only; danger is red.
 */
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
      ? colors.text
      : variant === "danger"
        ? colors.lost
        : variant === "secondary"
          ? colors.surfaceRaised
          : "transparent";
  const fg = variant === "primary" ? colors.bg : variant === "danger" ? colors.white : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      onPress={() => {
        Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        size === "sm" && styles.sm,
        { backgroundColor: bg, opacity: inactive ? 0.45 : pressed ? 0.75 : 1 },
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
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sm: { minHeight: 36, paddingHorizontal: spacing.md },
  outlined: { borderWidth: 1, borderColor: colors.border },
  label: { fontFamily: fonts.bodySemi, fontSize: fontSize.md + 1 },
  labelSm: { fontSize: fontSize.sm },
});
