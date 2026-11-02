import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { FeedSlipCard } from "@/components/FeedSlipCard";
import { Avatar, EmptyState, Screen, Segmented, T } from "@/components/ui";
import { BOOK_LABELS } from "@/constants/books";
import { colors, radius, spacing } from "@/constants/theme";
import { useProfile } from "@/hooks/useProfile";
import { type FeedSlip, useSlipFeed } from "@/hooks/useSlipFeed";
import { useUserId } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { computeRecord, formatRecord, inPeriod, isSettled, type Period } from "@/lib/stats";

const PERIODS = ["week", "month", "all"] as const;
const PERIOD_LABELS: Record<Period, string> = { week: "This week", month: "This month", all: "All time" };

export default function YouScreen() {
  const userId = useUserId();
  const router = useRouter();
  const { profile } = useProfile(userId);
  const { slips, loading, error, reload } = useSlipFeed(userId, "mine");
  const [period, setPeriod] = useState<Period>("week");

  const settled = useMemo(() => inPeriod(slips.filter((s) => isSettled(s.status)), period), [slips, period]);
  const record = useMemo(() => computeRecord(settled), [settled]);
  const byBook = useMemo(() => groupBy(settled, (s) => BOOK_LABELS[s.book]), [settled]);
  const bySize = useMemo(
    () => groupBy(settled, (s) => (s.legs_total <= 1 ? "Straight" : `${s.legs_total}-leg`)),
    [settled],
  );

  const profitColor = record.profit > 0 ? colors.won : record.profit < 0 ? colors.lost : colors.text;

  return (
    <Screen edges={["top"]} padded={false}>
      <FlatList
        data={settled}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.muted} />}
        ListHeaderComponent={
          <View>
            <View style={styles.top}>
              <Avatar handle={profile?.handle} size={44} />
              <View style={styles.who}>
                <T variant="title" numberOfLines={1}>
                  {profile?.handle ?? ""}
                </T>
                <T variant="small">Tracking only. No money moves through this app.</T>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Settings"
                hitSlop={10}
                onPress={() => router.push("/profile" as never)}
              >
                <SymbolView name="gearshape" size={24} tintColor={colors.muted} fallback={<T variant="body">Settings</T>} />
              </Pressable>
            </View>

            <Segmented options={PERIODS} value={period} onChange={setPeriod} labels={PERIOD_LABELS} />

            <View style={styles.hero}>
              <T variant="small">Profit</T>
              <T variant="numberLg" color={profitColor}>
                {record.priced > 0 ? formatMoney(record.profit, { signed: true }) : "--"}
              </T>
              <View style={styles.statRow}>
                <Stat label="Record" value={record.settled > 0 ? formatRecord(record) : "--"} />
                <Stat label="ROI" value={record.roi == null ? "--" : `${record.roi > 0 ? "+" : ""}${record.roi}%`} />
                <Stat label="Staked" value={record.staked > 0 ? formatMoney(record.staked) : "--"} />
              </View>
              {record.priced < record.settled ? (
                <T variant="small" color={colors.oneAway} style={styles.note}>
                  Profit is based on {record.priced} of {record.settled} slips. The rest had no readable stake.
                </T>
              ) : null}
            </View>

            {settled.length > 0 ? (
              <View style={styles.breakdowns}>
                <Breakdown title="By book" rows={byBook} />
                <Breakdown title="By size" rows={bySize} />
              </View>
            ) : null}

            {error ? (
              <T variant="small" color={colors.lost}>
                {error}
              </T>
            ) : null}
            {settled.length > 0 ? (
              <T variant="heading" style={styles.section}>
                History
              </T>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <FeedSlipCard slip={item} lead="room" compact />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              title={period === "all" ? "No settled slips yet" : `Nothing settled ${PERIOD_LABELS[period].toLowerCase()}`}
              body="Once a slip grades out it lands here with your running record."
            />
          )
        }
      />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <T variant="number">{value}</T>
      <T variant="small">{label}</T>
    </View>
  );
}

interface Row {
  key: string;
  record: ReturnType<typeof computeRecord>;
}

function groupBy(slips: FeedSlip[], keyOf: (s: FeedSlip) => string): Row[] {
  const groups = new Map<string, FeedSlip[]>();
  for (const s of slips) {
    const k = keyOf(s);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, record: computeRecord(list) }))
    .sort((a, b) => b.record.settled - a.record.settled);
}

function Breakdown({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <View style={styles.breakdown}>
      <T variant="heading" style={styles.breakdownTitle}>
        {title}
      </T>
      {rows.map((r) => (
        <View key={r.key} style={styles.breakRow}>
          <T variant="body" style={styles.breakKey} numberOfLines={1}>
            {r.key}
          </T>
          <T variant="smallMedium" style={styles.breakRecord}>
            {formatRecord(r.record)}
          </T>
          <T
            variant="smallMedium"
            color={r.record.profit > 0 ? colors.won : r.record.profit < 0 ? colors.lost : colors.muted}
            style={styles.breakProfit}
          >
            {r.record.priced > 0 ? formatMoney(r.record.profit, { signed: true }) : "--"}
          </T>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg },
  who: { flex: 1 },
  hero: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statRow: { flexDirection: "row", marginTop: spacing.lg, gap: spacing.lg },
  stat: { flex: 1 },
  note: { marginTop: spacing.md },
  breakdowns: { marginTop: spacing.md, gap: spacing.md },
  breakdown: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  breakdownTitle: { marginBottom: spacing.sm },
  breakRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  breakKey: { flex: 1 },
  breakRecord: { width: 64, textAlign: "right", color: colors.muted },
  breakProfit: { width: 84, textAlign: "right" },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
});
