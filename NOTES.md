# lastleg: share-sheet slip input and Phase 3 gate (1)

## Done this session
- Launch crash fixed for good: (app) layout gates on session at render time; Expo Router ErrorBoundary added. App opens, Sign in with Apple works (Supabase Apple provider enabled, client id io.lastleg.app), welcome screen picks a handle (migration 0005 `onboarded_at`, applied live).
- Phone OTP removed from sign-in (parked until users; helpers kept in lib/auth.tsx).
- Four-tab shell (Live, Rooms, +, Community, You) on expo-router/js-tabs with a custom bar, SF Symbols, haptics. Design system per DESIGN.md (ink, amber only for one-leg-away, Barlow/Barlow Condensed, `<T>`). All inner screens restyled (Phase 5). Reviewer caught and we fixed DST-wrong period math (lib/stats.ts, 19 tests).
- parse-slip deployed and working end to end from the phone (screenshot -> parse -> confirm -> save). Secrets set: ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID, PROPFEIN_API_URL=mock, ALLOW_MOCK_PROPFEIN=true (dated exception in DECISIONS.md; grader not deployed while mock is on).
- Share-link import: parse-slip accepts `share_url` (allow-listed sportsbook hosts -> og:image -> stored in the user's folder -> same parser); add-slip leads with a link field; client surfaces real function errors. Pushed to main as build 9 (not yet verified on device).
- Share-sheet extension built on branch `share-extension` (expo-share-intent 9, +native-intent, app/(app)/share.tsx, pick-room forwards url/image). Not merged: waits on Apple portal steps.
- Research docs: docs/research-slip-import-and-tail.md (auto-import, tail, Kalshi) and the share-extension findings summarized in CLAUDE.md gotchas.

## Decisions and why
- See DECISIONS.md rows added today: Navigation, Record and profit, Visual design, Slip input (share sheet primary), Slip import and tail (no credential sync in v1, Kalshi/Polymarket linking is the real auto-import path), Temporary mock-Propfein exception, Auth (Apple only).
- Tailgate comparison: it places trades on Polymarket/Kalshi via their APIs, which is why it "has" every parlay; sportsbooks offer nothing comparable, so share sheet is the FanDuel/DK ceiling.

## Next steps
1. Verify build 9 on device: FanDuel/DK placed bet -> Share -> Copy link -> Add slip -> paste -> Read this slip. If "no slip preview on that page", inspect the share page HTML (FanDuel share URLs look like `https://account.sportsbook.fanduel.com/sportsbook/addToBetslip?shareCode=...`) and adjust `findPreviewImage` / host list in `supabase/functions/parse-slip/index.ts`, then CJ runs `npx supabase functions deploy parse-slip`.
2. When CJ reports the 4 Apple portal steps done (App Group, App ID capability + regenerated `lastleg_app_store`, extension App ID, `lastleg_share_ext_app_store` uploaded to Codemagic): `git merge share-extension` into main, have CJ run `npm install --legacy-peer-deps` and commit the lockfile, watch the Codemagic log for `ShareExtension/` in `ls ios` and the use-profiles step. Then test Share -> Last Leg from FanDuel and from Photos.
3. Still-unverified gate step: join a room from a second phone with the invite code (`app/(app)/join.tsx`, `app/join/[code].tsx`).
4. Next feature phases in order: tail v1 deep links (needs Propfein event ids), Kalshi API-key linking, reactions on the Community feed (needs a `slip_reactions` migration; run schema-guard first), tail v2 pre-filled FanDuel slip once Propfein exposes selection ids.
5. Infra still pending: `eas init` for push projectId + APNs key; deploy grade-legs/send-push/check-receipts only after the real Propfein API replaces mock; buy lastleg.io; LLC / Apple org.

## Open questions for the user
- Did the second-phone join work?
- Has he done the Apple portal steps for the share extension?
- Propfein API timeline (unblocks grading, leg matching, tail links).

## Files touched
- app/_layout.tsx: fonts, ErrorBoundary, (share-extension branch: ShareIntentProvider)
- app/(app)/_layout.tsx: session gate, onboarding gate, new routes (tabs, pick-room, welcome, share)
- app/(app)/(tabs)/*: new Live, Rooms, Community, You screens; components/TabBar.tsx
- app/(app)/welcome.tsx, pick-room.tsx, add-slip.tsx (link + shared image), share.tsx (branch)
- app/(auth)/sign-in.tsx: Apple only, restyled
- components/ui/*, components/FeedSlipCard.tsx, SlipCard.tsx, ConfirmSlip.tsx, Ticker.tsx, RGFooter.tsx: design system
- constants/theme.ts, DESIGN.md, assets/fonts/*
- hooks/useSlipFeed.ts, lib/stats.ts (+tests), lib/slips.ts (link parse, error unwrapping), lib/database.types.ts (onboarded_at)
- supabase/migrations/20261102000005_onboarding.sql; supabase/functions/parse-slip/index.ts (workspace header, share_url)
- codemagic.yaml (changeset, npm ci fallback), package.json (expo-symbols, expo-haptics; branch adds expo-share-intent), app.json (splash color; branch adds plugin)
- DECISIONS.md, docs/research-slip-import-and-tail.md, CLAUDE.md
