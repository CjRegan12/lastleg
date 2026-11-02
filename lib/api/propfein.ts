/**
 * Typed Propfein API client, shared by the Expo app and the Edge Functions
 * (the Edge Functions import a copy from supabase/functions/_shared).
 *
 * Two modes:
 *  - live: hits PROPFEIN_API_URL with a bearer key
 *  - mock: returns deterministic fixtures so Last Leg can be built and
 *          tested before the Propfein API exists. Mock mode is selected when
 *          the base URL is "mock".
 */
import type {
  LegMatchRequest,
  LegMatchResponse,
  OddsResponse,
  PropfeinEvent,
  Sport,
} from "./propfein.types";
import { mockEvents, mockMatch, mockOdds } from "./propfein.mock";

export interface PropfeinClientOptions {
  baseUrl: string; // e.g. https://api.propfein.app, or "mock"
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class PropfeinApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PropfeinApiError";
    this.status = status;
    this.code = code;
  }
}

export class PropfeinClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  readonly isMock: boolean;

  constructor(opts: PropfeinClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.isMock = opts.baseUrl === "mock";
  }

  /** GET /v1/events?sport=&date=YYYY-MM-DD */
  async listEvents(sport: Sport, date: string): Promise<PropfeinEvent[]> {
    if (this.isMock) return mockEvents(sport, date);
    return this.get<PropfeinEvent[]>(`/v1/events?sport=${sport}&date=${date}`);
  }

  /** GET /v1/events/{id} (includes player_stats when available) */
  async getEvent(id: string): Promise<PropfeinEvent> {
    if (this.isMock) {
      const all = [...mockEvents("nfl", ""), ...mockEvents("nba", "")];
      const found = all.find((e) => e.id === id);
      if (!found) throw new PropfeinApiError(404, "not_found", `event ${id}`);
      return found;
    }
    return this.get<PropfeinEvent>(`/v1/events/${encodeURIComponent(id)}`);
  }

  /** POST /v1/legs/match */
  async matchLeg(req: LegMatchRequest): Promise<LegMatchResponse> {
    if (this.isMock) return mockMatch(req);
    return this.post<LegMatchResponse>(`/v1/legs/match`, req);
  }

  /** GET /v1/odds?event_id=&market=&player_id=&line= */
  async getOdds(params: {
    event_id: string;
    market_key: string;
    player_id?: string | null;
    line?: number | null;
  }): Promise<OddsResponse> {
    if (this.isMock) return mockOdds(params);
    const q = new URLSearchParams({ event_id: params.event_id, market: params.market_key });
    if (params.player_id) q.set("player_id", params.player_id);
    if (params.line != null) q.set("line", String(params.line));
    return this.get<OddsResponse>(`/v1/odds?${q.toString()}`);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let code = "http_error";
      let message = `${method} ${path} -> ${res.status}`;
      try {
        const j = (await res.json()) as { error?: { code?: string; message?: string } };
        code = j.error?.code ?? code;
        message = j.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new PropfeinApiError(res.status, code, message);
    }
    return (await res.json()) as T;
  }
}

/**
 * Build a client from environment. Works in Expo (EXPO_PUBLIC_*) and Deno (Deno.env).
 *
 * Fails closed: an unset URL resolves to "mock", and mock mode is refused unless
 * ALLOW_MOCK_PROPFEIN=true is set alongside it. A production deploy that forgot
 * PROPFEIN_API_URL must crash, not quietly grade real slips against fixtures.
 */
export function propfeinFromEnv(env: Record<string, string | undefined>): PropfeinClient {
  const baseUrl = env.PROPFEIN_API_URL ?? env.EXPO_PUBLIC_PROPFEIN_API_URL ?? "mock";
  if (baseUrl === "mock" && env.ALLOW_MOCK_PROPFEIN !== "true") {
    throw new Error(
      "propfein_not_configured: PROPFEIN_API_URL is unset or 'mock'; set a real URL or ALLOW_MOCK_PROPFEIN=true for dev",
    );
  }
  const apiKey = env.PROPFEIN_API_KEY ?? "";
  return new PropfeinClient({ baseUrl, apiKey });
}
