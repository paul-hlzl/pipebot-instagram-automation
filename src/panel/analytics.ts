/**
 * Analytics (Panel v9, channel-split in v20) - daily account snapshots + per-post engagement
 * snapshots, stored so the panel can show a 30-day trend instead of just "right now". Mirrors
 * planning.ts's shape: a daily cron (startDailyAnalyticsSnapshotSchedule) that loops every active
 * customer, one failure never aborts the run for anyone else (same K9-style isolation as the
 * customer-loop routine and planUpcomingPosts).
 *
 * v20: everything below takes an explicit `channel` instead of assuming Instagram, so LinkedIn
 * can be wired in later (once the Community Management API partner review clears - see
 * docs/LINKEDIN_COMMUNITY_API.md) by adding one fetch call to runDailyAnalyticsSnapshot, not by
 * touching this file's shape again. LinkedIn itself is NOT fetched yet (linkedin-analytics.ts
 * exists and is tested standalone, but isn't called from the cron - see that file's header).
 */
import { db, nowIso, type AnalyticsAccountSnapshotRow, type AnalyticsSummaryRow, type CustomerRow, type PostRow } from "./db.js";
import { resolveInstagramCredentials } from "./credentials.js";
import { fetchAccountInsights, fetchMediaInsights } from "../instagram-insights.js";
import { viennaDateStr } from "./schedule.js";
import { randomToken } from "./crypto.js";
import { generateAnalyticsSummary } from "../anthropic.js";
import { sendMailBestEffort } from "./mailer.js";
import { weeklyAnalyticsReportEmail } from "./emails.js";

export type AnalyticsChannel = "instagram" | "linkedin";

function toAccountSnapshot(r: AnalyticsAccountSnapshotRow) {
  return {
    id: r.id,
    customerId: r.customer_id,
    channel: r.channel as AnalyticsChannel,
    date: r.snapshot_date,
    followerCount: r.follower_count,
    reach: r.reach,
    views: r.views,
    accountsEngaged: r.accounts_engaged,
    totalInteractions: r.total_interactions,
  };
}
export type AccountSnapshot = ReturnType<typeof toAccountSnapshot>;

/** Idempotent per customer/channel/day - a second run on the same Vienna calendar date overwrites, never duplicates. */
export function saveAccountSnapshot(
  customerId: string,
  channel: AnalyticsChannel,
  dateStr: string,
  data: { followerCount: number | null; reach: number | null; views: number | null; accountsEngaged: number | null; totalInteractions: number | null },
): void {
  db.prepare(
    `INSERT INTO analytics_account_snapshots (id, customer_id, channel, snapshot_date, follower_count, reach, views, accounts_engaged, total_interactions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(customer_id, snapshot_date, channel) DO UPDATE SET
       follower_count = excluded.follower_count, reach = excluded.reach, views = excluded.views,
       accounts_engaged = excluded.accounts_engaged, total_interactions = excluded.total_interactions`,
  ).run(`ansnap_${randomToken(9)}`, customerId, channel, dateStr, data.followerCount, data.reach, data.views, data.accountsEngaged, data.totalInteractions, nowIso());
}

/** Last `days` days of account snapshots for one customer/channel, oldest first (chart-friendly order). */
export function listAccountSnapshots(customerId: string, channel: AnalyticsChannel, days = 30): AccountSnapshot[] {
  const rows = db
    .prepare("SELECT * FROM analytics_account_snapshots WHERE customer_id = ? AND channel = ? ORDER BY snapshot_date DESC LIMIT ?")
    .all(customerId, channel, days) as AnalyticsAccountSnapshotRow[];
  return rows.map(toAccountSnapshot).reverse();
}

