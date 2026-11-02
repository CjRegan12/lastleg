/**
 * Record, profit and ROI from settled slips. Pure functions, tested in stats.test.ts.
 *
 * Rules (DECISIONS.md "Record and profit"):
 *   win  -> profit = payout - stake
 *   loss -> profit = -stake
 *   push / void -> 0, excluded from the staked total
 *   pending / live -> excluded from everything
 * A stake of 0 means the parser could not read it. Those slips count for the
 * record but not for profit or ROI, and the UI says "based on N of M slips".
 */

export type SettleStatus = "pending" | "live" | "won" | "lost" | "void" | "push";

export interface StatSlip {
  status: SettleStatus;
  stake: number;
  potential_payout: number;
  settled_at: string | null;
  created_at: string;
}

export interface SlipRecord {
  won: number;
  lost: number;
  pushed: number;
  /** Settled slips with a known stake (used for profit and ROI). */
  priced: number;
  /** Settled slips total (won + lost + pushed). */
  settled: number;
  profit: number;
  staked: number;
  /** Percent, one decimal. null when nothing was staked. */
  roi: number | null;
}

export type Period = "week" | "month" | "all";

export function emptyRecord(): SlipRecord {
  return { won: 0, lost: 0, pushed: 0, priced: 0, settled: 0, profit: 0, staked: 0, roi: null };
}

export function isSettled(status: SettleStatus): boolean {
  return status === "won" || status === "lost" || status === "void" || status === "push";
}

/** Profit of one settled slip, or null when the stake is unknown. */
export function slipProfit(slip: Pick<StatSlip, "status" | "stake" | "potential_payout">): number | null {
  if (!(slip.stake > 0)) return null;
  switch (slip.status) {
    case "won":
      return round2(slip.potential_payout - slip.stake);
    case "lost":
      return -slip.stake;
    case "void":
    case "push":
      return 0;
    default:
      return null;
  }
}

export function computeRecord(slips: readonly StatSlip[]): SlipRecord {
  const r = emptyRecord();
  for (const s of slips) {
    if (!isSettled(s.status)) continue;
    r.settled += 1;
    if (s.status === "won") r.won += 1;
    else if (s.status === "lost") r.lost += 1;
    else r.pushed += 1;
    const p = slipProfit(s);
    if (p === null) continue;
    r.priced += 1;
    r.profit = round2(r.profit + p);
    if (s.status === "won" || s.status === "lost") r.staked = round2(r.staked + s.stake);
  }
  r.roi = r.staked > 0 ? Math.round((r.profit / r.staked) * 1000) / 10 : null;
  return r;
}

/**
 * Start of the period in America/New_York. "week" starts Monday 00:00 (sports
 * weeks end Sunday night); "month" starts on the 1st. DST-safe: the calendar
 * date is computed first, then that date's NY midnight is resolved on its own.
 */
export function periodStart(period: Period, now: Date = new Date()): Date | null {
  if (period === "all") return null;
  const t = nyParts(now);
  if (period === "month") return nyMidnight(t.y, t.m, 1);
  const sinceMonday = (t.dow + 6) % 7;
  const target = new Date(Date.UTC(t.y, t.m - 1, t.d - sinceMonday));
  return nyMidnight(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate());
}

interface NYParts {
  y: number;
  m: number;
  d: number;
  h: number;
  dow: number;
}

const NY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  weekday: "short",
  hour12: false,
});

function nyParts(at: Date): NYParts {
  const parts = NY.formatToParts(at);
  const get = (k: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === k)?.value ?? "";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")) % 24,
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

/** The instant of 00:00 America/New_York on a calendar date. */
function nyMidnight(y: number, m: number, d: number): Date {
  // Guess EST (UTC-5); NY wall-clock hour of the guess is 0 (EST) or 1 (EDT).
  const guess = Date.UTC(y, m - 1, d, 5);
  const h = nyParts(new Date(guess)).h;
  const delta = h < 12 ? h : h - 24;
  return new Date(guess - delta * 3_600_000);
}

/** Slips settled on or after the period start (by settled_at, falling back to created_at). */
export function inPeriod<T extends Pick<StatSlip, "settled_at" | "created_at">>(
  slips: readonly T[],
  period: Period,
  now: Date = new Date(),
): T[] {
  const start = periodStart(period, now);
  if (!start) return [...slips];
  const t0 = start.getTime();
  return slips.filter((s) => new Date(s.settled_at ?? s.created_at).getTime() >= t0);
}

export function formatRecord(r: Pick<SlipRecord, "won" | "lost" | "pushed">): string {
  return r.pushed > 0 ? `${r.won}-${r.lost}-${r.pushed}` : `${r.won}-${r.lost}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
