/**
 * Turns a customer's `frequency` + `postTime` briefing fields into an actual schedule the
 * posting routine can act on. Everything here is evaluated in Europe/Vienna wall-clock time
 * (the timezone customers actually think in when they pick "15:00"), regardless of the
 * server's own timezone.
 *
 * v4 adds granular per-weekday and per-channel scheduling plus a pause/vacation range, all
 * additive and opt-in:
 * - `isDue`/`nextPostAt` (no channel argument) keep their exact v3 behavior and signature -
 *   they use `activeWeekdays` (falling back to `frequency` as before) and an any-provider
 *   "already posted today" check, now also gated by `pauseFrom`/`pauseUntil`. A customer who
 *   never touches the new fields sees identical results to before.
 * - `isDueForChannel`/`nextPostAtForChannel` are new: they use `instagramWeekdays`/
 *   `linkedinWeekdays` when set (falling back to `activeWeekdays`/`frequency` otherwise) and a
 *   provider-specific "already posted today" check, so e.g. posting to Instagram today doesn't
 *   falsely mark LinkedIn as done. Keeping these separate from the combined isDue avoids a
 *   subtle bug: an OR-combined single `dueNow` would stay permanently true for a customer who
 *   only uses one channel, because the other, never-posted-to channel would look "always due".
 */
import { db } from "./db.js";

export type Frequency = "taeglich" | "werktags" | "3x-woche";
export type PostingChannel = "instagram" | "linkedin";
/**
 * Die Video-Diashow hat einen EIGENEN Wochenplan (siehe videos.ts) - sie ist technisch ein
 * Instagram-Beitrag, folgt aber nicht dem Instagram-Zeitplan. Deshalb ein eigener Kanalwert hier
 * statt eines Flags: nur so kann "heute schon gepostet?" auf Video-Beitraege eingegrenzt werden,
 * ohne dass ein normaler Feed-Beitrag am selben Tag das Video als erledigt markiert.
 */
export type SchedulableChannel = PostingChannel | "instagram_video";
/** Wert der posts.format-Spalte fuer Video-Diashows - hier gespiegelt, damit schedule.ts nicht von videos.ts abhaengt. */
const VIDEO_FORMAT = "video_slideshow";

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

function postingDaysFor(frequency: string | null | undefined): number[] {
  return POSTING_DAYS[(frequency as Frequency) ?? "werktags"] ?? POSTING_DAYS.werktags;
}

/** Parses a stored "1,3,5" weekday list (1=Monday..7=Sunday, the customer-facing convention) into internal Sun=0..Sat=6 numbers. */
function parseWeekdayList(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  const days = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
    .map((n) => n % 7); // 1..6 stay 1..6 (Mon..Sat), 7 (Sun) becomes 0
  return days.length ? days : null;
}

function parsePostTime(postTime: string | null): { hour: number; minute: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(postTime ?? "");
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : { hour: 15, minute: 0 };
}

/** True if `dateStr` (Vienna calendar date, YYYY-MM-DD) falls within the customer's pause/vacation range (inclusive). */
function isPausedOn(customer: ScheduleInput, dateStr: string): boolean {
  if (!customer.pauseFrom || !customer.pauseUntil) return false;
  return dateStr >= customer.pauseFrom && dateStr <= customer.pauseUntil;
}

/** True if this customer already has a logged post on the given Vienna calendar date (optionally restricted to one provider). */
function hasPostOnViennaDate(customerId: string, dateStr: string, provider?: PostingChannel, format?: string): boolean {
  // Posts cluster around "today" by definition, so the last handful is always enough to check -
  // avoids scanning the whole table for customers with a long history.
  const rows = (
    format && provider
      ? db
          .prepare("SELECT posted_at FROM posts WHERE customer_id = ? AND provider = ? AND format = ? ORDER BY posted_at DESC LIMIT 10")
          .all(customerId, provider, format)
      : provider
        ? db
            .prepare("SELECT posted_at FROM posts WHERE customer_id = ? AND provider = ? ORDER BY posted_at DESC LIMIT 10")
            .all(customerId, provider)
        : db.prepare("SELECT posted_at FROM posts WHERE customer_id = ? ORDER BY posted_at DESC LIMIT 10").all(customerId)
  ) as { posted_at: string }[];
  return rows.some((r) => viennaParts(new Date(r.posted_at)).dateStr === dateStr);
}

export interface ScheduleInput {
  customerId: string;
  frequency: string | null;
  postTime: string | null;
  /** "1,3,5" style, 1=Monday..7=Sunday. Falls back to `frequency` when unset. */
  activeWeekdays?: string | null;
  /** Per-channel override of activeWeekdays. Falls back to activeWeekdays (then frequency) when unset. */
  instagramWeekdays?: string | null;
  linkedinWeekdays?: string | null;
  /** Eigener Wochenplan der Video-Diashow. Anders als bei Instagram/LinkedIn gibt es hier KEINEN
   *  Rückfall auf activeWeekdays/frequency: ohne ausdrücklich gewählte Tage entsteht kein Video. */
  videoWeekdays?: string | null;
  /** Eigene Uhrzeit für Video-Beiträge. Leer = dieselbe wie für normale Beiträge (postTime). */
  videoPostTime?: string | null;
  /** Inclusive Vienna-date (YYYY-MM-DD) pause/vacation range. Nothing is due for either channel while "now" falls inside it. */
  pauseFrom?: string | null;
  pauseUntil?: string | null;
}

interface ScheduledSlot {
  dateStr: string;
  hour: number;
  minute: number;
  iso: string;
}

const LOOKAHEAD_DAYS = 60; // generous enough to see past a long vacation pause and still find a slot

