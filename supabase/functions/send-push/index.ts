/**
 * send-push: notifications rows -> Expo push.
 *
 * DEPLOY WITH JWT VERIFICATION OFF: `supabase functions deploy send-push --no-verify-jwt`.
 * The caller is a Database Webhook (or cron / curl), not a user, so auth is the
 * `x-webhook-secret` header, which must equal the WEBHOOK_SECRET secret.
 *
 * Modes:
 *  (a) Database Webhook on notifications INSERT:
 *      { type: "INSERT", table: "notifications", record: { id, user_id, title, body, url, ... } }
 *      -> sends that one row.
 *  (b) empty body or { mode: "drain" }
 *      -> sends up to 500 rows where sent_at is null, oldest first. Use this as a
 *         cron safety net in case a webhook delivery was missed.
 *
 * Per row: look up profiles.push_token. No token -> mark sent_at now with
 * expo_receipt_status 'no_token' and skip. Otherwise build an Expo message, POST in
 * chunks of 100, record expo_ticket_id + sent_at. A ticket error of
 * DeviceNotRegistered nulls that profile's push_token.
 *
 * Receipts are checked later by the check-receipts function.
 *
 * Secrets: WEBHOOK_SECRET, optional EXPO_ACCESS_TOKEN.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;
const DRAIN_LIMIT = 500;
const JSON_HEADERS = { "Content-Type": "application/json" };

interface NotificationRow {
  id: number;
  user_id: string;
  title: string;
  body: string;
  url: string | null;
  sent_at: string | null;
}

interface WebhookPayload {
  type?: string;
  table?: string;
  record?: Partial<NotificationRow> & { id?: number };
  mode?: string;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: { url: string | null; notification_id: number };
  sound: "default";
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string; [k: string]: unknown };
}

interface Summary {
  mode: "webhook" | "drain";
  considered: number;
  sent: number;
  no_token: number;
  errors: number;
  tokens_cleared: number;
  failures: Array<{ notification_id: number; error: string }>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isExpoToken(t: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(t);
}

async function postExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  const token = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(messages) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`exp.host ${res.status}: ${text.slice(0, 300)}`);
  }
  const payload = (await res.json()) as { data?: ExpoTicket[]; errors?: Array<{ code?: string; message?: string }> };
  if (!Array.isArray(payload.data)) {
    const msg = payload.errors?.map((e) => `${e.code ?? "error"}: ${e.message ?? ""}`).join("; ") ?? "no data[]";
    throw new Error(`exp.host malformed response: ${msg}`);
  }
  return payload.data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // auth
  const expected = Deno.env.get("WEBHOOK_SECRET");
  const provided = req.headers.get("x-webhook-secret");
  if (!expected || !provided || provided !== expected) return json({ error: "unauthorized" }, 401);

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // parse body (may be empty)
  let payload: WebhookPayload = {};
  const raw = await req.text();
  if (raw.trim().length > 0) {
    try {
      payload = JSON.parse(raw) as WebhookPayload;
    } catch {
      return json({ error: "body must be JSON or empty" }, 400);
    }
  }

  const summary: Summary = {
    mode: "drain",
    considered: 0,
    sent: 0,
    no_token: 0,
    errors: 0,
    tokens_cleared: 0,
    failures: [],
  };

  try {
    // 1. collect notifications to send
    let rows: NotificationRow[] = [];
    if (payload.type === "INSERT" && payload.table === "notifications" && payload.record?.id != null) {
      summary.mode = "webhook";
      // Re-read the row so we never trust webhook contents blindly and skip if already sent.
      const { data, error } = await admin
        .from("notifications")
        .select("id, user_id, title, body, url, sent_at")
        .eq("id", payload.record.id)
        .is("sent_at", null)
        .maybeSingle();
      if (error) throw new Error(`select notification: ${error.message}`);
      if (data) rows = [data as NotificationRow];
    } else {
      const { data, error } = await admin
        .from("notifications")
        .select("id, user_id, title, body, url, sent_at")
        .is("sent_at", null)
        .order("created_at", { ascending: true })
        .limit(DRAIN_LIMIT);
      if (error) throw new Error(`select unsent: ${error.message}`);
      rows = (data ?? []) as NotificationRow[];
    }
    summary.considered = rows.length;
    if (rows.length === 0) return json(summary);

    // 2. push tokens
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const { data: profiles, error: profErr } = await admin
      .from("profiles")
      .select("id, push_token")
      .in("id", userIds);
    if (profErr) throw new Error(`select profiles: ${profErr.message}`);
    const tokenByUser = new Map<string, string | null>();
    for (const p of (profiles ?? []) as Array<{ id: string; push_token: string | null }>) {
      tokenByUser.set(p.id, p.push_token);
    }

    // 3. split into sendable vs no_token
    const now = new Date().toISOString();
    const sendable: Array<{ row: NotificationRow; message: ExpoMessage }> = [];
    const noTokenIds: number[] = [];
    for (const row of rows) {
      const token = tokenByUser.get(row.user_id) ?? null;
      if (!token || !isExpoToken(token)) {
        noTokenIds.push(row.id);
        continue;
      }
      sendable.push({
        row,
        message: {
          to: token,
          title: row.title,
          body: row.body,
          data: { url: row.url, notification_id: row.id },
          sound: "default",
        },
      });
    }

    if (noTokenIds.length > 0) {
      const { error } = await admin
        .from("notifications")
        .update({ sent_at: now, expo_receipt_status: "no_token" })
        .in("id", noTokenIds);
      if (error) throw new Error(`mark no_token: ${error.message}`);
      summary.no_token = noTokenIds.length;
    }

    // 4. send in chunks of 100
    const deadTokens = new Set<string>();
    for (const batch of chunk(sendable, CHUNK)) {
      let tickets: ExpoTicket[];
      try {
        tickets = await postExpo(batch.map((b) => b.message));
      } catch (e) {
        // whole chunk failed; leave sent_at null so a later drain retries it
        const msg = e instanceof Error ? e.message : String(e);
        for (const b of batch) {
          summary.errors += 1;
          summary.failures.push({ notification_id: b.row.id, error: msg });
        }
        continue;
      }

      // tickets are positional
      for (let i = 0; i < batch.length; i++) {
        const { row, message } = batch[i];
        const ticket = tickets[i];
        const sentAt = new Date().toISOString();

        if (!ticket) {
          summary.errors += 1;
          summary.failures.push({ notification_id: row.id, error: "no ticket returned" });
          continue;
        }

        if (ticket.status === "ok") {
          const { error } = await admin
            .from("notifications")
            .update({ sent_at: sentAt, expo_ticket_id: ticket.id ?? null })
            .eq("id", row.id);
          if (error) {
            summary.errors += 1;
            summary.failures.push({ notification_id: row.id, error: `update: ${error.message}` });
          } else {
            summary.sent += 1;
          }
          continue;
        }

        // ticket.status === "error": record it so we do not resend forever
        const code = ticket.details?.error ?? "ticket_error";
        summary.errors += 1;
        summary.failures.push({ notification_id: row.id, error: `${code}: ${ticket.message ?? ""}`.trim() });
        await admin
          .from("notifications")
          .update({ sent_at: sentAt, expo_receipt_status: code })
          .eq("id", row.id);
        if (code === "DeviceNotRegistered") deadTokens.add(message.to);
      }
    }

    // 5. clear dead tokens
    if (deadTokens.size > 0) {
      const { data: cleared, error } = await admin
        .from("profiles")
        .update({ push_token: null })
        .in("push_token", [...deadTokens])
        .select("id");
      if (error) {
        summary.failures.push({ notification_id: -1, error: `clear tokens: ${error.message}` });
      } else {
        summary.tokens_cleared = cleared?.length ?? 0;
      }
    }

    return json(summary);
  } catch (e) {
    console.error("send-push failed", e);
    return json({ error: e instanceof Error ? e.message : "internal error", summary }, 500);
  }
});
