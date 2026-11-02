/**
 * Propfein API contract consumed by Last Leg.
 * Mirrors "Phase 1: Propfein API contract" in the Build Plan.
 * Last Leg stores NO sports data; everything here comes from Propfein.
 *
 * All times are UTC ISO 8601. All odds are American integers.
 * Team and player ids are Propfein's own stable ids.
 */

export type Sport = "nfl" | "nba";

export type EventStatus = "scheduled" | "live" | "final" | "postponed" | "canceled";

export interface Team {
  id: string;
  name: string; // "Philadelphia Eagles"
  abbreviation: string; // "PHI"
}

export interface PlayerStat {
  player_id: string;
  name: string;
  team_id: string;
  stat_type: string; // "passing_yards", "points", "rebounds", "receptions", "anytime_td" ...
  value: number;
}

export interface PropfeinEvent {
  id: string;
  sport: Sport;
  league: string; // "NFL" | "NBA"
  home_team: Team;
  away_team: Team;
  start_time: string; // ISO
  status: EventStatus;
  period: number | null; // quarter / half / OT index; null when scheduled
  clock: string | null; // "12:34" ; null when not live
  home_score: number | null;
  away_score: number | null;
  external_ids: { espn?: string; odds_api?: string };
  player_stats?: PlayerStat[]; // only on GET /v1/events/{id}
  updated_at: string; // ISO, when Propfein last refreshed this event
}

export type Market =
  | "spread"
  | "total"
  | "moneyline"
  | "player_prop"
  | "team_prop"
  | "other";

export interface LegMatchRequest {
  sport: Sport | null;
  date: string; // YYYY-MM-DD, the slate date in America/New_York
  teams?: string[]; // as parsed from the slip, e.g. ["Eagles", "Cowboys"]
  player?: string | null; // "Jalen Hurts"
  market: Market;
  selection: string; // raw selection text from the slip
  line?: number | null;
  stat_type?: string | null;
}

export interface LegMatchCandidate {
  event_id: string;
  market_key: string; // Propfein's canonical market key, e.g. "spread:home", "total:over", "prop:passing_yards:over"
  player_id: string | null;
  team_id: string | null; // which side the selection is on, when applicable
  side: "home" | "away" | "over" | "under" | null;
  confidence: number; // 0..1
}

export interface LegMatchResponse {
  best: LegMatchCandidate | null;
  alternates: LegMatchCandidate[]; // up to 3
}

export interface OddsQuote {
  book: string; // "draftkings" | "fanduel" | ...
  odds_american: number;
  implied_prob: number;
  fair_prob: number; // devigged
  ev_percent: number; // vs best available
  deep_link?: string | null;
}

export interface OddsResponse {
  event_id: string;
  market_key: string;
  player_id: string | null;
  line: number | null;
  quotes: OddsQuote[];
  best_book: string | null;
  updated_at: string;
}

export interface PropfeinError {
  error: { code: string; message: string };
}
