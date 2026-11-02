# Group Sweat

Live group bet-slip "sweat room": friends drop sportsbook slips, legs are graded in real time across books, pushes fire when a parlay is one leg away. No bets taken, no money held.

## Rules for any session
- `DECISIONS.md` is law. Deviate only after asking.
- Group Sweat stores no sports data. `lib/api/propfein.types.ts` is the Propfein API contract; `PROPFEIN_API_URL=mock` runs everything against fixtures.
- Schema changes are migrations in `supabase/migrations/` only. Never edit the dashboard by hand.
- Secrets never enter the repo. App: EAS env vars / `.env` (gitignored). Functions: `supabase secrets set`.
- Realtime is Broadcast on private `room:<id>` channels. Never postgres_changes.
- Finish a phase at its gate (see Build Plan doc), run its checks, then hand off with `/no-dumb-zone:handoff`.

## Commands
- `npm install` then `npx expo install --fix` (aligns native deps to SDK 58)
- `npx expo start --dev-client` after a dev build is on the phone
- `eas build --platform ios --profile development` (first time: `eas device:create`)
- `npm run test:grading` runs the grading engine tests on Node's built-in runner (no deps)
- `supabase db push` applies migrations; `supabase db reset` wipes local and reseeds; `supabase test db` runs `supabase/tests/*.sql`
- Functions: see `supabase/functions/README.md`

## Gotchas
- This repo was authored without npm access; the first `npm install` + `npx expo install --fix` on Windows may bump versions. Commit the lockfile it produces.
- `realtime.messages` RLS must not be enabled via migration (Supabase manages it); only add policies.
- The grader needs `GRADER_SECRET`, the push sender `WEBHOOK_SECRET`. Schedule the grader with `scripts/schedule-grader.sql` after the first deploy.
- Free Supabase plan allows 2 active projects; CJ already has inkbook and edgefinder.