export function savePostSnapshot(
  postId: string,
  customerId: string,
  data: { likes: number | null; comments: number | null; saved: number | null; shares: number | null; reach: number | null },
): void {
  db.prepare(
    `INSERT INTO analytics_post_snapshots (id, post_id, customer_id, likes, comments, saved, shares, reach, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`posnap_${randomToken(9)}`, postId, customerId, data.likes, data.comments, data.saved, data.shares, data.reach, nowIso());
}

interface TopPost {
  postId: string;
  headline: string | null;
  caption: string | null;
  imageUrl: string | null;
  postedAt: string;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  reach: number | null;
  engagementScore: number;
}

/** The `limit` best-performing Instagram posts from the last `days` days, ranked by likes+comments+saved
 *  (a simple, transparent score - no attempt to reverse-engineer Instagram's own ranking algorithm). Uses
 *  each post's MOST RECENT snapshot only (engagement keeps growing after publish, an old snapshot would
 *  understate a post that's still gaining traction). Posts with no snapshot yet are excluded, not
 *  shown with zeroes - a snapshot simply hasn't been fetched for them yet. */
export function listTopPosts(customerId: string, channel: AnalyticsChannel, days = 30, limit = 3): TopPost[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT p.id as post_id, p.headline, p.caption, p.image_url, p.posted_at,
              s.likes, s.comments, s.saved, s.reach
       FROM posts p
       JOIN analytics_post_snapshots s ON s.id = (
         SELECT id FROM analytics_post_snapshots WHERE post_id = p.id ORDER BY fetched_at DESC LIMIT 1
       )
       WHERE p.customer_id = ? AND p.provider = ? AND p.posted_at >= ?`,
    )
    .all(customerId, channel, since) as {
    post_id: string; headline: string | null; caption: string | null; image_url: string | null; posted_at: string;
    likes: number | null; comments: number | null; saved: number | null; reach: number | null;
  }[];
  return rows
    .map((r) => ({
      postId: r.post_id,
      headline: r.headline,
      caption: r.caption,
      imageUrl: r.image_url,
      postedAt: r.posted_at,
      likes: r.likes,
      comments: r.comments,
      saved: r.saved,
      reach: r.reach,
      engagementScore: (r.likes ?? 0) + (r.comments ?? 0) + (r.saved ?? 0),
    }))
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, limit);
}

function sumField(rows: AccountSnapshot[], field: "reach" | "views" | "totalInteractions"): number {
  return rows.reduce((sum, r) => sum + (r[field] ?? 0), 0);
}

export interface AnalyticsSummaryWindow {
  followerCount: number | null;
  followerGrowth: number | null;
  reach: number;
  views: number;
  engagementRate: number | null;
}

export interface AnalyticsSummary {
  hasData: boolean;
  channel: AnalyticsChannel;
  /** False only for 'linkedin' until the Community Management API partner review clears - see
   *  docs/LINKEDIN_COMMUNITY_API.md. The panel uses this to show a clear "why" instead of a
   *  silent empty chart (never leave something non-functional unexplained - see styleguide). */
  available: boolean;
  current: AnalyticsSummaryWindow;
  previous: AnalyticsSummaryWindow;
  reach30d: number;
  views30d: number;
  trend: AccountSnapshot[];
  topPosts: TopPost[];
}

/** Whether this channel's analytics can currently produce any data at all - distinct from
 *  `hasData` (which is about whether a snapshot happens to exist yet). LinkedIn analytics need
 *  r_member_postAnalytics, which requires Community Management API access (still pending, see
 *  docs/LINKEDIN_COMMUNITY_API.md) - until then it's not a bug, it's a known, explained gap. */
export function isAnalyticsChannelAvailable(channel: AnalyticsChannel): boolean {
  return channel === "instagram";
}

/**
 * Everything the panel's Analytics tab needs in one call: this week's key numbers, the same
 * numbers for the week before (for the ↑/↓ % comparison the panel shows), the 30-day trend for
 * the chart, and the top posts. `hasData` is false when the cron hasn't produced a single
 * snapshot yet (brand new connection, or account not yet approved for insights - see session
 * report) - the panel shows an honest "noch keine Daten" state instead of a chart full of zeroes.
 */
