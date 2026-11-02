# parse-slip evals

Measures how accurately the deployed `parse-slip` Edge Function reads real bet slip screenshots. Run it after any prompt, schema or model change; it is the gate for the slip parsing phase.

No images are checked in yet. CJ adds real screenshots (DraftKings and FanDuel first, per DECISIONS.md) and writes the expected JSON by hand. `evals/slips/draftkings/example.expected.json` shows the shape; it has no matching image so the harness skips it.

## Layout

```
evals/slips/<book>/<name>.jpg            screenshot (jpg, png or webp)
evals/slips/<book>/<name>.expected.json  ground truth
```

`<book>` matches the `sportsbook` enum: `draftkings`, `fanduel`, `caesars`, `betmgm`, `fanatics`, `other`. Crop screenshots the way the app will send them (whole slip, phone resolution). Strip anything personal before committing (account balance, username).

## expected.json shape

```json
{
  "book": "draftkings",
  "bet_type": "parlay",
  "stake": 10,
  "odds_american": 612,
  "potential_payout": 71.2,
  "legs": [
    { "market": "spread", "line": -3.5, "player_name": null, "selection": "Eagles -3.5" }
  ]
}
```

Only the compared fields are needed. Per leg: `market`, `line`, `player_name`, `selection`. Legs are compared by position, so list them in the order they appear on the slip. Strings are compared trimmed, lowercased, whitespace-collapsed; numbers to 2 decimals. `"N+" props` expect the .5 line (`250+` -> `249.5`).

## Run

```sh
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_ANON_KEY=...
export EVAL_USER_JWT=...     # access token of a throwaway test user
node --experimental-strip-types scripts/eval-parse.ts
```

Options: `--filter fanduel` runs one book; `--threshold 0.9` changes the pass bar (default 0.95).

Getting a JWT: sign in to the app as the test user and log `session.access_token`, or use the Supabase dashboard auth user -> "Generate link", or `supabase auth` via the JS client in a one-liner. Tokens expire after an hour; refresh when you see 401s.

## What it does

1. Uploads each image to the `slips` bucket at `<eval_user_id>/eval-<ts>.jpg` through the Storage REST API (RLS only allows your own folder, which is why the JWT is needed).
2. Calls `POST /functions/v1/parse-slip` with `{ storage_path, room_id }`. `room_id` is not read by the function today; `EVAL_ROOM_ID` overrides the placeholder.
3. Compares `book`, `bet_type`, `stake`, `odds_american`, `potential_payout`, `legs.length`, and per leg `market`, `line`, `player_name`, `selection`.
4. Deletes the uploaded object.
5. Prints per-slip results, a miss breakdown by field, token totals, and aggregate field accuracy. Exits 1 when any slip errors or accuracy is under the threshold.

Each run costs real Claude tokens (about 1.5k to 4k input per image on Haiku; more when it escalates to Sonnet). The summary prints the totals.

## Tips for building the set

- Aim for 20+ slips per book before trusting the number. Include singles, parlays, SGPs, player props with "N+" wording, moneylines (line null), and at least one with a visible game date.
- Include a couple of partial or cropped slips to see how confidence behaves; these can have loose expectations.
- When a slip consistently misses a field, fix the prompt or schema in `supabase/functions/parse-slip/`, redeploy, rerun.
