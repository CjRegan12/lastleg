/**
 * Eval harness for the parse-slip Edge Function.
 *
 *   node --experimental-strip-types scripts/eval-parse.ts [--filter draftkings] [--threshold 0.95]
 *
 * For each evals/slips/<book>/<name>.jpg (or .png/.webp) with a sibling <name>.expected.json:
 *   1. upload the image to the `slips` bucket under the eval user's folder (Storage REST API)
 *   2. call the deployed parse-slip function with the eval user's JWT
 *   3. compare parsed fields to expected, print per-slip and aggregate accuracy
 *   4. delete the uploaded object
 * Exit code 1 when aggregate field accuracy is below the threshold (default 0.95).
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, EVAL_USER_JWT (access token of a test user),
 *      optional EVAL_ROOM_ID (any uuid; parse-slip does not read it).
 * No dependencies: Node 22 built-ins only.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import process from "node:process";

// ---------- types (mirror supabase/functions/parse-slip/schema.ts) ----------
interface ExpectedLeg {
  market: string;
  line: number | null;
  player_name: string | null;
  selection: string;
}

interface Expected {
  book: string;
  bet_type: string;
  stake: number;
  odds_american: number;
  potential_payout: number;
  legs: ExpectedLeg[];
}

interface ParsedLeg extends ExpectedLeg {
  sport: string;
  stat_type: string | null;
  teams: string[];
  confidence: number;
}

interface Parsed extends Expected {
  legs: ParsedLeg[];
  overall_confidence: number;
}

interface ParseResponse {
  parsed: Parsed;
  matches: unknown[];
  model_used: string;
  escalated?: boolean;
  usage: { input_tokens: number; output_tokens: number };
}

interface FieldResult {
  field: string;
  expected: unknown;
  actual: unknown;
  ok: boolean;
}

interface SlipResult {
  name: string;
  fields: FieldResult[];
  model_used?: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
}

// ---------- args / env ----------
const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const FILTER = arg("filter");
const THRESHOLD = Number(arg("threshold") ?? "0.95");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env ${name}`);
    process.exit(2);
  }
  return v;
}
const SUPABASE_URL = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const USER_JWT = requireEnv("EVAL_USER_JWT");
const ROOM_ID = process.env.EVAL_ROOM_ID ?? "00000000-0000-0000-0000-000000000000";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const SLIPS_DIR = join(ROOT, "evals", "slips");
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

// ---------- helpers ----------
function userIdFromJwt(jwt: string): string {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new Error("EVAL_USER_JWT is not a JWT");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: string };
  if (!payload.sub) throw new Error("JWT has no sub claim");
  return payload.sub;
}

function norm(v: unknown): unknown {
  if (typeof v === "string") return v.trim().toLowerCase().replace(/\s+/g, " ");
  if (typeof v === "number") return Math.round(v * 100) / 100;
  if (v === undefined) return null;
  return v;
}

function eq(a: unknown, b: unknown): boolean {
  return norm(a) === norm(b);
}

function compare(expected: Expected, parsed: Parsed): FieldResult[] {
  const out: FieldResult[] = [];
  const top: Array<keyof Expected> = ["book", "bet_type", "stake", "odds_american", "potential_payout"];
  for (const f of top) out.push({ field: f, expected: expected[f], actual: parsed[f], ok: eq(expected[f], parsed[f]) });

  out.push({
    field: "legs.length",
    expected: expected.legs.length,
    actual: parsed.legs.length,
    ok: expected.legs.length === parsed.legs.length,
  });

  expected.legs.forEach((exp, i) => {
    const act = parsed.legs[i];
    const legFields: Array<keyof ExpectedLeg> = ["market", "line", "player_name", "selection"];
    for (const f of legFields) {
      out.push({
        field: `legs[${i}].${f}`,
        expected: exp[f],
        actual: act ? act[f] : undefined,
        ok: act ? eq(exp[f], act[f]) : false,
      });
    }
  });
  return out;
}

async function uploadImage(userId: string, file: string): Promise<string> {
  const ext = extname(file).toLowerCase();
  const objectPath = `${userId}/eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const bytes = await readFile(file);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/slips/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${USER_JWT}`,
      apikey: ANON_KEY,
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "x-upsert": "false",
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return objectPath;
}

async function deleteImage(objectPath: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/storage/v1/object/slips/${objectPath}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${USER_JWT}`, apikey: ANON_KEY },
  }).catch(() => undefined);
}

async function callParse(storagePath: string): Promise<ParseResponse> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/parse-slip`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${USER_JWT}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ storage_path: storagePath, room_id: ROOM_ID }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`parse-slip ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as ParseResponse;
}

async function findCases(): Promise<Array<{ name: string; image: string; expected: string }>> {
  const cases: Array<{ name: string; image: string; expected: string }> = [];
  let books: string[];
  try {
    books = await readdir(SLIPS_DIR);
  } catch {
    return cases;
  }
  for (const book of books) {
    if (FILTER && book !== FILTER) continue;
    const dir = join(SLIPS_DIR, book);
    if (!(await stat(dir)).isDirectory()) continue;
    for (const f of await readdir(dir)) {
      const ext = extname(f).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      const stem = basename(f, ext);
      const expected = join(dir, `${stem}.expected.json`);
      try {
        await stat(expected);
      } catch {
        console.warn(`skip ${book}/${f}: no ${stem}.expected.json`);
        continue;
      }
      cases.push({ name: `${book}/${stem}`, image: join(dir, f), expected });
    }
  }
  return cases.sort((a, b) => a.name.localeCompare(b.name));
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

// ---------- main ----------
async function main(): Promise<void> {
  const userId = userIdFromJwt(USER_JWT);
  const cases = await findCases();
  if (cases.length === 0) {
    console.error(`no eval cases found under ${SLIPS_DIR} (need <name>.jpg + <name>.expected.json)`);
    process.exit(2);
  }
  console.log(`running ${cases.length} slip(s) as user ${userId}\n`);

  const results: SlipResult[] = [];
  for (const c of cases) {
    const expected = JSON.parse(await readFile(c.expected, "utf8")) as Expected;
    let objectPath: string | null = null;
    try {
      objectPath = await uploadImage(userId, c.image);
      const resp = await callParse(objectPath);
      const fields = compare(expected, resp.parsed);
      results.push({ name: c.name, fields, model_used: resp.model_used, usage: resp.usage });
    } catch (e) {
      results.push({ name: c.name, fields: [], error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (objectPath) await deleteImage(objectPath);
    }
  }

  // report
  let totalFields = 0;
  let okFields = 0;
  let totalIn = 0;
  let totalOut = 0;
  const failedByField = new Map<string, number>();

  for (const r of results) {
    if (r.error) {
      console.log(`FAIL  ${r.name}\n      ${r.error}\n`);
      continue;
    }
    const ok = r.fields.filter((f) => f.ok).length;
    totalFields += r.fields.length;
    okFields += ok;
    totalIn += r.usage?.input_tokens ?? 0;
    totalOut += r.usage?.output_tokens ?? 0;
    const tag = ok === r.fields.length ? "PASS " : "MISS ";
    console.log(`${tag} ${r.name}  ${ok}/${r.fields.length} (${pct(ok, r.fields.length)})  model=${r.model_used}`);
    for (const f of r.fields) {
      if (f.ok) continue;
      const key = f.field.replace(/\[\d+\]/, "[]");
      failedByField.set(key, (failedByField.get(key) ?? 0) + 1);
      console.log(`      ${f.field}: expected ${JSON.stringify(f.expected)} got ${JSON.stringify(f.actual)}`);
    }
    console.log();
  }

  const errored = results.filter((r) => r.error).length;
  const accuracy = totalFields === 0 ? 0 : okFields / totalFields;

  console.log("---");
  console.log(`slips: ${results.length}  errored: ${errored}`);
  console.log(`field accuracy: ${okFields}/${totalFields} (${pct(okFields, totalFields)})  threshold ${THRESHOLD}`);
  console.log(`tokens: in ${totalIn}  out ${totalOut}`);
  if (failedByField.size > 0) {
    console.log("misses by field:");
    for (const [k, v] of [...failedByField.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  }

  if (errored > 0 || accuracy < THRESHOLD) {
    console.log(`\nRESULT: FAIL`);
    process.exit(1);
  }
  console.log(`\nRESULT: PASS`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
