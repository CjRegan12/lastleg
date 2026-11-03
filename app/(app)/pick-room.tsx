import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { Button, EmptyState, Screen, T } from "@/components/ui";
import { colors, radius, spacing } from "@/constants/theme";
import { useUserId } from "@/lib/auth";
import type { Room } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

/**
 * The + button lands here: which room is this slip for? One room skips the
 * question. No rooms sends you to make one.
 */
export default function PickRoomScreen() {
  const router = useRouter();
  const userId = useUserId();
  // A shared link rides along to add-slip once a room is chosen.
  const { url } = useLocalSearchParams<{ url?: string }>();
  const suffix = url ? `&url=${encodeURIComponent(url)}` : "";
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("room_members")
      .select("rooms(*)")
      .eq("user_id", userId)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          setRooms([]);
          return;
        }
        const list = (data ?? []).map((m) => m.rooms).filter((r): r is Room => !!r);
        list.sort((a, b) => a.name.localeCompare(b.name));
        if (list.length === 1) {
          router.replace(`/add-slip?room=${list[0].id}${suffix}` as never);
          return;
        }
        setRooms(list);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, router, suffix]);

  if (rooms === null) {
    return (
      <Screen edges={["bottom"]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      </Screen>
    );
  }

  if (rooms.length === 0) {
    return (
      <Screen edges={["bottom"]}>
        <EmptyState
          title="You need a room first"
          body="Slips live in rooms. Make one, send the code to your group chat, then drop your slip."
          action={<Button title="Create room" onPress={() => router.replace("/rooms/new" as never)} />}
        />
        {error ? (
          <T variant="small" color={colors.lost}>
            {error}
          </T>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen edges={["bottom"]} scroll>
      <T variant="body" color={colors.muted} style={styles.lead}>
        Where does this slip go?
      </T>
      {rooms.map((room) => (
        <Pressable
          key={room.id}
          accessibilityRole="button"
          onPress={() => router.replace(`/add-slip?room=${room.id}${suffix}` as never)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <T variant="heading" numberOfLines={1}>
            {room.name}
          </T>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  lead: { marginTop: spacing.lg, marginBottom: spacing.md },
  row: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.85 },
});
