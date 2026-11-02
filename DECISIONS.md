# DECISIONS.md

Mirror of the Decisions table in the Last Leg Build Plan (Claude Doc). This file is law for any build session. Deviations get asked, not improvised.

| Area | Decision |
| --- | --- |
| Mobile | Expo SDK 58, Expo Router, TypeScript, development builds (not Expo Go) |
| Build/ship | Codemagic (same pipeline as propfein-ios): push to main -> `expo prebuild` on a Codemagic Mac -> signed with the existing App Store Connect integration -> TestFlight. `ios/` is generated, never committed. EAS is used only for `eas init` (project id for Expo push tokens), not for builds |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions (Deno), Realtime, pg_cron |
| Sports data | None stored locally. Propfein API only (`lib/api/propfein.types.ts` is the contract). Mock mode when `PROPFEIN_API_URL=mock` |
| Realtime | Supabase Broadcast on private `room:<id>` channels via `realtime.broadcast_changes` triggers. Never postgres_changes |
| Grader | pg_cron every 30s -> Edge Function `grade-legs`; idempotent; only works when a slate is live |
| Slip parsing | Screenshot -> private Storage -> Edge Function `parse-slip` -> Claude Haiku 5.5 JSON schema output, escalate to Sonnet 5.5 on low confidence |
| Push | expo-notifications; `notifications` table -> webhook -> Edge Function `send-push` -> fetch to exp.host |
| Auth | Sign in with Apple only in v1 (Supabase Apple provider, client id io.lastleg.app). Phone OTP parked until there are users (needs a paid SMS provider); helpers kept in lib/auth.tsx. Email magic link for dev. Decided 2026-11-02. |
| Navigation | 4 tabs + floating center "+" (add slip from anywhere, pick room after). Live (all your unsettled legs across rooms, sorted closest-to-cashing; push landing surface), Rooms, Community (weekly leaderboard across people in your rooms + friends feed of graded slips with one-tap reactions; nothing public, no strangers), You (W-L-P, profit, ROI with week/month/all, slip history, stats by book and parlay size, settings). No tips/articles, no public feed, no public profiles in v1. Decided 2026-11-02. |
| Record and profit | win = payout - stake; loss = -stake; push/void = 0 and excluded from staked total; pending excluded. ROI = profit / staked over win+loss slips. Unknown stake: counts for record, profit shows "based on N of M slips" and the slip is flagged "add stake". Never invent a stake. Leg hit rate shown as secondary stat. |
| Visual design | DESIGN.md is the source: amber (#FFB020) is the brand and the one-leg-away color only; ink #0A0B0D; Barlow + Barlow Condensed; sentence case, no all-caps labels, no gradients; the amber glow is the only shadow. |
| Slip import and tail | No account-credential sync in v1 (SharpSports ~$500/mo, manual refresh, DK ToS exposure). Order: share-link paste (og:image -> existing parser), tail v1 deep link to the book event page, Kalshi API-key linking, tail v2 pre-filled FanDuel slip once Propfein exposes book selection ids. Auto-placing bets is never built. See docs/research-slip-import-and-tail.md. Decided 2026-11-02. |
| Tail link | Plain sportsbook URLs in v1; no affiliate tags |
| App Store | LLC/Organization enrollment, 18+ override, US only, 21+ gate, RG footer |
| Not in v1 | Account sync (SharpSports), live player stats, premium, Android, chat beyond reactions, books beyond DK + FanDuel |
| Schema changes | Migrations only (`supabase/migrations`), applied with the Supabase CLI |
| Secrets | EAS environment variables (app) and `supabase secrets set` (functions). Never in the repo |

## Versions and limits

- Expo SDK 58 (2026-10-15), React Native 0.88, Node 22.13+
- Codemagic free tier: 500 build minutes/month; a Last Leg build is roughly 15 minutes
- Expo push: 100 messages/request, 600/sec/project, 4 KiB payload
- Supabase free: 200 realtime connections, 2M messages/mo, 500K function invocations
- Claude Haiku 5.5: $0.10/M input, $0.50/M output; ~4,000 tokens per full-res iPhone screenshot, ~1,450 at 1568px long edge
- Apple age tiers: 4+, 9+, 13+, 16+, 18+; gambling or frequent simulated gambling = 18+
