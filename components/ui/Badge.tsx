import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { colors, fontSize, radius, spacing } from "@/constants/theme";

interface BadgeProps {
  label: string;
  /** Border and text color. Background is a tinted version. */
  color?: string;
  solid?: boolean;
  style?: ViewStyle;
}

export function Badge({ label, color = colors.muted, solid = false, style }: BadgeProps) {
  return (
    <View
      style={[
        styles.badge,
        { borderColor: color, backgroundColor: solid ? color : `${color}22` },
        style,
      ]}
    >
      <Text style={[styles.text, { color: solid ? colors.black : color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  text: { fontSize: fontSize.xs, fontWeight: "700", letterSpacing: 0.3 },
});
