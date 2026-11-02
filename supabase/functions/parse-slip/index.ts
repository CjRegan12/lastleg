/**
 * parse-slip: screenshot in private Storage -> Claude structured output -> Propfein leg matches.
 *
 * Deploy with verify_jwt ON (default): `supabase functions deploy parse-slip`.
 * The caller is the signed-in user; we re-verify them via auth.getUser(), require
 * the storage path to live in their own folder, and require them to be a member
 * of room_id (checked through the user's own client, so RLS does the work).
 *
 * The image is downloaded with the service role and sent to Claude as base64, not
 * as a signed URL: that works against local `functions serve` (no public URL) and
 * the escalation call can never hit an expired link.
 *
 * Request:  POST { storage_path: "<user_id>/<uuid>.jpg", room_id: "<uuid>" }
 * Response: { parsed, matches, model_used, usage: { input_tokens, output_tokens } }
 *
 * Nothing is written to the database here. The client inserts slips/legs after the
 * user confirms the parse (RLS allows own inserts).
 *
 * Secrets: ANTHROPIC_API_KEY, PROPFEIN_API_URL (or "mock"), PROPFEIN_API_KEY,
 *          optional PARSE_MODEL_PRIMARY / PARSE_MODEL_FALLBACK.
 * Supabase injects SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { propfeinFromEnv } from "../_shared/propfein.ts";
import type { LegMatchCandidate, LegMatchRequest, Sport } from "../_shared/propfein.types.ts";
import { clampConfidences, isParsedSlip, SLIP_SCHEMA, STAT_TYPES, type ParsedLeg, type ParsedSlip } from "./schema.ts";

// ---------- config ----------
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const BUCKET = "slips";
const MAX_TOKENS = 2000;
/** DECISIONS: escalate to the fallback model on low confidence or an unusable primary result. */
const ESCALATE_BELOW_CONFIDENCE = 0.8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic image limit
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const JSON_HEADERS = { "Content-Type": "application/json" };

// ---------- prompt ----------
const SYSTEM_PROMPT = `You are an expert at reading screenshots of US sportsbook bet slips (DraftKings, FanDuel, Caesars, BetMGM, Fanatics).

Your job is to extract EXACTLY what is on the slip into the required JSON shape.

Rules:
- Never invent legs. One leg per selection shown on the slip. If a slip shows 3 picks, return exactly 3 legs.
- American odds are integers: "+650" -> 650, "-110" -> -110, "EVEN" -> 100.
- stake and potential_payout are plain numbers in dollars ("$12.50" -> 12.5). potential_payout is the total returned including the stake. If the slip only shows "To Win", add the stake to it.
- If a value is not visible or is cut off, make your best guess and set that leg's confidence (and overall_confidence) low. Do not leave required fields out.
- teams: short names exactly as printed ("Eagles", "Cowboys", "LAL"). Empty array if none shown on that leg.
- selection: copy the pick text as printed, trimmed.
- line: the number in the selection (spread -3.5, total 47.5, prop 249.5). null for moneyline or when there is no number.
- market: spread, total, moneyline, player_prop (any single player stat), team_prop (team totals, first to score, etc.), other.
- bet_type: single (one leg), parlay (multi-game), sgp (same game parlay / "SGP" badge / all legs one game), round_robin, teaser, other.
- book: infer from logo, colors and layout. DraftKings is dark with green accents; FanDuel is dark navy/blue with a "FD" shield; Caesars is dark with gold; BetMGM is black and gold with a lion; Fanatics is dark with red/white.
- stat_type for player props must be canonical snake_case from this list when possible: ${STAT_TYPES.join(", ")}. Use null when the leg is not a player prop.
- event_date_hint: YYYY-MM-DD only if a game date is visible; otherwise null. Do not infer dates from today.
- sport: nfl, nba, mlb, nhl, ncaaf, ncaab, or other.

Few-shot examples (text descriptions of slips and the JSON you would produce):

Example 1 (DraftKings 3-leg parlay): dark background, green "Parlay" header, "+612" total odds, three cards: "Eagles -3.5" with "PHI Eagles @ DAL Cowboys  Sun 1:00PM  -110", "Over 47.5" with "KC Chiefs @ BUF Bills  -110", "Josh Allen 250+ Passing Yds" with "KC Chiefs @ BUF Bills  -115". Footer "Wager $10.00  To Pay $71.20".
Expected: {"book":"draftkings","bet_type":"parlay","stake":10,"odds_american":612,"potential_payout":71.2,"legs":[{"sport":"nfl","market":"spread","selection":"Eagles -3.5","line":-3.5,"player_name":null,"stat_type":null,"teams":["Eagles","Cowboys"],"event_date_hint":null,"leg_odds_american":-110,"confidence":0.97},{"sport":"nfl","market":"total","selection":"Over 47.5","line":47.5,"player_name":null,"stat_type":null,"teams":["Chiefs","Bills"],"event_date_hint":null,"leg_odds_american":-110,"confidence":0.96},{"sport":"nfl","market":"player_prop","selection":"Josh Allen 250+ Passing Yds","line":249.5,"player_name":"Josh Allen","stat_type":"passing_yards","teams":["Chiefs","Bills"],"event_date_hint":null,"leg_odds_american":-115,"confidence":0.94}],"overall_confidence":0.95}

Example 2 (FanDuel same game parlay): navy background, "Same Game Parlay" with the SGP badge, "Lakers @ Celtics  Tue Nov 4", total odds "+480", legs listed without individual odds: "LeBron James 25+ Points", "Jayson Tatum 7+ Rebounds", "Celtics Moneyline". Footer "Wager $20.00  Total Payout $116.00".
Expected: {"book":"fanduel","bet_type":"sgp","stake":20,"odds_american":480,"potential_payout":116,"legs":[{"sport":"nba","market":"player_prop","selection":"LeBron James 25+ Points","line":24.5,"player_name":"LeBron James","stat_type":"points","teams":["Lakers","Celtics"],"event_date_hint":"2026-11-04","leg_odds_american":null,"confidence":0.95},{"sport":"nba","market":"player_prop","selection":"Jayson Tatum 7+ Rebounds","line":6.5,"player_name":"Jayson Tatum","stat_type":"rebounds","teams":["Lakers","Celtics"],"event_date_hint":"2026-11-04","leg_odds_american":null,"confidence":0.95},{"sport":"nba","market":"moneyline","selection":"Celtics Moneyline","line":null,"player_name":null,"stat_type":null,"teams":["Lakers","Celtics"],"event_date_hint":"2026-11-04","leg_odds_american":null,"confidence":0.97}],"overall_confidence":0.95}

Note on "N+" props: "250+ Passing Yds" means over 249.5, "25+ Points" means over 24.5. Record the .5 line.`;

