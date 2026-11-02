/**
 * Run: node --experimental-strip-types --test lib/grading/grade.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { PropfeinEvent } from "../api/propfein.types.ts";
import { mockEvents } from "../api/propfein.mock.ts";
import { detectTransitions, gradeLeg, rollupSlip } from "./grade.ts";
import type { GradableLeg, SlipRollup } from "./grade.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const nfl = mockEvents("nfl", "2026-11-08");
const nba = mockEvents("nba", "2026-11-01");
const nflLive = nfl.find((e) => e.id === "nfl-mock-live")!; // PHI 24 - DAL 20, Q4
const nflFinal = nfl.find((e) => e.id === "nfl-mock-final")!; // BUF 31 - MIA 17
const nflScheduled = nfl.find((e) => e.id === "nfl-mock-scheduled")!;
const nbaLive = nba.find((e) => e.id === "nba-mock-live")!; // NYK 78 - BOS 81, Q3
const nbaFinal = nba.find((e) => e.id === "nba-mock-final")!; // LAL 112 - GSW 118

function leg(partial: Partial<GradableLeg> & { market: GradableLeg["market"] }): GradableLeg {
  return {
    side: null,
    line: null,
    propfein_player_id: null,
    stat_type: null,
    ...partial,
  };
}

/** Hand-built event with a given status and score. */
function event(
  status: PropfeinEvent["status"],
  home: number | null,
  away: number | null,
  extra: Partial<PropfeinEvent> = {},
): PropfeinEvent {
  return {
    id: "ev-test",
    sport: "nfl",
    league: "NFL",
    home_team: { id: "t-h", name: "Home", abbreviation: "HOM" },
    away_team: { id: "t-a", name: "Away", abbreviation: "AWY" },
    start_time: "2026-11-08T18:00:00Z",
    status,
    period: status === "scheduled" ? null : 4,
    clock: status === "live" ? "05:00" : status === "final" ? "00:00" : null,
    home_score: home,
    away_score: away,
    external_ids: {},
    updated_at: "2026-11-08T21:00:00Z",
    ...extra,
  };
}

const slip = (status: SlipRollup["status"], legs_remaining: number): SlipRollup => ({ status, legs_remaining });

// ---------------------------------------------------------------------------
// gradeLeg: spread
// ---------------------------------------------------------------------------

describe("gradeLeg spread", () => {
  it("home favorite covers a negative line (BUF -7.5, won 31-17)", () => {
    const r = gradeLeg(leg({ market: "spread", side: "home", line: -7.5 }), nflFinal);
    assert.equal(r.status, "won");
    assert.equal(r.current_value, 6.5);
  });

  it("home favorite fails to cover (BUF -14.5, won by 14)", () => {
    const r = gradeLeg(leg({ market: "spread", side: "home", line: -14.5 }), nflFinal);
    assert.equal(r.status, "lost");
    assert.equal(r.current_value, -0.5);
  });

  it("away underdog covers a positive line (MIA +17.5, lost by 14)", () => {
    const r = gradeLeg(leg({ market: "spread", side: "away", line: 17.5 }), nflFinal);
    assert.equal(r.status, "won");
    assert.equal(r.current_value, 3.5);
  });

  it("away underdog does not cover (MIA +10.5, lost by 14)", () => {
    const r = gradeLeg(leg({ market: "spread", side: "away", line: 10.5 }), nflFinal);
    assert.equal(r.status, "lost");
  });

  it("pushes when the margin lands exactly on a whole-number line", () => {
    const home = gradeLeg(leg({ market: "spread", side: "home", line: -14 }), nflFinal);
    assert.equal(home.status, "push");
    assert.equal(home.current_value, 0);
    const away = gradeLeg(leg({ market: "spread", side: "away", line: 14 }), nflFinal);
    assert.equal(away.status, "push");
  });

  it("away favorite with a negative line (GSW -3.5, won 118-112)", () => {
    const r = gradeLeg(leg({ market: "spread", side: "away", line: -3.5 }), nbaFinal);
    assert.equal(r.status, "won");
    assert.equal(r.current_value, 2.5);
  });

  it("home underdog with a positive line (LAL +5.5, lost by 6)", () => {
    const r = gradeLeg(leg({ market: "spread", side: "home", line: 5.5 }), nbaFinal);
    assert.equal(r.status, "lost");
    assert.equal(r.current_value, -0.5);
  });

  it("home underdog with a positive line that covers (LAL +6.5)", () => {
    const r = gradeLeg(leg({ market: "spread", side: "home", line: 6.5 }), nbaFinal);
    assert.equal(r.status, "won");
    assert.equal(r.current_value, 0.5);
  });

  it("half-point line can never push", () => {
    for (const line of [-0.5, 0.5, -3.5, 7.5]) {
      const r = gradeLeg(leg({ market: "spread", side: "home", line }), event("final", 20, 20));
      assert.notEqual(r.status, "push", `line ${line}`);
    }
  });

  it("pick-em (line 0) with a tie pushes", () => {
    const r = gradeLeg(leg({ market: "spread", side: "home", line: 0 }), event("final", 20, 20));
    assert.equal(r.status, "push");
  });

  it("live spread reports the current margin including the line", () => {
    // PHI 24 - DAL 20, PHI -6.5 -> -2.5
    const r = gradeLeg(leg({ market: "spread", side: "home", line: -6.5 }), nflLive);
    assert.equal(r.status, "live");
    assert.equal(r.current_value, -2.5);
    // DAL +6.5 -> 2.5
    const away = gradeLeg(leg({ market: "spread", side: "away", line: 6.5 }), nflLive);
    assert.equal(away.status, "live");
    assert.equal(away.current_value, 2.5);
  });

  it("needs a line", () => {
    const r = gradeLeg(leg({ market: "spread", side: "home", line: null }), nflFinal);
    assert.equal(r.status, "needs_review");
  });

  it("rejects an over/under side", () => {
    const r = gradeLeg(leg({ market: "spread", side: "over", line: -3 }), nflFinal);
    assert.equal(r.status, "needs_review");
  });

  it("final event without scores is needs_review", () => {
    const r = gradeLeg(leg({ market: "spread", side: "home", line: -3 }), event("final", null, null));
    assert.equal(r.status, "needs_review");
  });
});

