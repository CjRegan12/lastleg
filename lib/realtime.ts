import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import { supabase } from "@/lib/supabase";

export type BroadcastOp = "INSERT" | "UPDATE" | "DELETE";
export type BroadcastTable = "slips" | "legs" | "room_events" | "slates";

/** Payload shape produced by realtime.broadcast_changes(). */
interface BroadcastChangesPayload {
  event: BroadcastOp;
  payload: {
    id?: string;
    operation: BroadcastOp;
    schema: string;
    table: string;
    record: Record<string, unknown> | null;
    old_record: Record<string, unknown> | null;
  };
}

export type RoomChangeHandler = (
  table: BroadcastTable | string,
  op: BroadcastOp,
  record: Record<string, unknown> | null,
  oldRecord: Record<string, unknown> | null,
) => void;

/**
 * Subscribe to the private `room:<roomId>` Broadcast channel (DECISIONS: never
 * postgres_changes). The realtime.messages RLS policy checks is_room_member on
 * the topic, so setAuth() must run before subscribe.
 */
export function useRoomChannel(roomId: string | null | undefined, onChange: RoomChangeHandler): void {
  // keep the latest handler without resubscribing on every render
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    if (!roomId) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      const topic = `room:${roomId}`;
      const dispatch = (p: BroadcastChangesPayload) => {
        handlerRef.current(p.payload.table, p.payload.operation, p.payload.record, p.payload.old_record);
      };
      channel = supabase
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: "INSERT" }, (p) => dispatch(p as unknown as BroadcastChangesPayload))
        .on("broadcast", { event: "UPDATE" }, (p) => dispatch(p as unknown as BroadcastChangesPayload))
        .on("broadcast", { event: "DELETE" }, (p) => dispatch(p as unknown as BroadcastChangesPayload))
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" && __DEV__) {
            console.warn(`[realtime] ${topic} error`, err);
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId]);
}
