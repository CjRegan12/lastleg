# lastleg: first TestFlight build shipped via Codemagic (2)

## Done this session
- Full v1 repo authored at /home/claude/lastleg (cloud container; npm registry and Deno were unreachable, so nothing was installed or executed except the grading tests on Node 22).
- Propfein API contract (`lib/api/propfein.types.ts`), typed client with mock mode, mirrored into `supabase/functions/_shared/`.
- Three migrations: schema (enums, tables, triggers, invite codes), RLS (column grants, insert guard triggers on slips and legs, `me` view, RPCs create_room / join_room / ensure_slate / override_leg / rollup_slip), views + broadcast triggers + storage bucket + cron cleanup. Seed with 2 users / 1 room / 4 slips / 12 legs. pgTAP RLS test with 17 assertions.
- Grading engine `lib/grading/grade.ts` (gradeLeg, rollupSlip, detectTransitions), 77 tests incl. a 6-snapshot replay. All pass.
- Edge Functions: grade-legs (30s cron, CAS updates, rollup via RPC, room_events, notifications with dedupe), parse-slip (Claude Haiku 5.5 structured output, Sonnet escalation, base64 image, membership check), send-push (claim + Expo push), check-receipts.
- Expo SDK 58 app: auth (Apple, phone OTP, dev magic link, 21+ gate), rooms list/create/join + deep link, room board with ticker and upcoming slates, slip card w/ one-away pulse, slip detail with override + tail, add-slip with parse confirm screen, recap + share card, profile. Dark theme, RG footer.
- Two independent review rounds; 11 + 6 blocking findings fixed; final verification PASS.
- Build Plan doc updated with a "Build status" section.

## Decisions and why
- See DECISIONS.md (mirror of the Build Plan Decisions table).
- Product calls made during build: one_away only for parlays (legs_total > 1); slips land on the slate of their earliest game date, clamped [today-1, today+10]; parser escalates only on low confidence/refusal; functions fail closed without PROPFEIN_API_URL (ALLOW_MOCK_PROPFEIN=true for dev); other users see only handle/avatar, own profile via `me` view.

## Infra status (2026-11-02 afternoon)
- GitHub: CjRegan12/lastleg, main. CJ's clone: C:\Users\regan\source\repos\lastleg. Deps pinned by `expo install` (SDK 58, RN 0.88.1, react 19.3.0, reanimated 4.7.1 + react-native-worklets 0.13).
- Supabase: project `lastleg` ref pdumwhkssabbnfoqwftj. Migrations 0001-0004 applied live, seed loaded, 18 RLS assertions pass against the real DB. Found and fixed one real bug (override_leg enum cast). Security advisor clean except intentional items.
- Build: Codemagic (not EAS), app id 6ae8ebf18891436486b5b2a7, workflow ios-testflight, webhook on push to main, env group `lastleg`, profile `lastleg_app_store` fetched from Apple (hand-made "Last Leg App Store" profile on cert expiring 2027-09-30). Build #4 (commit 730f7b3) succeeded: LastLeg.ipa published to App Store Connect / TestFlight.

## Next steps
1. CJ installs from TestFlight, reports first-run issues. Expect UI/device bugs; fix, push, Codemagic rebuilds automatically.
2. `git diff app.json` on CJ's PC has an uncommitted change from stash pop; decide keep/discard.
3. `eas init` once (free) so Expo push tokens have a projectId; then upload the APNs key to Expo (`eas credentials`) for pushes to work.
4. Deploy functions per `supabase/functions/README.md`; set secrets; run `scripts/schedule-grader.sql`. Smoke-test grade-legs against the seed with PROPFEIN_API_URL=mock ALLOW_MOCK_PROPFEIN=true.
5. Propfein side: implement the 4 endpoints in Build Plan Phase 1 (contract in lib/api/propfein.types.ts).
6. Collect 20 real DK/FanDuel slip screenshots into evals/slips and run `node --experimental-strip-types scripts/eval-parse.ts`.

## Open questions for the user
- Name decided 2026-11-02: Last Leg, domain lastleg.io (buy it), bundle id io.lastleg.app, scheme lastleg://. GitHub repo should be CjRegan12/lastleg.
- Confirm the product calls above.
- Keep browsing-forward ensure_slate behavior (creates empty future slates) or switch future dates to read-only select.

## Files touched
- Entire repo (76 files); see `git log` for the three commits.
