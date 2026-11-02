import { useCallback, useEffect, useMemo, useState } from "react";

import type { SlipCardLeg } from "@/components/SlipCard";
import type { RoomEvent, Slate, SlateBoardRow } from "@/lib/database.types";
import { todayNY } from "@/lib/format";
import { useRoomChannel } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";

/**
 * Board data for one room + slate date. Loads via REST, then refetches the
 * affected table when a Broadcast arrives (simple and correct; the board is
 * small).
 *
 * Slate rows: ensure_slate runs only on initial load / date change, and only
 * for today or future dates, so "today" always exists but browsing back never
 * manufactures empty past slates (those are a plain select; none -> empty
 * board). A `slates` broadcast carries the whole row, so we apply it directly
 * instead of calling ensure_slate again.
 */
export function useSlateBoard(roomId: string | null | undefined, slateDate: string) {
  const [slate, setSlate] = useState<Slate | null>(null);
  const [slips, setSlips] = useState<SlateBoardRow[]>([]);
  const [legsBySlip, setLegsBySlip] = useState<Record<string, SlipCardLeg[]>>({});
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSlate = useCallback(async (): Promise<Slate | null> => {
    if (!roomId) return null;
    const isPast = slateDate < todayNY();

    if (isPast) {
      const { data, error: err } = await supabase
        .from("slates")
        .select("*")
        .eq("room_id", roomId)
        .eq("slate_date", slateDate)
        .maybeSingle();
      if (err) {
        setError(err.message);
        return null;
      }
      setSlate(data ?? null);
      return data ?? null;
    }

    const { data, error: err } = await supabase.rpc("ensure_slate", {
      p_room_id: roomId,
      p_date: slateDate,
    });
    if (err) {
      setError(err.message);
      return null;
    }
    setSlate(data);
    return data;
  }, [roomId, slateDate]);

  const loadSlips = useCallback(async (slateId: string) => {
    const { data, error: err } = await supabase
      .from("slate_board")
      .select("*")
      .eq("slate_id", slateId)
      .order("status_rank", { ascending: true })
      .order("remaining_rank", { ascending: true })
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      return;
    }
    const rows = data ?? [];
    setSlips(rows);
    const ids = rows.map((r) => r.id).filter((id): id is string => !!id);
    if (ids.length === 0) {
      setLegsBySlip({});
      return;
    }
    const { data: legs } = await supabase
      .from("legs")
      .select("id, slip_id, status, selection, created_at")
      .in("slip_id", ids)
      .order("created_at", { ascending: true });
    const grouped: Record<string, SlipCardLeg[]> = {};
    for (const l of legs ?? []) {
      (grouped[l.slip_id] ??= []).push({ id: l.id, status: l.status, selection: l.selection });
    }
    setLegsBySlip(grouped);
  }, []);

  const loadEvents = useCallback(async (slateId: string) => {
    const { data } = await supabase
      .from("room_events")
      .select("*")
      .eq("slate_id", slateId)
      .order("created_at", { ascending: false })
      .limit(20);
    setEvents(data ?? []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const s = await loadSlate();
    if (s) {
      await Promise.all([loadSlips(s.id), loadEvents(s.id)]);
    } else {
      // no slate for this date (past day nobody posted on): empty board
      setSlips([]);
      setLegsBySlip({});
      setEvents([]);
    }
    setLoading(false);
  }, [loadSlate, loadSlips, loadEvents]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useRoomChannel(roomId, (table, _op, record) => {
    if (table === "slates") {
      // A slate row changed (open -> live -> final, or a new slate for this date).
      // The broadcast carries the full row; no need to hit ensure_slate again.
      if (!record) return;
      const rec = record as unknown as Slate;
      if (slate ? rec.id === slate.id : rec.slate_date === slateDate && rec.room_id === roomId) {
        setSlate(rec);
        if (!slate) {
          // a slate appeared for the date we are looking at: pull its board
          loadSlips(rec.id);
          loadEvents(rec.id);
        }
      }
      return;
    }
    if (!slate) return;
    const recSlate = record?.slate_id;
    // broadcasts carry the whole row; skip rows for other slates when we can tell
    if (recSlate && recSlate !== slate.id) return;
    if (table === "slips" || table === "legs") loadSlips(slate.id);
    else if (table === "room_events") loadEvents(slate.id);
  });

  const totals = useMemo(() => {
    const atRisk = slips.reduce((sum, s) => sum + (s.stake ?? 0), 0);
    const live = slips.filter((s) => s.status === "live").length;
    const won = slips.filter((s) => s.status === "won").length;
    const lost = slips.filter((s) => s.status === "lost").length;
    return { atRisk, live, won, lost, count: slips.length };
  }, [slips]);

  return { slate, slips, legsBySlip, events, totals, loading, error, refresh };
}
