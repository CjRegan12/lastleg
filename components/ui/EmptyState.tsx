import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, spacing } from "@/constants/theme";

import { T } from "./Text";

interface EmptyStateProps {
  title: string;
  body?: string;
  action?: ReactNode;
}

/** An empty screen is an invitation to act: title says what's missing, body says what to do. */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <T variant="title" style={styles.title}>
        {title}
      </T>
      {body ? (
        <T variant="body" style={styles.body}>
          {body}
        </T>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: spacing.xl, paddingBottom: spacing.xxl, paddingHorizontal: spacing.xs },
  title: { textAlign: "left" },
  body: { color: colors.muted, marginTop: spacing.sm, maxWidth: 320 },
  action: { marginTop: spacing.xl, alignSelf: "stretch" },
});
