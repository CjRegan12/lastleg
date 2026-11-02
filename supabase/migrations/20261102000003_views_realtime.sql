-- Group Sweat: derived views, realtime broadcast, storage bucket, cron

-- ---------- views ----------
-- Season standings per room member. Plain view; materialize only when slow.
create or replace view room_standings
with (security_invoker = true)
as
select
  s.room_id,
  s.user_id,
  p.handle,
  p.avatar_url,
  count(*) filter (where s.status in ('won','lost','push','void')) as settled,
  count(*) filter (where s.status = 'won') as won,
  count(*) filter (where s.status = 'lost') as lost,
  coalesce(sum(case when s.status = 'won' then s.potential_payout - s.stake
                    when s.status = 'lost' then -s.stake
                    else 0 end), 0)::numeric(12,2) as profit,
  coalesce(sum(case when s.status in ('won','lost') then s.stake else 0 end), 0)::numeric(12,2) as risked,
  case when coalesce(sum(case when s.status in ('won','lost') then s.stake else 0 end), 0) > 0
       then round(100 * coalesce(sum(case when s.status = 'won' then s.potential_payout - s.stake
                                           when s.status = 'lost' then -s.stake else 0 end), 0)
                  / sum(case when s.status in ('won','lost') then s.stake else 0 end), 1)
       else 0 end as roi_percent,
  count(*) filter (where s.status = 'lost' and s.legs_total > 1
                   and (select count(*) from legs l where l.slip_id = s.id and l.status = 'lost') = 1) as bad_beats
from slips s
join profiles p on p.id = s.user_id
group by s.room_id, s.user_id, p.handle, p.avatar_url;

-- Board for a slate: slips with a sort key (closest to cashing first).
create or replace view slate_board
with (security_invoker = true)
as
select
  s.*,
  p.handle,
  p.avatar_url,
  case s.status
    when 'live' then 0
    when 'pending' then 1
    when 'won' then 2
    when 'lost' then 3
    else 4
  end as status_rank,
  case when s.status = 'live' then s.legs_remaining else 99 end as remaining_rank
from slips s
join profiles p on p.id = s.user_id;

-- ---------- realtime: broadcast on private room channels ----------
-- Clients subscribe to channel 'room:<room_id>' with { private: true }.
-- Policy on realtime.messages gates who can subscribe.
create policy "room members can receive broadcasts"
  on realtime.messages for select to authenticated
  using (
    -- guard the cast: a malformed topic must evaluate false, not raise
    case
      when realtime.topic() ~ '^room:[0-9a-f-]{36}$'
        then is_room_member(substring(realtime.topic() from 6)::uuid)
      else false
    end
  );

create or replace function broadcast_room_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  rid := coalesce(new.room_id, old.room_id);
  perform realtime.broadcast_changes(
    'room:' || rid::text,  -- topic
    tg_op,                 -- event
    tg_op,                 -- operation
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return coalesce(new, old);
end;
$$;

create trigger slips_broadcast after insert or update or delete on slips
  for each row execute function broadcast_room_change();
create trigger legs_broadcast after insert or update or delete on legs
  for each row execute function broadcast_room_change();
create trigger room_events_broadcast after insert on room_events
  for each row execute function broadcast_room_change();
create trigger slates_broadcast_insert after insert on slates
  for each row execute function broadcast_room_change();
-- no-op updates (e.g. an upsert that changes nothing) must not spam the room channel
create trigger slates_broadcast_update after update on slates
  for each row when (old.* is distinct from new.*) execute function broadcast_room_change();

-- ---------- storage: private slips bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- path convention: slips/<user_id>/<uuid>.jpg
create policy "slips bucket: upload own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'slips' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "slips bucket: read own folder"
  on storage.objects for select to authenticated
  using (bucket_id = 'slips' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "slips bucket: delete own folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'slips' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- cron ----------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The grader schedule is created by scripts/schedule-grader.sql after deploy,
-- because it needs the project URL and the GRADER_SECRET. Cleanup job is static:
select cron.schedule(
  'cleanup-cron-history',
  '0 4 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);
