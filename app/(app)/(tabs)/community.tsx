import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { FeedSlipCard } from "@/components/FeedSlipCard";
import { Avatar, Button, EmptyState, Screen, Segmented, T } from "@/components/ui";
import { colors, radius, spacing } from "@/constants/theme";
import { type FeedSlip, useSlipFeed } from "@/hooks/useSlipFeed";
import { useUserId } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { computeRecord, formatRecord, inPeriod, isSettled, type SlipRecord } from "@/lib/stats";

const PERIODS = ["week", "month"] as const;
type BoardPeriod = (typeof PERIODS)[number];
const PERIOD_LABELS: Record<BoardPeriod, string> = { week: "This week", month: "This month" };

interface Standing {
  userId: string;
  handle: string;
  record: SlipRecord;
  closeCalls: number;
}

/**
 * Your community is the people in your rooms. A leaderboard across all of
 * them, then a feed of what they cashed and what died. Nothing public.
 */
export default function CommunityScreen() {
  const userId = useUserId();
  const router = useRouter();
  const { slips, loading, error, reload } = useSlipFeed(userId, "everyone", 500);
  const [period, setPeriod] = useState<BoardPeriod>("week");

  const people = useMemo(() => new Set(slips.map((s) => s.user_id)).size, [slips]);

  const standings = useMemo<Standing[]>(() => {
    const settled = inPeriod(slips.filter((s) => isSettled(s.status)), period);
    const byUser = new Map<string, FeedSlip[]>();
    for (const s of settled) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
    return [...byUser.entries()]
      .map(([uid, list]) => ({
        userId: uid,
        handle: list[0].handle,
        record: computeRecord(list),
        closeCalls: list.filter((s) => s.status === "lost" && s.legs_total > 1 && lostByOne(s)).length,
      }))
      .sort((a, b) => b.record.profit - a.record.profit || b.record.won - a.record.won);
  }, [slips, period]);

  const feed = useMemo(
    () =>
      slips
        .filter((s) => isSettled(s.status) && s.user_id !== userId)
        .sort((a, b) => (b.settled_at ?? b.created_at).localeCompare(a.settled_at ?? a.created_at))
        .slice(0, 60),
    [slips, userId],
  );

  const thin = !loading && people < 3;

  return (
    <Screen edges={["top"]} padded={false}>
      <FlatList
        data={thin ? [] : feed}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.muted} />}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <T variant="display">Community</T>
              <T variant="body" color={colors.muted} style={styles.sub}>
                Everyone in your rooms, ranked.
              </T>
            </View>
            {thin ? null : (
              <>
                <Segmented options={PERIODS} value={period} onChange={setPeriod} labels={PERIOD_LABELS} />
                <View style={styles.board}>
                  {standings.length === 0 ? (
                    <T variant="body" color={colors.muted}>
                      Nothing settled {PERIOD_LABELS[period].toLowerCase()} yet.
                    </T>
                  ) : (
                    standings.map((s, i) => (
                      <View key={s.userId} style={[styles.rank, i > 0 && styles.rankBorder]}>
                        <T variant="number" style={styles.place} color={i === 0 ? colors.text : colors.muted}>
                          {i + 1}
                        </T>
                        <Avatar handle={s.handle} size={30} />
                        <View style={styles.rankWho}>
                          <T variant="bodyMedium" numberOfLines={1}>
                            {s.handle}
                            {s.userId === userId ? "  (you)" : ""}
                          </T>
                          <T variant="small">
                            {formatRecord(s.record)}
                            {s.closeCalls > 0 ? `, lost by one leg ${s.closeCalls > 1 ? `${s.closeCalls} times` : "once"}` : ""}
                          </T>
                        </View>
                        <T
                          variant="number"
                          color={s.record.profit > 0 ? colors.won : s.record.profit < 0 ? colors.lost : colors.muted}
                        >
                          {s.record.priced > 0 ? formatMoney(s.record.profit, { signed: true }) : "--"}
                        </T>
                      </View>
                    ))
                  )}
                </View>
                {feed.length > 0 ? (
                  <T variant="heading" style={styles.section}>
                    What your people did
                  </T>
                ) : null}
              </>
            )}
            {error ? (
              <T variant="small" color={colors.lost}>
                {error}
              </T>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <FeedSlipCard slip={item} lead="owner" compact />}
        ListEmptyComponent={
          loading ? null : thin ? (
            <EmptyState
              title="Your community is your rooms"
              body="Get two more friends into a room and the leaderboard turns on. Everyone you share a room with shows up here."
              action={<Button title="Go to rooms" variant="secondary" onPress={() => router.push("/rooms" as never)} />}
            />
          ) : null
        }
      />
    </Screen>
  );
}

function lostByOne(s: FeedSlip): boolean {
  return s.legs.filter((l) => l.status === "lost").length === 1;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { paddingTop: spacing.md, paddingBottom: spacing.lg },
  sub: { marginTop: spacing.xs },
  board: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rank: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  rankBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  place: { width: 22 },
  rankWho: { flex: 1 },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
});
