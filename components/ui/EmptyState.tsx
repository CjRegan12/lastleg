import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, fontSize, spacing } from "@/constants/theme";

interface EmptyStateProps {
  title: string;
  body?: string;
  action?: ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: spacing.xxl * 2, paddingHorizontal: spacing.xl },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: "700", textAlign: "center" },
  body: {
    color: colors.muted,
    fontSize: fontSize.md,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  action: { marginTop: spacing.xl, alignSelf: "stretch" },
});
