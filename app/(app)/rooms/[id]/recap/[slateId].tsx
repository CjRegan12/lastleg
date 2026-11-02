import * as Sharing from "expo-sharing";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import ViewShot from "react-native-view-shot";

import { Avatar, Button, Screen } from "@/components/ui";
import { APP_NAME, WEB_JOIN_BASE } from "@/constants/books";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
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
        <Text style={styles.muted}>{error ?? "Loading..."}</Text>
      </Screen>
    );
  }

  const netColor = recap.net > 0 ? colors.won : recap.net < 0 ? colors.lost : colors.muted;

  return (
    <Screen scroll edges={["bottom"]}>
      <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }} style={styles.card}>
        <Text style={styles.cardRoom}>{recap.roomName}</Text>
        <Text style={styles.cardDate}>{formatSlateDate(recap.slate.slate_date)}</Text>

        <View style={styles.recordRow}>
          <View style={styles.recordCell}>
            <Text style={[styles.recordNum, { color: colors.won }]}>{recap.won}</Text>
            <Text style={styles.recordLabel}>cashed</Text>
          </View>
          <Text style={styles.dash}>-</Text>
          <View style={styles.recordCell}>
            <Text style={[styles.recordNum, { color: colors.lost }]}>{recap.lost}</Text>
            <Text style={styles.recordLabel}>dead</Text>
          </View>
          <View style={[styles.recordCell, styles.netCell]}>
            <Text style={[styles.recordNum, { color: netColor }]}>{formatMoney(recap.net, { signed: true })}</Text>
            <Text style={styles.recordLabel}>net on {formatMoney(recap.risked)}</Text>
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

        <Text style={styles.section}>Season standings</Text>
        {recap.standings.slice(0, 8).map((row, i) => {
          const profit = row.profit ?? 0;
          return (
            <View key={row.user_id ?? String(i)} style={styles.standRow}>
              <Text style={styles.rank}>{i + 1}</Text>
              <Avatar handle={row.handle} size={24} />
              <Text style={styles.standHandle} numberOfLines={1}>
                {row.handle}
              </Text>
              <Text style={styles.standRecord}>
                {row.won ?? 0}-{row.lost ?? 0}
              </Text>
              <Text style={[styles.standProfit, { color: profit > 0 ? colors.won : profit < 0 ? colors.lost : colors.muted }]}>
                {formatMoney(profit, { signed: true })}
              </Text>
            </View>
          );
        })}

        <View style={styles.cardFooter}>
          <Text style={styles.cardBrand}>{APP_NAME}</Text>
          <Text style={styles.cardJoin}>
            {WEB_JOIN_BASE.replace("https://", "")}/{recap.inviteCode}
          </Text>
        </View>
      </ViewShot>

      <Button title="Share recap card" onPress={share} style={styles.share} />
    </Screen>
  );
}

function Highlight({ title, color, handle, line }: { title: string; color: string; handle: string | null; line: string }) {
  return (
    <View style={[styles.highlight, { borderColor: color }]}>
      <Text style={[styles.highlightTitle, { color }]}>{title}</Text>
      <View style={styles.row}>
        <Avatar handle={handle} size={24} />
        <Text style={styles.highlightHandle}>{handle ?? "someone"}</Text>
      </View>
      <Text style={styles.highlightLine}>{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: fontSize.md, marginTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  cardRoom: { color: colors.text, fontSize: fontSize.xl, fontWeight: "800" },
  cardDate: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
  recordRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg },
  recordCell: { alignItems: "center", minWidth: 56 },
  netCell: { marginLeft: "auto", alignItems: "flex-end" },
  recordNum: { fontSize: fontSize.xxl, fontWeight: "800", fontVariant: ["tabular-nums"] },
  recordLabel: { color: colors.muted, fontSize: fontSize.xs, marginTop: 2 },
  dash: { color: colors.muted, fontSize: fontSize.xl, marginHorizontal: spacing.sm },
  highlight: {
    borderLeftWidth: 3,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.lg,
  },
  highlightTitle: { fontSize: fontSize.xs, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs },
  highlightHandle: { color: colors.text, fontWeight: "700", marginLeft: spacing.sm },
  highlightLine: { color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.xs },
  section: {
    color: colors.muted,
    fontSize: fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  standRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  rank: { color: colors.muted, width: 20, fontSize: fontSize.sm, fontVariant: ["tabular-nums"] },
  standHandle: { color: colors.text, flex: 1, marginLeft: spacing.sm, fontWeight: "600" },
  standRecord: { color: colors.muted, fontSize: fontSize.sm, marginRight: spacing.md, fontVariant: ["tabular-nums"] },
  standProfit: { fontWeight: "700", fontVariant: ["tabular-nums"], minWidth: 64, textAlign: "right" },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cardBrand: { color: colors.text, fontWeight: "800" },
  cardJoin: { color: colors.muted, fontSize: fontSize.xs },
  share: { marginTop: spacing.lg },
});
