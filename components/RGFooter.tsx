import { StyleSheet, Text, View } from "react-native";

import { colors, fontSize, spacing } from "@/constants/theme";

/** Responsible gambling footer. Required on sign-in, slip detail and profile (App Store 18+ / NY). */
export function RGFooter() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>
        Gambling Problem? Call 1-800-GAMBLER. NY: 877-8-HOPENY or text HOPENY (467369). 21+.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
  text: { color: colors.muted, fontSize: fontSize.xs, textAlign: "center", lineHeight: 16 },
});
