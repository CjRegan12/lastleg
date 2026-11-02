import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, fonts, fontSize, radius, spacing } from "@/constants/theme";

interface SegmentedProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labels?: Partial<Record<T, string>>;
  /** Horizontal scroll for long option lists (books, markets). */
  scrollable?: boolean;
  warn?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
  scrollable = false,
  warn = false,
}: SegmentedProps<T>) {
  const items = options.map((opt) => {
    const active = opt === value;
    return (
      <Pressable
        key={opt}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => onChange(opt)}
        style={[styles.item, active && styles.itemActive, scrollable && styles.itemScroll]}
      >
        <Text style={[styles.label, active && styles.labelActive]}>{labels?.[opt] ?? opt}</Text>
      </Pressable>
    );
  });
  const border = warn ? colors.oneAway : colors.border;
  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.track, { borderColor: border }]}
        contentContainerStyle={styles.scrollContent}
      >
        {items}
      </ScrollView>
    );
  }
  return <View style={[styles.track, styles.row, { borderColor: border }]}>{items}</View>;
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 3,
  },
  row: { flexDirection: "row" },
  scrollContent: { flexDirection: "row", gap: 2 },
  item: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  itemScroll: { flex: 0, paddingHorizontal: spacing.md },
  itemActive: { backgroundColor: colors.surfaceRaised },
  label: { fontFamily: fonts.bodyMedium, color: colors.muted, fontSize: fontSize.sm },
  labelActive: { color: colors.text },
});
