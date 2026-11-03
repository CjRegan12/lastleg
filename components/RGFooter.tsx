import { StyleSheet, View } from "react-native";

import { T } from "@/components/ui/Text";
import { spacing } from "@/constants/theme";

/** Responsible gambling footer. Required on sign-in, slip detail and profile (App Store 18+ / NY). */
export function RGFooter() {
  return (
    <View style={styles.wrap}>
      <T variant="micro" style={styles.text}>
        Gambling problem? Call 1-800-GAMBLER. NY: 877-8-HOPENY or text HOPENY (467369). 21+.
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
  text: { textAlign: "center" },
});