// ---------------------------------------------------------------------------
// gradeLeg: total
// ---------------------------------------------------------------------------

describe("gradeLeg total", () => {
  it("over hits (48 vs 44.5)", () => {
    const r = gradeLeg(leg({ market: "total", side: "over", line: 44.5 }), nflFinal);
    assert.equal(r.status, "won");
    assert.equal(r.current_value, 48);
  });

  it("over misses (48 vs 51.5)", () => {
    const r = gradeLeg(leg({ market: "total", side: "over", line: 51.5 }), nflFinal);
    assert.equal(r.status, "lost");
  });

  it("under hits (48 vs 51.5)", () => {
    const r = gradeLeg(leg({ market: "total", side: "under", line: 51.5 }), nflFinal);
    assert.equal(r.status, "won");
  });

  it("under misses (48 vs 44.5)", () => {
    const r = gradeLeg(leg({ market: "total", side: "under", line: 44.5 }), nflFinal);
    assert.equal(r.status, "lost");
  });

  it("pushes on the exact number for both sides", () => {
    assert.equal(gradeLeg(leg({ market: "total", side: "over", line: 48 }), nflFinal).status, "push");
    assert.equal(gradeLeg(leg({ market: "total", side: "under", line: 48 }), nflFinal).status, "push");
  });

  it("NBA total with a half point (230 vs 229.5 over)", () => {
    const r = gradeLeg(leg({ market: "total", side: "over", line: 229.5 }), nbaFinal);
    assert.equal(r.status, "won");
    assert.equal(r.current_value, 230);
  });

  it("live total reports the combined score", () => {
    const r = gradeLeg(leg({ market: "total", side: "under", line: 51.5 }), nflLive);
    assert.equal(r.status, "live");
    assert.equal(r.current_value, 44);
  });

  it("rejects a home/away side", () => {
    assert.equal(gradeLeg(leg({ market: "total", side: "home", line: 44.5 }), nflFinal).status, "needs_review");
  });

  it("needs a line", () => {
    assert.equal(gradeLeg(leg({ market: "total", side: "over", line: null }), nflFinal).status, "needs_review");
  });
});

// ---------------------------------------------------------------------------
// gradeLeg: moneyline
// ---------------------------------------------------------------------------

