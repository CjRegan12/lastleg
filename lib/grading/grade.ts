/**
 * Pure grading logic for Last Leg. No I/O, no Supabase, no Deno.
 *
 * Shared by the Expo app (optimistic display) and the `grade-legs` Edge
 * Function (supabase/functions/_shared/grade.ts is an exact copy of this
 * file). Keep it dependency free so it runs under Node, Deno and Hermes.
 *
 * Everything here takes a leg as stored in `legs` plus a PropfeinEvent and
 * returns a decision. Nothing here writes anything.
 */
import type { PlayerStat, PropfeinEvent } from "../api/propfein.types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LegMarket = "spread" | "total" | "moneyline" | "player_prop" | "team_prop" | "other";
export type LegSide = "home" | "away" | "over" | "under" | null;

/** The subset of a `legs` row the grader needs. */
export interface GradableLeg {
  market: LegMarket;
  side: LegSide;
  line: number | null;
  propfein_player_id: string | null;
  stat_type: string | null;
}

/** Statuses the automatic grader is allowed to produce. `void` is only ever set by a human override. */
export type LegGradeStatus = "pending" | "live" | "won" | "lost" | "push" | "needs_review";

export interface LegGradeResult {
  status: LegGradeStatus;
  /** Live or final number behind the grade: margin incl. line, combined total, or the stat value. */
  current_value: number | null;
  /** Short human-readable explanation, shown in the needs_review UI and logged by the grader. */
  reason: string;
}

/** Slip statuses, mirrors the `slip_status` enum. `push` exists in the enum but rollup never emits it. */
export type SlipRollupStatus = "pending" | "live" | "won" | "lost" | "void";

export interface SlipRollup {
  status: SlipRollupStatus;
  legs_remaining: number;
  /** Total legs on the slip. Needed so one_away never fires for a single bet. */
  legs_total: number;
}

/** Feed events the grader can emit. Subset of the `room_event_type` enum. */
export type GradeRoomEventType = "leg_hit" | "leg_lost" | "slip_dead" | "one_away" | "cashed";

