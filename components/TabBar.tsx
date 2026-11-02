import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, fonts, fontSize, radius, spacing } from "@/constants/theme";

/** Tab order is fixed; the add button sits between Rooms and Community. */
const TABS: Record<string, { label: string; icon: SFSymbol; active: SFSymbol }> = {
  index: { label: "Live", icon: "bolt", active: "bolt.fill" },
  rooms: { label: "Rooms", icon: "person.2", active: "person.2.fill" },
  community: { label: "Community", icon: "trophy", active: "trophy.fill" },
  you: { label: "You", icon: "person.crop.circle", active: "person.crop.circle.fill" },
};

export function TabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const router = useRouter();
  const routes = state.routes.filter((r) => TABS[r.name]);
  const left = routes.slice(0, 2);
  const right = routes.slice(2, 4);

  const renderTab = (route: (typeof routes)[number]) => {
    const index = state.routes.findIndex((r) => r.key === route.key);
    const focused = state.index === index;
    const meta = TABS[route.name];
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={meta.label}
        onPress={() => {
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            Haptics.selectionAsync().catch(() => undefined);
            navigateToTab(route.key);
          }
        }}
        style={styles.tab}
      >
        <SymbolView
          name={focused ? meta.active : meta.icon}
          size={24}
          tintColor={focused ? colors.text : colors.muted}
          weight={focused ? "semibold" : "regular"}
          fallback={<View style={styles.iconFallback} />}
        />
        <Text style={[styles.label, focused && styles.labelActive]}>{meta.label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {left.map(renderTab)}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add slip"
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          router.push("/pick-room" as never);
        }}
        style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
      >
        <SymbolView name="plus" size={26} tintColor={colors.bg} weight="bold" fallback={<Text style={styles.plus}>+</Text>} />
      </Pressable>
      {right.map(renderTab)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "flex-end", paddingVertical: spacing.xs, gap: 3 },
  iconFallback: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.border },
  label: { fontFamily: fonts.bodyMedium, fontSize: fontSize.xs, color: colors.muted },
  labelActive: { color: colors.text },
  add: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  addPressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  plus: { color: colors.bg, fontSize: 30, lineHeight: 32, fontFamily: fonts.condensedBold },
});