describe("gradeLeg moneyline", () => {
  it("home winner", () => {
    const r = gradeLeg(leg({ market: "moneyline", side: "home" }), nflFinal);
    assert.equal(r.status, "won");
    assert.equal(r.current_value, 14);
  });

  it("home loser", () => {
    const r = gradeLeg(leg({ market: "moneyline", side: "home" }), nbaFinal);
    assert.equal(r.status, "lost");
    assert.equal(r.current_value, -6);
  });

  it("away winner", () => {
    const r = gradeLeg(leg({ market: "moneyline", side: "away" }), nbaFinal);
    assert.equal(r.status, "won");
    assert.equal(r.current_value, 6);
  });

  it("away loser", () => {
    assert.equal(gradeLeg(leg({ market: "moneyline", side: "away" }), nflFinal).status, "lost");
  });

  it("tie pushes", () => {
    const r = gradeLeg(leg({ market: "moneyline", side: "home" }), event("final", 17, 17));
    assert.equal(r.status, "push");
    assert.equal(r.current_value, 0);
  });

  it("does not need a line", () => {
    assert.equal(gradeLeg(leg({ market: "moneyline", side: "away", line: null }), nbaFinal).status, "won");
  });

  it("live moneyline reports the current margin", () => {
    // NYK 78 - BOS 81
    const r = gradeLeg(leg({ market: "moneyline", side: "home" }), nbaLive);
    assert.equal(r.status, "live");
    assert.equal(r.current_value, -3);
  });
});

// ---------------------------------------------------------------------------
// gradeLeg: player props
// ---------------------------------------------------------------------------

describe("gradeLeg player_prop", () => {
  const allenYards = (side: "over" | "under", line: number) =>
    leg({ market: "player_prop", side, line, propfein_player_id: "p-allen", stat_type: "passing_yards" });

  it("over hits (Allen 298 vs 275.5)", () => {
    const r = gradeLeg(allenYards("over", 275.5), nflFinal);
    assert.equal(r.status, "won");
    assert.equal(r.current_value, 298);
  });

  it("over misses (298 vs 300.5)", () => {
    assert.equal(gradeLeg(allenYards("over", 300.5), nflFinal).status, "lost");
  });

  it("under hits (298 vs 300.5)", () => {
    assert.equal(gradeLeg(allenYards("under", 300.5), nflFinal).status, "won");
  });

  it("under misses (298 vs 275.5)", () => {
    assert.equal(gradeLeg(allenYards("under", 275.5), nflFinal).status, "lost");
  });

  it("pushes on the exact number", () => {
    assert.equal(gradeLeg(allenYards("over", 298), nflFinal).status, "push");
    assert.equal(gradeLeg(allenYards("under", 298), nflFinal).status, "push");
  });

  it("whole-number count stats (Curry 7 threes over 6.5)", () => {
    const r = gradeLeg(
      leg({ market: "player_prop", side: "over", line: 6.5, propfein_player_id: "p-curry", stat_type: "threes" }),
      nbaFinal,
    );
    assert.equal(r.status, "won");
    assert.equal(r.current_value, 7);
  });

  it("missing stat on a final event is needs_review", () => {
    const r = gradeLeg(
      leg({ market: "player_prop", side: "over", line: 5.5, propfein_player_id: "p-allen", stat_type: "rushing_yards" }),
      nflFinal,
    );
    assert.equal(r.status, "needs_review");
    assert.equal(r.current_value, null);
  });

  it("unknown player on a final event is needs_review", () => {
    const r = gradeLeg(
      leg({ market: "player_prop", side: "over", line: 5.5, propfein_player_id: "p-nobody", stat_type: "passing_yards" }),
      nflFinal,
    );
    assert.equal(r.status, "needs_review");
  });

  it("missing player id or stat type is needs_review", () => {
    assert.equal(gradeLeg(leg({ market: "player_prop", side: "over", line: 1.5, stat_type: "points" }), nbaFinal).status, "needs_review");
    assert.equal(
      gradeLeg(leg({ market: "player_prop", side: "over", line: 1.5, propfein_player_id: "p-curry" }), nbaFinal).status,
      "needs_review",
    );
  });

  it("live prop reports the current stat value", () => {
    const r = gradeLeg(
      leg({ market: "player_prop", side: "over", line: 249.5, propfein_player_id: "p-hurts", stat_type: "passing_yards" }),
      nflLive,
    );
    assert.equal(r.status, "live");
    assert.equal(r.current_value, 231);
  });

  it("live prop with no stat yet stays live with null value", () => {
    const r = gradeLeg(
      leg({ market: "player_prop", side: "over", line: 0.5, propfein_player_id: "p-lamb", stat_type: "anytime_td" }),
      nflLive,
    );
    assert.equal(r.status, "live");
    assert.equal(r.current_value, null);
  });

  it("rejects a home/away side", () => {
    assert.equal(
      gradeLeg(leg({ market: "player_prop", side: "home", line: 1.5, propfein_player_id: "p-curry", stat_type: "points" }), nbaFinal).status,
      "needs_review",
    );
  });
});

