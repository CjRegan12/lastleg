-- Last Leg: schedule the grade-legs Edge Function with pg_cron + pg_net.
--
-- Run this ONCE against the project database (SQL editor or `supabase db query`)
-- after the first `supabase functions deploy grade-legs`. It is not a migration
-- because it contains project-specific values.
--
-- Fill in the two placeholders before running:
--   <PROJECT_URL>    the project's API URL, e.g. https://abcdefghijklmnop.supabase.co
--                    (Dashboard -> Project Settings -> API, or `supabase status` locally)
--   <GRADER_SECRET>  the same random string you set with
--                    `supabase secrets set GRADER_SECRET=...`
--                    (generate one with: openssl rand -hex 32)
--
-- pg_cron supports sub-minute intervals ('30 seconds') on Postgres 15+ with
-- pg_cron 1.5+, which Supabase ships. The function only does work when a slate
-- is open or live, so the 30s cadence is cheap the rest of the time.
--
-- Note: the secret is stored in plain text in cron.job. Only the postgres role
-- can read that table, but rotate it if the database is ever shared.

select cron.schedule(
  'grade-legs',
  '30 seconds',
  $$
  select net.http_post(
    url := '<PROJECT_URL>/functions/v1/grade-legs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-grader-secret', '<GRADER_SECRET>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  )
  $$
);

-- Check it is registered and see recent runs:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'grade-legs';
--   select status, return_message, start_time from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'grade-legs')
--     order by start_time desc limit 20;
--   select id, status_code, content::text from net._http_response order by id desc limit 10;

-- To stop the grader (e.g. before redeploying with a new secret):
--   select cron.unschedule('grade-legs');
