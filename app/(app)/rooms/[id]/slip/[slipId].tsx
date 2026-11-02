import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { RGFooter } from "@/components/RGFooter";
import { Avatar, AvatarStack, Badge, Button, Screen } from "@/components/ui";
import { BET_TYPE_LABELS, BOOK_LABELS, BOOK_URLS, MARKET_LABELS } from "@/constants/books";
import { colors, fontSize, radius, spacing, statusColor, statusLabel } from "@/constants/theme";
import { useUserId } from "@/lib/auth";
import type { Enums, Leg, Slip } from "@/lib/database.types";
import { formatLine, formatMoney, formatOdds, formatRelative } from "@/lib/format";
import { useRoomChannel } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";

type SettleStatus = Extract<Enums<"leg_status">, "won" | "lost" | "void" | "push">;
const SETTLE_OPTIONS: SettleStatus[] = ["won", "lost", "void", "push"];

interface OverrideInfo {
  handle: string;
  new_status: Enums<"leg_status">;
  created_at: string;
}

export default function SlipDetailScreen() {
  const { id: roomId, slipId } = useLocalSearchParams<{ id: string; slipId: string }>();
  const userId = useUserId();
  const [slip, setSlip] = useState<(Slip & { handle: string }) | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [overrides, setOverrides] = useState<Record<string, OverrideInfo>>({});
  const [sharedBy, setSharedBy] = useState<Record<string, string[]>>({});
  const [tailed, setTailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slipId || !roomId) return;
    const [slipRes, legsRes, tailRes] = await Promise.all([
      supabase.from("slips").select("*, profiles(handle)").eq("id", slipId).maybeSingle(),
      supabase.from("legs").select("*").eq("slip_id", slipId).order("created_at", { ascending: true }),
      supabase.from("tails").select("slip_id").eq("slip_id", slipId).eq("user_id", userId).maybeSingle(),
    ]);
    if (slipRes.error) setError(slipRes.error.message);
    if (slipRes.data) {
      const { profiles, ...rest } = slipRes.data;
      setSlip({ ...rest, handle: profiles?.handle ?? "someone" });
    }
    const legRows = legsRes.data ?? [];
    setLegs(legRows);
    setTailed(!!tailRes.data);

    const legIds = legRows.map((l) => l.id);
    if (legIds.length > 0) {
      const { data: ov } = await supabase
        .from("leg_overrides")
        .select("leg_id, new_status, created_at, profiles(handle)")
        .in("leg_id", legIds)
        .order("created_at", { ascending: false });
      const latest: Record<string, OverrideInfo> = {};
      for (const o of ov ?? []) {
        if (!latest[o.leg_id]) {
          latest[o.leg_id] = {
            handle: o.profiles?.handle ?? "someone",
            new_status: o.new_status,
            created_at: o.created_at,
          };
        }
      }
      setOverrides(latest);
    }

    // Who else in the room has the same leg (same event + market key + line).
    const matched = legRows.filter((l) => l.propfein_event_id && l.propfein_market_key);
    if (matched.length > 0) {
      const { data: others } = await supabase
        .from("legs")
        .select("propfein_event_id, propfein_market_key, line, slip_id, slips(user_id, profiles(handle))")
        .eq("room_id", roomId)
        .neq("slip_id", slipId)
        .in(
          "propfein_event_id",
          matched.map((l) => l.propfein_event_id as string),
        );
      const map: Record<string, string[]> = {};
      for (const o of others ?? []) {
        const key = legKey(o.propfein_event_id, o.propfein_market_key, o.line);
        const handle = o.slips?.profiles?.handle;
        if (!handle) continue;
        const arr = (map[key] ??= []);
        if (!arr.includes(handle)) arr.push(handle);
      }
      setSharedBy(map);
    }
  }, [slipId, roomId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  useRoomChannel(roomId, (table, _op, record) => {
    if (table === "legs" && record?.slip_id === slipId) load();
    if (table === "slips" && record?.id === slipId) load();
  });

  const overrideLeg = (leg: Leg) => {
    const apply = async (status: SettleStatus) => {
      const { error: err } = await supabase.rpc("override_leg", { p_leg_id: leg.id, p_new_status: status });
      if (err) Alert.alert("Override failed", err.message);
      else load();
    };
    const labels = SETTLE_OPTIONS.map((s) => `Mark ${s}`);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: leg.selection,
          message: "Override the grade for everyone in the room. It is logged with your handle.",
          options: [...labels, "Cancel"],
          cancelButtonIndex: labels.length,
          destructiveButtonIndex: 1,
          userInterfaceStyle: "dark",
        },
        (idx) => {
          const s = SETTLE_OPTIONS[idx];
          if (s) apply(s);
        },
      );
    } else {
      Alert.alert(leg.selection, "Override the grade for everyone in the room.", [
        ...SETTLE_OPTIONS.map((s) => ({ text: `Mark ${s}`, onPress: () => apply(s) })),
        { text: "Cancel", style: "cancel" as const },
      ]);
    }
  };

  const tail = async () => {
    if (!slip) return;
    const url = BOOK_URLS[slip.book];
    await supabase
      .from("tails")
      .upsert(
        { slip_id: slip.id, user_id: userId, book_clicked: slip.book },
        { onConflict: "slip_id,user_id", ignoreDuplicates: true },
      );
    setTailed(true);
    if (url) {
      Linking.openURL(url).catch(() => Alert.alert("Could not open", `Open ${BOOK_LABELS[slip.book]} manually.`));
    } else {
      Alert.alert("No link", "This book has no home link set. Place it in your app.");
    }
  };

  if (!slip) {
    return (
      <Screen edges={["bottom"]}>
        <Text style={styles.muted}>{error ?? "Loading..."}</Text>
      </Screen>
    );
  }

  const slipColor = statusColor(slip.status, slip.legs_remaining);
  const isMine = slip.user_id === userId;

  return (
    <Screen scroll edges={["bottom"]}>
      <View style={[styles.header, { borderColor: slipColor }]}>
        <View style={styles.row}>
          <Avatar handle={slip.handle} size={36} />
          <View style={styles.headerText}>
            <Text style={styles.handle}>{slip.handle}</Text>
            <Text style={styles.muted}>
              {BOOK_LABELS[slip.book]} · {BET_TYPE_LABELS[slip.bet_type]} · {formatRelative(slip.created_at)}
            </Text>
          </View>
          <Badge label={statusLabel(slip.status).toUpperCase()} color={slipColor} solid />
        </View>
        <View style={[styles.row, styles.moneyRow]}>
          <View>
            <Text style={styles.moneyLabel}>Stake</Text>
            <Text style={styles.money}>{formatMoney(slip.stake)}</Text>
          </View>
          <View style={styles.center}>
            <Text style={styles.moneyLabel}>Odds</Text>
            <Text style={[styles.money, { color: slipColor }]}>{formatOdds(slip.odds_american)}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.moneyLabel}>To win</Text>
            <Text style={styles.money}>{formatMoney(slip.potential_payout)}</Text>
          </View>
        </View>
        {slip.status === "live" ? (
          <Text style={[styles.remaining, { color: slipColor }]}>
            {slip.legs_remaining === 1 ? "ONE LEG AWAY" : `${slip.legs_remaining} of ${slip.legs_total} legs left`}
          </Text>
        ) : null}
      </View>

      <Text style={styles.section}>Legs</Text>
      {legs.map((leg) => {
        const c = statusColor(leg.status);
        const others = sharedBy[legKey(leg.propfein_event_id, leg.propfein_market_key, leg.line)] ?? [];
        const ov = overrides[leg.id];
        return (
          <Pressable
            key={leg.id}
            onLongPress={() => overrideLeg(leg)}
            delayLongPress={400}
            style={({ pressed }) => [styles.leg, { borderLeftColor: c }, pressed && styles.pressed]}
          >
            <View style={styles.row}>
              <Text style={styles.legSelection} numberOfLines={2}>
                {leg.selection}
              </Text>
              <Badge label={statusLabel(leg.status)} color={c} />
            </View>
            <Text style={styles.legMeta}>
              {MARKET_LABELS[leg.market]}
              {leg.player_name ? ` · ${leg.player_name}` : ""}
              {leg.stat_type ? ` · ${leg.stat_type.replace(/_/g, " ")}` : ""}
              {leg.line != null ? ` · line ${formatLine(leg.line, leg.market)}` : ""}
              {leg.leg_odds_american != null ? ` · ${formatOdds(leg.leg_odds_american)}` : ""}
            </Text>
            {/* Live/final context comes from the leg row itself (the grader writes
                current_value); the app never talks to Propfein directly. */}
            {leg.current_value != null && leg.line != null && leg.status !== "pending" ? (
              <Text style={[styles.progress, { color: c }]}>
                {formatLine(leg.current_value, leg.market)} / {formatLine(leg.line, leg.market)}
                {leg.side ? ` (${leg.side})` : ""}
              </Text>
            ) : null}
            {leg.status === "pending" ? (
              <Text style={styles.event}>Not started. Updates land here once the game is live.</Text>
            ) : leg.status === "live" && leg.current_value == null ? (
              <Text style={styles.event}>Live. Waiting on the first number from the grader.</Text>
            ) : leg.status === "needs_review" ? (
              <Text style={styles.warn}>Could not match this to a game. Long press to grade it by hand.</Text>
            ) : null}
            {ov ? (
              <Text style={styles.override}>
                Overridden to {ov.new_status} by {ov.handle} · {formatRelative(ov.created_at)}
              </Text>
            ) : null}
            {others.length > 0 ? (
              <View style={[styles.row, styles.others]}>
                <AvatarStack handles={others} size={20} />
                <Text style={styles.othersText}>
                  {others.length === 1 ? `${others[0]} has this too` : `${others.length} others have this`}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
      <Text style={styles.hint}>Long press a leg to override its grade.</Text>

      {!isMine && slip.status !== "lost" ? (
        <Button
          title={tailed ? `Tailed · open ${BOOK_LABELS[slip.book]}` : `Tail this bet on ${BOOK_LABELS[slip.book]}`}
          variant={tailed ? "secondary" : "primary"}
          onPress={tail}
          style={styles.tail}
        />
      ) : null}

      <RGFooter />
    </Screen>
  );
}

function legKey(eventId: string | null, marketKey: string | null, line: number | null): string {
  return `${eventId ?? ""}|${marketKey ?? ""}|${line ?? ""}`;
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  row: { flexDirection: "row", alignItems: "center" },
  headerText: { flex: 1, marginLeft: spacing.md },
  handle: { color: colors.text, fontWeight: "700", fontSize: fontSize.md },
  muted: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
  moneyRow: { marginTop: spacing.lg, justifyContent: "space-between" },
  center: { alignItems: "center" },
  right: { alignItems: "flex-end" },
  moneyLabel: { color: colors.muted, fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 1 },
  money: { color: colors.text, fontSize: fontSize.xl, fontWeight: "800", fontVariant: ["tabular-nums"] },
  remaining: { marginTop: spacing.md, fontWeight: "800", letterSpacing: 1, fontSize: fontSize.sm },
  section: {
    color: colors.muted,
    fontSize: fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  leg: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.85 },
  legSelection: { color: colors.text, fontSize: fontSize.md, fontWeight: "600", flex: 1, marginRight: spacing.sm },
  legMeta: { color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.xs },
  progress: { fontSize: fontSize.md, fontWeight: "800", marginTop: spacing.sm, fontVariant: ["tabular-nums"] },
  event: { color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.xs },
  warn: { color: colors.oneAway, fontSize: fontSize.sm, marginTop: spacing.xs },
  override: { color: colors.oneAway, fontSize: fontSize.xs, marginTop: spacing.sm, fontStyle: "italic" },
  others: { marginTop: spacing.sm },
  othersText: { color: colors.muted, fontSize: fontSize.xs, marginLeft: spacing.sm },
  hint: { color: colors.pending, fontSize: fontSize.xs, textAlign: "center", marginTop: spacing.xs },
  tail: { marginTop: spacing.xl },
});
