import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { T } from "@/components/ui/Text";
import { BOOK_LABELS } from "@/constants/books";
import { amberGlow, colors, radius, spacing, statusColor } from "@/constants/theme";
import type { FeedSlip } from "@/hooks/useSlipFeed";
import { formatMoney, formatOdds, formatRelative } from "@/lib/format";

interface Props {
  slip: FeedSlip;
  /** Show the owner (feeds) or the room (your own lists). */
  lead: "owner" | "room";
  /** Compact hides the leg list past the first three. */
  compact?: boolean;
}

/**
 * The one slip card, reused in Live, Community and You. Card color is state.
 * One leg away is the only card that glows, and it breathes once when it
 * becomes one away (not on every render).
 */
export function FeedSlipCard({ slip, lead, compact = false }: Props) {
  const router = useRouter();
  const remaining = slip.legs_remaining ?? 0;
  const oneAway = slip.status === "live" && remaining === 1 && slip.legs_total > 1;
  const edge = statusColor(slip.status, remaining);

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

  const legs = compact ? slip.legs.slice(0, 3) : slip.legs;
  const hidden = slip.legs.length - legs.length;
  const hasStake = slip.stake > 0;

  return (
    <Animated.View style={[styles.wrap, oneAway && styles.glow, breathe]}>
      <Pressable
        onPress={() => router.push(`/rooms/${slip.room_id}/slip/${slip.id}` as never)}
        style={({ pressed }) => [styles.card, { borderColor: oneAway ? colors.oneAway : colors.border }, pressed && styles.pressed]}
      >
        <View style={styles.head}>
          {lead === "owner" ? (
            <>
              <Avatar handle={slip.handle} size={26} />
              <T variant="smallMedium" style={styles.lead} numberOfLines={1}>
                {slip.handle}
              </T>
            </>
          ) : (
            <T variant="smallMedium" style={styles.lead} numberOfLines={1}>
              {slip.room_name}
            </T>
          )}
          <T variant="small" numberOfLines={1}>
            {BOOK_LABELS[slip.book]}
          </T>
          <T variant="small" style={styles.when}>
            {formatRelative(slip.settled_at ?? slip.created_at)}
          </T>
        </View>

        <View style={styles.money}>
          <T variant="number" color={edge}>
            {formatOdds(slip.odds_american)}
          </T>
          {hasStake ? (
            <T variant="small" style={styles.stake}>
              {formatMoney(slip.stake)} to win {formatMoney(slip.potential_payout)}
            </T>
          ) : (
            <T variant="small" color={colors.oneAway} style={styles.stake}>
              Stake not read
            </T>
          )}
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
          {hidden > 0 ? (
            <T variant="small" style={styles.more}>
              +{hidden} more
            </T>
          ) : null}
        </View>

        <View style={styles.foot}>
          <Badge label={footLabel(slip, remaining)} color={edge} solid={oneAway} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

function footLabel(slip: FeedSlip, remaining: number): string {
  switch (slip.status) {
    case "won":
      return "Cashed";
    case "lost":
      return "Dead";
    case "void":
      return "Void";
    case "push":
      return "Push";
    case "live":
      if (slip.legs_total <= 1) return "Live";
      return remaining === 1 ? "One leg away" : `${remaining} of ${slip.legs_total} legs left`;
    default:
      return slip.legs_total === 1 ? "1 leg" : `${slip.legs_total} legs`;
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
  lead: { flexShrink: 1, marginRight: "auto" },
  when: { marginLeft: spacing.xs },
  money: { flexDirection: "row", alignItems: "baseline", gap: spacing.md, marginTop: spacing.md },
  stake: { flexShrink: 1 },
  legs: { marginTop: spacing.sm },
  legRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  legText: { flexShrink: 1 },
  more: { marginLeft: spacing.lg, marginTop: 2 },
  foot: { marginTop: spacing.md, flexDirection: "row" },
});