export function getAnalyticsSummary(customerId: string, channel: AnalyticsChannel = "instagram"): AnalyticsSummary {
  const available = isAnalyticsChannelAvailable(channel);
  const snapshots = available ? listAccountSnapshots(customerId, channel, 30) : [];
  const topPosts = available ? listTopPosts(customerId, channel, 30, 3) : [];
  if (!snapshots.length) {
    const empty: AnalyticsSummaryWindow = { followerCount: null, followerGrowth: null, reach: 0, views: 0, engagementRate: null };
    return { hasData: false, channel, available, current: empty, previous: empty, reach30d: 0, views30d: 0, trend: [], topPosts: [] };
  }

  // snapshots is oldest-first (see listAccountSnapshots) - the last 7 are "this week", the 7
  // before that are "last week" (a partial history simply yields a shorter/empty "previous"
  // window rather than throwing - a brand-new connection has no 14-day history yet).
  const last7 = snapshots.slice(-7);
  const prev7 = snapshots.slice(-14, -7);

  const windowFor = (rows: AccountSnapshot[]): AnalyticsSummaryWindow => {
    if (!rows.length) return { followerCount: null, followerGrowth: null, reach: 0, views: 0, engagementRate: null };
    const latest = rows[rows.length - 1];
    const earliest = rows[0];
    const reach = sumField(rows, "reach");
    const interactions = sumField(rows, "totalInteractions");
    return {
      followerCount: latest.followerCount,
      followerGrowth: latest.followerCount != null && earliest.followerCount != null ? latest.followerCount - earliest.followerCount : null,
      reach,
      views: sumField(rows, "views"),
      engagementRate: reach > 0 ? Math.round((interactions / reach) * 1000) / 10 : null,
    };
  };

  return {
    hasData: true,
    channel,
    available,
    current: windowFor(last7),
    previous: windowFor(prev7),
    reach30d: sumField(snapshots, "reach"),
    views30d: sumField(snapshots, "views"),
    trend: snapshots,
    topPosts,
  };
}

/** Best-effort cost logging (Panel v9 Aufgabe 3) - never blocks the feature it's logging for if the insert itself fails. */
export function logUsageCost(customerId: string | null, feature: string, estimatedCostUsd: number | null): void {
  try {
    db.prepare("INSERT INTO usage_costs (id, customer_id, feature, estimated_cost_usd, created_at) VALUES (?, ?, ?, ?, ?)").run(
      `cost_${randomToken(9)}`,
      customerId,
      feature,
      estimatedCostUsd,
      nowIso(),
    );
  } catch (err) {
    console.error("[analytics] usage_costs-Eintrag fehlgeschlagen:", err instanceof Error ? err.message : err);
  }
}

/** Sum of estimated costs per feature over the last `days` days - for the admin overview. */
export function usageCostSummary(days = 30): { feature: string; count: number; totalUsd: number }[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db
    .prepare(
      `SELECT feature, COUNT(*) as count, COALESCE(SUM(estimated_cost_usd), 0) as totalUsd
       FROM usage_costs WHERE created_at >= ? GROUP BY feature ORDER BY totalUsd DESC`,
    )
    .all(since) as { feature: string; count: number; totalUsd: number }[];
}

export interface CachedAnalyticsSummary {
  summary: string;
  generatedAt: string;
}

export function getSummaryCache(customerId: string, channel: AnalyticsChannel = "instagram"): CachedAnalyticsSummary | null {
  const row = db.prepare("SELECT * FROM analytics_summaries WHERE customer_id = ? AND channel = ?").get(customerId, channel) as AnalyticsSummaryRow | undefined;
  return row ? { summary: row.summary, generatedAt: row.generated_at } : null;
}

function saveSummaryCache(customerId: string, channel: AnalyticsChannel, summary: string): string {
  const generatedAt = nowIso();
  db.prepare(
    `INSERT INTO analytics_summaries (customer_id, channel, summary, generated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(customer_id, channel) DO UPDATE SET summary = excluded.summary, generated_at = excluded.generated_at`,
  ).run(customerId, channel, summary, generatedAt);
  return generatedAt;
}

/**
 * Generates a fresh AI summary from the customer's current numbers, logs the estimated cost to
 * usage_costs (feature "analytics-summary", same pattern as every other AI call in this codebase),
 * and caches it so both the on-demand button and the weekly background run share one place. Throws
 * ToolError (via generateAnalyticsSummary) if there is no data yet or the Anthropic call fails -
 * callers should not call this for a customer whose getAnalyticsSummary().hasData is false.
 */
