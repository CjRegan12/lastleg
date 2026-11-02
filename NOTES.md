# group-sweat: v1 codebase written and reviewed, awaiting infra (1)

## Done this session
- Full v1 repo authored at /home/claude/group-sweat (cloud container; npm registry and Deno were unreachable, so nothing was installed or executed except the grading tests on Node 22).
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

## Next steps
1. CJ: create empty GitHub repo CjRegan12/group-sweat, then push from /home/claude/group-sweat (`git remote add origin ... && git push -u origin main`). Or re-run with folder access so the repo lands in C:\Users\regan\source\repos.
2. CJ: resolve the Supabase project creation (free plan cap: inkbook + edgefinder already active). Then `supabase link`, `supabase db push`, `supabase db reset` (local) and `supabase test db` to run the 17 RLS assertions. Fix anything that fails; nothing SQL has been executed yet.
3. On Windows: `npm install`, `npx expo install --fix`, `npm run typecheck`. Expect a handful of type errors from hand-written supabase-js relation types; regenerate `lib/database.types.ts` with `supabase gen types typescript --linked` after db push.
4. Deploy functions per `supabase/functions/README.md`; set secrets; run `scripts/schedule-grader.sql`. Smoke-test grade-legs against the seed with PROPFEIN_API_URL=mock ALLOW_MOCK_PROPFEIN=true.
5. Propfein side: implement the 4 endpoints in Build Plan Phase 1 (contract in lib/api/propfein.types.ts).
6. Collect 20 real DK/FanDuel slip screenshots into evals/slips and run `node --experimental-strip-types scripts/eval-parse.ts`.

## Open questions for the user
- App name (Group Sweat is a placeholder); bundle id is com.groupsweat.app placeholder.
- Confirm the product calls above.
- Keep browsing-forward ensure_slate behavior (creates empty future slates) or switch future dates to read-only select.

## Files touched
- Entire repo (76 files); see `git log` for the three commits.
