/**
 * Design tokens. Dark only in v1: people use this at night with the game on.
 * Card color = state. Never hardcode a hex outside this file.
 */
export const colors = {
  bg: "#0B0F14",
  surface: "#121820",
  surfaceRaised: "#182029",
  border: "#1F2A36",
  text: "#E8EEF5",
  muted: "#8A98A8",
  pending: "#6B7685",
  live: "#3B82F6",
  won: "#22C55E",
  lost: "#EF4444",
  oneAway: "#F59E0B",
  void: "#6B7685",
  black: "#000000",
  white: "#FFFFFF",
} as const;

export type ColorToken = keyof typeof colors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 24,
  xxl: 32,
} as const;

/** Slip and leg statuses share the same palette. */
export type GradeStatus = "pending" | "live" | "won" | "lost" | "void" | "push" | "needs_review";

export function statusColor(status: GradeStatus, legsRemaining?: number | null): string {
  switch (status) {
    case "live":
      return legsRemaining === 1 ? colors.oneAway : colors.live;
    case "won":
      return colors.won;
    case "lost":
      return colors.lost;
    case "void":
    case "push":
      return colors.void;
    case "needs_review":
      return colors.oneAway;
    case "pending":
    default:
      return colors.pending;
  }
}

export function statusLabel(status: GradeStatus): string {
  switch (status) {
    case "needs_review":
      return "Needs review";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}
