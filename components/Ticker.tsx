import { ScrollView, StyleSheet, View } from "react-native";

import { T } from "@/components/ui/Text";
import { colors, radius, spacing } from "@/constants/theme";
import type { Enums, RoomEvent } from "@/lib/database.types";
import { formatMoney, formatRelative } from "@/lib/format";

interface TickerProps {
  events: RoomEvent[];
}

/** Horizontal strip of the latest room_events, newest first. Read only (inserts are service role). */
export function Ticker({ events }: TickerProps) {
  if (events.length === 0) {
    return (
      <View style={styles.empty}>
        <T variant="small">Quiet for now. Slips and grades show up here live.</T>
      </View>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {events.map((e) => {
        const color = eventColor(e.type);
        return (
          <View key={e.id} style={[styles.chip, { borderColor: color }]}>
            <T variant="smallMedium" color={color} style={styles.chipText} numberOfLines={1}>
              {describe(e)}
            </T>
            <T variant="micro" style={styles.time}>
              {formatRelative(e.created_at)}
            </T>
          </View>
        );
      })}
    </ScrollView>
  );
}

function eventColor(t: Enums<"room_event_type">): string {
  switch (t) {
    case "cashed":
    case "leg_hit":
      return colors.won;
    case "slip_dead":
    case "leg_lost":
      return colors.lost;
    case "one_away":
      return colors.oneAway;
    case "tailed":
    case "slip_added":
      return colors.live;
    default:
      return colors.muted;
  }
}

/** Payload keys are written by the grader; read defensively. */
function describe(e: RoomEvent): string {
  const raw: unknown = e.payload;
  const p: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const who = typeof p.handle === "string" ? p.handle : "someone";
  const selection = typeof p.selection === "string" ? p.selection : "a leg";
  const payout = typeof p.potential_payout === "number" ? formatMoney(p.potential_payout) : null;
  switch (e.type) {
    case "slip_added":
      return `${who} dropped a slip${payout ? ` for ${payout}` : ""}`;
    case "leg_hit":
      return `${who}: ${selection} hit`;
    case "leg_lost":
      return `${who}: ${selection} lost`;
    case "slip_dead":
      return `${who}'s slip is dead`;
    case "one_away":
      return `${who} is one leg away${payout ? ` from ${payout}` : ""}`;
    case "cashed":
      return `${who} cashed${payout ? ` ${payout}` : ""}`;
    case "tailed":
      return `${who} tailed ${typeof p.target_handle === "string" ? p.target_handle : "a slip"}`;
    case "slate_final":
      return "Slate is final. Recap is ready.";
    default:
      return e.type;
  }
}

const styles = StyleSheet.create({
  strip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    maxWidth: 280,
  },
  chipText: { flexShrink: 1 },
  time: { marginLeft: spacing.sm },
  empty: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
