-- Group Sweat seed: 2 users, 1 room, 1 slate, 4 slips, 12 legs in mixed states.
-- Run after migrations on a dev project: `supabase db reset` applies it automatically.
-- Uses the mock Propfein event ids so the grader in mock mode grades these.

-- Two auth users. These seed users exist for the RLS tests and SQL-only poking;
-- they are not meant for signing in. Sign in through the app with real auth.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cj@example.com',
   crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mike@example.com',
   crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

-- profiles are created by the on_auth_user_created trigger; set nicer handles
update profiles set handle = 'cjr', age_confirmed_at = now() where id = '00000000-0000-0000-0000-000000000001';
update profiles set handle = 'mike', age_confirmed_at = now() where id = '00000000-0000-0000-0000-000000000002';

-- room
insert into rooms (id, name, invite_code, created_by)
values ('10000000-0000-0000-0000-000000000001', 'The Degenerates', 'DEGEN8TE', '00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into room_members (room_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'member')
on conflict do nothing;

-- slate for today (NY)
insert into slates (id, room_id, slate_date, status)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', (now() at time zone 'America/New_York')::date, 'live')
on conflict (room_id, slate_date) do nothing;

-- slips
insert into slips (id, user_id, room_id, slate_id, book, bet_type, stake, odds_american, potential_payout, status, legs_total, legs_remaining, parse_confidence) values
  -- CJ: 3-leg parlay, live, one leg left (the "moment")
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'draftkings', 'parlay', 25.00, 600, 175.00, 'live', 3, 1, 0.94),
  -- Mike: single spread, pending (scheduled game)
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'fanduel', 'single', 50.00, -110, 95.45, 'pending', 1, 1, 0.98),
  -- Mike: 2-leg SGP, won
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'fanduel', 'sgp', 20.00, 260, 72.00, 'won', 2, 0, 0.91),
  -- CJ: 6-leg parlay, lost on exactly one leg (bad beat)
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'draftkings', 'parlay', 10.00, 2500, 260.00, 'lost', 6, 0, 0.88)
on conflict (id) do nothing;

-- legs
insert into legs (slip_id, room_id, sport, market, selection, line, player_name, stat_type, teams, leg_odds_american, status, current_value, propfein_event_id, propfein_market_key, propfein_player_id, side, match_confidence, graded_by, graded_at) values
  -- slip 1 (live, one away): two won, one live
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'nfl', 'moneyline', 'Bills ML', null, null, null, array['Bills','Dolphins'], -180, 'won', 14, 'nfl-mock-final', 'moneyline:home', null, 'home', 0.95, 'auto', now()),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'nfl', 'player_prop', 'Josh Allen Over 2.5 Pass TDs', 2.5, 'Josh Allen', 'passing_tds', array['Bills'], 120, 'won', 3, 'nfl-mock-final', 'prop:passing_tds:over', 'p-allen', 'over', 0.93, 'auto', now()),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'nfl', 'player_prop', 'Jalen Hurts Over 1.5 Total TDs', 1.5, 'Jalen Hurts', 'anytime_td', array['Eagles'], 150, 'live', 1, 'nfl-mock-live', 'prop:anytime_td:over', 'p-hurts', 'over', 0.93, null, null),
  -- slip 2 (pending): Chiefs -6.5 scheduled
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'nfl', 'spread', 'Chiefs -6.5', -6.5, null, null, array['Chiefs','Raiders'], -110, 'pending', null, 'nfl-mock-scheduled', 'spread:home', null, 'home', 0.95, null, null),
  -- slip 3 (won): Warriors ML + Curry over 29.5 pts
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'nba', 'moneyline', 'Warriors ML', null, null, null, array['Warriors','Lakers'], 110, 'won', 6, 'nba-mock-final', 'moneyline:away', null, 'away', 0.95, 'auto', now()),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'nba', 'player_prop', 'Stephen Curry Over 29.5 Points', 29.5, 'Stephen Curry', 'points', array['Warriors'], -115, 'won', 34, 'nba-mock-final', 'prop:points:over', 'p-curry', 'over', 0.93, 'auto', now()),
  -- slip 4 (lost on one leg): five won, one lost
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'nfl', 'moneyline', 'Bills ML', null, null, null, array['Bills','Dolphins'], -180, 'won', 14, 'nfl-mock-final', 'moneyline:home', null, 'home', 0.95, 'auto', now()),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'nfl', 'total', 'Bills/Dolphins Over 44.5', 44.5, null, null, array['Bills','Dolphins'], -110, 'won', 48, 'nfl-mock-final', 'total:over', null, 'over', 0.9, 'auto', now()),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'nfl', 'spread', 'Bills -7.5', -7.5, null, null, array['Bills','Dolphins'], -110, 'won', 14, 'nfl-mock-final', 'spread:home', null, 'home', 0.95, 'auto', now()),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'nba', 'moneyline', 'Warriors ML', null, null, null, array['Warriors','Lakers'], 110, 'won', 6, 'nba-mock-final', 'moneyline:away', null, 'away', 0.95, 'auto', now()),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'nba', 'total', 'Lakers/Warriors Over 225.5', 225.5, null, null, array['Lakers','Warriors'], -110, 'won', 230, 'nba-mock-final', 'total:over', null, 'over', 0.9, 'auto', now()),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'nba', 'player_prop', 'Stephen Curry Over 7.5 Threes', 7.5, 'Stephen Curry', 'threes', array['Warriors'], 200, 'lost', 7, 'nba-mock-final', 'prop:threes:over', 'p-curry', 'over', 0.93, 'auto', now());

-- room events for the ticker
insert into room_events (room_id, slate_id, slip_id, type, payload) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'cashed', '{"handle":"mike","potential_payout":72.00}'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 'slip_dead', '{"handle":"cjr","potential_payout":260.00,"lost_leg":"Stephen Curry Over 7.5 Threes"}'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'one_away', '{"handle":"cjr","potential_payout":175.00,"last_leg":"Jalen Hurts Over 1.5 Total TDs"}');
