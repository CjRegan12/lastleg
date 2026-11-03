import * as Sharing from "expo-sharing";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import ViewShot from "react-native-view-shot";

import { Avatar, Button, Screen, T } from "@/components/ui";
import { APP_NAME, WEB_JOIN_BASE } from "@/constants/books";
import { colors, radius, spacing } from "@/constants/theme";
import type { RoomStandingsRow, Slate, SlateBoardRow } from "@/lib/database.types";
import { formatMoney, formatOdds, formatSlateDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";

interface Recap {
  slate: Slate;
  roomName: string;
  inviteCode: string;
  won: number;
  lost: number;
  risked: number;
  net: number;
  biggestCash: SlateBoardRow | null;
  worstBeat: SlateBoardRow | null;
  standings: RoomStandingsRow[];
}

export default function RecapScreen() {
  const { id: roomId, slateId } = useLocalSearchParams<{ id: string; slateId: string }>();
  const [recap, setRecap] = useState<Recap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shotRef = useRef<React.ComponentRef<typeof ViewShot>>(null);

  const load = useCallback(async () => {
    if (!roomId || !slateId) return;
    const [slateRes, roomRes, slipsRes, standingsRes] = await Promise.all([
      supabase.from("slates").select("*").eq("id", slateId).maybeSingle(),
      supabase.from("rooms").select("name, invite_code").eq("id", roomId).maybeSingle(),
      supabase.from("slate_board").select("*").eq("slate_id", slateId),
      supabase
        .from("room_standings")
        .select("*")
        .eq("room_id", roomId)
        .order("profit", { ascending: false }),
    ]);
    const err = slateRes.error ?? roomRes.error ?? slipsRes.error ?? standingsRes.error;
    if (err) {
      setError(err.message);
      return;
    }
    if (!slateRes.data || !roomRes.data) {
      setError("Slate not found");
      return;
    }
    const slips = slipsRes.data ?? [];
    const wonSlips = slips.filter((s) => s.status === "won");
    const lostSlips = slips.filter((s) => s.status === "lost");

    // worst beat: lost slip with exactly one lost leg, highest payout
    let worstBeat: SlateBoardRow | null = null;
    const lostIds = lostSlips.map((s) => s.id).filter((id): id is string => !!id);
    if (lostIds.length > 0) {
      const { data: lostLegs } = await supabase
        .from("legs")
        .select("slip_id")
        .in("slip_id", lostIds)
        .eq("status", "lost");
      const lostCount: Record<string, number> = {};
      for (const l of lostLegs ?? []) lostCount[l.slip_id] = (lostCount[l.slip_id] ?? 0) + 1;
      worstBeat =
        lostSlips
          .filter((s) => s.id && lostCount[s.id] === 1 && (s.legs_total ?? 0) > 1)
          .sort((a, b) => (b.potential_payout ?? 0) - (a.potential_payout ?? 0))[0] ?? null;
    }

    const biggestCash = [...wonSlips].sort((a, b) => (b.potential_payout ?? 0) - (a.potential_payout ?? 0))[0] ?? null;
    const risked = slips.reduce((sum, s) => sum + (s.stake ?? 0), 0);
    const net =
      wonSlips.reduce((sum, s) => sum + ((s.potential_payout ?? 0) - (s.stake ?? 0)), 0) -
      lostSlips.reduce((sum, s) => sum + (s.stake ?? 0), 0);

    setRecap({
      slate: slateRes.data,
      roomName: roomRes.data.name,
      inviteCode: roomRes.data.invite_code,
      won: wonSlips.length,
      lost: lostSlips.length,
      risked,
      net,
      biggestCash,
      worstBeat,
      standings: standingsRes.data ?? [],
    });
  }, [roomId, slateId]);

  useEffect(() => {
    load();
  }, [load]);

  const share = async () => {
    try {
      const uri = await shotRef.current?.capture?.();
      if (!uri) throw new Error("Could not render the card");
      if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device");
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: `${APP_NAME} recap` });
    } catch (e) {
      Alert.alert("Share failed", e instanceof Error ? e.message : String(e));
    }
  };

  if (!recap) {
    return (
      <Screen edges={["bottom"]}>
        <T variant="body" color={colors.muted} style={styles.muted}>
          {error ?? "Loading..."}
        </T>
      </Screen>
    );
  }

  const netColor = recap.net > 0 ? colors.won : recap.net < 0 ? colors.lost : colors.muted;

  return (
    <Screen scroll edges={["bottom"]}>
      <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }} style={styles.card}>
        <T variant="title" numberOfLines={1}>
          {recap.roomName}
        </T>
        <T variant="small" style={styles.cardDate}>
          {formatSlateDate(recap.slate.slate_date)}
        </T>

        <View style={styles.recordRow}>
          <View style={styles.recordCell}>
            <T variant="numberLg" color={colors.won}>
              {recap.won}
            </T>
            <T variant="small" style={styles.recordLabel}>
              Cashed
            </T>
          </View>
          <View style={styles.recordCell}>
            <T variant="numberLg" color={colors.lost}>
              {recap.lost}
            </T>
            <T variant="small" style={styles.recordLabel}>
              Dead
            </T>
          </View>
          <View style={[styles.recordCell, styles.netCell]}>
            <T variant="numberLg" color={netColor}>
              {formatMoney(recap.net, { signed: true })}
            </T>
            <T variant="small" style={styles.recordLabel}>
              Net on {formatMoney(recap.risked)}
            </T>
          </View>
        </View>

        {recap.biggestCash ? (
          <Highlight
            title="Biggest cash"
            color={colors.won}
            handle={recap.biggestCash.handle}
            line={`${formatMoney(recap.biggestCash.stake)} at ${formatOdds(recap.biggestCash.odds_american)} paid ${formatMoney(recap.biggestCash.potential_payout)}`}
          />
        ) : null}
        {recap.worstBeat ? (
          <Highlight
            title="Worst beat"
            color={colors.lost}
            handle={recap.worstBeat.handle}
            line={`One leg short of ${formatMoney(recap.worstBeat.potential_payout)} (${recap.worstBeat.legs_total}-leg ${recap.worstBeat.bet_type ?? "parlay"})`}
          />
        ) : null}

        <T variant="heading" style={styles.section}>
          Season standings
        </T>
        {recap.standings.slice(0, 8).map((row, i) => {
          const profit = row.profit ?? 0;
          return (
            <View key={row.user_id ?? String(i)} style={styles.standRow}>
              <T variant="small" style={styles.rank}>
                {i + 1}
              </T>
              <Avatar handle={row.handle} size={24} />
              <T variant="bodyMedium" style={styles.standHandle} numberOfLines={1}>
                {row.handle}
              </T>
              <T variant="smallMedium" style={styles.standRecord}>
                {row.won ?? 0}-{row.lost ?? 0}
              </T>
              <T
                variant="smallMedium"
                color={profit > 0 ? colors.won : profit < 0 ? colors.lost : colors.muted}
                style={styles.standProfit}
              >
                {formatMoney(profit, { signed: true })}
              </T>
            </View>
          );
        })}

        <View style={styles.cardFooter}>
          <T variant="heading">{APP_NAME}</T>
          <T variant="micro">
            {WEB_JOIN_BASE.replace("https://", "")}/{recap.inviteCode}
          </T>
        </View>
      </ViewShot>

      <Button title="Share recap card" onPress={share} style={styles.share} />
    </Screen>
  );
}