function nextSlot(customer: ScheduleInput, now: Date, channel: SchedulableChannel | null): ScheduledSlot {
  const isVideo = channel === "instagram_video";
  const channelSpecific = channel === "instagram" ? customer.instagramWeekdays : channel === "linkedin" ? customer.linkedinWeekdays : undefined;
  const days = isVideo
    ? parseWeekdayList(customer.videoWeekdays) ?? [] // kein Rückfall, siehe ScheduleInput.videoWeekdays
    : parseWeekdayList(channelSpecific) ?? parseWeekdayList(customer.activeWeekdays) ?? postingDaysFor(customer.frequency);
  const { hour, minute } = parsePostTime(isVideo ? customer.videoPostTime || customer.postTime : customer.postTime);
  const provider: PostingChannel | undefined = isVideo ? "instagram" : (channel as PostingChannel | null) ?? undefined;
  const format = isVideo ? VIDEO_FORMAT : undefined;

  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    const candidate = new Date(now.getTime() + offset * 86_400_000);
    const { dateStr, weekday } = viennaParts(candidate);
    if (isPausedOn(customer, dateStr)) continue;
    if (!days.includes(weekday)) continue;
    if (hasPostOnViennaDate(customer.customerId, dateStr, provider, format)) continue;
    return { dateStr, hour, minute, iso: viennaWallClockToUtcIso(dateStr, hour, minute) };
  }
  // Should be unreachable outside of a 60-day-plus pause with no posting days at all, but keep
  // a sane fallback instead of throwing.
  const { dateStr } = viennaParts(now);
  return { dateStr, hour, minute, iso: viennaWallClockToUtcIso(dateStr, hour, minute) };
}

function dueFromSlot(slot: ScheduledSlot, now: Date): boolean {
  const today = viennaParts(now);
  if (slot.dateStr !== today.dateStr) return false;
  return today.hour * 60 + today.minute >= slot.hour * 60 + slot.minute;
}

/** ISO timestamp of this customer's next planned (not yet posted) slot - combined across channels, v3-compatible. */
export function nextPostAt(customer: ScheduleInput, now: Date = new Date()): string {
  return nextSlot(customer, now, null).iso;
}

/**
 * True exactly when: today is not inside a pause/vacation range, today is one of this
 * customer's posting days (`activeWeekdays`, falling back to `frequency`), the configured post
 * time has been reached (Europe/Vienna wall clock), and no post has been logged for them today
 * yet on any channel. Combined across channels, v3-compatible signature and behavior.
 */
export function isDue(customer: ScheduleInput, now: Date = new Date()): boolean {
  return dueFromSlot(nextSlot(customer, now, null), now);
}

/** Same as `nextPostAt`, but for one specific channel - respects `instagramWeekdays`/`linkedinWeekdays` and only counts posts on that channel as "already posted". */
export function nextPostAtForChannel(customer: ScheduleInput, channel: SchedulableChannel, now: Date = new Date()): string {
  return nextSlot(customer, now, channel).iso;
}

/** Same as `isDue`, but for one specific channel - see `nextPostAtForChannel`. */
export function isDueForChannel(customer: ScheduleInput, channel: SchedulableChannel, now: Date = new Date()): boolean {
  return dueFromSlot(nextSlot(customer, now, channel), now);
}

/**
 * Day-level version of isDueForChannel for planning.ts (v5): would this channel get a post AT
 * ALL on this calendar day, ignoring both time-of-day and "already posted" (planning runs once,
 * long before the post time, and checks planned_posts for idempotency itself - not the posts
 * table). Returns the Vienna calendar date the given instant falls on, so callers don't need
 * their own date-string derivation to stay consistent with the rest of this module.
 */
/** The Vienna calendar date (YYYY-MM-DD) a UTC instant falls on - planned_posts.scheduled_for and the panel's date-range queries use this, to stay consistent with the Vienna-based weekday/pause logic above (a naive UTC date string would occasionally disagree by one day near midnight). */
export function viennaDateStr(date: Date = new Date()): string {
  return viennaParts(date).dateStr;
}

export function isPostingDayForChannel(customer: ScheduleInput, channel: PostingChannel, date: Date): { dateStr: string; due: boolean } {
  const channelSpecific = channel === "instagram" ? customer.instagramWeekdays : customer.linkedinWeekdays;
  const days = parseWeekdayList(channelSpecific) ?? parseWeekdayList(customer.activeWeekdays) ?? postingDaysFor(customer.frequency);
  const { dateStr, weekday } = viennaParts(date);
  return { dateStr, due: !isPausedOn(customer, dateStr) && days.includes(weekday) };
}

/**
 * Ist für diesen Kunden JETZT eine Video-Diashow fällig? Eigene Funktion statt eines weiteren
 * Kanalwerts in isDueForChannel-Aufrufern, damit an den Aufrufstellen sofort lesbar ist, dass hier
 * ein eigener Wochenplan gilt - und damit der Fall "keine Video-Tage gewählt" (nie fällig)
 * garantiert nicht versehentlich auf den allgemeinen Zeitplan zurückfällt.
 */
export function isVideoDue(customer: ScheduleInput, now: Date = new Date()): boolean {
  if (!parseWeekdayList(customer.videoWeekdays)) return false;
  return isDueForChannel(customer, "instagram_video", now);
}

/** Nächster geplanter Video-Termin (ISO) - null, wenn der Kunde keine Video-Tage gewählt hat. */
export function nextVideoPostAt(customer: ScheduleInput, now: Date = new Date()): string | null {
  if (!parseWeekdayList(customer.videoWeekdays)) return null;
  return nextPostAtForChannel(customer, "instagram_video", now);
}
