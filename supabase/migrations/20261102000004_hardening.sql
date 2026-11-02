-- Last Leg: hardening from the Supabase security advisor (first live apply, 2026-11-02)

-- Supabase grants EXECUTE on new public functions to anon/authenticated by
-- default, which exposes them at /rest/v1/rpc/<name>. Trigger functions and
-- internal helpers must never be callable over the API.
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function set_updated_at() from public, anon, authenticated;
revoke execute on function generate_invite_code() from public, anon, authenticated;
revoke execute on function broadcast_room_change() from public, anon, authenticated;
revoke execute on function slips_before_insert_guard() from public, anon, authenticated;
revoke execute on function legs_before_insert_guard() from public, anon, authenticated;
revoke execute on function legs_after_insert_sync() from public, anon, authenticated;
revoke execute on function legs_after_delete_sync() from public, anon, authenticated;

-- RPCs are for signed-in users only. (authenticated grants were made in 0002.)
revoke execute on function is_room_member(uuid) from public, anon;
revoke execute on function create_room(text) from public, anon;
revoke execute on function join_room(text) from public, anon;
revoke execute on function ensure_slate(uuid, date) from public, anon;
revoke execute on function override_leg(uuid, leg_status, text) from public, anon;

-- Stop future functions from being auto-exposed to anon.
alter default privileges in schema public revoke execute on functions from anon;

-- Pin search_path on the two helpers that lacked it.
alter function set_updated_at() set search_path = public;
alter function generate_invite_code() set search_path = public;

-- Note: the advisor also flags `public.me` as a SECURITY DEFINER view. That is
-- intentional and documented in 0002: it is read-only (all write privileges
-- revoked) and hard-filtered to auth.uid(). Extensions citext/pg_net living in
-- public is a Supabase default we accept for v1.
