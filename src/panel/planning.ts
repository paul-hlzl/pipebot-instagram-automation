/**
 * Server-side daily pre-planning (Panel v5, task 4): generates up to 7 days of upcoming posts
 * per active customer/channel AHEAD of time, as plain Node function calls into the same
 * underlying modules the MCP tools use (fal.ts, watermark.ts via generateImageUrl,
 * anthropic.ts, instagram.ts via getStyleSamples) - deliberately NOT through an MCP tool or a
 * Claude Code routine, so the panel can show/let customers edit a whole week at once instead of
 * generating one post per hourly routine tick.
 *
 * This is purely additive to the existing K1-K9 routine: planUpcomingPosts() only ever CREATES
 * planned_posts rows ahead of time. Nothing here publishes anything or touches pending_approvals
 * or the posts table - the routine (with docs/ROUTINE_TEIL1_V5.md's new K0 step) is still the
 * only thing that ever actually publishes, and still generates on the spot as a fallback for any
 * customer/day this run skipped or hasn't reached yet (task 6).
 */
import { db, nowIso, type CustomerRow } from "./db.js";
import {
  assertNoBannedWords,
  assertRequiredElements,
  CHANNEL_IMAGE_FORMAT,
  createPlannedPost,
  getPlannedPostByChannelDate,
  getStyleSamples,
  listContentPillars,
  logPlanningError,
  pickWeightedPillar,
  resolveImageBranding,
  scheduleInputFor,
  splitCommaList,
  type ContentPillar,
  type PublishChannel,
} from "./credentials.js";
import { isPostingDayForChannel, type PostingChannel } from "./schedule.js";
import { anthropicAvailable, generatePlannedPostContent } from "../anthropic.js";
import { generateImageUrl } from "../fal.js";

const LOOKAHEAD_DAYS = 7;

type PlannableChannel = PublishChannel;

const CHANNEL_SCHEDULE: Record<PlannableChannel, PostingChannel> = {
  ig_feed: "instagram",
  ig_story: "instagram",
  linkedin: "linkedin",
};

function checkTextsFor(channel: PlannableChannel, headline: string, caption: string): (string | undefined)[] {
  // Mirrors save_pending_approval's fix from the previous session: ig_story is only ever
  // checked/published by headline (Instagram Stories have no caption), everything else by
  // headline+caption combined - a mismatch here would let a planned story through that then
  // fails required-element checks forever once the routine actually tries to publish it.
  return channel === "ig_story" ? [headline] : [headline, caption];
}

interface PlanOneResult {
  planned: boolean;
}

async function planOnePost(row: CustomerRow, channel: PlannableChannel, scheduledFor: string, pillar: ContentPillar | null): Promise<PlanOneResult> {
  const styleSamples = await getStyleSamples(row.id);
  const bannedWords = splitCommaList(row.banned_words);
  const requiredElements = splitCommaList(row.required_elements);

  const baseInput = {
    channel,
    company: row.company,
    industry: row.industry ?? "",
    about: row.about ?? "",
    tone: row.tone ?? "sachlich",
    language: row.language ?? "de",
    hashtagPreference: row.hashtag_pref ?? "wenige",
    emojisEnabled: Boolean(row.emojis_enabled),
    pillarTitle: pillar?.title ?? null,
    pillarDescription: pillar?.description ?? null,
    bannedWords,
    requiredElements,
    styleSamples: styleSamples.samples.map((s) => s.caption).filter((c): c is string => Boolean(c)).slice(0, 5),
  };

  let content = await generatePlannedPostContent(baseInput);
  try {
    assertNoBannedWords(row.id, ...checkTextsFor(channel, content.headline, content.caption));
    assertRequiredElements(row.id, ...checkTextsFor(channel, content.headline, content.caption));
  } catch (err) {
    // One retry, feeding back exactly what was wrong - same "retry ONCE, don't retry forever
    // and don't give up after one attempt either" policy as K7 in the routine.
    const avoidNote = err instanceof Error ? err.message : String(err);
    content = await generatePlannedPostContent({ ...baseInput, avoidNote });
    assertNoBannedWords(row.id, ...checkTextsFor(channel, content.headline, content.caption));
    assertRequiredElements(row.id, ...checkTextsFor(channel, content.headline, content.caption));
  }

  const branding = resolveImageBranding(row.id);
  const generated = await generateImageUrl(content.headline, CHANNEL_IMAGE_FORMAT[channel], branding);

  createPlannedPost({
    customerId: row.id,
    channel,
    scheduledFor,
    headline: content.headline,
    caption: content.caption,
    imageUrl: generated.imageUrl,
    pillarTitle: pillar?.title,
    accentColorUsed: branding.accentColor,
  });
  return { planned: true };
}

