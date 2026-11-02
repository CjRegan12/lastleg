import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import type { Enums, Leg, Slip } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export type FeedLeg = Pick<
  Leg,
  "id" | "status" | "selection" | "market" | "sport" | "player_name" | "line" | "current_value" | "side"
>;

/** A slip joined with its room name, owner handle and legs. One shape for Live, You and Community. */
export interface FeedSlip extends Slip {
  room_name: string;
  handle: string;
  legs: FeedLeg[];
}

type Scope = "mine" | "everyone";

const SELECT =
  "*, rooms!slips_room_id_fkey(name), profiles!slips_user_id_fkey(handle), legs(id, status, selection, market, sport, player_name, line, current_value, side)";

/**
 * Slips visible to this user. `mine` = slips I placed; `everyone` = every slip
 * in every room I belong to (RLS already scopes it). Refetches on focus so a
 * tab always shows what the grader did while you were elsewhere. Capped at
 * `limit` newest; history past that is not in v1.
 */
export function useSlipFeed(userId: string, scope: Scope, limit = 300) {
  const [slips, setSlips] = useState<FeedSlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    let q = supabase.from("slips").select(SELECT).order("created_at", { ascending: false }).limit(limit);
    if (scope === "mine") q = q.eq("user_id", userId);
    const { data, error: err } = await q;
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const rows: FeedSlip[] = [];
    for (const raw of (data ?? []) as unknown as RawRow[]) {
      const { rooms, profiles, legs, ...slip } = raw;
      rows.push({
        ...slip,
        room_name: rooms?.name ?? "Room",
        handle: profiles?.handle ?? "someone",
        legs: (legs ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)),
      });
    }
    setSlips(rows);
    setLoading(false);
  }, [userId, scope, limit]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { slips, loading, error, reload: load };
}

type RawRow = Slip & {
  rooms: { name: string } | null;
  profiles: { handle: string } | null;
  legs: FeedLeg[] | null;
};

export type SlipStatus = Enums<"slip_status">;

export const isOpenStatus = (s: SlipStatus) => s === "pending" || s === "live";