// ---------------------------------------------------------------------------
// gradeLeg: event status handling
// ---------------------------------------------------------------------------

describe("gradeLeg event status", () => {
  it("scheduled -> pending for every market", () => {
    for (const l of [
      leg({ market: "spread", side: "home", line: -3 }),
      leg({ market: "total", side: "over", line: 44.5 }),
      leg({ market: "moneyline", side: "away" }),
      leg({ market: "player_prop", side: "over", line: 1.5, propfein_player_id: "p-x", stat_type: "points" }),
      leg({ market: "team_prop", side: "home", line: 1.5 }),
      leg({ market: "other" }),
    ]) {
      const r = gradeLeg(l, nflScheduled);
      assert.equal(r.status, "pending", l.market);
      assert.equal(r.current_value, null);
    }
  });

  it("postponed -> needs_review with a reason", () => {
    const r = gradeLeg(leg({ market: "spread", side: "home", line: -3 }), event("postponed", null, null));
    assert.equal(r.status, "needs_review");
    assert.match(r.reason, /postponed/);
  });

  it("canceled -> needs_review", () => {
    const r = gradeLeg(leg({ market: "moneyline", side: "home" }), event("canceled", null, null));
    assert.equal(r.status, "needs_review");
    assert.match(r.reason, /canceled/);
  });

  it("null side -> needs_review even before kickoff", () => {
    assert.equal(gradeLeg(leg({ market: "spread", side: null, line: -3 }), nflScheduled).status, "needs_review");
    assert.equal(gradeLeg(leg({ market: "moneyline", side: null }), nflFinal).status, "needs_review");
  });

  it("team_prop and other: live while live, needs_review at final", () => {
    assert.equal(gradeLeg(leg({ market: "team_prop", side: "home", line: 1.5 }), nflLive).status, "live");
    assert.equal(gradeLeg(leg({ market: "team_prop", side: "home", line: 1.5 }), nflFinal).status, "needs_review");
    assert.equal(gradeLeg(leg({ market: "other" }), nflLive).status, "live");
    assert.equal(gradeLeg(leg({ market: "other" }), nflFinal).status, "needs_review");
  });

  it("never returns void", () => {
    const legs: GradableLeg[] = [
      leg({ market: "spread", side: "home", line: -3 }),
      leg({ market: "other" }),
      leg({ market: "player_prop", side: "under", line: 1, propfein_player_id: "p-x", stat_type: "y" }),
    ];
    for (const ev of [nflScheduled, nflLive, nflFinal, event("postponed", null, null), event("canceled", null, null)]) {
      for (const l of legs) {
        assert.notEqual(gradeLeg(l, ev).status as string, "void");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// rollupSlip
// ---------------------------------------------------------------------------

describe("rollupSlip", () => {
  it("any lost -> lost, even with open legs", () => {
    assert.deepEqual(rollupSlip(["won", "lost", "live"]), { status: "lost", legs_remaining: 1 });
    assert.deepEqual(rollupSlip(["lost"]), { status: "lost", legs_remaining: 0 });
    assert.deepEqual(rollupSlip(["pending", "lost", "needs_review"]), { status: "lost", legs_remaining: 2 });
  });

  it("open legs with at least one live -> live", () => {
    assert.deepEqual(rollupSlip(["won", "live", "pending"]), { status: "live", legs_remaining: 2 });
    assert.deepEqual(rollupSlip(["live"]), { status: "live", legs_remaining: 1 });
    assert.deepEqual(rollupSlip(["needs_review", "live"]), { status: "live", legs_remaining: 2 });
  });

  it("open legs with none live -> pending", () => {
    assert.deepEqual(rollupSlip(["pending", "pending"]), { status: "pending", legs_remaining: 2 });
    assert.deepEqual(rollupSlip(["won", "pending"]), { status: "pending", legs_remaining: 1 });
    assert.deepEqual(rollupSlip(["won", "needs_review"]), { status: "pending", legs_remaining: 1 });
    assert.deepEqual(rollupSlip(["push", "needs_review"]), { status: "pending", legs_remaining: 1 });
  });

  it("all won -> won", () => {
    assert.deepEqual(rollupSlip(["won", "won", "won"]), { status: "won", legs_remaining: 0 });
    assert.deepEqual(rollupSlip(["won"]), { status: "won", legs_remaining: 0 });
  });

  it("won plus void/push mix -> won", () => {
    assert.deepEqual(rollupSlip(["won", "push"]), { status: "won", legs_remaining: 0 });
    assert.deepEqual(rollupSlip(["void", "won", "push"]), { status: "won", legs_remaining: 0 });
  });

  it("all void/push -> void", () => {
    assert.deepEqual(rollupSlip(["void"]), { status: "void", legs_remaining: 0 });
    assert.deepEqual(rollupSlip(["push", "push"]), { status: "void", legs_remaining: 0 });
    assert.deepEqual(rollupSlip(["void", "push"]), { status: "void", legs_remaining: 0 });
  });

  it("no legs -> pending (matches the SQL else branch)", () => {
    assert.deepEqual(rollupSlip([]), { status: "pending", legs_remaining: 0 });
  });
});

// ---------------------------------------------------------------------------
// detectTransitions
// ---------------------------------------------------------------------------

describe("detectTransitions", () => {
  it("leg -> won emits leg_hit", () => {
    assert.deepEqual(detectTransitions("live", "won", slip("live", 2), slip("live", 2)), ["leg_hit"]);
  });

  it("leg -> lost emits leg_lost", () => {
    assert.deepEqual(detectTransitions("live", "lost", slip("live", 2), slip("live", 2)), ["leg_lost"]);
  });

  it("leg -> push or needs_review emits nothing", () => {
    assert.deepEqual(detectTransitions("live", "push", slip("live", 2), slip("live", 2)), []);
    assert.deepEqual(detectTransitions("pending", "needs_review", slip("pending", 2), slip("pending", 2)), []);
  });

  it("leg pending -> live emits nothing", () => {
    assert.deepEqual(detectTransitions("pending", "live", slip("pending", 3), slip("live", 3)), []);
  });

  it("unchanged won leg does not re-emit leg_hit", () => {
    assert.deepEqual(detectTransitions("won", "won", slip("live", 1), slip("live", 1)), []);
  });

  it("slip -> lost emits slip_dead", () => {
    assert.deepEqual(detectTransitions(null, null, slip("live", 2), slip("lost", 1)), ["slip_dead"]);
  });

  it("slip -> won emits cashed", () => {
    assert.deepEqual(detectTransitions(null, null, slip("live", 1), slip("won", 0)), ["cashed"]);
  });

  it("legs_remaining >1 -> 1 while live emits one_away", () => {
    assert.deepEqual(detectTransitions(null, null, slip("live", 2), slip("live", 1)), ["one_away"]);
    assert.deepEqual(detectTransitions(null, null, slip("live", 3), slip("live", 1)), ["one_away"]);
    assert.deepEqual(detectTransitions(null, null, slip("pending", 3), slip("live", 1)), ["one_away"]);
  });

  it("one_away does not fire for a single-leg slip going live", () => {
    assert.deepEqual(detectTransitions(null, null, slip("pending", 1), slip("live", 1)), []);
  });

  it("one_away does not fire when still at 1 on a later tick", () => {
    assert.deepEqual(detectTransitions(null, null, slip("live", 1), slip("live", 1)), []);
  });

  it("one_away does not fire when the slip dies at the same time", () => {
    assert.deepEqual(detectTransitions(null, null, slip("live", 2), slip("lost", 1)), ["slip_dead"]);
  });

  it("one_away does not fire when the slip is pending (no leg live)", () => {
    assert.deepEqual(detectTransitions(null, null, slip("pending", 2), slip("pending", 1)), []);
  });

  it("combined leg + slip changes emit both, leg event first", () => {
    assert.deepEqual(detectTransitions("live", "won", slip("live", 1), slip("won", 0)), ["leg_hit", "cashed"]);
    assert.deepEqual(detectTransitions("live", "lost", slip("live", 3), slip("lost", 2)), ["leg_lost", "slip_dead"]);
    assert.deepEqual(detectTransitions("live", "won", slip("live", 2), slip("live", 1)), ["leg_hit", "one_away"]);
  });

  it("unchanged everything emits nothing", () => {
    assert.deepEqual(detectTransitions("live", "live", slip("live", 2), slip("live", 2)), []);
    assert.deepEqual(detectTransitions(null, null, slip("won", 0), slip("won", 0)), []);
  });
});
