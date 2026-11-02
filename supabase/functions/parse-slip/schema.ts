/**
 * JSON schema for Claude structured output when parsing a sportsbook bet slip,
 * plus the matching TypeScript type. Every object has additionalProperties: false
 * and every field is required (nullable where noted) so the model cannot drop
 * or invent keys.
 *
 * Enum values mirror the Postgres enums in supabase/migrations/20261102000001_schema.sql
 * (sportsbook, bet_type, sport, market).
 */

export const BOOKS = ["draftkings", "fanduel", "caesars", "betmgm", "fanatics", "other"] as const;
export const BET_TYPES = ["single", "parlay", "sgp", "round_robin", "teaser", "other"] as const;
export const SPORTS = ["nfl", "nba", "mlb", "nhl", "ncaaf", "ncaab", "other"] as const;
export const MARKETS = ["spread", "total", "moneyline", "player_prop", "team_prop", "other"] as const;

/** Canonical stat_type values the prompt asks the model to use. Not enforced by schema (string|null). */
export const STAT_TYPES = [
  "passing_yards",
  "passing_tds",
  "passing_attempts",
  "completions",
  "interceptions",
  "rushing_yards",
  "rushing_attempts",
  "rushing_tds",
  "receiving_yards",
  "receptions",
  "receiving_tds",
  "anytime_td",
  "first_td",
  "points",
  "rebounds",
  "assists",
  "threes",
  "steals",
  "blocks",
  "turnovers",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists",
  "double_double",
  "triple_double",
  "strikeouts",
  "hits",
  "total_bases",
  "home_runs",
  "rbis",
  "shots_on_goal",
  "goals",
  "saves",
] as const;

export type Book = (typeof BOOKS)[number];
export type BetType = (typeof BET_TYPES)[number];
export type SlipSport = (typeof SPORTS)[number];
export type SlipMarket = (typeof MARKETS)[number];

export interface ParsedLeg {
  sport: SlipSport;
  market: SlipMarket;
  selection: string;
  line: number | null;
  player_name: string | null;
  stat_type: string | null;
  teams: string[];
  event_date_hint: string | null; // YYYY-MM-DD
  leg_odds_american: number | null;
  confidence: number; // 0..1
}

export interface ParsedSlip {
  book: Book;
  bet_type: BetType;
  stake: number;
  odds_american: number;
  potential_payout: number;
  legs: ParsedLeg[];
  overall_confidence: number; // 0..1
}

const LEG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "sport",
    "market",
    "selection",
    "line",
    "player_name",
    "stat_type",
    "teams",
    "event_date_hint",
    "leg_odds_american",
    "confidence",
  ],
  properties: {
    sport: { type: "string", enum: [...SPORTS] },
    market: { type: "string", enum: [...MARKETS] },
    selection: {
      type: "string",
      description: "The pick exactly as printed, e.g. 'Eagles -3.5', 'Over 47.5', 'Jalen Hurts Over 249.5 Passing Yds'",
    },
    line: {
      type: ["number", "null"],
      description: "Spread, total, or prop line as a number. null for moneyline or when not visible.",
    },
    player_name: { type: ["string", "null"], description: "Player name for player props, else null." },
    stat_type: {
      type: ["string", "null"],
      description: "Canonical snake_case stat for player props (passing_yards, receptions, points, rebounds, assists, threes, anytime_td, rushing_yards, receiving_yards ...). null when not a player prop.",
    },
    teams: {
      type: "array",
      items: { type: "string" },
      description: "Short team names as printed on the slip, e.g. ['Eagles', 'Cowboys']. Empty array if none shown.",
    },
    event_date_hint: {
      type: ["string", "null"],
      description: "Game date if visible, formatted YYYY-MM-DD. null if not visible.",
    },
    leg_odds_american: {
      type: ["integer", "null"],
      description: "Odds for this leg as an American integer (e.g. -110, +250). null if not shown (common on SGP legs).",
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export const SLIP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["book", "bet_type", "stake", "odds_american", "potential_payout", "legs", "overall_confidence"],
  properties: {
    book: { type: "string", enum: [...BOOKS] },
    bet_type: { type: "string", enum: [...BET_TYPES] },
    stake: { type: "number", description: "Wager amount in dollars, e.g. 10 or 12.50." },
    odds_american: {
      type: "integer",
      description: "Total odds for the whole slip as an American integer, e.g. +650 -> 650, -110 -> -110.",
    },
    potential_payout: {
      type: "number",
      description: "Total payout (to win + stake) in dollars as printed. If only 'to win' is shown, add the stake.",
    },
    legs: { type: "array", items: LEG_SCHEMA },
    overall_confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

/** Runtime guard: cheap shape check on whatever the model returned before we trust it. */
export function isParsedSlip(x: unknown): x is ParsedSlip {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.book === "string" &&
    typeof o.bet_type === "string" &&
    typeof o.stake === "number" &&
    typeof o.odds_american === "number" &&
    typeof o.potential_payout === "number" &&
    Array.isArray(o.legs) &&
    typeof o.overall_confidence === "number"
  );
}