export interface PlanningRunSummary {
  startedAt: string;
  finishedAt: string;
  customersChecked: number;
  planned: number;
  skippedExisting: number;
  errors: number;
}

/**
 * Runs one full planning pass: every active, non-trial-expired, non-paused customer x every
 * enabled channel x the next 7 days. Idempotent (checks getPlannedPostByChannelDate first), so
 * running it more than once a day, or re-running after a partial failure, never creates
 * duplicates. A failure for one customer/day/channel is logged (logPlanningError) and skipped -
 * it NEVER aborts the rest of the run (task 8's safety net).
 */
export async function planUpcomingPosts(): Promise<PlanningRunSummary> {
  const startedAt = nowIso();
  let customersChecked = 0;
  let planned = 0;
  let skippedExisting = 0;
  let errors = 0;

  if (!anthropicAvailable()) {
    logPlanningError(null, null, null, "ANTHROPIC_API_KEY fehlt - Vorausplanung komplett übersprungen.");
    return { startedAt, finishedAt: nowIso(), customersChecked: 0, planned: 0, skippedExisting: 0, errors: 1 };
  }

  const rows = db.prepare("SELECT * FROM customers WHERE status = 'active'").all() as CustomerRow[];
  for (const row of rows) {
    customersChecked++;
    if (row.customer_paused) continue;
    if (row.trial_ends_at && new Date(row.trial_ends_at).getTime() < Date.now()) continue;

    const scheduleInput = scheduleInputFor(row);
    const pillars = listContentPillars(row.id);
    // Tracks the pillar assigned to the previous planned day/channel THIS run, so a freshly
    // generated 7-day week rotates pillars instead of all landing on the same one -
    // pickPillarForToday's DB-based "avoid last real post" check can't see that, since no new
    // `posts` rows exist yet mid-planning (see pickWeightedPillar's doc comment).
    let lastPillarTitle: string | null = null;

    const channelDefs: { channel: PlannableChannel; enabled: boolean }[] = [
      { channel: "ig_feed", enabled: Boolean(row.ig_feed_enabled) },
      { channel: "ig_story", enabled: Boolean(row.ig_story_enabled) },
      { channel: "linkedin", enabled: Boolean(row.linkedin_enabled) },
    ];

    for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
      const date = new Date(Date.now() + offset * 86_400_000);
      for (const { channel, enabled } of channelDefs) {
        if (!enabled) continue;
        const { dateStr, due } = isPostingDayForChannel(scheduleInput, CHANNEL_SCHEDULE[channel], date);
        if (!due) continue;
        if (getPlannedPostByChannelDate(row.id, channel, dateStr)) {
          skippedExisting++;
          continue;
        }
        const pillar = pickWeightedPillar(pillars, lastPillarTitle);
        if (pillar) lastPillarTitle = pillar.title;
        try {
          await planOnePost(row, channel, dateStr, pillar);
          planned++;
        } catch (err) {
          errors++;
          const message = err instanceof Error ? err.message : String(err);
          logPlanningError(row.id, channel, dateStr, message);
          console.error(`[panel] Vorausplanung fehlgeschlagen für ${row.id}/${channel}/${dateStr}:`, message);
        }
      }
    }
  }

  return { startedAt, finishedAt: nowIso(), customersChecked, planned, skippedExisting, errors };
}

function msUntilNextUtcHour(hourUtc: number): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Starts the once-daily planning run at a fixed UTC wall-clock hour (default 03:00 - clear of
 * both the 14:30-15:45 UTC own-account blackout and every hourly Kunden-Loop fire, which lands
 * on the hour). Unlike startTokenRefreshSchedule's simple setInterval (fine for "roughly every N
 * hours"), this deliberately anchors to a specific UTC hour so a server restart at some random
 * time of day doesn't permanently shift when planning runs.
 */
export function startDailyPlanningSchedule(hourUtc = 3): NodeJS.Timeout {
  const run = () =>
    planUpcomingPosts()
      .then((summary) => console.log("[panel] Tägliche Vorausplanung:", summary))
      .catch((err) => console.error("[panel] Tägliche Vorausplanung unerwartet fehlgeschlagen:", err));
  return setTimeout(() => {
    run();
    setInterval(run, 24 * 3_600_000);
  }, msUntilNextUtcHour(hourUtc));
}