export async function generateAndCacheSummary(customer: CustomerRow, channel: AnalyticsChannel = "instagram"): Promise<CachedAnalyticsSummary> {
  const data = getAnalyticsSummary(customer.id, channel);
  const { text, costUsd } = await generateAnalyticsSummary({
    company: customer.company,
    industry: customer.industry ?? "",
    followerCount: data.current.followerCount,
    followerGrowth7d: data.current.followerGrowth,
    reach7d: data.current.reach,
    reachPrev7d: data.previous.reach,
    views7d: data.current.views,
    engagementRate7d: data.current.engagementRate,
    reach30d: data.reach30d,
    topPosts: data.topPosts.map((p) => ({ headline: p.headline, caption: p.caption, likes: p.likes, comments: p.comments, saved: p.saved, reach: p.reach })),
  });
  logUsageCost(customer.id, "analytics-summary", costUsd);
  const generatedAt = saveSummaryCache(customer.id, channel, text);
  return { summary: text, generatedAt };
}

interface SnapshotRunSummary {
  startedAt: string;
  finishedAt: string;
  customersChecked: number;
  accountSnapshots: number;
  postSnapshots: number;
  errors: number;
}

/**
 * One daily pass: for every active, non-paused customer with a working Instagram connection,
 * fetch and store today's account snapshot, then refresh snapshots for their Instagram posts
 * from the last 30 days (so "Top-Beiträge" always reflects current engagement, not just the
 * engagement at publish time). A single customer's failure (API error, missing/expired token,
 * insights permission not yet approved for their account - see session report) is logged and
 * skipped, never aborts the run for anyone else - same K9-style isolation as the hourly
 * customer-loop routine and planUpcomingPosts.
 */
