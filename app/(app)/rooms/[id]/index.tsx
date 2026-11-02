import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SlipCard } from "@/components/SlipCard";
import { Ticker } from "@/components/Ticker";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { useRoom } from "@/hooks/useRoom";
import { useSlateBoard } from "@/hooks/useSlateBoard";
import { formatMoney, formatSlateDate, shiftDate, todayNY } from "@/lib/format";
import { shareInvite } from "@/lib/rooms";
import { SLATE_FUTURE_DAYS } from "@/lib/slips";
import { supabase } from "@/lib/supabase";

interface UpcomingSlate {
  id: string;
  slate_date: string;
  slipCount: number;
}

/** This room's future slates that already have slips on them (future-dated slips land there). */
function useUpcomingSlates(roomId: string | null | undefined, today: string, enabled: boolean) {
  const [rows, setRows] = useState<UpcomingSlate[]>([]);
  const load = useCallback(async () => {
    if (!roomId || !enabled) {
      setRows([]);
      return;
    }
    const { data } = await supabase
      .from("slates")
      .select("id, slate_date, slips(count)")
      .eq("room_id", roomId)
      .gt("slate_date", today)
      .order("slate_date", { ascending: true });
    const next: UpcomingSlate[] = [];
    for (const r of (data ?? []) as unknown as { id: string; slate_date: string; slips: { count: number }[] }[]) {
      const count = r.slips?.[0]?.count ?? 0;
      if (count > 0) next.push({ id: r.id, slate_date: r.slate_date, slipCount: count });
    }
    setRows(next);
  }, [roomId, today, enabled]);
  return { upcoming: rows, reloadUpcoming: load };
}

