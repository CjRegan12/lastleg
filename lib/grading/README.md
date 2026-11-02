# Grading engine

Pure functions that turn a Propfein event plus a leg into a grade. No I/O, no Supabase, no Deno, so the same code runs in the Expo app (optimistic display) and in the `grade-legs` Edge Function (`supabase/functions/_shared/grade.ts` is a copy of `grade.ts` with only the import path changed; keep them in sync).

## How a leg is graded (`gradeLeg`)

1. Event `postponed` or `canceled` -> `needs_review` (a human voids or re-matches it).
2. `team_prop` / `other` are never auto-graded: `pending` while scheduled, `live` during the game, `needs_review` at final.
3. Missing `side`, wrong side for the market, or missing `line` (spread, total, player prop) -> `needs_review`.
4. Event `scheduled` -> `pending`.
5. Event `live` -> `live` with `current_value`: spread = side score + line - opponent, moneyline = margin, total = combined score, player prop = current stat value (null if Propfein has no stat yet).
6. Event `final` -> `won` / `lost` / `push`. Exactly equal is a push (only possible on whole-number lines). A player prop whose stat is missing at final is `needs_review`.

The grader never emits `void`; only `override_leg()` does.

## Slip rollup and feed events

`rollupSlip(legStatuses)` mirrors the SQL `rollup_slip()` exactly: any lost -> lost; any open leg -> live if a leg is live else pending; any won -> won; all void/push -> void. `detectTransitions()` turns a before/after pair into room events: `leg_hit`, `leg_lost`, `slip_dead`, `cashed`, and `one_away` (slip live, legs_remaining goes from >1 to exactly 1).

## Tests

```
node --experimental-strip-types --test lib/grading/grade.test.ts lib/grading/replay.test.ts
```

No dependencies. `grade.test.ts` covers every market and rollup/transition case; `replay.test.ts` drives a 3-leg parlay through six snapshots and asserts `one_away` and `cashed` fire exactly once.