export async function runDailyAnalyticsSnapshot(): Promise<SnapshotRunSummary> {
  const startedAt = nowIso();
  let customersChecked = 0;
  let accountSnapshots = 0;
  let postSnapshots = 0;
  let errors = 0;
  const today = viennaDateStr();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const customers = db.prepare("SELECT * FROM customers WHERE status = 'active' AND customer_paused = 0").all() as CustomerRow[];
  for (const customer of customers) {
    const hasConnection = db
      .prepare("SELECT 1 FROM connections WHERE customer_id = ? AND provider = 'instagram'")
      .get(customer.id);
    if (!hasConnection) continue;
    customersChecked++;
    try {
      const creds = await resolveInstagramCredentials(customer.id);
      if (!creds) continue;

      const account = await fetchAccountInsights(creds);
      saveAccountSnapshot(customer.id, "instagram", today, account);
      accountSnapshots++;

      const posts = db
        .prepare("SELECT * FROM posts WHERE customer_id = ? AND provider = 'instagram' AND external_post_id IS NOT NULL AND posted_at >= ?")
        .all(customer.id, thirtyDaysAgo) as PostRow[];
      for (const post of posts) {
        try {
          const media = await fetchMediaInsights(post.external_post_id!, creds);
          savePostSnapshot(post.id, customer.id, media);
          postSnapshots++;
        } catch (err) {
          errors++;
          console.error(`[analytics] Post-Snapshot fehlgeschlagen (${customer.id}/${post.id}):`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      errors++;
      console.error(`[analytics] Tages-Snapshot fehlgeschlagen für Kunde ${customer.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { startedAt, finishedAt: nowIso(), customersChecked, accountSnapshots, postSnapshots, errors };
}

function msUntilNextUtcHour(hourUtc: number): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/** Fixed UTC hour, default 04:00 - after the 03:00 planning run finishes, clear of the hourly
 *  customer-loop routine and the own-account blackout window (same anchoring pattern as
 *  planning.ts's startDailyPlanningSchedule, for the same reason: survives a server restart at
 *  any time of day without permanently shifting). */
export function startDailyAnalyticsSnapshotSchedule(hourUtc = 4): NodeJS.Timeout {
  const run = () =>
    runDailyAnalyticsSnapshot()
      .then((summary) => console.log("[panel] Tägliches Analytics-Snapshot:", summary))
      .catch((err) => console.error("[panel] Tägliches Analytics-Snapshot unerwartet fehlgeschlagen:", err));
  return setTimeout(() => {
    run();
    setInterval(run, 24 * 3_600_000);
  }, msUntilNextUtcHour(hourUtc));
}

interface WeeklySummaryRunResult {
  startedAt: string;
  finishedAt: string;
  customersChecked: number;
  summariesGenerated: number;
  errors: number;
}

/**
 * Once a week: pre-generate the AI summary for every active customer who has analytics data, so
 * it is ready both for the on-demand "Zusammenfassung anzeigen" button (serves the cache instead
 * of making the customer wait for a fresh Anthropic call) and for the weekly e-mail report (Panel
 * v9 Aufgabe 5) without that report needing to call Anthropic itself. For customers who opted into
 * the weekly report (notify_weekly_report, separate switch from notify_on_publish - see
 * emails.ts/session report), also sends the report e-mail right after generating their summary.
 * Same K9-style isolation as runDailyAnalyticsSnapshot - one customer's failure never blocks the
 * rest, and a failed e-mail send never blocks the summary from being cached for the panel button.
 */
export async function runWeeklyAnalyticsSummaries(): Promise<WeeklySummaryRunResult> {
  const startedAt = nowIso();
  let customersChecked = 0;
  let summariesGenerated = 0;
  let errors = 0;

  const customers = db.prepare("SELECT * FROM customers WHERE status = 'active' AND customer_paused = 0").all() as CustomerRow[];
  for (const customer of customers) {
    const hasConnection = db.prepare("SELECT 1 FROM connections WHERE customer_id = ? AND provider = 'instagram'").get(customer.id);
    if (!hasConnection) continue;
    customersChecked++;
    try {
      const data = getAnalyticsSummary(customer.id);
      if (!data.hasData) continue;
      const { summary } = await generateAndCacheSummary(customer);
      summariesGenerated++;
      if (customer.notify_weekly_report) {
        sendMailBestEffort(
          weeklyAnalyticsReportEmail({
            to: customer.email,
            company: customer.company,
            followerCount: data.current.followerCount,
            followerGrowth7d: data.current.followerGrowth,
            reach7d: data.current.reach,
            reachPrev7d: data.previous.reach,
            views7d: data.current.views,
            engagementRate7d: data.current.engagementRate,
            aiSummary: summary,
          }),
        );
      }
    } catch (err) {
      errors++;
      console.error(`[analytics] Wöchentliche Zusammenfassung fehlgeschlagen für Kunde ${customer.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { startedAt, finishedAt: nowIso(), customersChecked, summariesGenerated, errors };
}

function msUntilNextWeeklySlot(weekdayUtc: number, hourUtc: number): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0));
  let dayDiff = (weekdayUtc - next.getUTCDay() + 7) % 7;
  if (dayDiff === 0 && next.getTime() <= now.getTime()) dayDiff = 7;
  next.setUTCDate(next.getUTCDate() + dayDiff);
  return next.getTime() - now.getTime();
}

/** Fixed weekly slot, default Monday 05:00 UTC - after the daily analytics snapshot has run at
 *  04:00, so the week-over-week numbers it summarizes are already up to date. Same fixed-wall-clock
 *  anchoring as the daily schedules, so a restart at any time never permanently shifts the day. */
export function startWeeklyAnalyticsSummarySchedule(weekdayUtc = 1, hourUtc = 5): NodeJS.Timeout {
  const run = () =>
    runWeeklyAnalyticsSummaries()
      .then((summary) => console.log("[panel] Wöchentliche Analytics-Zusammenfassungen:", summary))
      .catch((err) => console.error("[panel] Wöchentliche Analytics-Zusammenfassungen unerwartet fehlgeschlagen:", err));
  return setTimeout(() => {
    run();
    setInterval(run, 7 * 24 * 3_600_000);
  }, msUntilNextWeeklySlot(weekdayUtc, hourUtc));
}
