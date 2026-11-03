import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActionSheetIOS, Alert, Linking, Platform, Pressable, StyleSheet, View } from "react-native";

import { RGFooter } from "@/components/RGFooter";
import { Avatar, AvatarStack, Badge, Button, Screen, T } from "@/components/ui";
import { BET_TYPE_LABELS, BOOK_LABELS, BOOK_URLS, MARKET_LABELS } from "@/constants/books";
import { amberGlow, colors, radius, spacing, statusColor, statusLabel } from "@/constants/theme";
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
        <T variant="body" color={colors.muted} style={styles.loading}>
          {error ?? "Loading..."}
        </T>
      </Screen>
    );
  }

  const slipColor = statusColor(slip.status, slip.legs_remaining);
  const isMine = slip.user_id === userId;
  const oneAway = slip.status === "live" && slip.legs_remaining === 1;

  return (
    <Screen scroll edges={["bottom"]}>
      <View style={[styles.header, { borderColor: oneAway ? colors.oneAway : colors.border }, oneAway && styles.glow]}>
        <View style={styles.row}>
          <Avatar handle={slip.handle} size={36} />
          <View style={styles.headerText}>
            <T variant="heading" numberOfLines={1}>
              {slip.handle}
            </T>
            <T variant="small" style={styles.meta}>
              {BET_TYPE_LABELS[slip.bet_type]} on {BOOK_LABELS[slip.book]}, {formatRelative(slip.created_at)}
            </T>
          </View>
          <Badge label={headerLabel(slip)} color={slipColor} solid={oneAway} />
        </View>
        <View style={[styles.row, styles.moneyRow]}>
          <View>
            <T variant="small">Stake</T>
            <T variant="number">{formatMoney(slip.stake)}</T>
          </View>
          <View style={styles.center}>
            <T variant="small">Odds</T>
            <T variant="number" color={slipColor}>
              {formatOdds(slip.odds_american)}
            </T>
          </View>
          <View style={styles.right}>
            <T variant="small">To win</T>
            <T variant="number">{formatMoney(slip.potential_payout)}</T>
          </View>
        </View>
      </View>

      <T variant="heading" style={styles.section}>
        Legs
      </T>
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
              <T variant="bodyMedium" style={styles.legSelection} numberOfLines={2}>
                {leg.selection}
              </T>
              <Badge label={statusLabel(leg.status)} color={c} />
            </View>
            <T variant="small" style={styles.legMeta}>
              {legMeta(leg)}
            </T>
            {/* Event context comes from the leg row itself: `teams` from the parse and
                current_value from the grader. The app never talks to Propfein directly. */}
            {leg.teams && leg.teams.length > 0 ? (
              <T variant="small" color={colors.text} style={styles.teams}>
                {leg.teams.join(" vs ")}
              </T>
            ) : null}
            {leg.current_value != null && leg.line != null && leg.status !== "pending" ? (
              <T variant="number" color={c} style={styles.progress}>
                {leg.status === "live" ? "Now " : ""}
                {formatLine(leg.current_value, leg.market)}
                {leg.market === "spread" ? " margin" : ""}, line {formatLine(leg.line, leg.market)}
                {leg.side ? ` (${leg.side})` : ""}
              </T>
            ) : leg.current_value != null && leg.status !== "pending" ? (
              <T variant="number" color={c} style={styles.progress}>
                {leg.status === "live" ? "Now " : ""}margin {formatLine(leg.current_value, "spread")}
              </T>
            ) : null}
            {leg.status === "pending" ? (
              <T variant="small" style={styles.note}>
                Not started. Updates land here once the game is live.
              </T>
            ) : leg.status === "live" && leg.current_value == null ? (
              <T variant="small" style={styles.note}>
                Live. Waiting on the first number from the grader.
              </T>
            ) : leg.status === "needs_review" ? (
              <T variant="small" color={colors.oneAway} style={styles.note}>
                Could not match this to a game. Long press to grade it by hand.
              </T>
            ) : null}
            {ov ? (
              <T variant="micro" color={colors.oneAway} style={styles.override}>
                Overridden to {ov.new_status} by {ov.handle} {formatRelative(ov.created_at)}
              </T>
            ) : null}
            {others.length > 0 ? (
              <View style={[styles.row, styles.others]}>
                <AvatarStack handles={others} size={20} />
                <T variant="micro" style={styles.othersText}>
                  {others.length === 1 ? `${others[0]} has this too` : `${others.length} others have this`}
                </T>
              </View>
            ) : null}
          </Pressable>
        );
      })}
      <T variant="micro" style={styles.hint}>
        Long press a leg to override its grade.
      </T>

      {!isMine && slip.status !== "lost" ? (
        <Button
          title={tailed ? `Tailed. Open ${BOOK_LABELS[slip.book]}` : `Tail this bet on ${BOOK_LABELS[slip.book]}`}
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

/** Status badge for the slip header. Live parlays say how far from cashing. */
function headerLabel(slip: Slip): string {
  if (slip.status === "live") {
    if (slip.legs_remaining === 1) return "One leg away";
    if (slip.legs_total > 1) return `${slip.legs_remaining} of ${slip.legs_total} legs left`;
  }
  return statusLabel(slip.status);
}

/** One plain line under the selection: market, player, stat, line and odds, comma separated. */
function legMeta(leg: Leg): string {
  const parts: string[] = [MARKET_LABELS[leg.market]];
  if (leg.player_name) parts.push(leg.player_name);
  if (leg.stat_type) parts.push(leg.stat_type.replace(/_/g, " "));
  if (leg.line != null) parts.push(`line ${formatLine(leg.line, leg.market)}`);
  if (leg.leg_odds_american != null) parts.push(formatOdds(leg.leg_odds_american));
  return parts.join(", ");
}

const styles = StyleSheet.create({
  loading: { marginTop: spacing.lg },
  header: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  glow: amberGlow,
  row: { flexDirection: "row", alignItems: "center" },
  headerText: { flex: 1, marginLeft: spacing.md, marginRight: spacing.sm },
  meta: { marginTop: 2 },
  moneyRow: { marginTop: spacing.lg, justifyContent: "space-between" },
  center: { alignItems: "center" },
  right: { alignItems: "flex-end" },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  leg: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.85 },
  legSelection: { flex: 1, marginRight: spacing.sm },
  legMeta: { marginTop: spacing.xs },
  teams: { marginTop: spacing.xs },
  progress: { marginTop: spacing.sm },
  note: { marginTop: spacing.xs },
  override: { marginTop: spacing.sm },
  others: { marginTop: spacing.sm },
  othersText: { marginLeft: spacing.sm },
  hint: { textAlign: "center", marginTop: spacing.xs },
  tail: { marginTop: spacing.xl },
});
