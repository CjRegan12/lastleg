import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { AvatarStack, Button, EmptyState, Screen, T } from "@/components/ui";
import { colors, radius, spacing } from "@/constants/theme";
import { useUserId } from "@/lib/auth";
import type { Room } from "@/lib/database.types";
import { todayNY } from "@/lib/format";
import { supabase } from "@/lib/supabase";

interface RoomRow {
  room: Room;
  handles: string[];
  liveCount: number;
  slipCount: number;
  /** Handle of someone one leg away today, if anyone. */
  oneAway: string | null;
}

export default function RoomsScreen() {
  const router = useRouter();
  const userId = useUserId();
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
    const [membersRes, slatesRes] = await Promise.all([
      supabase.from("room_members").select("room_id, profiles!room_members_user_id_fkey(handle)").in("room_id", roomIds),
      supabase.from("slates").select("id, room_id").in("room_id", roomIds).eq("slate_date", today),
    ]);
    const handles: Record<string, string[]> = {};
    for (const m of (membersRes.data ?? []) as unknown as { room_id: string; profiles: { handle: string } | null }[]) {
      (handles[m.room_id] ??= []).push(m.profiles?.handle ?? "?");
    }

    const slateIds = (slatesRes.data ?? []).map((s) => s.id);
    const agg: Record<string, { live: number; count: number; oneAway: string | null }> = {};
    if (slateIds.length > 0) {
      const { data: slips } = await supabase
        .from("slips")
        .select("room_id, status, legs_remaining, legs_total, profiles!slips_user_id_fkey(handle)")
        .in("slate_id", slateIds);
      for (const s of (slips ?? []) as unknown as {
        room_id: string;
        status: string;
        legs_remaining: number;
        legs_total: number;
        profiles: { handle: string } | null;
      }[]) {
        const a = (agg[s.room_id] ??= { live: 0, count: 0, oneAway: null });
        a.count += 1;
        if (s.status === "live") a.live += 1;
        if (s.status === "live" && s.legs_remaining === 1 && s.legs_total > 1 && !a.oneAway) {
          a.oneAway = s.profiles?.handle ?? "Someone";
        }
      }
    }

    setRows(
      rooms
        .map((room) => ({
          room,
          handles: handles[room.id] ?? [],
          liveCount: agg[room.id]?.live ?? 0,
          slipCount: agg[room.id]?.count ?? 0,
          oneAway: agg[room.id]?.oneAway ?? null,
        }))
        .sort(
          (a, b) =>
            Number(!!b.oneAway) - Number(!!a.oneAway) ||
            b.liveCount - a.liveCount ||
            b.slipCount - a.slipCount ||
            a.room.name.localeCompare(b.room.name),
        ),
    );
    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen edges={["top"]} padded={false}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.room.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.muted} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <T variant="display">Rooms</T>
            <View style={styles.actions}>
              <Button title="Create room" onPress={() => router.push("/rooms/new" as never)} style={styles.action} />
              <Button
                title="Join with code"
                variant="secondary"
                onPress={() => router.push("/join" as never)}
                style={styles.action}
              />
            </View>
            {error ? (
              <T variant="small" color={colors.lost}>
                {error}
              </T>
            ) : null}
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
            style={({ pressed }) => [styles.row, !!item.oneAway && styles.rowHot, pressed && styles.pressed]}
          >
            <View style={styles.rowTop}>
              <T variant="title" style={styles.name} numberOfLines={1}>
                {item.room.name}
              </T>
              {item.liveCount > 0 ? (
                <View style={styles.liveChip}>
                  <View style={styles.liveDot} />
                  <T variant="smallMedium">{item.liveCount} live</T>
                </View>
              ) : null}
            </View>
            <View style={styles.rowBottom}>
              <AvatarStack handles={item.handles} size={22} />
              <T variant="small" style={styles.meta} numberOfLines={1}>
                {item.oneAway
                  ? `${item.oneAway} is one leg away`
                  : item.slipCount > 0
                    ? `${item.slipCount} ${item.slipCount === 1 ? "slip" : "slips"} today`
                    : `${item.handles.length} ${item.handles.length === 1 ? "member" : "members"}`}
              </T>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { paddingTop: spacing.md, paddingBottom: spacing.lg },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  action: { flex: 1 },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  rowHot: { borderColor: colors.oneAway },
  pressed: { opacity: 0.85 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  name: { flexShrink: 1 },
  liveChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  meta: { flexShrink: 1 },
});
