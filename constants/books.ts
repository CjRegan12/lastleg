import type { Database } from "@/lib/database.types";

export type Sportsbook = Database["public"]["Enums"]["sportsbook"];

export const BOOKS: readonly Sportsbook[] = [
  "draftkings",
  "fanduel",
  "caesars",
  "betmgm",
  "fanatics",
  "other",
] as const;

export const BOOK_LABELS: Record<Sportsbook, string> = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  caesars: "Caesars",
  betmgm: "BetMGM",
  fanatics: "Fanatics",
  other: "Other",
};

/** Plain sportsbook home URLs. No affiliate tags in v1 (DECISIONS.md). */
export const BOOK_URLS: Record<Sportsbook, string | null> = {
  draftkings: "https://sportsbook.draftkings.com",
  fanduel: "https://sportsbook.fanduel.com",
  caesars: "https://sportsbook.caesars.com",
  betmgm: "https://sports.betmgm.com",
  fanatics: "https://sportsbook.fanatics.com",
  other: null,
};

export const BET_TYPES: readonly Database["public"]["Enums"]["bet_type"][] = [
  "single",
  "parlay",
  "sgp",
  "round_robin",
  "teaser",
  "other",
] as const;

export const BET_TYPE_LABELS: Record<Database["public"]["Enums"]["bet_type"], string> = {
  single: "Straight",
  parlay: "Parlay",
  sgp: "SGP",
  round_robin: "Round robin",
  teaser: "Teaser",
  other: "Other",
};

export const MARKETS: readonly Database["public"]["Enums"]["market"][] = [
  "spread",
  "total",
  "moneyline",
  "player_prop",
  "team_prop",
  "other",
] as const;

export const MARKET_LABELS: Record<Database["public"]["Enums"]["market"], string> = {
  spread: "Spread",
  total: "Total",
  moneyline: "Moneyline",
  player_prop: "Player prop",
  team_prop: "Team prop",
  other: "Other",
};

export const SPORTS: readonly Database["public"]["Enums"]["sport"][] = [
  "nfl",
  "nba",
  "mlb",
  "nhl",
  "ncaaf",
  "ncaab",
  "other",
] as const;

export const APP_NAME = "Last Leg";
export const WEB_JOIN_BASE = "https://lastleg.io/join";
export const APP_SCHEME_JOIN_BASE = "lastleg://join";
