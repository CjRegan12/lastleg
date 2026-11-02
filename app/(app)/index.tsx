import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { useProfile } from "@/hooks/useProfile";
import { useUserId } from "@/lib/auth";
import type { Room } from "@/lib/database.types";
import { formatMoney, todayNY } from "@/lib/format";
import { supabase } from "@/lib/supabase";

interface RoomRow {
  room: Room;
  memberCount: number;
  slipCount: number;
  atRisk: number;
}

export default function RoomsScreen() {
  const router = useRouter();
  const userId = useUserId();
  const { profile } = useProfile(userId);
  const [rows, setRows] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: memberships, error: mErr } = await supabase
      .from("room_members")
      .select("room_id, rooms(*)")
      .eq("user_id", userId);
    if (mErr) {
      setError(mErr.message);
      setLoading(false);
      return;
    }
    const rooms = (memberships ?? []).map((m) => m.rooms).filter((r): r is Room => !!r);
    const roomIds = rooms.map((r) => r.id);
    if (roomIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const today = todayNY();
    const [countsRes, slatesRes] = await Promise.all([
      supabase.from("room_members").select("room_id").in("room_id", roomIds),
      supabase.from("slates").select("id, room_id").in("room_id", roomIds).eq("slate_date", today),
    ]);
    const memberCounts: Record<string, number> = {};
    for (const m of countsRes.data ?? []) memberCounts[m.room_id] = (memberCounts[m.room_id] ?? 0) + 1;

    const slateIds = (slatesRes.data ?? []).map((s) => s.id);
    const slipAgg: Record<string, { count: number; atRisk: number }> = {};
    if (slateIds.length > 0) {
      const { data: slips } = await supabase
        .from("slips")
        .select("room_id, stake")
        .in("slate_id", slateIds);
      for (const s of slips ?? []) {
        const agg = (slipAgg[s.room_id] ??= { count: 0, atRisk: 0 });
        agg.count += 1;
        agg.atRisk += s.stake;
      }
    }

    setRows(
      rooms
        .map((room) => ({
          room,
          memberCount: memberCounts[room.id] ?? 1,
          slipCount: slipAgg[room.id]?.count ?? 0,
          atRisk: slipAgg[room.id]?.atRisk ?? 0,
        }))
        .sort((a, b) => b.slipCount - a.slipCount || a.room.name.localeCompare(b.room.name)),
    );
    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen edges={["bottom"]} padded={false}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push("/profile" as never)} hitSlop={8}>
              <Avatar handle={profile?.handle} size={30} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.room.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.muted} />}
        ListHeaderComponent={
          <View style={styles.actions}>
            <Button title="Create room" onPress={() => router.push("/rooms/new" as never)} style={styles.action} />
            <Button
              title="Join with code"
              variant="secondary"
              onPress={() => router.push("/join" as never)}
              style={styles.action}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              title="No rooms yet"
              body="Make one for your group chat and send them the code. Everyone drops their slips, the board grades itself."
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/rooms/${item.room.id}` as never)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowMain}>
              <Text style={styles.name} numberOfLines={1}>
                {item.room.name}
              </Text>
              <Text style={styles.meta}>
                {item.memberCount} {item.memberCount === 1 ? "member" : "members"}
                {"  ·  "}
                {item.slipCount} {item.slipCount === 1 ? "slip" : "slips"} today
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.risk}>{formatMoney(item.atRisk)}</Text>
              <Text style={styles.riskLabel}>at risk</Text>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  actions: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg, flexWrap: "wrap" },
  action: { flex: 1, minWidth: 140 },
  error: { color: colors.lost, fontSize: fontSize.sm, width: "100%" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.85 },
  rowMain: { flex: 1 },
  name: { color: colors.text, fontSize: fontSize.lg, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.xs },
  rowRight: { alignItems: "flex-end", marginLeft: spacing.md },
  risk: { color: colors.text, fontSize: fontSize.lg, fontWeight: "800", fontVariant: ["tabular-nums"] },
  riskLabel: { color: colors.muted, fontSize: fontSize.xs },
});
