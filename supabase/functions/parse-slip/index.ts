/**
 * parse-slip: screenshot in private Storage -> Claude structured output -> Propfein leg matches.
 *
 * Deploy with verify_jwt ON (default): `supabase functions deploy parse-slip`.
 * The caller is the signed-in user; we re-verify them via auth.getUser() and
 * require the storage path to live in their own folder.
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
import { isParsedSlip, SLIP_SCHEMA, STAT_TYPES, type ParsedLeg, type ParsedSlip } from "./schema.ts";

// ---------- config ----------
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const BUCKET = "slips";
const SIGNED_URL_TTL_SECONDS = 60;
const MAX_TOKENS = 2000;
const ESCALATE_BELOW_CONFIDENCE = 0.8;
const ESCALATE_ABOVE_LEGS = 4;
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

async function callClaude(apiKey: string, model: string, imageUrl: string): Promise<ClaudeCallResult> {
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: imageUrl } },
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
    let message = `Claude API ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { type?: string; message?: string } };
      if (err.error?.message) message = `Claude API ${res.status}: ${err.error.type ?? "error"}: ${err.error.message}`;
    } catch {
      /* non-JSON error body */
    }
    throw new HttpError(502, message);
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
  return { parsed, stop_reason: data.stop_reason, model: data.model ?? model, usage };
}

function shouldEscalate(r: ClaudeCallResult): boolean {
  if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return true;
  if (!r.parsed) return true;
  if (r.parsed.overall_confidence < ESCALATE_BELOW_CONFIDENCE) return true;
  if (r.parsed.legs.length > ESCALATE_ABOVE_LEGS) return true;
  return false;
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

    // 3. signed URL for the image (service role; bucket is private)
    const admin = createClient(supabaseUrl, env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      throw new HttpError(400, `could not sign image url: ${signErr?.message ?? "unknown"}`);
    }

    // 4. Claude, primary then fallback
    const anthropicKey = env("ANTHROPIC_API_KEY");
    const primaryModel = Deno.env.get("PARSE_MODEL_PRIMARY") ?? "claude-haiku-5-5";
    const fallbackModel = Deno.env.get("PARSE_MODEL_FALLBACK") ?? "claude-sonnet-5-5";

    const usage: ClaudeUsage = { input_tokens: 0, output_tokens: 0 };
    let result = await callClaude(anthropicKey, primaryModel, signed.signedUrl);
    usage.input_tokens += result.usage.input_tokens;
    usage.output_tokens += result.usage.output_tokens;

    let escalated = false;
    if (shouldEscalate(result) && fallbackModel !== primaryModel) {
      escalated = true;
      const second = await callClaude(anthropicKey, fallbackModel, signed.signedUrl);
      usage.input_tokens += second.usage.input_tokens;
      usage.output_tokens += second.usage.output_tokens;
      // keep the fallback unless it failed outright and the primary had something usable
      if (second.parsed || !result.parsed) result = second;
    }

    if (!result.parsed) {
      if (result.stop_reason === "refusal") throw new HttpError(422, "model refused to read this image");
      if (result.stop_reason === "max_tokens") throw new HttpError(422, "slip too long to parse");
      throw new HttpError(502, `model returned unusable output (${result.stop_reason ?? "unknown"})`);
    }
    const parsed = result.parsed;

    // 5. match each leg against Propfein
    const propfein = propfeinFromEnv(Deno.env.toObject());
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
    console.error("parse-slip unhandled", e);
    return json({ error: "internal error" }, 500);
  }
});
