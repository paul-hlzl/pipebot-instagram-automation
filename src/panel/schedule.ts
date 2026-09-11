/**
 * Turns a customer's `frequency` + `postTime` briefing fields into an actual schedule the
 * posting routine can act on. Everything here is evaluated in Europe/Vienna wall-clock time
 * (the timezone customers actually think in when they pick "15:00"), regardless of the
 * server's own timezone.
 */
import { db } from "./db.js";

export type Frequency = "taeglich" | "werktags" | "3x-woche";

// JS-style weekday numbers as produced by Intl's "short" weekday formatting below: Sun=0..Sat=6.
const POSTING_DAYS: Record<Frequency, number[]> = {
  taeglich: [0, 1, 2, 3, 4, 5, 6],
  werktags: [1, 2, 3, 4, 5],
  "3x-woche": [1, 3, 5], // Mo, Mi, Fr
};

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

interface ViennaParts {
  dateStr: string; // YYYY-MM-DD
  weekday: number; // 0=Sun..6=Sat
  hour: number;
  minute: number;
}

/** Reads the wall-clock date/time/weekday a UTC instant corresponds to in Europe/Vienna. */
function viennaParts(date: Date): ViennaParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Vienna",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value])) as Record<string, string>;
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 1,
    hour: Number(parts.hour) % 24, // ICU can render midnight as "24"
    minute: Number(parts.minute),
  };
}

/** Europe/Vienna's UTC offset (in minutes) at the given instant - handles CET/CEST automatically. */
function viennaOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Vienna", timeZoneName: "shortOffset" });
  const raw = fmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(raw);
  if (!m) return 60;
  const sign = m[1].startsWith("-") ? -1 : 1;
  return Number(m[1]) * 60 + sign * Number(m[2] ?? 0);
}

/** Builds the UTC instant for a given Vienna wall-clock date + time, correct across DST changes. */
function viennaWallClockToUtcIso(dateStr: string, hour: number, minute: number): string {
  // Use local noon on that calendar date to read the correct offset (avoids the 1-3am DST
  // transition hour itself, which is the only time this shortcut could misjudge the offset).
  const offsetAtNoon = viennaOffsetMinutes(new Date(`${dateStr}T12:00:00Z`));
  const utcGuessMs = Date.parse(`${dateStr}T${pad(hour)}:${pad(minute)}:00Z`) - offsetAtNoon * 60_000;
  return new Date(utcGuessMs).toISOString();
}

function postingDaysFor(frequency: string | null): number[] {
  return POSTING_DAYS[(frequency as Frequency) ?? "werktags"] ?? POSTING_DAYS.werktags;
}

function parsePostTime(postTime: string | null): { hour: number; minute: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(postTime ?? "");
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : { hour: 15, minute: 0 };
}

/** True if this customer already has a logged post on the given Vienna calendar date. */
function hasPostOnViennaDate(customerId: string, dateStr: string): boolean {
  // Posts cluster around "today" by definition, so the last handful is always enough to check -
  // avoids scanning the whole table for customers with a long history.
  const rows = db
    .prepare("SELECT posted_at FROM posts WHERE customer_id = ? ORDER BY posted_at DESC LIMIT 10")
    .all(customerId) as { posted_at: string }[];
  return rows.some((r) => viennaParts(new Date(r.posted_at)).dateStr === dateStr);
}

interface ScheduleInput {
  customerId: string;
  frequency: string | null;
  postTime: string | null;
}

interface ScheduledSlot {
  dateStr: string;
  hour: number;
  minute: number;
  iso: string;
}

/** The next posting slot (today or a future day) that doesn't have a post logged yet. */
function nextSlot(customer: ScheduleInput, now: Date): ScheduledSlot {
  const days = postingDaysFor(customer.frequency);
  const { hour, minute } = parsePostTime(customer.postTime);
  for (let offset = 0; offset < 14; offset++) {
    const candidate = new Date(now.getTime() + offset * 86_400_000);
    const { dateStr, weekday } = viennaParts(candidate);
    if (!days.includes(weekday)) continue;
    if (hasPostOnViennaDate(customer.customerId, dateStr)) continue;
    return { dateStr, hour, minute, iso: viennaWallClockToUtcIso(dateStr, hour, minute) };
  }
  // Should be unreachable (every frequency hits at least one day within a week), but keep a
  // sane fallback instead of throwing.
  const { dateStr } = viennaParts(now);
  return { dateStr, hour, minute, iso: viennaWallClockToUtcIso(dateStr, hour, minute) };
}

/** ISO timestamp of this customer's next planned (not yet posted) slot. */
export function nextPostAt(customer: ScheduleInput, now: Date = new Date()): string {
  return nextSlot(customer, now).iso;
}

/**
 * True exactly when: today is one of this customer's posting days, the configured post time
 * has been reached (Europe/Vienna wall clock), and no post has been logged for them today yet.
 */
export function isDue(customer: ScheduleInput, now: Date = new Date()): boolean {
  const today = viennaParts(now);
  const slot = nextSlot(customer, now);
  if (slot.dateStr !== today.dateStr) return false;
  return today.hour * 60 + today.minute >= slot.hour * 60 + slot.minute;
}