export const SETTLED_LEG_STATUSES: ReadonlySet<string> = new Set(["won", "lost", "void", "push"]);
export const OPEN_LEG_STATUSES: ReadonlySet<string> = new Set(["pending", "live", "needs_review"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function result(status: LegGradeStatus, current_value: number | null, reason: string): LegGradeResult {
  return { status, current_value, reason };
}

/** Compare a value to a line. Exactly equal is a push (only possible on whole-number lines). */
function settleOverUnder(value: number, line: number, side: "over" | "under"): LegGradeStatus {
  if (value === line) return "push";
  const over = value > line;
  return over === (side === "over") ? "won" : "lost";
}

function sideScores(event: PropfeinEvent, side: "home" | "away"): { mine: number; theirs: number } | null {
  if (event.home_score == null || event.away_score == null) return null;
  return side === "home"
    ? { mine: event.home_score, theirs: event.away_score }
    : { mine: event.away_score, theirs: event.home_score };
}

function findStat(event: PropfeinEvent, playerId: string, statType: string): PlayerStat | undefined {
  return (event.player_stats ?? []).find((s) => s.player_id === playerId && s.stat_type === statType);
}

/** Round away float noise from half-point math (e.g. 24 + -3.5 - 20). */
function clean(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// gradeLeg
// ---------------------------------------------------------------------------

/**
 * Grade one leg against the current state of its event.
 *
 * Ordering of checks:
 *  1. postponed / canceled events -> needs_review (a human voids or re-points the leg)
 *  2. a null side on a market that needs one -> needs_review (bad match, fix before kickoff)
 *  3. scheduled -> pending
 *  4. live -> live, with a current_value when it can be computed
 *  5. final -> settle, or needs_review when the data needed is missing
 */
export function gradeLeg(leg: GradableLeg, event: PropfeinEvent): LegGradeResult {
  // 1. Events that will not produce a result.
  if (event.status === "postponed" || event.status === "canceled") {
    return result("needs_review", null, `event ${event.status}; void or re-match the leg manually`);
  }

  // 2. Markets we never grade automatically.
  if (leg.market === "team_prop" || leg.market === "other") {
    if (event.status === "scheduled") return result("pending", null, `${leg.market} grades manually after the game`);
    if (event.status === "live") return result("live", null, `${leg.market} is live; grades manually after the game`);
    return result("needs_review", null, `${leg.market} is not auto-graded`);
  }

  // 3. Side is required for every auto-graded market.
  if (leg.side == null) {
    return result("needs_review", null, "leg has no side; re-match the leg");
  }
  const isTeamSide = leg.side === "home" || leg.side === "away";
  const isOuSide = leg.side === "over" || leg.side === "under";

  if ((leg.market === "spread" || leg.market === "moneyline") && !isTeamSide) {
    return result("needs_review", null, `${leg.market} needs a home/away side, got ${leg.side}`);
  }
  if ((leg.market === "total" || leg.market === "player_prop") && !isOuSide) {
    return result("needs_review", null, `${leg.market} needs an over/under side, got ${leg.side}`);
  }
  if ((leg.market === "spread" || leg.market === "total" || leg.market === "player_prop") && leg.line == null) {
    return result("needs_review", null, `${leg.market} has no line`);
  }

  // 4. Nothing has happened yet.
  if (event.status === "scheduled") {
    return result("pending", null, "event not started");
  }

  const live = event.status === "live";
  const where = live ? `${event.period ?? "?"}Q ${event.clock ?? ""}`.trim() : "final";

  switch (leg.market) {
    case "spread": {
      const sc = sideScores(event, leg.side as "home" | "away");
      if (!sc) return live ? result("live", null, "no score yet") : result("needs_review", null, "final with no score");
      const margin = clean(sc.mine + (leg.line as number) - sc.theirs);
      if (live) return result("live", margin, `covering by ${margin} at ${where}`);
      if (margin === 0) return result("push", margin, "landed exactly on the number");
      return result(margin > 0 ? "won" : "lost", margin, `${sc.mine}-${sc.theirs} with ${leg.line}`);
    }

    case "moneyline": {
      const sc = sideScores(event, leg.side as "home" | "away");
      if (!sc) return live ? result("live", null, "no score yet") : result("needs_review", null, "final with no score");
      const margin = sc.mine - sc.theirs;
      if (live) return result("live", margin, `margin ${margin} at ${where}`);
      if (margin === 0) return result("push", margin, "tie");
      return result(margin > 0 ? "won" : "lost", margin, `${sc.mine}-${sc.theirs}`);
    }

    case "total": {
      if (event.home_score == null || event.away_score == null) {
        return live ? result("live", null, "no score yet") : result("needs_review", null, "final with no score");
      }
      const total = event.home_score + event.away_score;
      if (live) return result("live", total, `${total} at ${where}, line ${leg.line}`);
      const status = settleOverUnder(total, leg.line as number, leg.side as "over" | "under");
      return result(status, total, `total ${total} vs ${leg.line}`);
    }

    case "player_prop": {
      if (!leg.propfein_player_id || !leg.stat_type) {
        return result("needs_review", null, "player prop missing player id or stat type");
      }
      const stat = findStat(event, leg.propfein_player_id, leg.stat_type);
      if (live) {
        return stat
          ? result("live", stat.value, `${stat.name} ${stat.value} ${leg.stat_type} at ${where}, line ${leg.line}`)
          : result("live", null, `no ${leg.stat_type} stat yet`);
      }
      if (!stat) return result("needs_review", null, `no final ${leg.stat_type} stat for player ${leg.propfein_player_id}`);
      const status = settleOverUnder(stat.value, leg.line as number, leg.side as "over" | "under");
      return result(status, stat.value, `${stat.name} ${stat.value} ${leg.stat_type} vs ${leg.line}`);
    }

    default:
      return result("needs_review", null, `unknown market ${String(leg.market)}`);
  }
}

// ---------------------------------------------------------------------------
// rollupSlip
// ---------------------------------------------------------------------------

/**
 * Recompute a slip's status from its leg statuses. Must stay identical to the
 * SQL `rollup_slip()` in supabase/migrations/20261102000002_rls.sql:
 *   any lost                      -> lost
 *   any open (pending/live/nr)    -> live if any leg is live, else pending
 *   any won (rest void/push)      -> won
 *   all void/push, >= 1 leg       -> void
 *   no legs                       -> pending
 */
export function rollupSlip(legStatuses: string[]): SlipRollup {
  const total = legStatuses.length;
  let lost = 0;
  let won = 0;
  let voided = 0;
  let open = 0;
  let anyLive = false;
  for (const s of legStatuses) {
    if (s === "lost") lost++;
    else if (s === "won") won++;
    else if (s === "void" || s === "push") voided++;
    else if (OPEN_LEG_STATUSES.has(s)) {
      open++;
      if (s === "live") anyLive = true;
    }
  }

  let status: SlipRollupStatus;
  if (lost > 0) status = "lost";
  else if (open > 0) status = anyLive ? "live" : "pending";
  else if (won > 0) status = "won";
  else if (voided === total && total > 0) status = "void";
  else status = "pending";

  return { status, legs_remaining: open, legs_total: total };
}

// ---------------------------------------------------------------------------
// detectTransitions
// ---------------------------------------------------------------------------

/**
 * Which feed events a state change should produce.
 *
 * Leg events come from the leg status pair, slip events from the slip pair.
 * Pass `null` for both leg statuses to get slip events only (the grader does
 * this once per slip after rollup, and calls with the leg pair once per leg
 * with the slip unchanged, so nothing is double counted).
 */
export function detectTransitions(
  prevLegStatus: string | null,
  nextLegStatus: string | null,
  prevSlip: SlipRollup,
  nextSlip: SlipRollup,
): GradeRoomEventType[] {
  const out: GradeRoomEventType[] = [];

  if (prevLegStatus !== nextLegStatus) {
    if (nextLegStatus === "won") out.push("leg_hit");
    if (nextLegStatus === "lost") out.push("leg_lost");
  }

  const slipChanged = prevSlip.status !== nextSlip.status;
  if (slipChanged && nextSlip.status === "lost") out.push("slip_dead");
  if (slipChanged && nextSlip.status === "won") out.push("cashed");

  // one_away: the slip is a parlay (legs_total > 1; a single bet is never
  // "one away"), is still open (pending or live) and either
  //  a) legs_remaining just dropped from >1 to exactly 1, or
  //  b) legs_remaining was already 1 and the slip went pending -> live
  //     (the last leg's game just kicked off).
  // (b) can re-fire after (a) when the last leg's game starts later than the
  // others settled. The grader dedupes: notifications via the unique
  // (user_id, slate_id, type, slip_id) index, room_events by checking for an existing
  // one_away row for the slip before inserting.
  const stillOpen = nextSlip.status === "pending" || nextSlip.status === "live";
  if (stillOpen && nextSlip.legs_total > 1 && nextSlip.legs_remaining === 1) {
    const droppedToOne = prevSlip.legs_remaining > 1;
    const lastLegWentLive =
      prevSlip.legs_remaining === 1 && prevSlip.status === "pending" && nextSlip.status === "live";
    if (droppedToOne || lastLegWentLive) out.push("one_away");
  }

  return out;
}
