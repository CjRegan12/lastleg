-- Group Sweat: RLS policies and RPCs
-- Rule: everything scoped by room_id is visible only to room members.
-- Grader, parser and push sender run as service role and bypass RLS by design.

-- ---------- helper ----------
create or replace function is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;
grant execute on function is_room_member(uuid) to authenticated;

-- ---------- enable RLS ----------
alter table profiles enable row level security;
alter table rooms enable row level security;
alter table room_members enable row level security;
alter table slates enable row level security;
alter table slips enable row level security;
alter table legs enable row level security;
alter table leg_overrides enable row level security;
alter table parse_corrections enable row level security;
alter table room_events enable row level security;
alter table tails enable row level security;
alter table notifications enable row level security;

-- ---------- profiles ----------
-- Row policy lets everyone read everyone, but column grants hide the private
-- columns (push_token, premium_until, quiet hours, age_confirmed_at). The owner
-- reads their own full row through the `me` view below.
revoke select on profiles from authenticated, anon;
grant select (id, handle, avatar_url, created_at) on profiles to authenticated;
create policy "profiles: anyone authenticated can read"
  on profiles for select to authenticated using (true);

-- Owner may change only these columns. premium_until is service role only;
-- age_confirmed_at stays owner-settable because it is a self-declaration.
revoke update on profiles from authenticated, anon;
grant update (handle, avatar_url, push_token, quiet_hours_start, quiet_hours_end, age_confirmed_at)
  on profiles to authenticated;
create policy "profiles: update own"
  on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Full own-row read. Deliberately NOT security_invoker: column grants are
-- table-wide, so an invoker view would be denied the private columns too. The
-- view runs as its owner and the hard-coded `id = auth.uid()` filter is the
-- only thing that scopes it, which is exactly the owner-only read we want.
create view public.me
with (security_invoker = false)
as select * from profiles where id = auth.uid();
revoke all on public.me from public, anon;
grant select on public.me to authenticated;
-- A security_definer view over a single table is auto-updatable in Postgres:
-- writes through it would run as the view owner and bypass both RLS and the
-- profiles column grants (premium_until, for one). Strip every write privilege
-- so `me` is strictly read-only. UPDATEs go to `profiles` directly.
revoke insert, update, delete, truncate, references, trigger on public.me
  from authenticated, anon, public;

-- ---------- rooms ----------
create policy "rooms: members read"
  on rooms for select to authenticated using (is_room_member(id));
create policy "rooms: owner updates"
  on rooms for update to authenticated
  using (exists (select 1 from room_members m where m.room_id = rooms.id and m.user_id = auth.uid() and m.role = 'owner'))
  with check (exists (select 1 from room_members m where m.room_id = rooms.id and m.user_id = auth.uid() and m.role = 'owner'));
-- inserts go through create_room() RPC so the owner row is created atomically

-- ---------- room_members ----------
create policy "room_members: members read"
  on room_members for select to authenticated using (is_room_member(room_id));
create policy "room_members: leave own"
  on room_members for delete to authenticated using (user_id = auth.uid() and role <> 'owner');
-- joins go through join_room() RPC (needs invite code)

-- ---------- slates ----------
create policy "slates: members read"
  on slates for select to authenticated using (is_room_member(room_id));
-- slates are created by ensure_slate() RPC

-- ---------- slips ----------
create policy "slips: members read"
  on slips for select to authenticated using (is_room_member(room_id));
create policy "slips: insert own in a room you belong to"
  on slips for insert to authenticated
  with check (user_id = auth.uid() and is_room_member(room_id));
-- Owner edits a pending slip's metadata only. status/legs_*/settled_at are the
-- grader's (service role); room_id/slate_id/user_id are fixed at insert. Column
-- grants enforce the column list, the policy enforces pending + same room.
revoke update on slips from authenticated, anon;
grant update (book, bet_type, stake, odds_american, potential_payout, screenshot_path, parsed_json, parse_confidence)
  on slips to authenticated;
create policy "slips: owner updates own pending slip"
  on slips for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and is_room_member(room_id));
create policy "slips: delete own while pending"
  on slips for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');
-- Client inserts cannot pick their own status or grading columns, and the slate
-- they point at must belong to the same room and still be gradeable. The legs
-- insert (and rollup_slip) sets legs_total/legs_remaining afterwards.
-- Service role (grader, parser) and postgres (migrations, seed, tests) are trusted.
create or replace function slips_before_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claims text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role text;
  sl slates;
begin
  jwt_role := case when claims is null then null else claims::jsonb->>'role' end;
  -- null role = no JWT (postgres/migrations/seed); service_role = trusted backend
  if jwt_role is null or jwt_role = 'service_role' then
    return new;
  end if;

  select * into sl from slates where id = new.slate_id;
  if sl.id is null then
    raise exception 'slate % not found', new.slate_id using errcode = 'P0002';
  end if;
  if sl.room_id is distinct from new.room_id then
    raise exception 'slate belongs to another room' using errcode = '42501';
  end if;
  if sl.status = 'final' then
    raise exception 'cannot add a slip to a final slate' using errcode = '42501';
  end if;

  new.status := 'pending'::slip_status;
  new.legs_total := 0;
  new.legs_remaining := 0;
  new.settled_at := null;
  return new;
