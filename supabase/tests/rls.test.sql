-- RLS tests for Group Sweat. Run with: supabase test db
-- Requires pgTAP (enabled by `supabase test db`). Uses seed data ids.
begin;
select plan(11);

-- helper: impersonate a user
create or replace function test_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- a third user who is NOT in the room
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.com', now(), now());

-- 1. member sees the room
select test_as('00000000-0000-0000-0000-000000000001');
select is((select count(*) from rooms where id = '10000000-0000-0000-0000-000000000001'), 1::bigint, 'member can read room');

-- 2. member sees slips in the room
select is((select count(*) from slips where room_id = '10000000-0000-0000-0000-000000000001'), 4::bigint, 'member sees all 4 slips');

-- 3. outsider sees nothing
select test_as('00000000-0000-0000-0000-000000000003');
select is((select count(*) from rooms), 0::bigint, 'outsider sees zero rooms');
select is((select count(*) from slips), 0::bigint, 'outsider sees zero slips');
select is((select count(*) from legs), 0::bigint, 'outsider sees zero legs');

-- 4. outsider cannot insert a slip into the room
select throws_ok(
  $$ insert into slips (user_id, room_id, slate_id, book, bet_type, stake, odds_american, potential_payout)
     values ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'draftkings', 'single', 10, -110, 19.09) $$,
  '42501', null, 'outsider cannot insert slip');

-- 5. member cannot update another member's slip
select test_as('00000000-0000-0000-0000-000000000002');
update slips set stake = 999 where id = '30000000-0000-0000-0000-000000000001';
select is((select stake from slips where id = '30000000-0000-0000-0000-000000000001'), 25.00::numeric, 'mike cannot change cj stake');

-- 6. member cannot directly change a leg status (no update policy)
update legs set status = 'won' where slip_id = '30000000-0000-0000-0000-000000000001' and status = 'live';
select is((select count(*) from legs where slip_id = '30000000-0000-0000-0000-000000000001' and status = 'live'), 1::bigint, 'direct leg status update is a no-op under RLS');

-- 7. override_leg works for a peer and is logged
select lives_ok(
  $$ select override_leg((select id from legs where slip_id = '30000000-0000-0000-0000-000000000001' and status = 'live'), 'won', 'saw it live') $$,
  'peer can override via RPC');
select is((select count(*) from leg_overrides where room_id = '10000000-0000-0000-0000-000000000001'), 1::bigint, 'override logged');

-- 8. leg_overrides are append only (RLS filters the delete to zero rows)
delete from leg_overrides where room_id = '10000000-0000-0000-0000-000000000001';
select is((select count(*) from leg_overrides where room_id = '10000000-0000-0000-0000-000000000001'), 1::bigint, 'cannot delete overrides');

select * from finish();
rollback;
