/**
 * grade-legs: the Group Sweat grader.
 *
 * Called by pg_cron every 30 seconds (scripts/schedule-grader.sql). Each run:
 *   1. loads every open leg (status pending/live, propfein_event_id set) with its
 *      slip and slate, in pages of 1000, regardless of slate age
 *   2. pulls Propfein events for the distinct slate dates of those legs
 *      (yesterday through today + 10 days), plus player_stats via GET /v1/events/{id}
 *      for events that carry open player props (listEvents has no stats)
 *   3. re-grades every open leg whose event came back (pure logic in _shared/grade.ts)
 *   4. rolls up every touched slip through the SQL rollup_slip() RPC
 *   5. writes room_events for the feed and notifications for send-push
 *   6. moves slates open -> live -> final and sends the recap; slates older than
 *      7 days are force-finalized (open legs -> needs_review) so nothing hangs
 *
 * Concurrency / idempotency, honestly:
 *   - Leg writes are compare-and-set: `update ... where id = ? and status = <status we read>`.
 *     If another run (or a human override) got there first the update matches zero
 *     rows and this run drops the leg; it never emits events for a change it did not make.
 *   - Slip transitions come from rollup_slip(), which locks the slip row and returns
 *     old/new status + legs_remaining. Only the run whose rollup actually moved the
 *     slip sees a change, so slip_dead / cashed / one_away fire once.
 *   - Notifications are deduped by the unique index on (user_id, slate_id, type, slip_id);
 *     a unique violation is treated as "already sent", not an error.
 *   - Slate finalization is `update ... where status in (open, live) returning id`;
 *     only the run that flips it sends the recap.
 *   - Leg-level feed events (leg_hit / leg_lost) can still double up if two runs
 *     grade the same leg between the read and the CAS; the CAS makes this rare and
 *     the UI tolerates it.
 *
 * Fails closed: without PROPFEIN_API_URL (or with "mock" and no ALLOW_MOCK_PROPFEIN=true)
 * the run returns 500 propfein_not_configured and touches nothing.
 *
 * Secrets: GRADER_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *          PROPFEIN_API_URL (or "mock" + ALLOW_MOCK_PROPFEIN=true), PROPFEIN_API_KEY.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { propfeinFromEnv } from "../_shared/propfein.ts";
import type { PropfeinClient } from "../_shared/propfein.ts";
import type { PropfeinEvent, Sport } from "../_shared/propfein.types.ts";
import { detectTransitions, gradeLeg, SETTLED_LEG_STATUSES } from "../_shared/grade.ts";
import type { GradableLeg, GradeRoomEventType, SlipRollup } from "../_shared/grade.ts";

// ---------------------------------------------------------------------------
// Row types (hand-written: no generated types in this repo yet)
// ---------------------------------------------------------------------------

type SlipStatus = "pending" | "live" | "won" | "lost" | "void" | "push";
type NotificationType = "one_away" | "cashed" | "slip_died" | "recap";

interface SlateRow {
  id: string;
  room_id: string;
  slate_date: string; // YYYY-MM-DD
  status: "open" | "live" | "final";
}

interface SlateLite {
  id: string;
  slate_date: string;
}

interface SlipJoin {
  id: string;
  status: SlipStatus;
  legs_remaining: number;
  legs_total: number;
  room_id: string;
  slate_id: string;
  user_id: string;
  potential_payout: number | string; // numeric comes back as string from PostgREST
  stake: number | string;
  slates: SlateLite;
}

interface LegRow {
  id: string;
  slip_id: string;
  room_id: string;
  market: GradableLeg["market"];
  side: GradableLeg["side"];
  line: number | string | null;
  selection: string;
  stat_type: string | null;
  status: string;
  current_value: number | string | null;
  propfein_event_id: string | null;
  propfein_player_id: string | null;
  slips: SlipJoin;
}

/** What rollup_slip() returns (one row). */
interface RollupResult {
  id: string;
  room_id: string;
  slate_id: string;
  user_id: string;
  old_status: SlipStatus;
  new_status: SlipStatus;
  old_legs_remaining: number;
  new_legs_remaining: number;
  legs_total: number;
  potential_payout: number | string;
  stake: number | string;
}