end;
$$;
create trigger slips_before_insert_guard
  before insert on slips
  for each row execute function slips_before_insert_guard();

-- Because the guard zeroes legs_total/legs_remaining on client inserts, keep
-- them in sync as legs are added or removed. Same math as rollup_slip for those
-- two columns; status stays the grader's. Statement-level so a multi-row legs
-- insert updates each slip (and fires slips_broadcast) once.
create or replace function slips_sync_leg_counts(p_slip_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update slips s
     set legs_total = c.n_total,
         legs_remaining = c.n_open
    from (
      select sl.id,
             count(l.id)::int as n_total,
             count(l.id) filter (where l.status in ('pending', 'live', 'needs_review'))::int as n_open
        from slips sl
        left join legs l on l.slip_id = sl.id
       where sl.id = any (p_slip_ids)
       group by sl.id
    ) c
   where s.id = c.id
     and (s.legs_total <> c.n_total or s.legs_remaining <> c.n_open);
$$;
revoke execute on function slips_sync_leg_counts(uuid[]) from public, anon, authenticated;

create or replace function legs_after_insert_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform slips_sync_leg_counts((select array_agg(distinct slip_id) from new_legs));
  return null;
end;
$$;
create trigger legs_after_insert_sync
  after insert on legs
  referencing new table as new_legs
  for each statement execute function legs_after_insert_sync();

create or replace function legs_after_delete_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform slips_sync_leg_counts((select array_agg(distinct slip_id) from old_legs));
  return null;
end;
$$;
create trigger legs_after_delete_sync
  after delete on legs
  referencing old table as old_legs
  for each statement execute function legs_after_delete_sync();

-- ---------- legs ----------
create policy "legs: members read"
  on legs for select to authenticated using (is_room_member(room_id));
create policy "legs: insert on own slip"
  on legs for insert to authenticated
  with check (exists (select 1 from slips s where s.id = slip_id and s.user_id = auth.uid()) and is_room_member(room_id));
-- Client inserts cannot pick their own room_id, status or grading columns.
-- Service role (grader, parser) and postgres (migrations, seed, tests) are trusted.
create or replace function legs_before_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claims text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role text;
  parent slips;
begin
  jwt_role := case when claims is null then null else claims::jsonb->>'role' end;
  -- null role = no JWT (postgres/migrations/seed); service_role = trusted backend
  if jwt_role is null or jwt_role = 'service_role' then
    return new;
  end if;

  select * into parent from slips where id = new.slip_id;
  if parent.id is null then
    raise exception 'slip % not found', new.slip_id using errcode = 'P0002';
  end if;
  if parent.user_id is distinct from auth.uid() then
    raise exception 'cannot add legs to another user''s slip' using errcode = '42501';
  end if;
  if parent.status <> 'pending' then
    raise exception 'cannot add legs to a slip that is not pending' using errcode = '42501';
  end if;

  new.room_id := parent.room_id;
  new.status := case when new.propfein_event_id is null then 'needs_review'::leg_status else 'pending'::leg_status end;
  new.graded_by := null;
  new.graded_at := null;
  new.current_value := null;
  return new;
end;
$$;
create trigger legs_before_insert_guard
  before insert on legs
  for each row execute function legs_before_insert_guard();
-- status changes by clients go through override_leg() RPC; grader is service role
create policy "legs: delete on own pending slip"
  on legs for delete to authenticated
  using (exists (select 1 from slips s where s.id = slip_id and s.user_id = auth.uid() and s.status = 'pending'));

-- ---------- leg_overrides (append only) ----------
create policy "leg_overrides: members read"
  on leg_overrides for select to authenticated using (is_room_member(room_id));
-- inserts via override_leg() RPC only; no update/delete policies -> denied

-- ---------- parse_corrections (append only) ----------
create policy "parse_corrections: insert own"
  on parse_corrections for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from slips s where s.id = slip_id and s.user_id = auth.uid())
  );
create policy "parse_corrections: read own"
  on parse_corrections for select to authenticated using (user_id = auth.uid());

-- ---------- room_events ----------
create policy "room_events: members read"
  on room_events for select to authenticated using (is_room_member(room_id));
-- inserts by service role only

-- ---------- tails ----------
create policy "tails: members read"
  on tails for select to authenticated
  using (exists (select 1 from slips s where s.id = slip_id and is_room_member(s.room_id)));
create policy "tails: insert own"
  on tails for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from slips s where s.id = slip_id and is_room_member(s.room_id)));

-- ---------- notifications ----------
create policy "notifications: read own"
  on notifications for select to authenticated using (user_id = auth.uid());

-- =====================================================================
-- RPCs
-- =====================================================================

