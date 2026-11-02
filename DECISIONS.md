# DECISIONS.md

Mirror of the Decisions table in the Group Sweat Build Plan (Claude Doc). This file is law for any build session. Deviations get asked, not improvised.

| Area | Decision |
| --- | --- |
| Mobile | Expo SDK 58, Expo Router, TypeScript, development builds (not Expo Go) |
| Build/ship | EAS Build + EAS Submit from Windows, free tier; EAS Update for JS changes |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions (Deno), Realtime, pg_cron |
| Sports data | None stored locally. Propfein API only (`lib/api/propfein.types.ts` is the contract). Mock mode when `PROPFEIN_API_URL=mock` |
| Realtime | Supabase Broadcast on private `room:<id>` channels via `realtime.broadcast_changes` triggers. Never postgres_changes |
| Grader | pg_cron every 30s -> Edge Function `grade-legs`; idempotent; only works when a slate is live |
| Slip parsing | Screenshot -> private Storage -> Edge Function `parse-slip` -> Claude Haiku 5.5 JSON schema output, escalate to Sonnet 5.5 on low confidence |
| Push | expo-notifications; `notifications` table -> webhook -> Edge Function `send-push` -> fetch to exp.host |
| Auth | Sign in with Apple + phone OTP; email magic link for dev |
| Tail link | Plain sportsbook URLs in v1; no affiliate tags |
| App Store | LLC/Organization enrollment, 18+ override, US only, 21+ gate, RG footer |
| Not in v1 | Account sync (SharpSports), live player stats, premium, Android, chat beyond reactions, books beyond DK + FanDuel |
| Schema changes | Migrations only (`supabase/migrations`), applied with the Supabase CLI |
| Secrets | EAS environment variables (app) and `supabase secrets set` (functions). Never in the repo |

## Versions and limits

- Expo SDK 58 (2026-10-15), React Native 0.88, Node 22.13+
- EAS free: 15 iOS builds/month, 45 min timeout
- Expo push: 100 messages/request, 600/sec/project, 4 KiB payload
- Supabase free: 200 realtime connections, 2M messages/mo, 500K function invocations
- Claude Haiku 5.5: $0.10/M input, $0.50/M output; ~4,000 tokens per full-res iPhone screenshot, ~1,450 at 1568px long edge
- Apple age tiers: 4+, 9+, 13+, 16+, 18+; gambling or frequent simulated gambling = 18+
