import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import { type Edge, SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing } from "@/constants/theme";

interface ScreenProps {
  children: ReactNode;
  /** Wrap in a ScrollView. Off for screens that own a FlatList. */
  scroll?: boolean;
  /** Safe-area edges. Screens under a native header usually want ["bottom"]. */
  edges?: Edge[];
  padded?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}

export function Screen({
  children,
  scroll = false,
  edges = ["top", "bottom"],
  padded = true,
  style,
  contentStyle,
}: ScreenProps) {
  const inner = [padded && styles.padded, contentStyle];
  return (
    <SafeAreaView edges={edges} style={[styles.root, style]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, inner]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  padded: { paddingHorizontal: spacing.lg },
  scrollContent: { paddingBottom: spacing.xxl },
});
