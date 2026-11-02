# Last Leg

Last Leg is a live "sweat room" for your group chat. Everyone screenshots their sportsbook slip and drops it in the room. The app reads the slip, matches each leg to tonight's games through the Propfein API, and grades every leg in real time across books. The board sorts itself by who is closest to cashing, a ticker shows every hit and miss as it happens, and a push fires when someone's parlay is one leg away. When the slate goes final there is a recap card to share back to the chat.

No bets are placed or taken here and no money moves through the app. There are no pots, entry fees or payouts. "Tail this bet" opens the sportsbook's home page with no affiliate tag. Last Leg stores no sports data of its own; events, scores and player stats are read from Propfein on demand. The stack is Expo SDK 58 (Expo Router, TypeScript, dev builds) on top of Supabase (Postgres, Auth, Storage, Edge Functions, Realtime Broadcast, pg_cron). iOS only in v1, 21+ gate, responsible gambling footer.

## Setup (Windows)

Prereqs: Node 22.13+, Git, an Expo account (free), an Apple Developer account for device builds. iOS builds run on EAS, so no Mac is needed.

```powershell
git clone <repo-url> lastleg
cd lastleg
npm install
npx expo install --fix        # aligns every native dep to the SDK 58 line
copy .env.example .env         # then fill in the Supabase URL and publishable key
npm run typecheck
```

This repo was authored without npm access, so `package.json` carries the SDK 58 ranges as of Nov 2026. `npx expo install --fix` is the source of truth: let it bump versions, then commit the lockfile it produces.

First device build:

```powershell
npm i -g eas-cli
eas login
eas build:configure           # links the project; paste the projectId into app.json extra.eas.projectId
eas device:create             # register your iPhone (UDID via the link it texts you)
eas build --platform ios --profile development
```

Install the build from the EAS link, then:

```powershell
npx expo start --dev-client
```

Push env vars to EAS for cloud builds so they are never in the repo:

```powershell
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://xxx.supabase.co --environment development
eas env:create --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value sb_publishable_xxx --environment development
```

The app never talks to Propfein directly and holds no Propfein key. Only the Edge Functions do, through `PROPFEIN_API_URL` (set with `supabase secrets set`); for local dev and the mock seed, set `PROPFEIN_API_URL=mock` together with `ALLOW_MOCK_PROPFEIN=true` in `supabase/functions/.env.local`.

## Supabase

Schema and policies live in `supabase/migrations/` and are applied with the CLI only:

```powershell
supabase link --project-ref <ref>
supabase db push
```

Edge Functions (`parse-slip`, `grade-legs`, `send-push`), their secrets and the grader schedule are documented in `supabase/functions/README.md`. Enable Sign in with Apple and Phone (SMS) providers in the Supabase dashboard; email magic link is for `__DEV__` only.

## Tests

The grading engine is plain TypeScript with no deps and runs on Node's built-in runner:

```powershell
npm run test:grading
```

## Layout

- `app/` Expo Router screens: `(auth)/sign-in`, `(app)/index` (rooms), `rooms/new`, `join`, `rooms/[id]` (board), `rooms/[id]/slip/[slipId]`, `rooms/[id]/recap/[slateId]`, `add-slip`, `profile`, plus `join/[code]` for deep links
- `components/` UI primitives (`ui/`), `SlipCard`, `Ticker`, `ConfirmSlip`, `RGFooter`
- `lib/` Supabase client, auth, realtime, slips pipeline, notifications, formatting; `lib/api/` is the Propfein contract and client; `lib/grading/` the grading engine
- `constants/` theme tokens and sportsbook tables
- `hooks/` data hooks for rooms, profiles and the slate board
- `supabase/` migrations and Edge Functions

## Phases

`DECISIONS.md` is the law for build sessions and lists what is and is not in v1. Phase gates and the checklist live in the Build Plan doc (see `NOTES.md`).
