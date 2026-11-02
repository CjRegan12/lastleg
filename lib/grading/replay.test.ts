/**
 * Replay test: drive a 3-leg parlay through six Propfein snapshots the way the
 * grade-legs function does every 30 seconds, and check the leg timeline plus
 * the feed events. one_away and cashed must each fire exactly once.
 *
 * Run: node --experimental-strip-types --test lib/grading/replay.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { PropfeinEvent } from "../api/propfein.types.ts";
import { detectTransitions, gradeLeg, rollupSlip } from "./grade.ts";
import type { GradableLeg, GradeRoomEventType, SlipRollup } from "./grade.ts";

// ---------------------------------------------------------------------------
// Three events, one per leg. Each snapshot is "what Propfein returned on this tick".
// ---------------------------------------------------------------------------

type Snap = Record<string, PropfeinEvent>;

function ev(
  id: string,
  status: PropfeinEvent["status"],
  period: number | null,
  clock: string | null,
  home: number | null,
  away: number | null,
  stats: PropfeinEvent["player_stats"] = undefined,
): PropfeinEvent {
  return {
    id,
    sport: "nfl",
    league: "NFL",
    home_team: { id: `${id}-h`, name: "Home", abbreviation: "HOM" },
    away_team: { id: `${id}-a`, name: "Away", abbreviation: "AWY" },
    start_time: "2026-11-08T18:00:00Z",
    status,
    period,
    clock,
    home_score: home,
    away_score: away,
    external_ids: {},
    player_stats: stats,
    updated_at: "2026-11-08T18:00:00Z",
  };
}

const hurts = (yards: number) => [
  { player_id: "p-hurts", name: "Jalen Hurts", team_id: "C-h", stat_type: "passing_yards", value: yards },
];

// Leg 1: event A, home spread -3.5. Leg 2: event B, total over 44.5. Leg 3: event C, Hurts over 249.5 passing yards.
const legs: { id: string; event_id: string; leg: GradableLeg }[] = [
  { id: "L1", event_id: "A", leg: { market: "spread", side: "home", line: -3.5, propfein_player_id: null, stat_type: null } },
  { id: "L2", event_id: "B", leg: { market: "total", side: "over", line: 44.5, propfein_player_id: null, stat_type: null } },
  { id: "L3", event_id: "C", leg: { market: "player_prop", side: "over", line: 249.5, propfein_player_id: "p-hurts", stat_type: "passing_yards" } },
];

const snapshots: Snap[] = [
  // 1. everything scheduled
  {
    A: ev("A", "scheduled", null, null, null, null),
    B: ev("B", "scheduled", null, null, null, null),
    C: ev("C", "scheduled", null, null, null, null),
  },
  // 2. A kicks off, Q1
  {
    A: ev("A", "live", 1, "09:40", 7, 0),
    B: ev("B", "scheduled", null, null, null, null),
    C: ev("C", "scheduled", null, null, null, null),
  },
  // 3. all three live, Q3-ish
  {
    A: ev("A", "live", 3, "02:10", 21, 17),
    B: ev("B", "live", 3, "11:00", 20, 14),
    C: ev("C", "live", 3, "06:30", 10, 13, hurts(188)),
  },
  // 4. A and B go final (both hit), C in Q4 -> one leg left
  {
    A: ev("A", "final", 4, "00:00", 31, 20),
    B: ev("B", "final", 4, "00:00", 27, 24),
    C: ev("C", "live", 4, "12:00", 17, 20, hurts(221)),
  },
  // 5. C still Q4, Hurts crosses the number but the game is not over
  {
    A: ev("A", "final", 4, "00:00", 31, 20),
    B: ev("B", "final", 4, "00:00", 27, 24),
    C: ev("C", "live", 4, "03:15", 24, 20, hurts(256)),
  },
  // 6. C final -> cashed
  {
    A: ev("A", "final", 4, "00:00", 31, 20),
    B: ev("B", "final", 4, "00:00", 27, 24),
    C: ev("C", "final", 4, "00:00", 27, 20, hurts(263)),
  },
];

// ---------------------------------------------------------------------------
// The grader loop, in miniature
// ---------------------------------------------------------------------------

describe("replay: 3-leg parlay across six snapshots", () => {
  const legStatus: Record<string, string> = { L1: "pending", L2: "pending", L3: "pending" };
  const legValue: Record<string, number | null> = { L1: null, L2: null, L3: null };
  let slipState: SlipRollup = rollupSlip(Object.values(legStatus));

  const timeline: string[][] = [];
  const slipTimeline: SlipRollup[] = [];
  const events: GradeRoomEventType[] = [];

  for (const snap of snapshots) {
    const prevSlip = slipState;
    const legEvents: GradeRoomEventType[] = [];

    for (const l of legs) {
      const prev = legStatus[l.id];
      const r = gradeLeg(l.leg, snap[l.event_id]);
      if (r.status !== prev || r.current_value !== legValue[l.id]) {
        legStatus[l.id] = r.status;
        legValue[l.id] = r.current_value;
        // leg-level events only, slip unchanged on purpose
        legEvents.push(...detectTransitions(prev, r.status, prevSlip, prevSlip));
      }
    }

    slipState = rollupSlip(legs.map((l) => legStatus[l.id]));
    const slipEvents = detectTransitions(null, null, prevSlip, slipState);

    events.push(...legEvents, ...slipEvents);
    timeline.push(legs.map((l) => legStatus[l.id]));
    slipTimeline.push(slipState);
  }

  it("leg statuses follow the game states", () => {
    assert.deepEqual(timeline, [
      ["pending", "pending", "pending"],
      ["live", "pending", "pending"],
      ["live", "live", "live"],
      ["won", "won", "live"],
      ["won", "won", "live"],
      ["won", "won", "won"],
    ]);
  });

  it("slip status and legs_remaining follow the rollup", () => {
    assert.deepEqual(slipTimeline, [
      { status: "pending", legs_remaining: 3, legs_total: 3 },
      { status: "live", legs_remaining: 3, legs_total: 3 },
      { status: "live", legs_remaining: 3, legs_total: 3 },
      { status: "live", legs_remaining: 1, legs_total: 3 },
      { status: "live", legs_remaining: 1, legs_total: 3 },
      { status: "won", legs_remaining: 0, legs_total: 3 },
    ]);
  });

  it("live legs carry a current_value", () => {
    // final values after the last snapshot
    assert.equal(legValue.L1, 7.5); // 31 - 3.5 - 20
    assert.equal(legValue.L2, 51); // 27 + 24
    assert.equal(legValue.L3, 263);
  });

  it("one_away and cashed fire exactly once each", () => {
    assert.equal(events.filter((e) => e === "one_away").length, 1);
    assert.equal(events.filter((e) => e === "cashed").length, 1);
  });

  it("three leg_hit events, no losses, no slip_dead", () => {
    assert.equal(events.filter((e) => e === "leg_hit").length, 3);
    assert.equal(events.filter((e) => e === "leg_lost").length, 0);
    assert.equal(events.filter((e) => e === "slip_dead").length, 0);
  });

  it("events arrive in game order", () => {
    assert.deepEqual(events, ["leg_hit", "leg_hit", "one_away", "leg_hit", "cashed"]);
  });

  it("snapshot 5 (no state change) emits nothing", () => {
    // Re-run snapshot 5 after snapshot 4 state in isolation.
    const st: Record<string, string> = { L1: "won", L2: "won", L3: "live" };
    const before = rollupSlip(Object.values(st));
    const emitted: GradeRoomEventType[] = [];
    for (const l of legs) {
      const r = gradeLeg(l.leg, snapshots[4][l.event_id]);
      if (r.status !== st[l.id]) emitted.push(...detectTransitions(st[l.id], r.status, before, before));
      st[l.id] = r.status;
    }
    emitted.push(...detectTransitions(null, null, before, rollupSlip(Object.values(st))));
    assert.deepEqual(emitted, []);
  });
});
