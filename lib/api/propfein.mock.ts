/**
 * Deterministic mock data for the Propfein API.
 * Used when PROPFEIN_API_URL === "mock". Covers one NFL and one NBA game
 * in each of three states (scheduled, live, final) so the grader and the UI
 * can be exercised end to end without any network.
 */
import type {
  LegMatchRequest,
  LegMatchResponse,
  OddsResponse,
  PropfeinEvent,
  Sport,
} from "./propfein.types";

const now = () => new Date().toISOString();

export function mockEvents(sport: Sport, _date: string): PropfeinEvent[] {
  if (sport === "nfl") {
    return [
      {
        id: "nfl-mock-live",
        sport: "nfl",
        league: "NFL",
        home_team: { id: "t-phi", name: "Philadelphia Eagles", abbreviation: "PHI" },
        away_team: { id: "t-dal", name: "Dallas Cowboys", abbreviation: "DAL" },
        start_time: "2026-11-08T18:00:00Z",
        status: "live",
        period: 4,
        clock: "07:12",
        home_score: 24,
        away_score: 20,
        external_ids: { espn: "401772510" },
        player_stats: [
          { player_id: "p-hurts", name: "Jalen Hurts", team_id: "t-phi", stat_type: "passing_yards", value: 231 },
          { player_id: "p-hurts", name: "Jalen Hurts", team_id: "t-phi", stat_type: "passing_tds", value: 1 },
          { player_id: "p-hurts", name: "Jalen Hurts", team_id: "t-phi", stat_type: "rushing_tds", value: 1 },
          { player_id: "p-hurts", name: "Jalen Hurts", team_id: "t-phi", stat_type: "anytime_td", value: 1 },
          { player_id: "p-lamb", name: "CeeDee Lamb", team_id: "t-dal", stat_type: "receptions", value: 6 },
          { player_id: "p-lamb", name: "CeeDee Lamb", team_id: "t-dal", stat_type: "receiving_yards", value: 88 },
        ],
        updated_at: now(),
      },
      {
        id: "nfl-mock-final",
        sport: "nfl",
        league: "NFL",
        home_team: { id: "t-buf", name: "Buffalo Bills", abbreviation: "BUF" },
        away_team: { id: "t-mia", name: "Miami Dolphins", abbreviation: "MIA" },
        start_time: "2026-11-08T18:00:00Z",
        status: "final",
        period: 4,
        clock: "00:00",
        home_score: 31,
        away_score: 17,
        external_ids: { espn: "401772511" },
        player_stats: [
          { player_id: "p-allen", name: "Josh Allen", team_id: "t-buf", stat_type: "passing_yards", value: 298 },
          { player_id: "p-allen", name: "Josh Allen", team_id: "t-buf", stat_type: "passing_tds", value: 3 },
        ],
        updated_at: now(),
      },
      {
        id: "nfl-mock-scheduled",
        sport: "nfl",
        league: "NFL",
        home_team: { id: "t-kc", name: "Kansas City Chiefs", abbreviation: "KC" },
        away_team: { id: "t-lv", name: "Las Vegas Raiders", abbreviation: "LV" },
        start_time: "2026-11-09T01:20:00Z",
        status: "scheduled",
        period: null,
        clock: null,
        home_score: null,
        away_score: null,
        external_ids: { espn: "401772512" },
        updated_at: now(),
      },
    ];
  }
  return [
    {
      id: "nba-mock-live",
      sport: "nba",
      league: "NBA",
      home_team: { id: "t-nyk", name: "New York Knicks", abbreviation: "NYK" },
      away_team: { id: "t-bos", name: "Boston Celtics", abbreviation: "BOS" },
      start_time: "2026-11-02T00:30:00Z",
      status: "live",
      period: 3,
      clock: "04:55",
      home_score: 78,
      away_score: 81,
      external_ids: { espn: "401909896" },
      player_stats: [
        { player_id: "p-brunson", name: "Jalen Brunson", team_id: "t-nyk", stat_type: "points", value: 22 },
        { player_id: "p-brunson", name: "Jalen Brunson", team_id: "t-nyk", stat_type: "assists", value: 5 },
        { player_id: "p-tatum", name: "Jayson Tatum", team_id: "t-bos", stat_type: "points", value: 27 },
        { player_id: "p-tatum", name: "Jayson Tatum", team_id: "t-bos", stat_type: "rebounds", value: 8 },
      ],
      updated_at: now(),
    },
    {
      id: "nba-mock-final",
      sport: "nba",
      league: "NBA",
      home_team: { id: "t-lal", name: "Los Angeles Lakers", abbreviation: "LAL" },
      away_team: { id: "t-gsw", name: "Golden State Warriors", abbreviation: "GSW" },
      start_time: "2026-11-02T02:30:00Z",
      status: "final",
      period: 4,
      clock: "00:00",
      home_score: 112,
      away_score: 118,
      external_ids: { espn: "401909897" },
      player_stats: [
        { player_id: "p-curry", name: "Stephen Curry", team_id: "t-gsw", stat_type: "points", value: 34 },
        { player_id: "p-curry", name: "Stephen Curry", team_id: "t-gsw", stat_type: "threes", value: 7 },
      ],
      updated_at: now(),
    },
  ];
}