function Highlight({ title, color, handle, line }: { title: string; color: string; handle: string | null; line: string }) {
  return (
    <View style={[styles.highlight, { borderColor: color }]}>
      <T variant="smallMedium" color={color}>
        {title}
      </T>
      <View style={styles.row}>
        <Avatar handle={handle} size={24} />
        <T variant="bodyMedium" style={styles.highlightHandle}>
          {handle ?? "someone"}
        </T>
      </View>
      <T variant="small" style={styles.highlightLine}>
        {line}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { marginTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  cardDate: { marginTop: 2 },
  recordRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xl, marginTop: spacing.lg },
  recordCell: { alignItems: "flex-start" },
  netCell: { marginLeft: "auto", alignItems: "flex-end" },
  recordLabel: { marginTop: 2 },
  highlight: {
    borderLeftWidth: 3,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.lg,
  },
  row: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs },
  highlightHandle: { marginLeft: spacing.sm },
  highlightLine: { marginTop: spacing.xs },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  standRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  rank: { width: 20, fontVariant: ["tabular-nums"] },
  standHandle: { flex: 1, marginLeft: spacing.sm },
  standRecord: { color: colors.muted, marginRight: spacing.md, fontVariant: ["tabular-nums"] },
  standProfit: { fontVariant: ["tabular-nums"], minWidth: 64, textAlign: "right" },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  share: { marginTop: spacing.lg },
});
