import { Share } from "react-native";

import { APP_NAME, APP_SCHEME_JOIN_BASE, WEB_JOIN_BASE } from "@/constants/books";
import type { Room } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export type JoinResult = { ok: true; room: Room } | { ok: false; message: string };

/** join_room RPC with the Postgres error translated for humans. */
export async function joinRoomByCode(code: string): Promise<JoinResult> {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 8) return { ok: false, message: "Codes are 8 letters and numbers." };
  const { data, error } = await supabase.rpc("join_room", { p_invite_code: clean });
  if (error) {
    // P0002 is raised by join_room for an unknown code
    if (error.code === "P0002" || /invalid invite/i.test(error.message)) {
      return { ok: false, message: "That code does not match a room. Check it and try again." };
    }
    return { ok: false, message: error.message };
  }
  if (!data) return { ok: false, message: "Could not join the room." };
  return { ok: true, room: data };
}

export function inviteLinks(inviteCode: string): { app: string; web: string } {
  return {
    app: `${APP_SCHEME_JOIN_BASE}/${inviteCode}`,
    web: `${WEB_JOIN_BASE}/${inviteCode}`,
  };
}

/** iOS share sheet with the code and both link forms. */
export async function shareInvite(room: Pick<Room, "name" | "invite_code">): Promise<void> {
  const { app, web } = inviteLinks(room.invite_code);
  await Share.share({
    title: `Join ${room.name} on ${APP_NAME}`,
    message: `Join "${room.name}" on ${APP_NAME}. Code: ${room.invite_code}\n${web}\n(or ${app} if the app is installed)`,
  });
}