const USER_PROMPT =
  "Read this bet slip screenshot and return the JSON. Extract only what is visible; never add legs that are not on the slip.";

// ---------- types ----------
interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
}

interface ClaudeResponse {
  id: string;
  model: string;
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
  usage: ClaudeUsage;
}

interface ClaudeCallResult {
  parsed: ParsedSlip | null;
  stop_reason: string | null;
  model: string;
  usage: ClaudeUsage;
}

interface LegMatchOut {
  match: LegMatchCandidate | null;
  alternates: LegMatchCandidate[];
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// ---------- helpers ----------
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new HttpError(500, `missing env ${name}`);
  return v;
}

/** YYYY-MM-DD for "today" in America/New_York, the slate timezone. */
function todayInNewYork(): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Propfein only knows nfl and nba today; anything else is sent as null. */
function toPropfeinSport(s: ParsedLeg["sport"]): Sport | null {
  return s === "nfl" || s === "nba" ? s : null;
}

function toMatchRequest(leg: ParsedLeg, fallbackDate: string): LegMatchRequest {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(leg.event_date_hint ?? "") ? (leg.event_date_hint as string) : fallbackDate;
  return {
    sport: toPropfeinSport(leg.sport),
    date,
    teams: leg.teams,
    player: leg.player_name,
    market: leg.market,
    selection: leg.selection,
    line: leg.line,
    stat_type: leg.stat_type,
  };
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

interface ImageInput {
  media_type: ImageMediaType;
  data: string; // base64
}

/** Media type from the storage path's extension. The app always uploads .jpg; be lenient anyway. */
function mediaTypeFor(path: string): ImageMediaType {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

/** ArrayBuffer -> base64 without blowing the call stack on large images. */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

async function callClaude(apiKey: string, model: string, image: ImageInput): Promise<ClaudeCallResult> {
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } },
          { type: "text", text: USER_PROMPT },
        ],
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: SLIP_SCHEMA },
    },
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Log the real error for ops; the client gets a generic message. Claude's error
    // text can echo request details and is not something to surface in the app.
    let detail = "";
    try {
      const err = (await res.json()) as { error?: { type?: string; message?: string } };
      detail = `${err.error?.type ?? "error"}: ${err.error?.message ?? ""}`;
    } catch {
      /* non-JSON error body */
    }
    console.error(`parse-slip: Claude API ${res.status} (${model}) ${detail}`.trim());
    throw new HttpError(502, "the slip reader is unavailable right now, try again in a moment");
  }

  const data = (await res.json()) as ClaudeResponse;
  const usage: ClaudeUsage = {
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
  };

  if (data.stop_reason === "refusal" || data.stop_reason === "max_tokens") {
    return { parsed: null, stop_reason: data.stop_reason, model: data.model ?? model, usage };
  }

  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { parsed: null, stop_reason: "invalid_json", model: data.model ?? model, usage };
  }
  if (!isParsedSlip(parsed)) {
    return { parsed: null, stop_reason: "schema_mismatch", model: data.model ?? model, usage };
  }
  return { parsed: clampConfidences(parsed), stop_reason: data.stop_reason, model: data.model ?? model, usage };
}

