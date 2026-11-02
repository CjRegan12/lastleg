import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { colors, fonts, fontSize, radius, spacing } from "@/constants/theme";

interface BadgeProps {
  label: string;
  /** Text color. Background is a tinted version unless solid. */
  color?: string;
  solid?: boolean;
  style?: ViewStyle;
}

export function Badge({ label, color = colors.muted, solid = false, style }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: solid ? color : `${color}1F` }, style]}>
      <Text style={[styles.text, { color: solid ? colors.bg : color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  text: { fontFamily: fonts.bodySemi, fontSize: fontSize.xs + 1 },
});