-- Create a room and make the caller its owner, atomically.
create or replace function create_room(p_name text)
returns rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into rooms (name, invite_code, created_by)
  values (p_name, generate_invite_code(), auth.uid())
  returning * into r;
  insert into room_members (room_id, user_id, role) values (r.id, auth.uid(), 'owner');
  return r;
end;
$$;
grant execute on function create_room(text) to authenticated;

-- Join a room by invite code. Idempotent.
create or replace function join_room(p_invite_code text)
returns rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into r from rooms where invite_code = upper(p_invite_code);
  if r.id is null then raise exception 'invalid invite code' using errcode = 'P0002'; end if;
  insert into room_members (room_id, user_id, role)
  values (r.id, auth.uid(), 'member')
  on conflict do nothing;
  return r;
end;
$$;
grant execute on function join_room(text) to authenticated;

-- Get or create the slate for a room on a date (America/New_York by default).
create or replace function ensure_slate(p_room_id uuid, p_date date default (now() at time zone 'America/New_York')::date)
returns slates
language plpgsql
security definer
set search_path = public
as $$
declare
  s slates;
begin
  if not is_room_member(p_room_id) then raise exception 'not a room member'; end if;
  -- do nothing on conflict so no UPDATE (and no slates_broadcast) fires for an existing slate
  insert into slates (room_id, slate_date) values (p_room_id, p_date)
  on conflict (room_id, slate_date) do nothing;
  select * into s from slates where room_id = p_room_id and slate_date = p_date;
  return s;
end;
$$;
grant execute on function ensure_slate(uuid, date) to authenticated;

-- A room member overrides a leg's grade. Visible to the whole room via leg_overrides.
create or replace function override_leg(p_leg_id uuid, p_new_status leg_status, p_reason text default null)
returns legs
language plpgsql
security definer
set search_path = public
as $$
declare
  l legs;
begin
  select * into l from legs where id = p_leg_id;
  if l.id is null then raise exception 'leg not found'; end if;
  if not is_room_member(l.room_id) then raise exception 'not a room member'; end if;
  if p_new_status not in ('won', 'lost', 'void', 'push') then
    raise exception 'override must settle the leg (won, lost, void, push)';
  end if;
  insert into leg_overrides (leg_id, room_id, user_id, old_status, new_status, reason)
  values (l.id, l.room_id, auth.uid(), l.status, p_new_status, p_reason);
  update legs
     set status = p_new_status,
         graded_by = case when (select user_id from slips where id = l.slip_id) = auth.uid() then 'user' else 'peer' end,
         graded_at = now()
   where id = l.id
  returning * into l;
  perform rollup_slip(l.slip_id); -- set-returning now; result discarded here
  return l;
end;
$$;
grant execute on function override_leg(uuid, leg_status, text) to authenticated;

-- Recompute a slip's status and legs_remaining from its legs. Used by the grader and override_leg.
-- Locks the slip row so two overlapping grader runs serialize, and returns the
-- before/after pair so the caller can detect transitions (one_away, cashed, slip_dead)
-- without a second read. Must stay identical to rollupSlip() in lib/grading/grade.ts.
create or replace function rollup_slip(p_slip_id uuid)
returns table (
  id uuid,
  room_id uuid,
  slate_id uuid,
  user_id uuid,
  old_status slip_status,
  new_status slip_status,
  old_legs_remaining int,
  new_legs_remaining int,
  legs_total int,
  potential_payout numeric,
  stake numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s slips;
  n_total int;
  n_lost int;
  n_won int;
  n_void int;
  n_open int;
  n_live int;
  v_new_status slip_status;
begin
  select * into s from slips sl where sl.id = p_slip_id for update;
  if s.id is null then
    raise exception 'slip % not found', p_slip_id using errcode = 'P0002';
  end if;

  select count(*),
         count(*) filter (where l.status = 'lost'),
         count(*) filter (where l.status = 'won'),
         count(*) filter (where l.status in ('void', 'push')),
         count(*) filter (where l.status in ('pending', 'live', 'needs_review')),
         count(*) filter (where l.status = 'live')
    into n_total, n_lost, n_won, n_void, n_open, n_live
    from legs l where l.slip_id = p_slip_id;

  if n_lost > 0 then v_new_status := 'lost';
  elsif n_open > 0 then v_new_status := case when n_live > 0 then 'live' else 'pending' end;
  elsif n_won > 0 then v_new_status := 'won';
  elsif n_void = n_total and n_total > 0 then v_new_status := 'void';
  else v_new_status := 'pending';
  end if;

  update slips sl
     set status = v_new_status,
         legs_total = n_total,
         legs_remaining = n_open,
         settled_at = case when v_new_status in ('won', 'lost', 'void', 'push') then coalesce(sl.settled_at, now()) else null end
   where sl.id = p_slip_id;

  return query
    select s.id, s.room_id, s.slate_id, s.user_id,
           s.status, v_new_status,
           s.legs_remaining::int, n_open,
           n_total,
           s.potential_payout::numeric, s.stake::numeric;
end;
$$;
-- service role calls this; authenticated only through override_leg (security definer)
revoke execute on function rollup_slip(uuid) from public, anon, authenticated;
