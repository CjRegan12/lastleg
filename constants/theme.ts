import type { TextStyle } from "react-native";

/**
 * Design tokens. See DESIGN.md. Dark only in v1: people use this at night with the game on.
 * Card color = state. Never hardcode a hex outside this file.
 *
 * Amber is the brand and the one-leg-away color. It is used for nothing else.
 */
export const colors = {
  bg: "#0A0B0D", // ink
  surface: "#14161A",
  surfaceRaised: "#1C1F25",
  border: "#272B33",
  text: "#F3F1EC",
  muted: "#8F949C",
  pending: "#6B7280",
  live: "#6AA6FF",
  won: "#3DDC84",
  lost: "#FF5C5C",
  oneAway: "#FFB020",
  oneAwayInk: "#2A1F06",
  void: "#6B7280",
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

/**
 * Font families registered in app/_layout.tsx via expo-font. If the fonts fail
 * to load the app still renders with the system face; nothing blocks on them.
 */
export const fonts = {
  body: "Barlow-Regular",
  bodyMedium: "Barlow-Medium",
  bodySemi: "Barlow-SemiBold",
  condensedSemi: "BarlowCondensed-SemiBold",
  condensedBold: "BarlowCondensed-Bold",
} as const;

/** Type scale from DESIGN.md. Spread into a StyleSheet entry. */
const tabular: TextStyle["fontVariant"] = ["tabular-nums"];
export const type = {
  display: { fontFamily: fonts.condensedBold, fontSize: 40, lineHeight: 42, letterSpacing: -0.5, color: colors.text },
  title: { fontFamily: fonts.condensedBold, fontSize: 28, lineHeight: 30, color: colors.text },
  number: { fontFamily: fonts.condensedSemi, fontSize: 22, lineHeight: 24, color: colors.text, fontVariant: tabular },
  numberLg: { fontFamily: fonts.condensedBold, fontSize: 34, lineHeight: 36, color: colors.text, fontVariant: tabular },
  heading: { fontFamily: fonts.bodySemi, fontSize: 17, lineHeight: 22, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.text },
  bodyMedium: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 21, color: colors.text },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  smallMedium: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18, color: colors.text },
  micro: { fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14, color: colors.muted },
} satisfies Record<string, TextStyle>;

/** The only shadow in the app: the one-leg-away glow. */
export const amberGlow = {
  shadowColor: colors.oneAway,
  shadowOpacity: 0.45,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 0 },
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