/** Per DECISIONS: low confidence, or refusal / max_tokens / unparseable output. Leg count is not a reason. */
function shouldEscalate(r: ClaudeCallResult): boolean {
  if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return true;
  if (!r.parsed) return true;
  return r.parsed.overall_confidence < ESCALATE_BELOW_CONFIDENCE;
}

// ---------- handler ----------
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    // 1. who is calling
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new HttpError(401, "missing Authorization header");

    const supabaseUrl = env("SUPABASE_URL");
    const userClient = createClient(supabaseUrl, env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) throw new HttpError(401, "not authenticated");

    // 2. body
    let body: { storage_path?: unknown; room_id?: unknown };
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "body must be JSON");
    }
    const storagePath = typeof body.storage_path === "string" ? body.storage_path : "";
    const roomId = typeof body.room_id === "string" ? body.room_id : "";
    if (!storagePath || !roomId) throw new HttpError(400, "storage_path and room_id are required");
    if (!UUID_RE.test(roomId)) throw new HttpError(400, "room_id must be a uuid");
    if (!storagePath.startsWith(`${user.id}/`) || storagePath.includes("..")) {
      throw new HttpError(400, "storage_path must be inside your own folder");
    }

    // 3. caller must belong to the room. Through the user client so RLS answers it.
    const { data: membership, error: memberErr } = await userClient
      .from("room_members")
      .select("room_id")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberErr) {
      console.error("parse-slip: membership check", memberErr.message);
      throw new HttpError(500, "could not verify room membership");
    }
    if (!membership) throw new HttpError(403, "you are not a member of this room");

    // 4. download the image (service role; bucket is private) and base64 it
    const admin = createClient(supabaseUrl, env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(storagePath);
    if (dlErr || !blob) {
      console.error("parse-slip: download", dlErr?.message ?? "no data");
      throw new HttpError(400, "could not read the uploaded image");
    }
    if (blob.size > MAX_IMAGE_BYTES) throw new HttpError(413, "image is too large (5 MB max)");
    const image: ImageInput = { media_type: mediaTypeFor(storagePath), data: toBase64(await blob.arrayBuffer()) };

    // 5. Propfein client first: if it is misconfigured we fail before spending Claude tokens.
    //    propfeinFromEnv throws when PROPFEIN_API_URL is unset/mock without ALLOW_MOCK_PROPFEIN=true;
    //    the catch below turns that into 500 propfein_not_configured.
    const propfein = propfeinFromEnv(Deno.env.toObject());

    // 6. Claude, primary then fallback
    const anthropicKey = env("ANTHROPIC_API_KEY");
    const primaryModel = Deno.env.get("PARSE_MODEL_PRIMARY") ?? "claude-haiku-5-5";
    const fallbackModel = Deno.env.get("PARSE_MODEL_FALLBACK") ?? "claude-sonnet-5-5";

    const usage: ClaudeUsage = { input_tokens: 0, output_tokens: 0 };
    let result = await callClaude(anthropicKey, primaryModel, image);
    usage.input_tokens += result.usage.input_tokens;
    usage.output_tokens += result.usage.output_tokens;

    let escalated = false;
    if (shouldEscalate(result) && fallbackModel !== primaryModel) {
      escalated = true;
      const second = await callClaude(anthropicKey, fallbackModel, image);
      usage.input_tokens += second.usage.input_tokens;
      usage.output_tokens += second.usage.output_tokens;
      // keep the fallback unless it failed outright and the primary had something usable
      if (second.parsed || !result.parsed) result = second;
    }

    if (!result.parsed) {
      if (result.stop_reason === "refusal") throw new HttpError(422, "model refused to read this image");
      if (result.stop_reason === "max_tokens") throw new HttpError(422, "slip too long to parse");
      console.error("parse-slip: unusable model output", result.stop_reason ?? "unknown", result.model);
      throw new HttpError(502, "could not read this slip, try a clearer screenshot");
    }
    const parsed = result.parsed;

    // 7. match each leg against Propfein
    const today = todayInNewYork();
    const matches: LegMatchOut[] = await Promise.all(
      parsed.legs.map(async (leg): Promise<LegMatchOut> => {
        try {
          const r = await propfein.matchLeg(toMatchRequest(leg, today));
          return { match: r.best ?? null, alternates: r.alternates ?? [] };
        } catch (e) {
          console.warn("propfein.matchLeg failed", leg.selection, e instanceof Error ? e.message : e);
          return { match: null, alternates: [] };
        }
      }),
    );

    return json({
      parsed,
      matches,
      model_used: result.model,
      escalated,
      usage,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: e.message }, e.status);
    }
    if (e instanceof Error && e.message.startsWith("propfein_not_configured")) {
      console.error("parse-slip: propfein not configured", e.message);
      return json({ error: "propfein_not_configured" }, 500);
    }
    console.error("parse-slip unhandled", e);
    return json({ error: "internal error" }, 500);
  }
});
