-- Last Leg: first-run onboarding marker (pick your name after first sign-in)

alter table profiles add column onboarded_at timestamptz;
grant update (onboarded_at) on profiles to authenticated;

-- `me` was created with select *, which Postgres expands at creation time, so
-- it must be re-created to see the new column. CREATE OR REPLACE keeps the
-- grants and revokes from 0002 (owner-only read, no writes).
create or replace view public.me
with (security_invoker = false)
as select * from profiles where id = auth.uid();
