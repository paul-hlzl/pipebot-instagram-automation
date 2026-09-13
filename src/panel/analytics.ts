/**
 * Instagram Analytics (Panel v9) - daily account snapshots + per-post engagement snapshots,
 * stored so the panel can show a 30-day trend instead of just "right now". Mirrors planning.ts's
 * shape: a daily cron (startDailyAnalyticsSnapshotSchedule) that loops every active customer,
 * one failure never aborts the run for anyone else (same K9-style isolation as the customer-loop
 * routine and planUpcomingPosts).
 *
 * v1 scope: Instagram only (see session report - LinkedIn analytics deliberately out of scope,
 * different API/constraints, can be added later as its own effort).
 */
import { db, nowIso, type AnalyticsAccountSnapshotRow, type CustomerRow, type PostRow } from "./db.js";
import { resolveInstagramCredentials } from "./credentials.js";
import { fetchAccountInsights, fetchMediaInsights } from "../instagram-insights.js";
import { viennaDateStr } from "./schedule.js";
import { randomToken } from "./crypto.js";

function toAccountSnapshot(r: AnalyticsAccountSnapshotRow) {
  return {
    id: r.id,
    customerId: r.customer_id,
    date: r.snapshot_date,
    followerCount: r.follower_count,
    reach: r.reach,
    views: r.views,
    accountsEngaged: r.accounts_engaged,
    totalInteractions: r.total_interactions,
  };
}
export type AccountSnapshot = ReturnType<typeof toAccountSnapshot>;

/** Idempotent per customer/day - a second run on the same Vienna calendar date overwrites, never duplicates. */
export function saveAccountSnapshot(
  customerId: string,
  dateStr: string,
  data: { followerCount: number | null; reach: number | null; views: number | null; accountsEngaged: number | null; totalInteractions: number | null },
): void {
  db.prepare(
    `INSERT INTO analytics_account_snapshots (id, customer_id, snapshot_date, follower_count, reach, views, accounts_engaged, total_interactions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(customer_id, snapshot_date) DO UPDATE SET
       follower_count = excluded.follower_count, reach = excluded.reach, views = excluded.views,
       accounts_engaged = excluded.accounts_engaged, total_interactions = excluded.total_interactions`,
  ).run(`ansnap_${randomToken(9)}`, customerId, dateStr, data.followerCount, data.reach, data.views, data.accountsEngaged, data.totalInteractions, nowIso());
}

/** Last `days` days of account snapshots for one customer, oldest first (chart-friendly order). */
export function listAccountSnapshots(customerId: string, days = 30): AccountSnapshot[] {
  const rows = db
    .prepare("SELECT * FROM analytics_account_snapshots WHERE customer_id = ? ORDER BY snapshot_date DESC LIMIT ?")
    .all(customerId, days) as AnalyticsAccountSnapshotRow[];
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
export function listTopPosts(customerId: string, days = 30, limit = 3): TopPost[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT p.id as post_id, p.headline, p.caption, p.image_url, p.posted_at,
              s.likes, s.comments, s.saved, s.reach
       FROM posts p
       JOIN analytics_post_snapshots s ON s.id = (
         SELECT id FROM analytics_post_snapshots WHERE post_id = p.id ORDER BY fetched_at DESC LIMIT 1
       )
       WHERE p.customer_id = ? AND p.provider = 'instagram' AND p.posted_at >= ?`,
    )
    .all(customerId, since) as {
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
      saveAccountSnapshot(customer.id, today, account);
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
