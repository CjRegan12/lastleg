import { randomUUID } from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import type { Enums, Inserts, Json } from "@/lib/database.types";
import { shiftDate, todayNY } from "@/lib/format";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types. Must stay in sync with supabase/functions/parse-slip/schema.ts plus
// the match block the function attaches per leg after calling Propfein.
// ---------------------------------------------------------------------------

export type Book = Enums<"sportsbook">;
export type BetType = Enums<"bet_type">;
export type SlipSport = Enums<"sport">;
export type SlipMarket = Enums<"market">;

export interface LegMatch {
  event_id: string;
  market_key: string;
  player_id: string | null;
  team_id: string | null;
  side: "home" | "away" | "over" | "under" | null;
  confidence: number;
}

export interface ParsedLeg {
  sport: SlipSport;
  market: SlipMarket;
  selection: string;
  line: number | null;
  player_name: string | null;
  stat_type: string | null;
  teams: string[];
  event_date_hint: string | null;
  leg_odds_american: number | null;
  confidence: number;
  match: LegMatch | null;
}

export interface ParsedSlip {
  book: Book;
  bet_type: BetType;
  stake: number;
  odds_american: number;
  potential_payout: number;
  legs: ParsedLeg[];
  overall_confidence: number;
}

export const LOW_CONFIDENCE = 0.8;

// ---------------------------------------------------------------------------
// Image: pick, downscale to 1568px long edge (keeps Haiku at ~1,450 tokens).
// ---------------------------------------------------------------------------

export const MAX_LONG_EDGE = 1568;

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

/** Returns null when the user cancels. */
export async function pickAndPrepareImage(
  source: "library" | "camera" = "library",
): Promise<PreparedImage | null> {
  const common: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 1,
    exif: false,
  };
  let result: ImagePicker.ImagePickerResult;
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Camera permission denied");
    result = await ImagePicker.launchCameraAsync(common);
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error("Photo library permission denied");
    result = await ImagePicker.launchImageLibraryAsync(common);
  }
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return downscale(asset.uri, asset.width, asset.height);
}

