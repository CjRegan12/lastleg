import { useCallback, useEffect, useState } from "react";

import type { Room } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export interface RoomMemberLite {
  user_id: string;
  role: "owner" | "member";
  handle: string;
}

export function useRoom(roomId: string | null | undefined) {
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<RoomMemberLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    const [roomRes, memRes] = await Promise.all([
      supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
      supabase.from("room_members").select("user_id, role, profiles(handle)").eq("room_id", roomId),
    ]);
    setError(roomRes.error?.message ?? memRes.error?.message ?? null);
    setRoom(roomRes.data ?? null);
    setMembers(
      (memRes.data ?? []).map((m) => ({
        user_id: m.user_id,
        role: m.role,
        handle: m.profiles?.handle ?? "?",
      })),
    );
    setLoading(false);
  }, [roomId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { room, members, loading, error, refresh };
}