export default function RoomBoardScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { room } = useRoom(roomId);
  const today = todayNY();
  const [slateDate, setSlateDate] = useState(today);
  const { slate, slips, legsBySlip, events, totals, loading, error, refresh } = useSlateBoard(
    roomId,
    slateDate,
  );

  const isToday = slateDate === today;
  const isUpcoming = slateDate > today;
  // Slips can be dated up to SLATE_FUTURE_DAYS ahead (see slateDateFor), so the board can browse that far.
  const canGoForward = slateDate < shiftDate(today, SLATE_FUTURE_DAYS);
  const { upcoming, reloadUpcoming } = useUpcomingSlates(roomId, today, isToday);
  useEffect(() => {
    // runs on mount and whenever today's slip list changes (a new slip may have landed on a future slate too)
    reloadUpcoming();
  }, [slips.length, reloadUpcoming]);

  return (
    <Screen edges={["bottom"]} padded={false}>
      <Stack.Screen
        options={{
          title: room?.name ?? "",
          headerRight: () =>
            room ? (
              <Pressable onPress={() => shareInvite(room)} hitSlop={8} style={styles.invite}>
                <Text style={styles.inviteText}>Invite</Text>
              </Pressable>
            ) : null,
        }}
      />

      <View style={styles.slateBar}>
        <Pressable onPress={() => setSlateDate(shiftDate(slateDate, -1))} hitSlop={8} style={styles.chev}>
          <Text style={styles.chevText}>‹</Text>
        </Pressable>
        <Pressable onPress={() => setSlateDate(today)} style={styles.slateLabelWrap}>
          <View style={styles.slateTitleRow}>
            <Text style={styles.slateLabel}>{isToday ? "Today" : formatSlateDate(slateDate)}</Text>
            {isUpcoming ? <Badge label="Upcoming" color={colors.pending} style={styles.upcomingChip} /> : null}
          </View>
          {slate ? <Text style={styles.slateStatus}>{slate.status.toUpperCase()}</Text> : null}
        </Pressable>
        <Pressable
          onPress={() => canGoForward && setSlateDate(shiftDate(slateDate, 1))}
          hitSlop={8}
          style={[styles.chev, !canGoForward && styles.chevOff]}
        >
          <Text style={styles.chevText}>›</Text>
        </Pressable>
      </View>

      <Ticker events={events} />

      <FlatList
        data={slips}
        keyExtractor={(s, i) => s.id ?? String(i)}
        contentContainerStyle={[styles.list, { paddingBottom: 96 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.muted} />}
        ListHeaderComponent={
          <View style={styles.summary}>
            <Stat label="slips" value={String(totals.count)} />
            <Stat label="at risk" value={formatMoney(totals.atRisk)} />
            <Stat label="live" value={String(totals.live)} color={colors.live} />
            <Stat label="cashed" value={String(totals.won)} color={colors.won} />
            <Stat label="dead" value={String(totals.lost)} color={colors.lost} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              title={isToday ? "Nobody has dropped a slip yet" : "No slips on this slate"}
              body={
                isToday
                  ? "Screenshot your bet slip and add it. Every leg gets graded live and the whole room sees it."
                  : "Pick another day or head back to today."
              }
              action={
                isToday && roomId ? (
                  <Button title="Add a slip" onPress={() => router.push(`/add-slip?room=${roomId}` as never)} />
                ) : undefined
              }
            />
          )
        }
        ListFooterComponent={
          <>
            {slate && slate.status === "final" && roomId ? (
              <Button
                title="View recap"
                variant="secondary"
                onPress={() => router.push(`/rooms/${roomId}/recap/${slate.id}` as never)}
                style={styles.recap}
              />
            ) : null}
            {isToday && upcoming.length > 0 ? (
              <View style={styles.upcoming}>
                <Text style={styles.upcomingTitle}>Upcoming</Text>
                {upcoming.map((u) => (
                  <Pressable
                    key={u.id}
                    onPress={() => setSlateDate(u.slate_date)}
                    style={({ pressed }) => [styles.upcomingRow, pressed && styles.upcomingPressed]}
                  >
                    <Text style={styles.upcomingDate}>{formatSlateDate(u.slate_date)}</Text>
                    <Text style={styles.upcomingCount}>
                      {u.slipCount} {u.slipCount === 1 ? "slip" : "slips"} ›
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        }
        renderItem={({ item }) =>
          roomId ? <SlipCard slip={item} legs={legsBySlip[item.id ?? ""] ?? []} roomId={roomId} /> : null
        }
      />

      {isToday && roomId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add slip"
          onPress={() => router.push(`/add-slip?room=${roomId}` as never)}
          style={({ pressed }) => [styles.fab, { bottom: insets.bottom + spacing.lg }, pressed && styles.fabPressed]}
        >
          <Text style={styles.fabText}>+ Add slip</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  invite: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inviteText: { color: colors.text, fontWeight: "600", fontSize: fontSize.sm },
  slateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  chev: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  chevOff: { opacity: 0.25 },
  chevText: { color: colors.text, fontSize: 28, lineHeight: 30 },
  slateLabelWrap: { alignItems: "center" },
  slateTitleRow: { flexDirection: "row", alignItems: "center" },
  upcomingChip: { marginLeft: spacing.sm },
  slateLabel: { color: colors.text, fontSize: fontSize.lg, fontWeight: "700" },
  slateStatus: { color: colors.muted, fontSize: fontSize.xs, letterSpacing: 1, marginTop: 2 },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  stat: { flex: 1, minWidth: 60, alignItems: "center" },
  statValue: { color: colors.text, fontSize: fontSize.lg, fontWeight: "800", fontVariant: ["tabular-nums"] },
  statLabel: { color: colors.muted, fontSize: fontSize.xs, marginTop: 2 },
  error: { color: colors.lost, fontSize: fontSize.sm, width: "100%", paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  recap: { marginTop: spacing.md },
  upcoming: { marginTop: spacing.lg },
  upcomingTitle: {
    color: colors.muted,
    fontSize: fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  upcomingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
  },
  upcomingPressed: { opacity: 0.85 },
  upcomingDate: { color: colors.text, fontSize: fontSize.sm, fontWeight: "600" },
  upcomingCount: { color: colors.muted, fontSize: fontSize.sm },
  fab: {
    position: "absolute",
    right: spacing.lg,
    backgroundColor: colors.live,
    paddingHorizontal: spacing.xl,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.black,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { opacity: 0.85 },
  fabText: { color: colors.white, fontWeight: "700", fontSize: fontSize.md },
});