export async function downscale(uri: string, width: number, height: number): Promise<PreparedImage> {
  const longEdge = Math.max(width, height);
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
  const target = {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
  const ctx = ImageManipulator.manipulate(uri);
  if (scale < 1) ctx.resize(target);
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  rendered.release();
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

// ---------------------------------------------------------------------------
// Storage: private bucket `slips`, path `<user_id>/<uuid>.jpg`
// ---------------------------------------------------------------------------

export async function uploadSlipImage(userId: string, localUri: string): Promise<string> {
  const res = await fetch(localUri);
  const buf = await res.arrayBuffer();
  const path = `${userId}/${randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("slips").upload(path, buf, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

// ---------------------------------------------------------------------------
// Parse: Edge Function `parse-slip`
// ---------------------------------------------------------------------------

/** Wire shape of parse-slip's 200 response. `parsed` has no `match`; matches are positional. */
interface ParseSlipResponse {
  parsed: Omit<ParsedSlip, "legs"> & { legs: Omit<ParsedLeg, "match">[] };
  matches: { match: LegMatch | null; alternates: LegMatch[] }[];
  storage_path?: string;
  model_used: string;
  escalated: boolean;
  usage: { input_tokens: number; output_tokens: number };
}

export async function callParseSlip(storagePath: string, roomId: string): Promise<ParsedSlip> {
  const r = await invokeParse({ storage_path: storagePath, room_id: roomId });
  return r.parsed;
}

/**
 * Share-link path: the server fetches the book's preview image, stores it in the
 * caller's folder and parses it. Returns the storage path so saveSlip can use it
 * exactly like an upload.
 */
export async function callParseSlipFromLink(
  url: string,
  roomId: string,
): Promise<{ parsed: ParsedSlip; storagePath: string }> {
  const r = await invokeParse({ share_url: url, room_id: roomId });
  if (!r.storagePath) throw new Error("parse-slip did not return the stored image path");
  return { parsed: r.parsed, storagePath: r.storagePath };
}

/** Sportsbook share links we accept, mirrored from the Edge Function allow-list. */
export function looksLikeShareLink(text: string): string | null {
  const m = text.match(/https:\/\/[^\s<>"']+/i);
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    const hosts = [
      "fanduel.com",
      "draftkings.com",
      "dkng.co",
      "prizepicks.com",
      "underdogfantasy.com",
      "betmgm.com",
      "caesars.com",
      "fanatics.com",
      "fanatics.bet",
      "kalshi.com",
      "espnbet.com",
      "hardrock.bet",
      "bet365.com",
      "betrivers.com",
    ];
    const h = u.hostname.toLowerCase();
    return hosts.some((d) => h === d || h.endsWith(`.${d}`)) ? u.toString() : null;
  } catch {
    return null;
  }
}

async function invokeParse(
  body: { storage_path: string; room_id: string } | { share_url: string; room_id: string },
): Promise<{ parsed: ParsedSlip; storagePath: string | null }> {
  const { data, error } = await supabase.functions.invoke<ParseSlipResponse>("parse-slip", { body });
  if (error) {
    // supabase-js wraps non-2xx in a FunctionsHttpError whose context holds the real body.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string };
        if (j?.error) throw new Error(j.error);
      } catch (inner) {
        if (inner instanceof Error && inner.message && !/JSON/i.test(inner.message)) throw inner;
      }
    }
    throw error;
  }
  if (!data || !data.parsed || !Array.isArray(data.parsed.legs)) {
    throw new Error("parse-slip returned an unexpected shape");
  }
  const matches = Array.isArray(data.matches) ? data.matches : [];
  return {
    parsed: {
      ...data.parsed,
      legs: data.parsed.legs.map((l, i) => ({ ...l, match: matches[i]?.match ?? null })),
    },
    storagePath: typeof data.storage_path === "string" ? data.storage_path : null,
  };
}

// ---------------------------------------------------------------------------
// Save: slip + legs (+ parse_corrections for anything the user changed)
// ---------------------------------------------------------------------------

export interface SaveSlipInput {
  userId: string;
  roomId: string;
  screenshotPath: string;
  /** What parse-slip returned, untouched. */
  parsed: ParsedSlip;
  /** What the user confirmed. */
  confirmed: ParsedSlip;
  /**
   * Explicit slate date override. When omitted the slip goes on the slate of
   * the earliest game date printed on it (event_date_hint), else today NY.
   */
  slateDate?: string;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** How far a slip may be dated relative to today (NY). Matches the room board's forward navigation. */
export const SLATE_PAST_DAYS = 1;
export const SLATE_FUTURE_DAYS = 10;

/**
 * Slate for a slip is the date of its games, not the day it was uploaded: a slip
 * dropped Tuesday for Thursday night football belongs on Thursday's board.
 * Earliest valid event_date_hint wins, clamped to [today-1, today+10] in New
 * York; a hint outside that window (misread year, stale screenshot) falls back
 * to today. No hints -> today. ParsedLeg.match carries no start_time, so the
 * printed date hint is the only signal we have here.
 */
export function slateDateFor(legs: Pick<ParsedLeg, "event_date_hint">[], now: Date = new Date()): string {
  const today = todayNY(now);
  const min = shiftDate(today, -SLATE_PAST_DAYS);
  const max = shiftDate(today, SLATE_FUTURE_DAYS);
  let earliest: string | null = null;
  for (const leg of legs) {
    const d = leg.event_date_hint;
    if (!d || !YMD_RE.test(d)) continue;
    if (d < min || d > max) continue; // misread year or stale screenshot: ignore this hint
    if (earliest === null || d < earliest) earliest = d;
  }
  return earliest ?? today;
}

export async function saveSlip(input: SaveSlipInput): Promise<string> {
  const { userId, roomId, screenshotPath, parsed, confirmed } = input;

  const { data: slate, error: slateErr } = await supabase.rpc("ensure_slate", {
    p_room_id: roomId,
    p_date: input.slateDate ?? slateDateFor(confirmed.legs),
  });
  if (slateErr) throw slateErr;

  const slipInsert: Inserts<"slips"> = {
    user_id: userId,
    room_id: roomId,
    slate_id: slate.id,
    book: confirmed.book,
    bet_type: confirmed.bet_type,
    stake: confirmed.stake,
    odds_american: confirmed.odds_american,
    potential_payout: confirmed.potential_payout,
    // status/legs_total/legs_remaining are set server side: slips_before_insert_guard
    // zeroes them and the legs insert trigger recomputes the counts.
    screenshot_path: screenshotPath,
    parsed_json: parsed as unknown as Json,
    parse_confidence: clamp01(parsed.overall_confidence),
  };
  const { data: slip, error: slipErr } = await supabase
    .from("slips")
    .insert(slipInsert)
    .select("id")
    .single();
  if (slipErr) throw slipErr;

  const legInserts: Inserts<"legs">[] = confirmed.legs.map((leg) => ({
    slip_id: slip.id,
    room_id: roomId,
    sport: leg.sport,
    market: leg.market,
    selection: leg.selection,
    line: leg.line,
    player_name: leg.player_name,
    stat_type: leg.stat_type,
    teams: leg.teams,
    leg_odds_american: leg.leg_odds_american,
    status: leg.match ? "pending" : "needs_review",
    propfein_event_id: leg.match?.event_id ?? null,
    propfein_market_key: leg.match?.market_key ?? null,
    propfein_player_id: leg.match?.player_id ?? null,
    side: leg.match?.side ?? null,
    match_confidence: leg.match ? clamp01(leg.match.confidence) : null,
  }));
  if (legInserts.length > 0) {
    try {
      const { error: legsErr } = await supabase.from("legs").insert(legInserts);
      if (legsErr) throw legsErr;
    } catch (e) {
      // Do not leave a legless slip on the board. RLS lets the owner delete while pending.
      await supabase.from("slips").delete().eq("id", slip.id);
      throw e;
    }
  }

  const corrections = diffCorrections(parsed, confirmed).map((c) => ({
    slip_id: slip.id,
    user_id: userId,
    field_path: c.field_path,
    parsed_value: c.parsed_value,
    corrected_value: c.corrected_value,
  }));
  if (corrections.length > 0) {
    // learning data only; never block the save on it
    await supabase.from("parse_corrections").insert(corrections);
  }

  return slip.id;
}

interface Correction {
  field_path: string;
  parsed_value: Json;
  corrected_value: Json;
}

const SLIP_FIELDS = ["book", "bet_type", "stake", "odds_american", "potential_payout"] as const;
const LEG_FIELDS = [
  "sport",
  "market",
  "selection",
  "line",
  "player_name",
  "stat_type",
  "leg_odds_american",
] as const;

/** Field-level diff between the model output and what the user submitted. */
export function diffCorrections(parsed: ParsedSlip, confirmed: ParsedSlip): Correction[] {
  const out: Correction[] = [];
  for (const f of SLIP_FIELDS) {
    if (parsed[f] !== confirmed[f]) {
      out.push({ field_path: f, parsed_value: parsed[f], corrected_value: confirmed[f] });
    }
  }
  const n = Math.max(parsed.legs.length, confirmed.legs.length);
  for (let i = 0; i < n; i++) {
    const a = parsed.legs[i];
    const b = confirmed.legs[i];
    if (!a || !b) {
      out.push({
        field_path: `legs[${i}]`,
        parsed_value: a ? (a as unknown as Json) : null,
        corrected_value: b ? (b as unknown as Json) : null,
      });
      continue;
    }
    for (const f of LEG_FIELDS) {
      if (a[f] !== b[f]) {
        out.push({
          field_path: `legs[${i}].${f}`,
          parsed_value: a[f],
          corrected_value: b[f],
        });
      }
    }
  }
  return out;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}
