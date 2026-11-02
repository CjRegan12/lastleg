/**
 * grade-legs: the Group Sweat grader.
 *
 * Called by pg_cron every 30 seconds (scripts/schedule-grader.sql). Each run:
 *   1. bails out unless a slate for today or yesterday (New York) is open or live
 *   2. pulls today's and yesterday's NFL + NBA events from Propfein
 *   3. re-grades every open leg whose event is in that set (pure logic in _shared/grade.ts)
 *   4. rolls up every touched slip through the SQL rollup_slip() RPC
 *   5. writes room_events for the feed and notifications for send-push
 *   6. moves slates open -> live -> final and sends the recap
 *
 * Idempotent by construction: every write is derived from the current Propfein
 * state and the current row, so two overlapping runs converge on the same rows.
 * The only duplicates possible from an overlap are feed events, which the UI
 * tolerates.
 *
 * Secrets: GRADER_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *          PROPFEIN_API_URL (or "mock"), PROPFEIN_API_KEY.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { propfeinFromEnv } from "../_shared/propfein.ts";
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

interface SlipRow {
  id: string;
  status: SlipStatus;
  legs_remaining: number;
  legs_total: number;
  room_id: string;
  slate_id: string;
  user_id: string;
  potential_payout: number | string;
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
  type: NotificationType;
  title: string;
  body: string;
  url: string;
}

/** A per-slip change bundle collected while grading legs. */
interface SlipTouch {
  slip: SlipJoin;
  prev: SlipRollup;
  legChanges: { leg: LegRow; prevStatus: string; nextStatus: string }[];
}

interface RunSummary {
  ok: boolean;
  skipped?: string;
  legs_checked: number;
  legs_updated: number;
  slips_rolled: number;
  events: number;
  notifications: number;
  slates_finalized: number;
  errors: string[];
}

// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, "public", any>;

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

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
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

  const db: Db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const summary: RunSummary = {
    ok: true,
    legs_checked: 0,
    legs_updated: 0,
    slips_rolled: 0,
    events: 0,
    notifications: 0,
    slates_finalized: 0,
    errors: [],
  };

  try {
    await run(db, summary);
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

async function run(db: Db, summary: RunSummary): Promise<void> {
  const now = new Date();
  const today = nyDate(now);
  const yesterday = nyDate(daysAgo(1));

  // ---- 1. only work when a slate is active ---------------------------------
  const { data: slates, error: slatesErr } = await db
    .from("slates")
    .select("id, room_id, slate_date, status")
    .in("status", ["open", "live"])
    .in("slate_date", [today, yesterday]);
  if (slatesErr) throw slatesErr;
  const activeSlates = (slates ?? []) as SlateRow[];
  if (activeSlates.length === 0) {
    summary.skipped = "no_live_slates";
    return;
  }
  const slateIds = activeSlates.map((s) => s.id);

  // ---- 2. events from Propfein ---------------------------------------------
  const events = await fetchEvents([today, yesterday], summary);

  // ---- 3. open legs on active slates ---------------------------------------
  const { data: legRows, error: legsErr } = await db
    .from("legs")
    .select(
      "id, slip_id, room_id, market, side, line, selection, stat_type, status, current_value, propfein_event_id, propfein_player_id, " +
        "slips!inner(id, status, legs_remaining, legs_total, room_id, slate_id, user_id, potential_payout, stake)",
    )
    .in("status", ["pending", "live"])
    .not("propfein_event_id", "is", null)
    .in("slips.slate_id", slateIds);
  if (legsErr) throw legsErr;
  const legs = (legRows ?? []) as unknown as LegRow[];

  const touched = new Map<string, SlipTouch>();

  for (const leg of legs) {
    const event = events.get(leg.propfein_event_id!);
    if (!event) continue; // not in today's/yesterday's slate of games, leave it alone
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
    const { error: updErr } = await db
      .from("legs")
      .update({
        status: graded.status,
        current_value: graded.current_value,
        graded_by: "auto",
        graded_at: settled ? now.toISOString() : null,
      })
      .eq("id", leg.id)
      .in("status", ["pending", "live"]); // never clobber a human override that landed mid-run
    if (updErr) {
      summary.errors.push(`leg ${leg.id}: ${updErr.message}`);
      continue;
    }
    summary.legs_updated++;

    // remember what changed per slip so we can emit feed events after rollup
    let touch = touched.get(leg.slip_id);
    if (!touch) {
      touch = {
        slip: leg.slips,
        prev: { status: slipRollupStatus(leg.slips.status), legs_remaining: leg.slips.legs_remaining },
        legChanges: [],
      };
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

/** slips.status 'push' is in the enum but rollup never emits it; map it to void for comparisons. */
function slipRollupStatus(s: SlipStatus): SlipRollup["status"] {
  return s === "push" ? "void" : s;
}

// ---------------------------------------------------------------------------
// Propfein
// ---------------------------------------------------------------------------

async function fetchEvents(dates: string[], summary: RunSummary): Promise<Map<string, PropfeinEvent>> {
  const client = propfeinFromEnv(Deno.env.toObject());
  const sports: Sport[] = ["nfl", "nba"];
  const calls: Promise<PropfeinEvent[]>[] = [];
  for (const sport of sports) for (const date of dates) calls.push(client.listEvents(sport, date));

  const results = await Promise.allSettled(calls);
  const map = new Map<string, PropfeinEvent>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const e of r.value) map.set(e.id, e);
    } else {
      summary.errors.push(`propfein ${sports[Math.floor(i / dates.length)]} ${dates[i % dates.length]}: ${String(r.reason)}`);
    }
  });
  return map;
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

  // Legs per touched slip, post-update, for "last live leg" and "exactly one lost".
  const { data: slipLegRows, error: slipLegsErr } = await db
    .from("legs")
    .select("id, slip_id, status, selection")
    .in("slip_id", [...touched.keys()]);
  if (slipLegsErr) throw slipLegsErr;
  const legsBySlip = groupBy((slipLegRows ?? []) as { id: string; slip_id: string; status: string; selection: string }[], (l) => l.slip_id);

  for (const [slipId, touch] of touched) {
    // rollup_slip() returns the updated slips row
    const { data: rolled, error: rpcErr } = await db.rpc("rollup_slip", { p_slip_id: slipId });
    if (rpcErr) {
      summary.errors.push(`rollup ${slipId}: ${rpcErr.message}`);
      continue;
    }
    summary.slips_rolled++;
    const after = (Array.isArray(rolled) ? rolled[0] : rolled) as SlipRow;
    const next: SlipRollup = { status: slipRollupStatus(after.status), legs_remaining: after.legs_remaining };

    const slip = touch.slip;
    const handle = owners.get(slip.user_id)?.handle ?? "someone";
    const payout = money(slip.potential_payout);
    const base = { room_id: slip.room_id, slate_id: slip.slate_id, slip_id: slipId };

    // leg-level feed events (slip passed unchanged so nothing is double counted)
    for (const ch of touch.legChanges) {
      for (const type of detectTransitions(ch.prevStatus, ch.nextStatus, touch.prev, touch.prev)) {
        roomEvents.push({ ...base, type, payload: { leg_id: ch.leg.id, selection: ch.leg.selection, user_id: slip.user_id, handle } });
      }
    }

    // slip-level feed events + notifications
    const slipTypes = detectTransitions(null, null, touch.prev, next);
    const legsOfSlip = legsBySlip.get(slipId) ?? [];
    const liveLegs = legsOfSlip.filter((l) => !SETTLED_LEG_STATUSES.has(l.status));
    const lostCount = legsOfSlip.filter((l) => l.status === "lost").length;
    const settings = rooms.get(slip.room_id) ?? defaultSettings();
    const roomMemberIds = members.get(slip.room_id) ?? [];
    const url = `/rooms/${slip.room_id}/slip/${slipId}`;

    for (const type of slipTypes) {
      roomEvents.push({
        ...base,
        type,
        payload: { user_id: slip.user_id, handle, potential_payout: num(slip.potential_payout), legs_remaining: next.legs_remaining, legs_total: after.legs_total },
      });

      if (type === "one_away") {
        const lastLeg = liveLegs[0];
        for (const uid of roomMemberIds) {
          candidates.push({
            user_id: uid,
            room_id: slip.room_id,
            slate_id: slip.slate_id,
            type: "one_away",
            title: `${handle} is one leg from $${payout}`,
            body: lastLeg ? lastLeg.selection : `${after.legs_total}-leg parlay, one to go`,
            url,
          });
        }
      } else if (type === "cashed" && (num(slip.potential_payout) ?? 0) >= settings.cash_threshold) {
        for (const uid of roomMemberIds) {
          candidates.push({
            user_id: uid,
            room_id: slip.room_id,
            slate_id: slip.slate_id,
            type: "cashed",
            title: `${handle} cashed $${payout}`,
            body: `${after.legs_total}-leg ${after.legs_total === 1 ? "bet" : "parlay"} hit`,
            url,
          });
        }
      } else if (type === "slip_dead" && after.legs_total > 1 && lostCount === 1) {
        const dead = legsOfSlip.find((l) => l.status === "lost");
        candidates.push({
          user_id: slip.user_id,
          room_id: slip.room_id,
          slate_id: slip.slate_id,
          type: "slip_died",
          title: `Bad beat: one leg killed your $${payout} slip`,
          body: dead ? dead.selection : "One leg lost",
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
    const inserted = await insertNotifications(db, candidates, rooms, now);
    summary.notifications += inserted;
  }
}

/**
 * Apply the room's muted_triggers, the recipient's quiet hours and the
 * per-(room, slate, user) cap, then insert what survives. Higher priority
 * types are placed first so they win the remaining slots.
 */
async function insertNotifications(
  db: Db,
  candidates: NotificationInsert[],
  rooms: Map<string, RoomSettings>,
  now: Date,
): Promise<number> {
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

  if (keep.length === 0) return 0;
  const { error } = await db.from("notifications").insert(keep);
  if (error) throw error;
  return keep.length;
}

// ---------------------------------------------------------------------------
// Slate lifecycle
// ---------------------------------------------------------------------------

async function advanceSlates(db: Db, slates: SlateRow[], today: string, now: Date, summary: RunSummary): Promise<void> {
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

    // open -> live as soon as a slip goes live
    if (slate.status === "open" && anyLive) {
      const { error: e } = await db.from("slates").update({ status: "live" }).eq("id", slate.id).eq("status", "open");
      if (e) summary.errors.push(`slate ${slate.id} -> live: ${e.message}`);
      continue;
    }

    // yesterday's (or older) slate with everything settled -> final
    if (slate.slate_date < today && allSettled) {
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
        type: "recap",
        title: "Last night's recap is in",
        body: `See who cashed and who got burned on ${s.slate_date}`,
        url: `/rooms/${s.room_id}/recap/${s.id}`,
      });
    }
  }
  if (recaps.length > 0) {
    summary.notifications += await insertNotifications(db, recaps, rooms, now);
  }
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
