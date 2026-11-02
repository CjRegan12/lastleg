/** "+650", "-110", "EVEN" for 100. */
export function formatOdds(odds: number | null | undefined): string {
  if (odds == null || Number.isNaN(odds)) return "--";
  if (odds === 100) return "EVEN";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

/** "$12.50", "$1,250" (drops cents when whole dollars). */
export function formatMoney(amount: number | null | undefined, opts?: { signed?: boolean }): string {
  if (amount == null || Number.isNaN(amount)) return "--";
  const abs = Math.abs(amount);
  const whole = Number.isInteger(abs);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const sign = amount < 0 ? "-" : opts?.signed && amount > 0 ? "+" : "";
  return `${sign}$${body}`;
}

/** "just now", "4m", "2h", "3d", else short date. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (diffSec < 45) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Sun, Nov 2" from a YYYY-MM-DD slate date (interpreted as a calendar date, not UTC). */
export function formatSlateDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Today's date as YYYY-MM-DD in America/New_York (matches ensure_slate's default). */
export function todayNY(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Shift a YYYY-MM-DD by n days. */
export function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/** "+2.5", "-3", "47.5" style line text; null -> "". */
export function formatLine(line: number | null | undefined, market?: string | null): string {
  if (line == null) return "";
  if (market === "spread") return line > 0 ? `+${line}` : `${line}`;
  return `${line}`;
}

export function initials(handle: string | null | undefined): string {
  if (!handle) return "?";
  const clean = handle.replace(/[^a-zA-Z0-9]/g, "");
  return clean.slice(0, 2).toUpperCase() || "?";
}

export function pct(n: number | null | undefined): string {
  if (n == null) return "--";
  return `${Math.round(n * 100)}%`;
}
