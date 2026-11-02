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
create policy "profiles: anyone authenticated can read"
  on profiles for select to authenticated using (true);
create policy "profiles: update own"
  on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

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
create policy "slips: owner updates own metadata"
  on slips for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "slips: delete own while pending"
  on slips for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');

-- ---------- legs ----------
create policy "legs: members read"
  on legs for select to authenticated using (is_room_member(room_id));
create policy "legs: insert on own slip"
  on legs for insert to authenticated
  with check (exists (select 1 from slips s where s.id = slip_id and s.user_id = auth.uid()) and is_room_member(room_id));
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
  on parse_corrections for insert to authenticated with check (user_id = auth.uid());
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
  insert into slates (room_id, slate_date) values (p_room_id, p_date)
  on conflict (room_id, slate_date) do update set slate_date = excluded.slate_date
  returning * into s;
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
  perform rollup_slip(l.slip_id);
  return l;
end;
$$;
grant execute on function override_leg(uuid, leg_status, text) to authenticated;

-- Recompute a slip's status and legs_remaining from its legs. Used by the grader and override_leg.
create or replace function rollup_slip(p_slip_id uuid)
returns slips
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
  new_status slip_status;
begin
  select count(*),
         count(*) filter (where status = 'lost'),
         count(*) filter (where status = 'won'),
         count(*) filter (where status in ('void', 'push')),
         count(*) filter (where status in ('pending', 'live', 'needs_review'))
    into n_total, n_lost, n_won, n_void, n_open
    from legs where slip_id = p_slip_id;

  if n_lost > 0 then new_status := 'lost';
  elsif n_open > 0 then
    new_status := case when exists (select 1 from legs where slip_id = p_slip_id and status = 'live') then 'live' else 'pending' end;
  elsif n_won > 0 then new_status := 'won';
  elsif n_void = n_total and n_total > 0 then new_status := 'void';
  else new_status := 'pending';
  end if;

  update slips
     set status = new_status,
         legs_total = n_total,
         legs_remaining = n_open,
         settled_at = case when new_status in ('won', 'lost', 'void', 'push') then coalesce(settled_at, now()) else null end
   where id = p_slip_id
  returning * into s;
  return s;
end;
$$;
-- service role calls this; authenticated only through override_leg
revoke execute on function rollup_slip(uuid) from public;
