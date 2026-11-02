import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeRecord, formatRecord, inPeriod, periodStart, slipProfit, type StatSlip } from "./stats.ts";

const slip = (over: Partial<StatSlip>): StatSlip => ({
  status: "won",
  stake: 10,
  potential_payout: 25,
  settled_at: "2026-11-01T20:00:00Z",
  created_at: "2026-11-01T18:00:00Z",
  ...over,
});

describe("slipProfit", () => {
  it("win is payout minus stake", () => assert.equal(slipProfit(slip({})), 15));
  it("loss is minus stake", () => assert.equal(slipProfit(slip({ status: "lost" })), -10));
  it("push and void are zero", () => {
    assert.equal(slipProfit(slip({ status: "push" })), 0);
    assert.equal(slipProfit(slip({ status: "void" })), 0);
  });
  it("unknown stake is null, never invented", () => assert.equal(slipProfit(slip({ stake: 0 })), null));
  it("unsettled is null", () => assert.equal(slipProfit(slip({ status: "live" })), null));
});

describe("computeRecord", () => {
  it("counts record, profit, staked and ROI", () => {
    const r = computeRecord([
      slip({}), // +15 on 10
      slip({ status: "lost", stake: 20, potential_payout: 50 }), // -20 on 20
      slip({ status: "push", stake: 5 }), // 0, not staked
      slip({ status: "live" }), // ignored
    ]);
    assert.equal(r.won, 1);
    assert.equal(r.lost, 1);
    assert.equal(r.pushed, 1);
    assert.equal(r.settled, 3);
    assert.equal(r.priced, 3);
    assert.equal(r.profit, -5);
    assert.equal(r.staked, 30);
    assert.equal(r.roi, -16.7);
  });
  it("unknown stake counts for record only", () => {
    const r = computeRecord([slip({ stake: 0, potential_payout: 0 }), slip({ status: "lost" })]);
    assert.equal(r.won, 1);
    assert.equal(r.lost, 1);
    assert.equal(r.settled, 2);
    assert.equal(r.priced, 1);
    assert.equal(r.profit, -10);
    assert.equal(r.staked, 10);
  });
  it("ROI is null with nothing staked", () => {
    assert.equal(computeRecord([slip({ status: "push" })]).roi, null);
    assert.equal(computeRecord([]).roi, null);
  });
});

describe("periodStart", () => {
  // Wed 2026-11-04 15:30 ET = 20:30 UTC (EST, UTC-5)
  const now = new Date("2026-11-04T20:30:00Z");
  it("week starts Monday midnight ET", () => {
    assert.equal(periodStart("week", now)?.toISOString(), "2026-11-02T05:00:00.000Z");
  });
  it("month starts on the 1st midnight ET", () => {
    assert.equal(periodStart("month", now)?.toISOString(), "2026-11-01T05:00:00.000Z");
  });
  it("all is unbounded", () => assert.equal(periodStart("all", now), null));
  it("sunday night still belongs to the week that started the previous monday", () => {
    const sun = new Date("2026-11-09T03:30:00Z"); // Sun 2026-11-08 22:30 ET
    assert.equal(periodStart("week", sun)?.toISOString(), "2026-11-02T05:00:00.000Z");
  });
});

describe("inPeriod", () => {
  const now = new Date("2026-11-04T20:30:00Z");
  it("filters by settled_at, falling back to created_at", () => {
    const list = [
      slip({ settled_at: "2026-11-03T01:00:00Z" }),
      slip({ settled_at: "2026-10-30T01:00:00Z" }),
      slip({ settled_at: null, created_at: "2026-11-02T06:00:00Z" }),
    ];
    assert.equal(inPeriod(list, "week", now).length, 2);
    assert.equal(inPeriod(list, "month", now).length, 2);
    assert.equal(inPeriod(list, "all", now).length, 3);
  });
});

describe("formatRecord", () => {
  it("hides pushes when zero", () => {
    assert.equal(formatRecord({ won: 3, lost: 1, pushed: 0 }), "3-1");
    assert.equal(formatRecord({ won: 3, lost: 1, pushed: 2 }), "3-1-2");
  });
});