interface RoomSettings {
  cash_threshold: number;
  muted_triggers: string[];
  max_pushes_per_slate: number;
}

interface ProfileLite {
  id: string;
  handle: string;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
}

interface RoomEventInsert {
  room_id: string;
  slate_id: string | null;
  slip_id: string | null;
  type: GradeRoomEventType | "slate_final";
  payload: Record<string, unknown>;
}

interface NotificationInsert {
  user_id: string;
  room_id: string;
  slate_id: string;
  slip_id: string | null;
  type: NotificationType;
  title: string;
  body: string;
  url: string;
}

/** A per-slip change bundle collected while grading legs. */
interface SlipTouch {
  slip: SlipJoin;
  legChanges: { leg: LegRow; prevStatus: string; nextStatus: string }[];
}

interface RunSummary {
  ok: boolean;
  skipped?: string;
  legs_checked: number;
  legs_updated: number;
  legs_raced: number;
  slips_rolled: number;
  events: number;
  events_fetched_by_id: number;
  one_away_deduped: number;
  notifications: number;
  notifications_deduped: number;
  slates_finalized: number;
  slates_forced: number;
  errors: string[];
}

// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const PAGE = 1000;
const LOOKAHEAD_DAYS = 10;
const FORCE_FINAL_AFTER_DAYS = 7;
const EVENT_FETCH_CONCURRENCY = 5;
const PG_UNIQUE_VIOLATION = "23505";

// ---------------------------------------------------------------------------
// Time helpers (everything user-facing is America/New_York)
// ---------------------------------------------------------------------------

const NY = "America/New_York";

/** YYYY-MM-DD for a Date in New York. en-CA gives ISO ordering. */
function nyDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function nyHour(d: Date): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: NY, hour: "numeric", hour12: false }).format(d);
  return Number(h) % 24; // some ICU builds print "24" for midnight
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 86_400_000);
}

