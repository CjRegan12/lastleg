import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SlipCard } from "@/components/SlipCard";
import { Ticker } from "@/components/Ticker";
import { Badge, Button, EmptyState, Screen, T } from "@/components/ui";
import { colors, radius, spacing, statusColor } from "@/constants/theme";
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
              <Pressable
                accessibilityRole="button"
                onPress={() => shareInvite(room)}
                hitSlop={8}
                style={({ pressed }) => [styles.invite, pressed && styles.pressed]}
              >
                <T variant="smallMedium">Invite</T>
              </Pressable>
            ) : null,
        }}
      />

      <View style={styles.slateBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          onPress={() => setSlateDate(shiftDate(slateDate, -1))}
          hitSlop={8}
          style={styles.chev}
        >
          <T variant="title" style={styles.chevText}>
            ‹
          </T>
        </Pressable>
        <Pressable onPress={() => setSlateDate(today)} style={styles.slateLabelWrap}>
          <View style={styles.slateTitleRow}>
            <T variant="title">{isToday ? "Today" : formatSlateDate(slateDate)}</T>
            {isUpcoming ? <Badge label="Upcoming" color={colors.pending} /> : null}
          </View>
          {slate ? (
            <T variant="small" style={styles.slateStatus}>
              {slateStatusLabel(slate.status)}
            </T>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next day"
          onPress={() => canGoForward && setSlateDate(shiftDate(slateDate, 1))}
          hitSlop={8}
          style={[styles.chev, !canGoForward && styles.chevOff]}
        >
          <T variant="title" style={styles.chevText}>
            ›
          </T>
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
            <Stat label="Slips" value={String(totals.count)} />
            <Stat label="At risk" value={formatMoney(totals.atRisk)} />
            <Stat label="Live" value={String(totals.live)} color={statusColor("live")} />
            <Stat label="Cashed" value={String(totals.won)} color={statusColor("won")} />
            <Stat label="Dead" value={String(totals.lost)} color={statusColor("lost")} />
            {error ? (
              <T variant="small" color={colors.lost} style={styles.error}>
                {error}
              </T>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? undefined : (
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
                <T variant="heading" style={styles.upcomingTitle}>
                  Upcoming
                </T>
                {upcoming.map((u) => (
                  <Pressable
                    key={u.id}
                    accessibilityRole="button"
                    onPress={() => setSlateDate(u.slate_date)}
                    style={({ pressed }) => [styles.upcomingRow, pressed && styles.pressed]}
                  >
                    <T variant="bodyMedium">{formatSlateDate(u.slate_date)}</T>
                    <T variant="small">
                      {u.slipCount} {u.slipCount === 1 ? "slip" : "slips"}
                    </T>
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
          <T variant="heading" color={colors.bg}>
            Add slip
          </T>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <T variant="number" color={color}>
        {value}
      </T>
      <T variant="small" style={styles.statLabel}>
        {label}
      </T>
    </View>
  );
}

/** slate.status is a db enum (open, live, final...); show it as a plain word. */
function slateStatusLabel(status: string): string {
  const s = status.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  pressed: { opacity: 0.85 },
  slateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  chev: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  chevOff: { opacity: 0.25 },
  chevText: { color: colors.muted },
  slateLabelWrap: { alignItems: "center" },
  slateTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  slateStatus: { marginTop: 2 },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.lg,
  },
  stat: { flex: 1, minWidth: 60, alignItems: "center" },
  statLabel: { marginTop: 2 },
  error: { width: "100%", paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  recap: { marginTop: spacing.md },
  upcoming: { marginTop: spacing.lg },
  upcomingTitle: { marginBottom: spacing.sm },
  upcomingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  fab: {
    position: "absolute",
    right: spacing.lg,
    backgroundColor: colors.text,
    paddingHorizontal: spacing.xl,
    height: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  fabPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
