import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { BET_TYPE_LABELS, BOOK_LABELS } from "@/constants/books";
import { colors, fontSize, radius, spacing, statusColor } from "@/constants/theme";
import type { Enums, Leg, SlateBoardRow } from "@/lib/database.types";
import { formatMoney, formatOdds } from "@/lib/format";

export type SlipCardLeg = Pick<Leg, "id" | "status" | "selection">;

interface SlipCardProps {
  slip: SlateBoardRow;
  legs: SlipCardLeg[];
  roomId: string;
}

export function SlipCard({ slip, legs, roomId }: SlipCardProps) {
  const router = useRouter();
  const status = (slip.status ?? "pending") as Enums<"slip_status">;
  const remaining = slip.legs_remaining ?? legs.filter((l) => isOpen(l.status)).length;
  const oneAway = status === "live" && remaining === 1;
  const border = statusColor(status, remaining);

  const pulse = useSharedValue(1);
  useEffect(() => {
    if (oneAway) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(0.35, { duration: 700, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 200 });
    }
    return () => cancelAnimation(pulse);
  }, [oneAway, pulse]);

  const glow = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const open = () => {
    if (!slip.id) return;
    router.push(`/rooms/${roomId}/slip/${slip.id}` as never);
  };

  return (
    <Pressable onPress={open} style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
      <Animated.View pointerEvents="none" style={[styles.borderLayer, { borderColor: border }, glow]} />
      <View style={styles.card}>
        <View style={styles.row}>
          <Avatar handle={slip.handle} size={28} />
          <Text style={styles.handle} numberOfLines={1}>
            {slip.handle ?? "someone"}
          </Text>
          <View style={styles.badges}>
            {slip.book ? <Badge label={BOOK_LABELS[slip.book]} /> : null}
            {slip.bet_type ? (
              <Badge label={BET_TYPE_LABELS[slip.bet_type]} style={styles.badgeGap} />
            ) : null}
          </View>
        </View>

        <View style={[styles.row, styles.moneyRow]}>
          <Text style={styles.money}>
            {formatMoney(slip.stake)} <Text style={styles.arrow}>to win</Text>{" "}
            {formatMoney(slip.potential_payout)}
          </Text>
          <Text style={[styles.odds, { color: border }]}>{formatOdds(slip.odds_american)}</Text>
        </View>

        <View style={styles.legs}>
          {legs.map((leg) => (
            <View key={leg.id} style={styles.legRow}>
              <View style={[styles.dot, { backgroundColor: statusColor(leg.status) }]} />
              <Text style={styles.legText} numberOfLines={1}>
                {leg.selection}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <Badge label={footerLabel(status, remaining, slip.legs_total ?? legs.length)} color={border} />
        </View>
      </View>
    </Pressable>
  );
}

function isOpen(s: Enums<"leg_status">): boolean {
  return s === "pending" || s === "live" || s === "needs_review";
}

function footerLabel(status: Enums<"slip_status">, remaining: number, total: number): string {
  switch (status) {
    case "won":
      return "CASHED";
    case "lost":
      return "DEAD";
    case "void":
      return "VOID";
    case "push":
      return "PUSH";
    case "live":
      return remaining === 1 ? "ONE AWAY" : `${remaining} of ${total} legs left`;
    default:
      return total === 1 ? "1 leg" : `${total} legs`;
  }
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md, borderRadius: radius.lg },
  pressed: { opacity: 0.9 },
  borderLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    margin: 1.5,
  },
  row: { flexDirection: "row", alignItems: "center" },
  handle: { color: colors.text, fontWeight: "600", marginLeft: spacing.sm, flexShrink: 1 },
  badges: { flexDirection: "row", marginLeft: "auto" },
  badgeGap: { marginLeft: spacing.xs },
  moneyRow: { marginTop: spacing.md, justifyContent: "space-between" },
  money: { color: colors.text, fontSize: fontSize.md, fontWeight: "700" },
  arrow: { color: colors.muted, fontWeight: "400", fontSize: fontSize.sm },
  odds: { fontSize: fontSize.md, fontWeight: "800", fontVariant: ["tabular-nums"] },
  legs: { marginTop: spacing.sm },
  legRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  legText: { color: colors.text, fontSize: fontSize.sm, flexShrink: 1 },
  footer: { marginTop: spacing.sm, flexDirection: "row" },
});