const TEAM_ALIASES: Record<string, { event: string; side: "home" | "away" }> = {
  eagles: { event: "nfl-mock-live", side: "home" },
  philadelphia: { event: "nfl-mock-live", side: "home" },
  cowboys: { event: "nfl-mock-live", side: "away" },
  dallas: { event: "nfl-mock-live", side: "away" },
  bills: { event: "nfl-mock-final", side: "home" },
  dolphins: { event: "nfl-mock-final", side: "away" },
  chiefs: { event: "nfl-mock-scheduled", side: "home" },
  raiders: { event: "nfl-mock-scheduled", side: "away" },
  knicks: { event: "nba-mock-live", side: "home" },
  celtics: { event: "nba-mock-live", side: "away" },
  lakers: { event: "nba-mock-final", side: "home" },
  warriors: { event: "nba-mock-final", side: "away" },
};

const PLAYER_ALIASES: Record<string, { event: string; player_id: string; team_id: string }> = {
  "jalen hurts": { event: "nfl-mock-live", player_id: "p-hurts", team_id: "t-phi" },
  "ceedee lamb": { event: "nfl-mock-live", player_id: "p-lamb", team_id: "t-dal" },
  "josh allen": { event: "nfl-mock-final", player_id: "p-allen", team_id: "t-buf" },
  "jalen brunson": { event: "nba-mock-live", player_id: "p-brunson", team_id: "t-nyk" },
  "jayson tatum": { event: "nba-mock-live", player_id: "p-tatum", team_id: "t-bos" },
  "stephen curry": { event: "nba-mock-final", player_id: "p-curry", team_id: "t-gsw" },
};

export function mockMatch(req: LegMatchRequest): LegMatchResponse {
  const text = `${req.selection} ${(req.teams ?? []).join(" ")} ${req.player ?? ""}`.toLowerCase();
  const isUnder = /\bunder\b|\bu\s?\d/.test(text);

  if (req.market === "player_prop") {
    const key = Object.keys(PLAYER_ALIASES).find((k) => text.includes(k));
    if (!key) return { best: null, alternates: [] };
    const p = PLAYER_ALIASES[key];
    const stat = req.stat_type ?? "points";
    const side = isUnder ? "under" : "over";
    return {
      best: {
        event_id: p.event,
        market_key: `prop:${stat}:${side}`,
        player_id: p.player_id,
        team_id: p.team_id,
        side,
        confidence: 0.93,
      },
      alternates: [],
    };
  }

  const teamKey = Object.keys(TEAM_ALIASES).find((k) => text.includes(k));
  if (!teamKey) return { best: null, alternates: [] };
  const t = TEAM_ALIASES[teamKey];

  if (req.market === "total") {
    const side = isUnder ? "under" : "over";
    return {
      best: { event_id: t.event, market_key: `total:${side}`, player_id: null, team_id: null, side, confidence: 0.9 },
      alternates: [],
    };
  }
  const market = req.market === "moneyline" ? "moneyline" : "spread";
  return {
    best: {
      event_id: t.event,
      market_key: `${market}:${t.side}`,
      player_id: null,
      team_id: null,
      side: t.side,
      confidence: 0.95,
    },
    alternates: [],
  };
}

export function mockOdds(params: {
  event_id: string;
  market_key: string;
  player_id?: string | null;
  line?: number | null;
}): OddsResponse {
  return {
    event_id: params.event_id,
    market_key: params.market_key,
    player_id: params.player_id ?? null,
    line: params.line ?? null,
    quotes: [
      { book: "draftkings", odds_american: -110, implied_prob: 0.524, fair_prob: 0.5, ev_percent: -4.5, deep_link: null },
      { book: "fanduel", odds_american: -105, implied_prob: 0.512, fair_prob: 0.5, ev_percent: -2.4, deep_link: null },
      { book: "betmgm", odds_american: 100, implied_prob: 0.5, fair_prob: 0.5, ev_percent: 0, deep_link: null },
    ],
    best_book: "betmgm",
    updated_at: now(),
  };
}
