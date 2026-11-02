/**
 * check-receipts: ask Expo what happened to pushes we sent >= 15 minutes ago.
 *
 * DEPLOY WITH JWT VERIFICATION OFF: `supabase functions deploy check-receipts --no-verify-jwt`.
 * Called by pg_cron every 15 minutes (see supabase/functions/README.md). Auth is the
 * `x-webhook-secret` header, which must equal the WEBHOOK_SECRET secret.
 *
 * Selects notifications with expo_ticket_id set, expo_receipt_status null and
 * sent_at between 24 hours and 15 minutes ago (limit 1000), POSTs the ticket ids
 * to exp.host getReceipts in chunks of 1000, and writes expo_receipt_status
 * ('ok' or the Expo error code). Expo keeps receipts for about a day, so rows
 * older than 24 hours with no receipt are marked 'expired' and never asked again.
 *
 * DeviceNotRegistered nulls the user's push_token, but only if the profile has not
 * been updated since that notification was sent (profiles.updated_at <= sent_at):
 * a token the app re-registered after the failed send is left alone.
 *
 * Receipts Expo has not produced yet are simply left for the next run.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const CHUNK = 1000;
const SELECT_LIMIT = 1000;
const MIN_AGE_MINUTES = 15;
const MAX_AGE_HOURS = 24;
const JSON_HEADERS = { "Content-Type": "application/json" };

interface PendingRow {
  id: number;
  user_id: string;
  expo_ticket_id: string;
  sent_at: string;
}

interface ExpoReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string; [k: string]: unknown };
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

async function fetchReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  const token = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(EXPO_RECEIPTS_URL, { method: "POST", headers, body: JSON.stringify({ ids }) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`exp.host ${res.status}: ${text.slice(0, 300)}`);
  }
  const payload = (await res.json()) as { data?: Record<string, ExpoReceipt> };
  if (!payload.data || typeof payload.data !== "object") throw new Error("exp.host malformed receipts response");
  return payload.data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const expected = Deno.env.get("WEBHOOK_SECRET");
  const provided = req.headers.get("x-webhook-secret");
  if (!expected || !provided || provided !== expected) return json({ error: "unauthorized" }, 401);

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const summary = {
    checked: 0,
    ok: 0,
    errors: 0,
    still_pending: 0,
    expired: 0,
    tokens_cleared: 0,
    failures: [] as string[],
  };

  try {
    const cutoff = new Date(Date.now() - MIN_AGE_MINUTES * 60_000).toISOString();
    const floor = new Date(Date.now() - MAX_AGE_HOURS * 3_600_000).toISOString();

    // 0. give up on anything older than Expo's receipt retention
    const { data: expiredRows, error: expErr } = await admin
      .from("notifications")
      .update({ expo_receipt_status: "expired" })
      .not("expo_ticket_id", "is", null)
      .is("expo_receipt_status", null)
      .lte("sent_at", floor)
      .select("id");
    if (expErr) summary.failures.push(`mark expired: ${expErr.message}`);
    else summary.expired = expiredRows?.length ?? 0;

    const { data, error } = await admin
      .from("notifications")
      .select("id, user_id, expo_ticket_id, sent_at")
      .not("expo_ticket_id", "is", null)
      .is("expo_receipt_status", null)
      .gt("sent_at", floor)
      .lt("sent_at", cutoff)
      .order("sent_at", { ascending: true })
      .limit(SELECT_LIMIT);
    if (error) throw new Error(`select pending receipts: ${error.message}`);

    const rows = (data ?? []) as PendingRow[];
    summary.checked = rows.length;
    if (rows.length === 0) return json(summary);

    // user_id -> latest sent_at among their DeviceNotRegistered receipts
    const usersToClear = new Map<string, string>();

    for (const batch of chunk(rows, CHUNK)) {
      let receipts: Record<string, ExpoReceipt>;
      try {
        receipts = await fetchReceipts(batch.map((r) => r.expo_ticket_id));
      } catch (e) {
        summary.failures.push(e instanceof Error ? e.message : String(e));
        continue;
      }

      const okIds: number[] = [];
      const errored: Array<{ id: number; code: string }> = [];

      for (const row of batch) {
        const receipt = receipts[row.expo_ticket_id];
        if (!receipt) {
          summary.still_pending += 1; // Expo has not produced it yet; retry next run
          continue;
        }
        if (receipt.status === "ok") {
          okIds.push(row.id);
          continue;
        }
        const code = receipt.details?.error ?? "error";
        errored.push({ id: row.id, code });
        if (code === "DeviceNotRegistered") {
          const prev = usersToClear.get(row.user_id);
          if (!prev || row.sent_at > prev) usersToClear.set(row.user_id, row.sent_at);
        }
      }

      if (okIds.length > 0) {
        const { error: upErr } = await admin
          .from("notifications")
          .update({ expo_receipt_status: "ok" })
          .in("id", okIds);
        if (upErr) summary.failures.push(`update ok: ${upErr.message}`);
        else summary.ok += okIds.length;
      }

      // group errored rows by code so each code is one update
      const byCode = new Map<string, number[]>();
      for (const e of errored) {
        const list = byCode.get(e.code) ?? [];
        list.push(e.id);
        byCode.set(e.code, list);
      }
      for (const [code, ids] of byCode) {
        const { error: upErr } = await admin
          .from("notifications")
          .update({ expo_receipt_status: code })
          .in("id", ids);
        if (upErr) summary.failures.push(`update ${code}: ${upErr.message}`);
        else summary.errors += ids.length;
      }
    }

    // Clear tokens only where the profile has not changed since the failed send.
    // Expo receipts do not echo the token, so updated_at <= sent_at is the guard.
    for (const [userId, sentAt] of usersToClear) {
      const { data: cleared, error: clearErr } = await admin
        .from("profiles")
        .update({ push_token: null })
        .eq("id", userId)
        .not("push_token", "is", null)
        .lte("updated_at", sentAt)
        .select("id");
      if (clearErr) summary.failures.push(`clear token ${userId}: ${clearErr.message}`);
      else summary.tokens_cleared += cleared?.length ?? 0;
    }

    return json(summary);
  } catch (e) {
    console.error("check-receipts failed", e);
    return json({ error: e instanceof Error ? e.message : "internal error", summary }, 500);
  }
});
