import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { T } from "@/components/ui/Text";
import { BET_TYPE_LABELS, BOOK_LABELS } from "@/constants/books";
import { amberGlow, colors, radius, spacing, statusColor } from "@/constants/theme";
import type { Enums, Leg, SlateBoardRow } from "@/lib/database.types";
import { formatMoney, formatOdds } from "@/lib/format";

export type SlipCardLeg = Pick<Leg, "id" | "status" | "selection">;

interface SlipCardProps {
  slip: SlateBoardRow;
  legs: SlipCardLeg[];
  roomId: string;
}

/**
 * Room board card. Same look as FeedSlipCard: hairline border, amber edge and
 * glow only when one leg away, with a single breathe the moment it gets there.
 */
export function SlipCard({ slip, legs, roomId }: SlipCardProps) {
  const router = useRouter();
  const status = (slip.status ?? "pending") as Enums<"slip_status">;
  const remaining = slip.legs_remaining ?? legs.filter((l) => isOpen(l.status)).length;
  const oneAway = status === "live" && remaining === 1;
  const edge = statusColor(status, remaining);

  const scale = useSharedValue(1);
  const wasOneAway = useRef(oneAway);
  useEffect(() => {
    if (oneAway && !wasOneAway.current) {
      scale.value = withSequence(
        withTiming(1.015, { duration: 220, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 320, easing: Easing.inOut(Easing.quad) }),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    }
    wasOneAway.current = oneAway;
  }, [oneAway, scale]);
  const breathe = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const open = () => {
    if (!slip.id) return;
    router.push(`/rooms/${roomId}/slip/${slip.id}` as never);
  };

  return (
    <Animated.View style={[styles.wrap, oneAway && styles.glow, breathe]}>
      <Pressable
        onPress={open}
        style={({ pressed }) => [styles.card, { borderColor: oneAway ? colors.oneAway : colors.border }, pressed && styles.pressed]}
      >
        <View style={styles.head}>
          <Avatar handle={slip.handle} size={26} />
          <T variant="smallMedium" style={styles.handle} numberOfLines={1}>
            {slip.handle ?? "someone"}
          </T>
          {slip.book ? (
            <T variant="small" numberOfLines={1}>
              {BOOK_LABELS[slip.book]}
            </T>
          ) : null}
          {slip.bet_type ? (
            <T variant="small" numberOfLines={1}>
              {BET_TYPE_LABELS[slip.bet_type]}
            </T>
          ) : null}
        </View>

        <View style={styles.money}>
          <T variant="number" color={edge}>
            {formatOdds(slip.odds_american)}
          </T>
          <T variant="small" style={styles.stake}>
            {formatMoney(slip.stake)} to win {formatMoney(slip.potential_payout)}
          </T>
        </View>

        <View style={styles.legs}>
          {legs.map((leg) => (
            <View key={leg.id} style={styles.legRow}>
              <View style={[styles.dot, { backgroundColor: statusColor(leg.status) }]} />
              <T variant="body" style={styles.legText} numberOfLines={1}>
                {leg.selection}
              </T>
            </View>
          ))}
        </View>

        <View style={styles.foot}>
          <Badge label={footerLabel(status, remaining, slip.legs_total ?? legs.length)} color={edge} solid={oneAway} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

function isOpen(s: Enums<"leg_status">): boolean {
  return s === "pending" || s === "live" || s === "needs_review";
}

function footerLabel(status: Enums<"slip_status">, remaining: number, total: number): string {
  switch (status) {
    case "won":
      return "Cashed";
    case "lost":
      return "Dead";
    case "void":
      return "Void";
    case "push":
      return "Push";
    case "live":
      return remaining === 1 ? "One leg away" : `${remaining} of ${total} legs left`;
    default:
      return total === 1 ? "1 leg" : `${total} legs`;
  }
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md, borderRadius: radius.lg },
  glow: amberGlow,
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  pressed: { opacity: 0.9 },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  handle: { flexShrink: 1, marginRight: "auto" },
  money: { flexDirection: "row", alignItems: "baseline", gap: spacing.md, marginTop: spacing.md },
  stake: { flexShrink: 1 },
  legs: { marginTop: spacing.sm },
  legRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  legText: { flexShrink: 1 },
  foot: { marginTop: spacing.md, flexDirection: "row" },
});
