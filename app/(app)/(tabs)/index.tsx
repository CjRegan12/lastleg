import { useRouter } from "expo-router";
import { useMemo } from "react";
import { RefreshControl, SectionList, StyleSheet, View } from "react-native";

import { FeedSlipCard } from "@/components/FeedSlipCard";
import { Button, EmptyState, Screen, T } from "@/components/ui";
import { colors, spacing } from "@/constants/theme";
import { type FeedSlip, useSlipFeed } from "@/hooks/useSlipFeed";
import { useUserId } from "@/lib/auth";
import { todayNY } from "@/lib/format";

interface Section {
  title: string;
  data: FeedSlip[];
}

/**
 * Everything you have riding right now, across every room, closest to cashing
 * first. The last-leg push lands here.
 */
export default function LiveScreen() {
  const userId = useUserId();
  const router = useRouter();
  const { slips, loading, error, reload } = useSlipFeed(userId, "mine");

  const sections = useMemo<Section[]>(() => {
    const today = todayNY();
    const live = slips
      .filter((s) => s.status === "live")
      .sort((a, b) => a.legs_remaining - b.legs_remaining || a.created_at.localeCompare(b.created_at));
    const waiting = slips.filter((s) => s.status === "pending");
    const settled = slips.filter(
      (s) => s.settled_at && s.status !== "live" && s.status !== "pending" && s.settled_at.slice(0, 10) >= today,
    );
    const out: Section[] = [];
    if (live.length) out.push({ title: "Live now", data: live });
    if (waiting.length) out.push({ title: "Waiting on tipoff", data: waiting });
    if (settled.length) out.push({ title: "Settled today", data: settled });
    return out;
  }, [slips]);

  const liveCount = sections.find((s) => s.title === "Live now")?.data.length ?? 0;
  const oneAway = slips.filter((s) => s.status === "live" && s.legs_remaining === 1 && s.legs_total > 1).length;

  return (
    <Screen edges={["top"]} padded={false}>
      <SectionList
        sections={sections}
        keyExtractor={(s) => s.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.muted} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <T variant="display">Live</T>
            <T variant="body" color={colors.muted} style={styles.sub}>
              {headline(liveCount, oneAway, sections.length > 0)}
            </T>
            {error ? (
              <T variant="small" color={colors.lost}>
                {error}
              </T>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <T variant="heading" style={styles.section}>
            {section.title}
          </T>
        )}
        renderItem={({ item }) => <FeedSlipCard slip={item} lead="room" />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              title="Nothing sweating"
              body="Drop a slip and it shows up here the second a game goes live."
              action={<Button title="Add a slip" onPress={() => router.push("/pick-room" as never)} />}
            />
          )
        }
      />
    </Screen>
  );
}

function headline(live: number, oneAway: number, any: boolean): string {
  if (oneAway === 1) return "One slip is a leg away.";
  if (oneAway > 1) return `${oneAway} slips are a leg away.`;
  if (live === 1) return "One slip in play.";
  if (live > 1) return `${live} slips in play.`;
  return any ? "Nothing in play yet." : "Every leg you have riding, across all your rooms.";
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { paddingTop: spacing.md, paddingBottom: spacing.lg },
  sub: { marginTop: spacing.xs },
  section: { marginBottom: spacing.sm, marginTop: spacing.sm },
});
