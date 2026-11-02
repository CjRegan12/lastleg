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
 * Claiming: the webhook and the drain cron can overlap, so rows are claimed
 * atomically before anything is sent: `update notifications set sent_at = now(),
 * expo_receipt_status = 'claimed' where id in (...) and sent_at is null returning *`.
 * Only rows that come back from that update are sent; a row another invocation
 * claimed first is skipped. After Expo answers, the row gets its ticket id and
 * expo_receipt_status goes back to null (receipt pending) or to the Expo error code.
 * If the Expo POST itself fails, the claim is released (sent_at back to null) so a
 * later drain retries it. A drain also starts by releasing any row still 'claimed'
 * more than 10 minutes after its claim (an invocation that died mid-send).
 *
 * Per row: look up profiles.push_token. No token -> expo_receipt_status 'no_token'
 * (sent_at stays set from the claim). A ticket error of DeviceNotRegistered nulls
 * that profile's push_token, but only if the profile has not been updated since
 * the claim (profiles.updated_at <= sent_at), so a token re-registered in between
 * survives.
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

const CLAIMED = "claimed";
/** A row still 'claimed' this long after its claim belongs to a dead invocation; a drain reclaims it. */
const STALE_CLAIM_MINUTES = 10;
const NOTIFICATION_COLUMNS = "id, user_id, title, body, url, sent_at";

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
  /** drain only: stale 'claimed' rows released back to unsent before selecting candidates */
  reclaimed: number;
  claimed: number;
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
    reclaimed: 0,
    claimed: 0,
    sent: 0,
    no_token: 0,
    errors: 0,
    tokens_cleared: 0,
    failures: [],
  };

  try {
    // 1. candidate ids. We never trust webhook contents; the id is all we take from it.
    let candidateIds: number[] = [];
    if (payload.type === "INSERT" && payload.table === "notifications" && payload.record?.id != null) {
      summary.mode = "webhook";
      candidateIds = [payload.record.id];
    } else {
      // Reclaim stale claims first: an invocation that died between the claim
      // and the Expo answer leaves rows stuck at 'claimed' forever. Anything
      // claimed more than STALE_CLAIM_MINUTES ago goes back to unsent.
      const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
      const { data: reclaimed, error: reclaimErr } = await admin
        .from("notifications")
        .update({ sent_at: null, expo_receipt_status: null })
        .eq("expo_receipt_status", CLAIMED)
        .lt("sent_at", staleBefore)
        .select("id");
      if (reclaimErr) throw new Error(`reclaim stale: ${reclaimErr.message}`);
      summary.reclaimed = (reclaimed ?? []).length;

      const { data, error } = await admin
        .from("notifications")
        .select("id")
        .is("sent_at", null)
        .order("created_at", { ascending: true })
        .limit(DRAIN_LIMIT);
      if (error) throw new Error(`select unsent: ${error.message}`);
      candidateIds = ((data ?? []) as Array<{ id: number }>).map((r) => r.id);
    }
    summary.considered = candidateIds.length;
    if (candidateIds.length === 0) return json(summary);

    // 2. claim atomically: only rows still unsent come back, and they are ours now.
    const claimedAt = new Date().toISOString();
    const { data: claimedRows, error: claimErr } = await admin
      .from("notifications")
      .update({ sent_at: claimedAt, expo_receipt_status: CLAIMED })
      .in("id", candidateIds)
      .is("sent_at", null)
      .select(NOTIFICATION_COLUMNS);
    if (claimErr) throw new Error(`claim notifications: ${claimErr.message}`);
    const rows = (claimedRows ?? []) as NotificationRow[];
    summary.claimed = rows.length;
    if (rows.length === 0) return json(summary);

    // 3. push tokens
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

    // 4. split into sendable vs no_token
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
      // sent_at already set by the claim; just record why nothing went out
      const { error } = await admin
        .from("notifications")
        .update({ expo_receipt_status: "no_token" })
        .in("id", noTokenIds);
      if (error) throw new Error(`mark no_token: ${error.message}`);
      summary.no_token = noTokenIds.length;
    }

    // 5. send in chunks of 100
    const deadTokens = new Set<string>();
    for (const batch of chunk(sendable, CHUNK)) {
      let tickets: ExpoTicket[];
      try {
        tickets = await postExpo(batch.map((b) => b.message));
      } catch (e) {
        // whole chunk failed: release the claim so a later drain retries it
        const msg = e instanceof Error ? e.message : String(e);
        const { error: relErr } = await admin
          .from("notifications")
          .update({ sent_at: null, expo_receipt_status: null })
          .in("id", batch.map((b) => b.row.id))
          .eq("expo_receipt_status", CLAIMED);
        for (const b of batch) {
          summary.errors += 1;
          summary.failures.push({ notification_id: b.row.id, error: relErr ? `${msg}; release failed: ${relErr.message}` : msg });
        }
        continue;
      }

      // tickets are positional
      for (let i = 0; i < batch.length; i++) {
        const { row, message } = batch[i];
        const ticket = tickets[i];
        const sentAt = new Date().toISOString();

        if (!ticket) {
          // Expo gave us nothing for this slot; record it rather than resend blindly
          summary.errors += 1;
          summary.failures.push({ notification_id: row.id, error: "no ticket returned" });
          await admin.from("notifications").update({ expo_receipt_status: "no_ticket" }).eq("id", row.id);
          continue;
        }

        if (ticket.status === "ok") {
          // receipt pending: status back to null so check-receipts picks it up
          const { error } = await admin
            .from("notifications")
            .update({ sent_at: sentAt, expo_ticket_id: ticket.id ?? null, expo_receipt_status: null })
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

    // 6. clear dead tokens. Match on the exact token that failed, and only if the
    //    profile has not been touched since we claimed (a fresh registration wins).
    if (deadTokens.size > 0) {
      const { data: cleared, error } = await admin
        .from("profiles")
        .update({ push_token: null })
        .in("push_token", [...deadTokens])
        .lte("updated_at", claimedAt)
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
