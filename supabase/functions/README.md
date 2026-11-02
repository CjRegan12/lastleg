# Edge Functions

Four Deno functions. `_shared/` holds the Propfein client copied from `lib/api/` plus the grading engine; the functions import from `../_shared/...`.

| Function | Auth | Trigger |
| --- | --- | --- |
| `parse-slip` | User JWT (verify_jwt on) | App, after uploading a screenshot to the `slips` bucket |
| `grade-legs` | `x-grader-secret` header = `GRADER_SECRET` | pg_cron every 30s (`scripts/schedule-grader.sql`) |
| `send-push` | `x-webhook-secret` header = `WEBHOOK_SECRET` | Database Webhook on `notifications` INSERT; also drain mode |
| `check-receipts` | `x-webhook-secret` header = `WEBHOOK_SECRET` | pg_cron every 15 min |

## Secrets

Set once per project (never in the repo):

```sh
supabase secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  PROPFEIN_API_URL=mock \
  PROPFEIN_API_KEY=... \
  GRADER_SECRET=$(openssl rand -hex 32) \
  WEBHOOK_SECRET=$(openssl rand -hex 32) \
  EXPO_ACCESS_TOKEN=...
```

- `PROPFEIN_API_URL=mock` runs the Propfein client against fixtures. Switch to the real URL when the API exists.
- `EXPO_ACCESS_TOKEN` is optional until Expo push security is turned on for the project.
- Optional parse overrides: `PARSE_MODEL_PRIMARY` (default `claude-haiku-5-5`), `PARSE_MODEL_FALLBACK` (default `claude-sonnet-5-5`).
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

Check what is set with `supabase secrets list` (values are not shown).

## Deploy

```sh
supabase functions deploy parse-slip
supabase functions deploy send-push --no-verify-jwt
supabase functions deploy check-receipts --no-verify-jwt
supabase functions deploy grade-legs --no-verify-jwt
```

`--no-verify-jwt` is required on the three machine-called functions: pg_cron and webhooks do not carry a user JWT. Each of them checks its own secret header and returns 401 otherwise. `parse-slip` keeps JWT verification on and re-checks the user with `auth.getUser()`.

## Database Webhook for send-push

Dashboard -> Database -> Webhooks -> Create a new hook:

- Name: `notifications-send-push`
- Table: `public.notifications`
- Events: `Insert`
- Type: HTTP Request, method `POST`
- URL: `https://<project-ref>.supabase.co/functions/v1/send-push`
- HTTP headers:
  - `Content-Type: application/json`
  - `x-webhook-secret: <the WEBHOOK_SECRET value>`
- Timeout: 5000 ms

The payload Supabase sends is `{ type: "INSERT", table: "notifications", record: {...} }`; the function re-reads the row by id before sending. If you prefer SQL over the dashboard, the equivalent is a `supabase_functions.http_request` trigger, but the dashboard route is fine for v1.

Drain safety net (optional, catches missed webhook deliveries):

```sql
select cron.schedule(
  'send-push-drain',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', '<WEBHOOK_SECRET>'),
    body := '{"mode":"drain"}'::jsonb
  );
  $$
);
```

## pg_cron for check-receipts

```sql
select cron.schedule(
  'check-push-receipts',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/check-receipts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', '<WEBHOOK_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);
```

`pg_cron` and `pg_net` are enabled by migration `20261102000003_views_realtime.sql`. Putting the secret in a cron command stores it in `cron.job`, which only the postgres role can read; same trade-off `scripts/schedule-grader.sql` makes. Rotate with `supabase secrets set WEBHOOK_SECRET=...` and `cron.alter_job`.

## Local testing

```sh
supabase start
supabase functions serve --env-file supabase/functions/.env.local
```

`supabase/functions/.env.local` (gitignored) holds the same keys as the secrets above. Local functions are at `http://127.0.0.1:54321/functions/v1/<name>`.

### parse-slip

Needs a real user JWT (sign in from the app or use `supabase auth` in the dashboard and copy the access token) and an image already uploaded to `slips/<user_id>/<uuid>.jpg`.

```sh
curl -sS -X POST http://127.0.0.1:54321/functions/v1/parse-slip \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"storage_path":"'"$USER_ID"'/test.jpg","room_id":"00000000-0000-0000-0000-000000000000"}'
```

Response: `{ parsed, matches, model_used, escalated, usage }`. 400 bad body or path outside your folder, 401 no user, 422 model refused, 502 Claude API error.

### send-push

Webhook shape:

```sh
curl -sS -X POST http://127.0.0.1:54321/functions/v1/send-push \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"type":"INSERT","table":"notifications","record":{"id":1}}'
```

Drain mode:

```sh
curl -sS -X POST http://127.0.0.1:54321/functions/v1/send-push \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode":"drain"}'
```

### check-receipts

```sh
curl -sS -X POST http://127.0.0.1:54321/functions/v1/check-receipts \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### grade-legs

```sh
curl -sS -X POST http://127.0.0.1:54321/functions/v1/grade-legs \
  -H "x-grader-secret: $GRADER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Logs

`supabase functions logs <name>` or Dashboard -> Edge Functions -> Logs. All four functions `console.error` on failure and return a JSON `{ error }` body; none of them echo secrets.
