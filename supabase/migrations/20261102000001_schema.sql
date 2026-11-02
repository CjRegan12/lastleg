-- Last Leg: core schema
-- Phase 2 of the Build Plan. Last Leg stores NO sports data; legs reference
-- Propfein ids as text. Enums everywhere a value is a closed set.

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ---------- enums ----------
create type room_role as enum ('owner', 'member');
create type slate_status as enum ('open', 'live', 'final');
create type slip_status as enum ('pending', 'live', 'won', 'lost', 'void', 'push');
create type leg_status as enum ('pending', 'live', 'won', 'lost', 'void', 'push', 'needs_review');
create type bet_type as enum ('single', 'parlay', 'sgp', 'round_robin', 'teaser', 'other');
create type sportsbook as enum ('draftkings', 'fanduel', 'caesars', 'betmgm', 'fanatics', 'other');
create type market as enum ('spread', 'total', 'moneyline', 'player_prop', 'team_prop', 'other');
create type sport as enum ('nfl', 'nba', 'mlb', 'nhl', 'ncaaf', 'ncaab', 'other');
create type graded_by as enum ('auto', 'user', 'peer');
create type room_event_type as enum (
  'slip_added', 'leg_hit', 'leg_lost', 'slip_dead', 'one_away', 'cashed', 'tailed', 'slate_final'
);
create type notification_type as enum ('one_away', 'cashed', 'slip_died', 'no_slip_yet', 'tailed', 'recap', 'rank_change');

-- ---------- profiles ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle citext not null unique check (length(handle) between 3 and 24 and handle ~ '^[a-zA-Z0-9_]+$'),
  avatar_url text,
  push_token text,
  premium_until timestamptz,
  quiet_hours_start smallint check (quiet_hours_start between 0 and 23),
  quiet_hours_end smallint check (quiet_hours_end between 0 and 23),
  age_confirmed_at timestamptz, -- 21+ self-declaration
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- auto-create a profile row when a user signs up
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := coalesce(
    nullif(regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9_]', '', 'g'), ''),
    'user'
  );
  base := left(base, 18);
  if length(base) < 3 then base := base || 'user'; end if;
  candidate := base;
  -- handle is citext; cast so the comparison is case-insensitive instead of text = text
  while exists (select 1 from profiles where handle = candidate::citext) loop
    n := n + 1;
    candidate := base || n::text;
  end loop;
  -- two signups can race past the exists() check; retry on unique_violation
  for attempt in 1..5 loop
    begin
      insert into profiles (id, handle) values (new.id, candidate::citext);
      return new;
    exception when unique_violation then
      if attempt = 5 then
        raise exception 'could not allocate a unique handle for user %', new.id;
      end if;
      candidate := left(base, 21) || lpad(floor(random() * 1000)::int::text, 3, '0');
    end;
  end loop;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- rooms ----------
create table rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 40),
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{8}$'),
  created_by uuid not null references profiles(id) on delete restrict,
  settings jsonb not null default jsonb_build_object(
    'cash_threshold', 500,
    'muted_triggers', '[]'::jsonb,
    'season_start', null,
    'max_pushes_per_slate', 6
  ),
  created_at timestamptz not null default now()
);

create table room_members (
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role room_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_members_user_idx on room_members(user_id);

-- ---------- slates ----------
create table slates (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  slate_date date not null,
  status slate_status not null default 'open',
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (room_id, slate_date)
);
create index slates_room_idx on slates(room_id);
create index slates_status_idx on slates(status);

-- ---------- slips ----------
create table slips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  slate_id uuid not null references slates(id) on delete cascade,
  book sportsbook not null,
  bet_type bet_type not null,
  stake numeric(10,2) not null check (stake >= 0),
  odds_american integer not null,
  potential_payout numeric(10,2) not null check (potential_payout >= 0),
  status slip_status not null default 'pending',
  legs_total smallint not null default 0,
  legs_remaining smallint not null default 0,
  screenshot_path text,
  parsed_json jsonb,
  parse_confidence numeric(3,2) check (parse_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz
);
create index slips_room_idx on slips(room_id);
create index slips_slate_idx on slips(slate_id);
create index slips_user_idx on slips(user_id);
create index slips_status_idx on slips(status);

-- ---------- legs ----------
create table legs (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references slips(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade, -- denormalized for RLS + broadcast
  sport sport not null,
  market market not null,
  selection text not null,
  line numeric(7,2),
  player_name text,
  stat_type text,
  teams text[],
  leg_odds_american integer,
  status leg_status not null default 'pending',
  current_value numeric(10,2),
  propfein_event_id text,
  propfein_market_key text,
  propfein_player_id text,
  side text check (side in ('home', 'away', 'over', 'under')),
  match_confidence numeric(3,2),
  graded_by graded_by,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index legs_slip_idx on legs(slip_id);
create index legs_room_idx on legs(room_id);
create index legs_status_idx on legs(status);
create index legs_event_idx on legs(propfein_event_id);

-- ---------- audit + learning ----------
create table leg_overrides (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references legs(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  old_status leg_status not null,
  new_status leg_status not null,
  reason text,
  created_at timestamptz not null default now()
);
create index leg_overrides_leg_idx on leg_overrides(leg_id);

create table parse_corrections (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references slips(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  field_path text not null, -- e.g. "legs[1].line"
  parsed_value jsonb,
  corrected_value jsonb,
  created_at timestamptz not null default now()
);

-- ---------- live feed + pushes ----------
create table room_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  slate_id uuid references slates(id) on delete cascade,
  slip_id uuid references slips(id) on delete cascade,
  type room_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index room_events_room_idx on room_events(room_id, created_at desc);

create table tails (
  slip_id uuid not null references slips(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  book_clicked sportsbook,
  created_at timestamptz not null default now(),
  primary key (slip_id, user_id)
);

create table notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  room_id uuid references rooms(id) on delete cascade,
  slate_id uuid references slates(id) on delete cascade,
  slip_id uuid references slips(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text not null,
  url text, -- in-app route for deep link
  sent_at timestamptz,
  expo_ticket_id text,
  expo_receipt_status text,
  created_at timestamptz not null default now()
);
create index notifications_unsent_idx on notifications(created_at) where sent_at is null;
create index notifications_room_slate_idx on notifications(room_id, slate_id);
-- overlapping grader runs may both try to push the same slip event; the second insert fails here
create unique index notifications_dedupe_idx
  on notifications(user_id, slate_id, type, slip_id)
  where slip_id is not null;

-- ---------- updated_at ----------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_updated_at before update on profiles for each row execute function set_updated_at();
create trigger slips_updated_at before update on slips for each row execute function set_updated_at();
create trigger legs_updated_at before update on legs for each row execute function set_updated_at();

-- ---------- invite code helper ----------
create or replace function generate_invite_code()
returns text language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from rooms where invite_code = code);
  end loop;
  return code;
end;
$$;