/** True when `hour` falls inside [start, end), handling wrap past midnight. */
export function inQuietHours(hour: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v: number | string): string {
  const n = num(v) ?? 0;
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // ---- auth: shared secret from pg_cron, nothing else gets in --------------
  const secret = Deno.env.get("GRADER_SECRET");
  if (!secret || req.headers.get("x-grader-secret") !== secret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // ---- fail closed: never grade real slips against fixtures by accident ----
  const env = Deno.env.toObject();
  const propfeinUrl = env.PROPFEIN_API_URL;
  if ((!propfeinUrl || propfeinUrl === "mock") && env.ALLOW_MOCK_PROPFEIN !== "true") {
    console.error("grade-legs: PROPFEIN_API_URL unset or mock without ALLOW_MOCK_PROPFEIN=true");
    return json({ ok: false, error: "propfein_not_configured" }, 500);
  }
  let propfein: PropfeinClient;
  try {
    propfein = propfeinFromEnv(env);
  } catch (err) {
    console.error("grade-legs: propfein client", err);
    return json({ ok: false, error: "propfein_not_configured" }, 500);
  }

  const db: Db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const summary: RunSummary = {
    ok: true,
    legs_checked: 0,
    legs_updated: 0,
    legs_raced: 0,
    slips_rolled: 0,
    events: 0,
    events_fetched_by_id: 0,
    one_away_deduped: 0,
    notifications: 0,
    notifications_deduped: 0,
    slates_finalized: 0,
    slates_forced: 0,
    errors: [],
  };

  try {
    await run(db, propfein, summary);
  } catch (err) {
    summary.ok = false;
    summary.errors.push(err instanceof Error ? err.message : String(err));
    console.error("grade-legs failed", err);
    return json(summary, 500);
  }
  return json(summary, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Main pass
// ---------------------------------------------------------------------------

async function run(db: Db, propfein: PropfeinClient, summary: RunSummary): Promise<void> {
  const now = new Date();
  const today = nyDate(now);
  const yesterday = nyDate(daysFromNow(-1));
  const horizon = nyDate(daysFromNow(LOOKAHEAD_DAYS));

  // ---- 1. open legs, any slate age, paged ----------------------------------
  const legs = await loadOpenLegs(db);

  // ---- open/live slates (for the lifecycle step and the early skip) ---------
  const { data: slates, error: slatesErr } = await db
    .from("slates")
    .select("id, room_id, slate_date, status")
    .in("status", ["open", "live"]);
  if (slatesErr) throw slatesErr;
  const activeSlates = (slates ?? []) as SlateRow[];

  if (legs.length === 0 && activeSlates.length === 0) {
    summary.skipped = "no_open_legs_or_slates";
    return;
  }

  // ---- 2. events from Propfein for the dates those legs live on -----------
  // Distinct slate dates, clamped to [yesterday, today + 10]. A leg on a slate
  // further out just waits; a leg on a slate older than yesterday is handled by
  // force-finalization below rather than by re-fetching ancient games.
  const dates = unique(legs.map((l) => l.slips.slates.slate_date))
    .filter((d) => d >= yesterday && d <= horizon)
    .sort();
  const events = dates.length > 0 ? await fetchEvents(propfein, dates, summary) : new Map<string, PropfeinEvent>();

  // Legs whose event is not on their slate's date (a Tuesday slip with a Thursday
  // game, a slate date the parser got wrong) miss the list fetch. Fetch those
  // events individually so they still grade. The date-window list stays the fast path.
  const missingEventIds = unique(
    legs
      .filter((l) => l.propfein_event_id && !events.has(l.propfein_event_id))
      .map((l) => l.propfein_event_id as string),
  );
  await fetchMissingEvents(propfein, events, missingEventIds, summary);

  // player props need player_stats, which only GET /v1/events/{id} carries
  const propEventIds = unique(
    legs
      .filter((l) => l.market === "player_prop" && l.propfein_event_id && events.has(l.propfein_event_id))
      .map((l) => l.propfein_event_id as string),
  );
  await hydratePlayerStats(propfein, events, propEventIds, summary);

  // ---- 3. grade --------------------------------------------------------------
  const touched = new Map<string, SlipTouch>();

  for (const leg of legs) {
    const event = events.get(leg.propfein_event_id!);
    if (!event) continue; // not in the fetched window, leave it alone
    summary.legs_checked++;

    const graded = gradeLeg(
      {
        market: leg.market,
        side: leg.side,
        line: num(leg.line),
        propfein_player_id: leg.propfein_player_id,
        stat_type: leg.stat_type,
      },
      event,
    );

    const prevValue = num(leg.current_value);
    if (graded.status === leg.status && graded.current_value === prevValue) continue;

    const settled = SETTLED_LEG_STATUSES.has(graded.status);
    // Compare-and-set on the status we read. Zero rows back means another run or a
    // human override moved this leg first: skip it entirely, no events, no rollup.
    const { data: updRows, error: updErr } = await db
      .from("legs")
      .update({
        status: graded.status,
        current_value: graded.current_value,
        graded_by: "auto",
        graded_at: settled ? now.toISOString() : null,
      })
      .eq("id", leg.id)
      .eq("status", leg.status)
      .select("id");
    if (updErr) {
      summary.errors.push(`leg ${leg.id}: ${updErr.message}`);
      continue;
    }
    if (!updRows || updRows.length === 0) {
      summary.legs_raced++;
      continue;
    }
    summary.legs_updated++;

    let touch = touched.get(leg.slip_id);
    if (!touch) {
      touch = { slip: leg.slips, legChanges: [] };
      touched.set(leg.slip_id, touch);
    }
    touch.legChanges.push({ leg, prevStatus: leg.status, nextStatus: graded.status });
  }

  // ---- 4 + 5. roll up slips, emit events and notifications -----------------
  if (touched.size > 0) {
    await rollupAndNotify(db, touched, now, summary);
  }

  // ---- 6. slate lifecycle --------------------------------------------------
  await advanceSlates(db, activeSlates, today, now, summary);
}

/** True when a feed event of this type already exists for the slip. */
async function hasRoomEvent(db: Db, slipId: string, type: GradeRoomEventType): Promise<boolean> {
  const { data, error } = await db.from("room_events").select("id").eq("slip_id", slipId).eq("type", type).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** slips.status 'push' is in the enum but rollup never emits it; map it to void for comparisons. */
function slipRollupStatus(s: SlipStatus): SlipRollup["status"] {
  return s === "push" ? "void" : s;
}

/** Every pending/live leg with a Propfein id, with its slip and slate, 1000 at a time. */
async function loadOpenLegs(db: Db): Promise<LegRow[]> {
  const out: LegRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("legs")
      .select(
        "id, slip_id, room_id, market, side, line, selection, stat_type, status, current_value, propfein_event_id, propfein_player_id, " +
          "slips!inner(id, status, legs_remaining, legs_total, room_id, slate_id, user_id, potential_payout, stake, slates!inner(id, slate_date))",
      )
      .in("status", ["pending", "live"])
      .not("propfein_event_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as LegRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Propfein
// ---------------------------------------------------------------------------

async function fetchEvents(client: PropfeinClient, dates: string[], summary: RunSummary): Promise<Map<string, PropfeinEvent>> {
  const sports: Sport[] = ["nfl", "nba"];
  const jobs: { sport: Sport; date: string }[] = [];
  for (const sport of sports) for (const date of dates) jobs.push({ sport, date });

  const map = new Map<string, PropfeinEvent>();
  await pool(jobs, EVENT_FETCH_CONCURRENCY, async ({ sport, date }) => {
    try {
      for (const e of await client.listEvents(sport, date)) map.set(e.id, e);
    } catch (err) {
      summary.errors.push(`propfein ${sport} ${date}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return map;
}

/** GET /v1/events/{id} for events the date-window list did not return. A miss is logged, not fatal. */
async function fetchMissingEvents(
  client: PropfeinClient,
  events: Map<string, PropfeinEvent>,
  eventIds: string[],
  summary: RunSummary,
): Promise<void> {
  if (eventIds.length === 0) return;
  await pool(eventIds, EVENT_FETCH_CONCURRENCY, async (id) => {
    if (events.has(id)) return;
    try {
      const full = await client.getEvent(id);
      events.set(id, full);
      summary.events_fetched_by_id++;
    } catch (err) {
      // leg stays as is this run; a wrong/stale id surfaces here on every tick until re-matched
      summary.errors.push(`propfein event ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/** Replace list entries with GET /v1/events/{id} so player_stats are present. Cached per run by the map itself. */
async function hydratePlayerStats(
  client: PropfeinClient,
  events: Map<string, PropfeinEvent>,
  eventIds: string[],
  summary: RunSummary,
): Promise<void> {
  const need = eventIds.filter((id) => {
    const e = events.get(id);
    // scheduled games have no stats yet; skip the round trip
    return e && e.status !== "scheduled" && e.player_stats === undefined;
  });
  if (need.length === 0) return;
  await pool(need, EVENT_FETCH_CONCURRENCY, async (id) => {
    try {
      const full = await client.getEvent(id);
      events.set(id, { ...full, player_stats: full.player_stats ?? [] });
    } catch (err) {
      // leave the list version in place; player_prop legs on it grade as "no stat yet" / needs_review
      summary.errors.push(`propfein event ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/** Tiny concurrency pool: run `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Rollup, feed events, notifications
// ---------------------------------------------------------------------------

const NOTIFICATION_PRIORITY: Record<NotificationType, number> = { one_away: 0, cashed: 1, slip_died: 2, recap: 3 };

async function rollupAndNotify(db: Db, touched: Map<string, SlipTouch>, now: Date, summary: RunSummary): Promise<void> {
  const roomEvents: RoomEventInsert[] = [];
  const candidates: NotificationInsert[] = [];

  // Lookups shared by every slip in this run.
  const roomIds = unique([...touched.values()].map((t) => t.slip.room_id));
  const ownerIds = unique([...touched.values()].map((t) => t.slip.user_id));
  const [rooms, members] = await Promise.all([loadRooms(db, roomIds), loadMembers(db, roomIds)]);
  const owners = await loadProfiles(db, ownerIds);

  // Legs per touched slip, post-update, for "last live leg" and bad-beat wording.
  const { data: slipLegRows, error: slipLegsErr } = await db
    .from("legs")
    .select("id, slip_id, status, selection")
    .in("slip_id", [...touched.keys()]);
  if (slipLegsErr) throw slipLegsErr;
  const legsBySlip = groupBy((slipLegRows ?? []) as { id: string; slip_id: string; status: string; selection: string }[], (l) => l.slip_id);

  for (const [slipId, touch] of touched) {
    // rollup_slip() locks the slip and reports the before/after it observed. That
    // pair, not our start-of-run snapshot, decides which slip events fire.
    const { data: rolled, error: rpcErr } = await db.rpc("rollup_slip", { p_slip_id: slipId });
    if (rpcErr) {
      summary.errors.push(`rollup ${slipId}: ${rpcErr.message}`);
      continue;
    }
    const r = (Array.isArray(rolled) ? rolled[0] : rolled) as RollupResult | undefined;
    if (!r) {
      summary.errors.push(`rollup ${slipId}: no row returned`);
      continue;
    }
    summary.slips_rolled++;

    const prev: SlipRollup = { status: slipRollupStatus(r.old_status), legs_remaining: r.old_legs_remaining, legs_total: r.legs_total };
    const next: SlipRollup = { status: slipRollupStatus(r.new_status), legs_remaining: r.new_legs_remaining, legs_total: r.legs_total };

    const slip = touch.slip;
    const handle = owners.get(slip.user_id)?.handle ?? "someone";
    const payout = money(r.potential_payout);
    const base = { room_id: r.room_id, slate_id: r.slate_id, slip_id: slipId };

    // leg-level feed events (slip passed unchanged so nothing is double counted)
    for (const ch of touch.legChanges) {
      for (const type of detectTransitions(ch.prevStatus, ch.nextStatus, prev, prev)) {
        roomEvents.push({ ...base, type, payload: { leg_id: ch.leg.id, selection: ch.leg.selection, user_id: r.user_id, handle } });
      }
    }

    // slip-level feed events + notifications
    const slipTypes = detectTransitions(null, null, prev, next);
    const legsOfSlip = legsBySlip.get(slipId) ?? [];
    const liveLegs = legsOfSlip.filter((l) => !SETTLED_LEG_STATUSES.has(l.status));
    const lostLegs = legsOfSlip.filter((l) => l.status === "lost");
    const wonCount = legsOfSlip.filter((l) => l.status === "won").length;
    const settings = rooms.get(r.room_id) ?? defaultSettings();
    const roomMemberIds = members.get(r.room_id) ?? [];
    const url = `/rooms/${r.room_id}/slip/${slipId}`;

    for (const type of slipTypes) {
      // one_away can be detected twice for one slip (legs dropped to 1, then the
      // last leg's game kicked off later). Pushes dedupe on the notifications
      // unique index; the feed needs an explicit check.
      if (type === "one_away" && (await hasRoomEvent(db, slipId, "one_away"))) {
        summary.one_away_deduped++;
        continue;
      }
      roomEvents.push({
        ...base,
        type,
        payload: { user_id: r.user_id, handle, potential_payout: num(r.potential_payout), legs_remaining: next.legs_remaining, legs_total: r.legs_total },
      });

      if (type === "one_away") {
        const lastLeg = liveLegs[0];
        for (const uid of roomMemberIds) {
          candidates.push({
            ...base,
            user_id: uid,
            type: "one_away",
            title: `${handle} is one leg from $${payout}`,
            body: lastLeg ? lastLeg.selection : `${r.legs_total}-leg parlay, one to go`,
            url,
          });
        }
      } else if (type === "cashed" && (num(r.potential_payout) ?? 0) >= settings.cash_threshold) {
        for (const uid of roomMemberIds) {
          candidates.push({
            ...base,
            user_id: uid,
            type: "cashed",
            title: `${handle} cashed $${payout}`,
            body: `${r.legs_total}-leg ${r.legs_total === 1 ? "bet" : "parlay"} hit`,
            url,
          });
        }
      } else if (type === "slip_dead") {
        // "Bad beat" only when exactly one leg lost and every other leg won.
        // Anything else (two losers, legs still open, voids) is just dead.
        const badBeat = r.legs_total > 1 && lostLegs.length === 1 && wonCount === legsOfSlip.length - 1;
        candidates.push({
          ...base,
          user_id: r.user_id,
          type: "slip_died",
          title: badBeat ? `Bad beat: one leg killed your $${payout} slip` : `Your $${payout} slip is dead`,
          body: badBeat ? lostLegs[0].selection : `${handle}'s slip is dead`,
          url,
        });
      }
    }
  }

  // ---- write feed events ----------------------------------------------------
  if (roomEvents.length > 0) {
    const { error } = await db.from("room_events").insert(roomEvents);
    if (error) summary.errors.push(`room_events: ${error.message}`);
    else summary.events += roomEvents.length;
  }

  // ---- write notifications: muted triggers, quiet hours, per-slate cap -------
  if (candidates.length > 0) {
    await insertNotifications(db, candidates, rooms, now, summary);
  }
}

/**
 * Apply the room's muted_triggers, the recipient's quiet hours and the
 * per-(room, slate, user) cap, then insert what survives. Higher priority
 * types are placed first so they win the remaining slots.
 *
 * Inserted one row at a time so the dedupe index (user_id, slate_id, type, slip_id)
 * can reject individual duplicates (23505 -> already sent by an overlapping run)
 * without failing the batch.
 */
async function insertNotifications(
  db: Db,
  candidates: NotificationInsert[],
  rooms: Map<string, RoomSettings>,
  now: Date,
  summary: RunSummary,
): Promise<void> {
  const hour = nyHour(now);
  const recipients = await loadProfiles(db, unique(candidates.map((c) => c.user_id)));

  // existing counts for (room, slate, user)
  const pairs = unique(candidates.map((c) => `${c.room_id}|${c.slate_id}`));
  const counts = new Map<string, number>();
  for (const pair of pairs) {
    const [room_id, slate_id] = pair.split("|");
    const { data, error } = await db.from("notifications").select("user_id").eq("room_id", room_id).eq("slate_id", slate_id);
    if (error) throw error;
    for (const row of (data ?? []) as { user_id: string }[]) {
      const k = `${pair}|${row.user_id}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  const sorted = [...candidates].sort((a, b) => NOTIFICATION_PRIORITY[a.type] - NOTIFICATION_PRIORITY[b.type]);
  const keep: NotificationInsert[] = [];
  for (const c of sorted) {
    const settings = rooms.get(c.room_id) ?? defaultSettings();
    if (settings.muted_triggers.includes(c.type)) continue;

    const p = recipients.get(c.user_id);
    if (c.type !== "recap" && p && inQuietHours(hour, p.quiet_hours_start, p.quiet_hours_end)) continue;

    const k = `${c.room_id}|${c.slate_id}|${c.user_id}`;
    const used = counts.get(k) ?? 0;
    if (c.type !== "recap" && used >= settings.max_pushes_per_slate) continue;
    counts.set(k, used + 1);
    keep.push(c);
  }

  for (const n of keep) {
    const { error } = await db.from("notifications").insert(n);
    if (!error) {
      summary.notifications++;
    } else if (error.code === PG_UNIQUE_VIOLATION) {
      summary.notifications_deduped++;
    } else {
      summary.errors.push(`notification ${n.type} ${n.slip_id ?? n.slate_id} -> ${n.user_id}: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Slate lifecycle
// ---------------------------------------------------------------------------

async function advanceSlates(db: Db, slates: SlateRow[], today: string, now: Date, summary: RunSummary): Promise<void> {
  if (slates.length === 0) return;
  const forceBefore = nyDate(daysFromNow(-FORCE_FINAL_AFTER_DAYS));

  const { data: slipRows, error } = await db
    .from("slips")
    .select("id, slate_id, status")
    .in("slate_id", slates.map((s) => s.id));
  if (error) throw error;
  const slipsBySlate = groupBy((slipRows ?? []) as { id: string; slate_id: string; status: SlipStatus }[], (s) => s.slate_id);

  const finalized: SlateRow[] = [];

  for (const slate of slates) {
    const slips = slipsBySlate.get(slate.id) ?? [];
    const anyLive = slips.some((s) => s.status === "live");
    const allSettled = slips.every((s) => s.status === "won" || s.status === "lost" || s.status === "void" || s.status === "push");
    const stale = slate.slate_date < forceBefore;

    // Stale slate: park whatever is still open as needs_review and roll those slips up
    // so a human can void or grade them from the detail screen; then finalize below.
    if (stale && !allSettled) {
      const forced = await forceReviewOpenLegs(db, slate.id, slips.map((s) => s.id), summary);
      if (!forced) continue; // errors recorded; try again next run
      summary.slates_forced++;
    }

    // open -> live as soon as a slip goes live (only for slates we are not force-closing)
    if (!stale && slate.status === "open" && anyLive) {
      const { error: e } = await db.from("slates").update({ status: "live" }).eq("id", slate.id).eq("status", "open");
      if (e) summary.errors.push(`slate ${slate.id} -> live: ${e.message}`);
      continue;
    }

    // yesterday's (or older) slate with everything settled -> final; stale -> final regardless
    if (slate.slate_date < today && (allSettled || stale)) {
      const { data: upd, error: e } = await db
        .from("slates")
        .update({ status: "final", finalized_at: now.toISOString() })
        .eq("id", slate.id)
        .in("status", ["open", "live"]) // only the run that flips it sends the recap
        .select("id");
      if (e) {
        summary.errors.push(`slate ${slate.id} -> final: ${e.message}`);
        continue;
      }
      if ((upd ?? []).length > 0) finalized.push(slate);
    }
  }

  if (finalized.length === 0) return;
  summary.slates_finalized += finalized.length;

  // feed event + recap notification to every member
  const roomIds = unique(finalized.map((s) => s.room_id));
  const [rooms, members] = await Promise.all([loadRooms(db, roomIds), loadMembers(db, roomIds)]);

  const roomEvents: RoomEventInsert[] = finalized.map((s) => ({
    room_id: s.room_id,
    slate_id: s.id,
    slip_id: null,
    type: "slate_final",
    payload: { slate_date: s.slate_date, slips: (slipsBySlate.get(s.id) ?? []).length },
  }));
  const { error: evErr } = await db.from("room_events").insert(roomEvents);
  if (evErr) summary.errors.push(`room_events slate_final: ${evErr.message}`);
  else summary.events += roomEvents.length;

  const recaps: NotificationInsert[] = [];
  for (const s of finalized) {
    if ((slipsBySlate.get(s.id) ?? []).length === 0) continue; // nothing to recap
    for (const uid of members.get(s.room_id) ?? []) {
      recaps.push({
        user_id: uid,
        room_id: s.room_id,
        slate_id: s.id,
        slip_id: null,
        type: "recap",
        title: "Last night's recap is in",
        body: `See who cashed and who got burned on ${s.slate_date}`,
        url: `/rooms/${s.room_id}/recap/${s.id}`,
      });
    }
  }
  if (recaps.length > 0) {
    await insertNotifications(db, recaps, rooms, now, summary);
  }
}

/**
 * Mark every still-open leg on the given slips needs_review (CAS on open statuses so a
 * concurrent override wins) and roll the slips up. Returns false if anything failed.
 */
async function forceReviewOpenLegs(db: Db, slateId: string, slipIds: string[], summary: RunSummary): Promise<boolean> {
  if (slipIds.length === 0) return true;
  const { data: legs, error } = await db
    .from("legs")
    .update({ status: "needs_review", graded_by: "auto" })
    .in("slip_id", slipIds)
    .in("status", ["pending", "live"])
    .select("id, slip_id");
  if (error) {
    summary.errors.push(`slate ${slateId} force review: ${error.message}`);
    return false;
  }
  // roll up every slip on the slate, not just those with legs we moved: a slip can be
  // out of sync with its legs for reasons other than the ones we just caused
  let ok = true;
  for (const slipId of slipIds) {
    const { error: rpcErr } = await db.rpc("rollup_slip", { p_slip_id: slipId });
    if (rpcErr) {
      summary.errors.push(`slate ${slateId} force rollup ${slipId}: ${rpcErr.message}`);
      ok = false;
    }
  }
  summary.legs_updated += (legs ?? []).length;
  return ok;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

function defaultSettings(): RoomSettings {
  return { cash_threshold: 500, muted_triggers: [], max_pushes_per_slate: 6 };
}

async function loadRooms(db: Db, roomIds: string[]): Promise<Map<string, RoomSettings>> {
  const out = new Map<string, RoomSettings>();
  if (roomIds.length === 0) return out;
  const { data, error } = await db.from("rooms").select("id, settings").in("id", roomIds);
  if (error) throw error;
  for (const r of (data ?? []) as { id: string; settings: Partial<RoomSettings> | null }[]) {
    const s = r.settings ?? {};
    out.set(r.id, {
      cash_threshold: num(s.cash_threshold ?? null) ?? 500,
      muted_triggers: Array.isArray(s.muted_triggers) ? s.muted_triggers : [],
      max_pushes_per_slate: num(s.max_pushes_per_slate ?? null) ?? 6,
    });
  }
  return out;
}

async function loadMembers(db: Db, roomIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (roomIds.length === 0) return out;
  const { data, error } = await db.from("room_members").select("room_id, user_id").in("room_id", roomIds);
  if (error) throw error;
  for (const m of (data ?? []) as { room_id: string; user_id: string }[]) {
    const list = out.get(m.room_id) ?? [];
    list.push(m.user_id);
    out.set(m.room_id, list);
  }
  return out;
}

async function loadProfiles(db: Db, userIds: string[]): Promise<Map<string, ProfileLite>> {
  const out = new Map<string, ProfileLite>();
  if (userIds.length === 0) return out;
  const { data, error } = await db
    .from("profiles")
    .select("id, handle, quiet_hours_start, quiet_hours_end")
    .in("id", userIds);
  if (error) throw error;
  for (const p of (data ?? []) as ProfileLite[]) out.set(p.id, p);
  return out;
}

// ---------------------------------------------------------------------------
// Small utils
// ---------------------------------------------------------------------------

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = out.get(k) ?? [];
    list.push(x);
    out.set(k, list);
  }
  return out;
}
