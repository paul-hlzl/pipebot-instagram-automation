/**
 * Schnittstelle zwischen Kunden-Panel und MCP-Tools.
 * MCP-Tools holen sich Tokens NUR über diese Datei – nie direkt aus der DB.
 */
import {
  db,
  nowIso,
  cleanupExpired,
  type ConnectionRow,
  type ContentPillarRow,
  type CustomerRow,
  type PendingApprovalRow,
  type PostRequestRow,
  type PostRow,
} from "./db.js";
import { randomToken } from "./crypto.js";
import { decrypt, encrypt } from "./crypto.js";
import { getProvider } from "./providers/index.js";
import type { Provider, TokenSet } from "./providers/types.js";
import { isDue, isDueForChannel, nextPostAt, type ScheduleInput } from "./schedule.js";

const DAY = 86_400_000;

export type ConnectionStatus = "ok" | "renew-soon" | "expired";

function canAutoRefresh(provider: Provider, row: ConnectionRow): boolean {
  if (!provider.refresh) return false;
  if (provider.autoRefresh === "always") return true;
  if (provider.autoRefresh === "with-refresh-token") return Boolean(row.refresh_token_enc);
  return false;
}

export function connectionStatus(row: ConnectionRow): ConnectionStatus {
  if (!row.expires_at) return "ok";
  const left = new Date(row.expires_at).getTime() - Date.now();
  if (left <= 0) return "expired";
  const provider = getProvider(row.provider);
  if (provider && !canAutoRefresh(provider, row) && left < 7 * DAY) return "renew-soon";
  return "ok";
}

export interface ChannelOverview {
  provider: string;
  accountId: string;
  accountName: string | null;
  expiresAt: string | null;
  status: ConnectionStatus;
}

export interface CustomerOverview {
  customerId: string;
  company: string;
  website: string | null;
  industry: string | null;
  about: string | null;
  tone: string | null;
  frequency: string | null;
  postTime: string | null;
  /** Hex color (e.g. "#0a0e1a") to steer this customer's image background. Falls back to the default styleguide color when empty. */
  accentColor: string | null;
  /** Text stamped on generated images instead of "Pipeline" (e.g. the customer's own brand name). Falls back to company name when empty. */
  watermarkText: string | null;
  /** Free-text topics/phrasing this customer wants avoided (soft - an AI instruction, not enforced). */
  avoidTopics: string | null;
  /** Comma-separated words that are HARD-blocked: publish tools refuse a caption/headline containing one of these. */
  bannedWords: string | null;
  /** Comma-separated elements that MUST appear somewhere in headline+caption combined, or publish tools refuse. */
  requiredElements: string | null;
  /** Preferred call-to-action slug: link_bio | anrufen | nachricht | termin | keiner */
  ctaPreference: string | null;
  /** ISO timestamp - if set and in the past, treat as an expired trial (still "active" status, but routines should skip it). Null = no trial limit. */
  trialEndsAt: string | null;
  /** True once trialEndsAt is in the past. Routines must skip these customers instead of posting. */
  trialExpired: boolean;
  /** Whole days left in the trial (0 once expired), or null when trialEndsAt is unset (unlimited / pre-trial customer). */
  trialDaysLeft: number | null;
  /** True right now (Europe/Vienna) if today is a posting day, postTime has passed, and nothing has been posted yet today. */
  dueNow: boolean;
  /** ISO timestamp of this customer's next planned (not yet posted) slot per their frequency/postTime. */
  nextPostAt: string;
  /** Per-channel due-ness, respecting instagramWeekdays/linkedinWeekdays when set - use these instead of `dueNow` once acting per channel. */
  instagramDueNow: boolean;
  linkedinDueNow: boolean;
  /** Vacation/pause range (Vienna dates, inclusive) - nothing is due for either channel while "now" falls inside it. */
  pauseFrom: string | null;
  pauseUntil: string | null;
  /** Channel/format toggles - publish tools refuse to post when the relevant one is false. */
  igFeedEnabled: boolean;
  igStoryEnabled: boolean;
  linkedinEnabled: boolean;
  /** Caption style preferences the routine should follow when writing captions (not enforced in code). */
  hashtagPreference: "keine" | "wenige" | "viele";
  emojisEnabled: boolean;
  language: "de" | "en";
  /** The customer's own pause toggle from their dashboard - distinct from `status` (admin lock). */
  customerPaused: boolean;
  /** Content pillars this customer configured (empty = feature unused, fall back to `about`). */
  contentPillars: ContentPillar[];
  /** This call's weighted pick among contentPillars, avoiding whatever pillar the last post used. Null when contentPillars is empty. */
  suggestedPillar: ContentPillar | null;
  /** When true, the routine must call `save_pending_approval` instead of a publish tool for this customer - see list_customers' tool description. */
  approvalMode: boolean;
  channels: ChannelOverview[];
}

function channelsFor(customerId: string): ChannelOverview[] {
  const rows = db.prepare("SELECT * FROM connections WHERE customer_id = ?").all(customerId) as ConnectionRow[];
  return rows.map((r) => ({
    provider: r.provider,
    accountId: r.account_id,
    accountName: r.account_name,
    expiresAt: r.expires_at,
    status: connectionStatus(r),
  }));
}

export function scheduleInputFor(c: CustomerRow): ScheduleInput {
  return {
    customerId: c.id,
    frequency: c.frequency,
    postTime: c.post_time,
    activeWeekdays: c.active_weekdays,
    instagramWeekdays: c.instagram_weekdays,
    linkedinWeekdays: c.linkedin_weekdays,
    pauseFrom: c.pause_from,
    pauseUntil: c.pause_until,
  };
}

function overview(c: CustomerRow): CustomerOverview {
  return {
    customerId: c.id,
    company: c.company,
    website: c.website,
    industry: c.industry,
    about: c.about,
    tone: c.tone,
    frequency: c.frequency,
    postTime: c.post_time,
    accentColor: c.accent_color,
    watermarkText: c.watermark_text,
    avoidTopics: c.avoid_topics,
    bannedWords: c.banned_words,
    requiredElements: c.required_elements,
    ctaPreference: c.cta_preference,
    trialEndsAt: c.trial_ends_at,
    trialExpired: isTrialExpired({ trialEndsAt: c.trial_ends_at }),
    trialDaysLeft: trialDaysLeft(c.trial_ends_at),
    // A customer who paused themselves is never "due", same effect as an unmet schedule -
    // the routine doesn't need a separate flag to remember to check.
    dueNow: c.customer_paused ? false : isDue(scheduleInputFor(c)),
    nextPostAt: nextPostAt(scheduleInputFor(c)),
    instagramDueNow: c.customer_paused ? false : isDueForChannel(scheduleInputFor(c), "instagram"),
    linkedinDueNow: c.customer_paused ? false : isDueForChannel(scheduleInputFor(c), "linkedin"),
    pauseFrom: c.pause_from,
    pauseUntil: c.pause_until,
    igFeedEnabled: Boolean(c.ig_feed_enabled),
    igStoryEnabled: Boolean(c.ig_story_enabled),
    linkedinEnabled: Boolean(c.linkedin_enabled),
    hashtagPreference: (c.hashtag_pref as CustomerOverview["hashtagPreference"]) || "wenige",
    emojisEnabled: Boolean(c.emojis_enabled),
    language: (c.language as CustomerOverview["language"]) || "de",
    customerPaused: Boolean(c.customer_paused),
    contentPillars: listContentPillars(c.id),
    suggestedPillar: pickPillarForToday(c.id),
    approvalMode: Boolean(c.approval_mode),
    channels: channelsFor(c.id),
  };
}

export type PublishChannel = "ig_feed" | "ig_story" | "linkedin";

const CHANNEL_LABEL: Record<PublishChannel, string> = {
  ig_feed: "Instagram Feed",
  ig_story: "Instagram Story",
  linkedin: "LinkedIn",
};

const CHANNEL_COLUMN: Record<PublishChannel, "ig_feed_enabled" | "ig_story_enabled" | "linkedin_enabled"> = {
  ig_feed: "ig_feed_enabled",
  ig_story: "ig_story_enabled",
  linkedin: "linkedin_enabled",
};

/**
 * Throws a clear error if a customer has switched this channel/format off in the panel.
 * A missing customerId (the operator's own .env account) is never gated - unchanged behavior.
 */
export function assertChannelEnabled(customerId: string | undefined, channel: PublishChannel): void {
  if (!customerId) return;
  const column = CHANNEL_COLUMN[channel];
  const row = db.prepare(`SELECT ${column} as enabled FROM customers WHERE id = ?`).get(customerId) as
    | { enabled: number }
    | undefined;
  if (row && !row.enabled) {
    throw new Error(`Kunde ${customerId}: ${CHANNEL_LABEL[channel]} ist im Panel deaktiviert - keine Veröffentlichung möglich.`);
  }
}

/** True if this customer has a trial end date in the past. Routines should skip these instead of posting. */
export function isTrialExpired(c: Pick<CustomerOverview, "trialEndsAt">): boolean {
  return Boolean(c.trialEndsAt) && new Date(c.trialEndsAt as string).getTime() < Date.now();
}

/** Whole days left in the trial (clamped to 0 once past), or null when there is no trial end date at all. */
export function trialDaysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const diff = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / DAY));
}

/** Alle aktiven Kunden inkl. Briefing – für die Content-Routine. Enthält KEINE Tokens. */
export function listCustomers(): CustomerOverview[] {
  const rows = db.prepare("SELECT * FROM customers WHERE status = 'active' ORDER BY created_at").all() as CustomerRow[];
  return rows.map(overview);
}

export function getCustomerOverview(customerId: string): CustomerOverview | null {
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as CustomerRow | undefined;
  return row ? overview(row) : null;
}

async function refreshRow(provider: Provider, row: ConnectionRow): Promise<TokenSet> {
  const current: TokenSet = {
    accessToken: decrypt(row.access_token_enc),
    refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : undefined,
  };
  const next = await provider.refresh!(current);
  db.prepare(
    `UPDATE connections SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, updated_at = ?
     WHERE customer_id = ? AND provider = ?`,
  ).run(
    encrypt(next.accessToken),
    next.refreshToken ? encrypt(next.refreshToken) : row.refresh_token_enc,
    next.expiresAt ? next.expiresAt.toISOString() : row.expires_at,
    nowIso(),
    row.customer_id,
    row.provider,
  );
  return next;
}

function shouldRefresh(provider: Provider, row: ConnectionRow): boolean {
  if (!row.expires_at || !canAutoRefresh(provider, row)) return false;
  const left = new Date(row.expires_at).getTime() - Date.now();
  const ageMs = Date.now() - new Date(row.updated_at).getTime();
  // Instagram erlaubt Refresh erst, wenn der Token mind. 24h alt ist
  return left > 0 && left < provider.refreshWithinDays * DAY && ageMs > DAY;
}

/** Entschlüsselte Zugangsdaten für einen Kunden + Plattform. Verlängert automatisch, wenn nötig. */
export async function getCredentials(
  customerId: string,
  providerId: string,
): Promise<{ accountId: string; accountName: string | null; accessToken: string }> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unbekannte Plattform: ${providerId}`);

  const customerRow = db.prepare("SELECT trial_ends_at, customer_paused FROM customers WHERE id = ?").get(customerId) as
    | { trial_ends_at: string | null; customer_paused: number }
    | undefined;
  if (customerRow && isTrialExpired({ trialEndsAt: customerRow.trial_ends_at })) {
    // Second line of defense - list_customers already exposes trialExpired so a well-behaved
    // routine skips these customers on its own, but this check makes it impossible to
    // publish for an expired trial even if that gets missed.
    throw new Error(`Kunde ${customerId}: Probezeitraum abgelaufen. Keine Veröffentlichung möglich, bis der Kunde freigeschaltet wird.`);
  }
  if (customerRow?.customer_paused) {
    throw new Error(`Kunde ${customerId}: Posting wurde vom Kunden selbst pausiert - keine Veröffentlichung möglich, bis er es im Panel fortsetzt.`);
  }

  const row = db
    .prepare("SELECT * FROM connections WHERE customer_id = ? AND provider = ?")
    .get(customerId, providerId) as ConnectionRow | undefined;
  if (!row) throw new Error(`Kunde ${customerId} hat ${provider.name} nicht verbunden.`);

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new Error(`${provider.name}-Zugang von Kunde ${customerId} ist abgelaufen – Kunde muss im Panel neu verbinden.`);
  }
  let accessToken = decrypt(row.access_token_enc);
  if (shouldRefresh(provider, row)) {
    try {
      accessToken = (await refreshRow(provider, row)).accessToken;
    } catch (err) {
      console.error(`[panel] Refresh ${providerId}/${customerId} fehlgeschlagen (alter Token noch gültig):`, err);
    }
  }
  return { accountId: row.account_id, accountName: row.account_name, accessToken };
}

/** Verlängert alle bald ablaufenden Tokens. Wird per Intervall aufgerufen. */
export async function refreshExpiringTokens(): Promise<{ refreshed: string[]; failed: string[] }> {
  cleanupExpired();
  const refreshed: string[] = [];
  const failed: string[] = [];
  const rows = db.prepare("SELECT * FROM connections").all() as ConnectionRow[];
  for (const row of rows) {
    const provider = getProvider(row.provider);
    if (!provider || !shouldRefresh(provider, row)) continue;
    const label = `${row.customer_id}/${row.provider}`;
    try {
      await refreshRow(provider, row);
      refreshed.push(label);
    } catch (err) {
      console.error(`[panel] Refresh ${label} fehlgeschlagen:`, err);
      failed.push(label);
    }
  }
  return { refreshed, failed };
}

export interface LoggedPost {
  id: string;
  provider: string;
  externalPostId: string | null;
  headline: string | null;
  caption: string | null;
  imageUrl: string | null;
  postedAt: string;
}

/**
 * Record a post that was just published for a customer, so the panel's
 * "Verlauf" tab can show it. Call this from the publish_* MCP tools right
 * after a successful publish, whenever a customer_id was given. Never call
 * this for your own (non-customer) posts - the panel only shows customer
 * history.
 */
export function logPost(
  customerId: string,
  provider: string,
  post: { externalPostId?: string; headline?: string; caption?: string; imageUrl?: string; pillarTitle?: string },
): void {
  db.prepare(
    `INSERT INTO posts (id, customer_id, provider, external_post_id, headline, caption, image_url, posted_at, pillar_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `post_${randomToken(9)}`,
    customerId,
    provider,
    post.externalPostId ?? null,
    post.headline ?? null,
    post.caption ?? null,
    post.imageUrl ?? null,
    nowIso(),
    post.pillarTitle ?? null,
  );
}

/** Most recent posts for one customer, newest first - used by the panel's own "Verlauf" tab. */
export function listPostsForCustomer(customerId: string, limit = 30): LoggedPost[] {
  const rows = db
    .prepare("SELECT * FROM posts WHERE customer_id = ? ORDER BY posted_at DESC LIMIT ?")
    .all(customerId, limit) as PostRow[];
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    externalPostId: r.external_post_id,
    headline: r.headline,
    caption: r.caption,
    imageUrl: r.image_url,
    postedAt: r.posted_at,
  }));
}

export interface ContentPillar {
  id: string;
  title: string;
  description: string | null;
  weight: number;
}

const MAX_PILLARS = 6;

/** Active content pillars for a customer, oldest first. Empty array = feature unused (fallback to `about`). */
export function listContentPillars(customerId: string): ContentPillar[] {
  const rows = db
    .prepare("SELECT * FROM content_pillars WHERE customer_id = ? AND active = 1 ORDER BY created_at")
    .all(customerId) as ContentPillarRow[];
  return rows.map((r) => ({ id: r.id, title: r.title, description: r.description, weight: r.weight }));
}

/**
 * Replaces a customer's whole set of content pillars (the panel edits them together as one
 * list, so full replace-on-save is simpler and safer than a diff). Capped at 6, weight clamped
 * to 1-5. Titles must be non-empty; blank/duplicate-only input results in an empty list, which
 * is a valid "not using this feature" state.
 */
export function setContentPillars(customerId: string, pillars: { title: string; description?: string; weight?: number }[]): void {
  const clean = pillars
    .map((p) => ({ title: (p.title ?? "").trim().slice(0, 60), description: (p.description ?? "").trim().slice(0, 300), weight: Math.min(5, Math.max(1, Math.round(p.weight ?? 1))) }))
    .filter((p) => p.title)
    .slice(0, MAX_PILLARS);
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM content_pillars WHERE customer_id = ?").run(customerId);
    for (const p of clean) {
      db.prepare(
        `INSERT INTO content_pillars (id, customer_id, title, description, weight, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(`pillar_${randomToken(9)}`, customerId, p.title, p.description || null, p.weight, now, now);
    }
  });
  tx();
}

/**
 * Weighted-random pick among a customer's active pillars, avoiding whichever pillar their most
 * recent logged post used (so the routine doesn't hit the same pillar twice in a row). Returns
 * null when the customer has no pillars set up - callers should fall back to `about`.
 */
export function pickPillarForToday(customerId: string): ContentPillar | null {
  const pillars = listContentPillars(customerId);
  if (!pillars.length) return null;
  if (pillars.length === 1) return pillars[0];

  const lastPost = db
    .prepare("SELECT pillar_title FROM posts WHERE customer_id = ? ORDER BY posted_at DESC LIMIT 1")
    .get(customerId) as { pillar_title: string | null } | undefined;
  const lastTitle = lastPost?.pillar_title ?? null;
  const pool = lastTitle ? pillars.filter((p) => p.title !== lastTitle) : pillars;
  const candidates = pool.length ? pool : pillars; // everything filtered out is only possible with 1 active pillar, handled above, but stay safe

  const totalWeight = candidates.reduce((sum, p) => sum + p.weight, 0);
  let r = Math.random() * totalWeight;
  for (const p of candidates) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return candidates[candidates.length - 1];
}

function splitCommaList(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Case-insensitive substring check against a customer's hard-blocked words. Returns the matched word, or null. */
export function containsBannedWord(text: string, customerId: string): string | null {
  const row = db.prepare("SELECT banned_words FROM customers WHERE id = ?").get(customerId) as
    | { banned_words: string | null }
    | undefined;
  const words = splitCommaList(row?.banned_words ?? null);
  if (!words.length || !text) return null;
  const lower = text.toLowerCase();
  return words.find((w) => lower.includes(w.toLowerCase())) ?? null;
}

/**
 * Throws a clear, actionable error if any of the given text fields contains a word this
 * customer hard-banned. A missing customerId (the operator's own .env account) is never
 * checked - unchanged behavior. Call this from every publish tool, before the network call.
 */
export function assertNoBannedWords(customerId: string | undefined, ...texts: (string | undefined)[]): void {
  if (!customerId) return;
  for (const text of texts) {
    if (!text) continue;
    const hit = containsBannedWord(text, customerId);
    if (hit) {
      throw new Error(`Caption enthält verbotenes Wort: "${hit}" - bitte neu formulieren und erneut versuchen.`);
    }
  }
}

/**
 * Throws a clear, actionable error if this customer has required elements configured and one
 * of them is missing across ALL of the given texts combined (e.g. a required hashtag can be
 * in either the headline or the caption - it just has to be somewhere). A missing customerId
 * is never checked - unchanged behavior. Call this from every publish tool, before the
 * network call, alongside assertNoBannedWords.
 */
export function assertRequiredElements(customerId: string | undefined, ...texts: (string | undefined)[]): void {
  if (!customerId) return;
  const row = db.prepare("SELECT required_elements FROM customers WHERE id = ?").get(customerId) as
    | { required_elements: string | null }
    | undefined;
  const required = splitCommaList(row?.required_elements ?? null);
  if (!required.length) return;
  const combined = texts.filter(Boolean).join(" \n ").toLowerCase();
  const missing = required.find((el) => !combined.includes(el.toLowerCase()));
  if (missing) {
    throw new Error(`Caption fehlt ein Pflicht-Element: "${missing}" - bitte ergänzen und erneut versuchen.`);
  }
}

export interface PostRequest {
  id: string;
  customerId: string;
  topic: string | null;
  channel: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function toPostRequest(r: PostRequestRow): PostRequest {
  return { id: r.id, customerId: r.customer_id, topic: r.topic, channel: r.channel, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
}

export const POST_REQUEST_MAX_OPEN = 1;
export const POST_REQUEST_MAX_PER_DAY = 3;

/** How many still-pending requests this customer currently has (should be 0 or 1 - enforced at creation). */
export function openPostRequestCount(customerId: string): number {
  return (db.prepare("SELECT COUNT(*) as n FROM post_requests WHERE customer_id = ? AND status = 'pending'").get(customerId) as { n: number }).n;
}

/** How many requests (any status) this customer created today (server-local calendar day - a soft daily cap, precision doesn't matter). */
export function postRequestCountToday(customerId: string): number {
  return (
    db.prepare("SELECT COUNT(*) as n FROM post_requests WHERE customer_id = ? AND date(created_at) = date('now')").get(customerId) as {
      n: number;
    }
  ).n;
}

/**
 * Queues a "post now" request for the routine to pick up - does NOT call any MCP tool or
 * generate anything itself (this server has no Anthropic API access in this context, and the
 * whole point is that the routine decides how to fulfil it). Caller must check
 * openPostRequestCount/postRequestCountToday against POST_REQUEST_MAX_OPEN/_PER_DAY first.
 */
export function createPostRequest(customerId: string, topic: string | null, channel: string | null = null): PostRequest {
  const id = `preq_${randomToken(9)}`;
  const now = nowIso();
  db.prepare(
    `INSERT INTO post_requests (id, customer_id, topic, channel, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(id, customerId, topic || null, channel, now, now);
  return { id, customerId, topic, channel, status: "pending", createdAt: now, updatedAt: now };
}

/** Most recent request for one customer (any status), for the panel's own status display. Null if they never asked. */
export function lastPostRequestForCustomer(customerId: string): PostRequest | null {
  const row = db
    .prepare("SELECT * FROM post_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(customerId) as PostRequestRow | undefined;
  return row ? toPostRequest(row) : null;
}

/** All still-open requests across all customers, oldest first - what the routine should process before its regular customer loop. */
export function listOpenPostRequests(): PostRequest[] {
  const rows = db.prepare("SELECT * FROM post_requests WHERE status = 'pending' ORDER BY created_at").all() as PostRequestRow[];
  return rows.map(toPostRequest);
}

/** Marks a request done once the routine has fulfilled it. Returns false if the id doesn't exist (already handled by someone else, or invalid). */
export function markPostRequestDone(id: string): boolean {
  const result = db.prepare("UPDATE post_requests SET status = 'done', updated_at = ? WHERE id = ?").run(nowIso(), id);
  return result.changes > 0;
}

export interface PendingApproval {
  id: string;
  customerId: string;
  provider: string;
  headline: string | null;
  caption: string | null;
  imageUrl: string | null;
  pillarTitle: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function toPendingApproval(r: PendingApprovalRow): PendingApproval {
  return {
    id: r.id,
    customerId: r.customer_id,
    provider: r.provider,
    headline: r.headline,
    caption: r.caption,
    imageUrl: r.image_url,
    pillarTitle: r.pillar_title,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Used by `save_pending_approval` (the MCP tool) when a customer has `approval_mode` on -
 * files a generated post away for the customer to review in their panel instead of
 * publishing it. Whether to call this instead of a publish tool is the routine's own decision
 * (based on `approvalMode` from list_customers) - nothing here intercepts the publish tools.
 */
export function savePendingApproval(input: {
  customerId: string;
  provider: string;
  headline?: string;
  caption?: string;
  imageUrl?: string;
  pillarTitle?: string;
}): PendingApproval {
  const id = `appr_${randomToken(9)}`;
  const now = nowIso();
  db.prepare(
    `INSERT INTO pending_approvals (id, customer_id, provider, headline, caption, image_url, pillar_title, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(id, input.customerId, input.provider, input.headline ?? null, input.caption ?? null, input.imageUrl ?? null, input.pillarTitle ?? null, now, now);
  return toPendingApproval(
    db.prepare("SELECT * FROM pending_approvals WHERE id = ?").get(id) as PendingApprovalRow,
  );
}

/** A customer's own pending_approvals in a given status ("pending" for the review UI), newest first. */
export function listPendingApprovalsForCustomer(customerId: string, status: string = "pending"): PendingApproval[] {
  const rows = db
    .prepare("SELECT * FROM pending_approvals WHERE customer_id = ? AND status = ? ORDER BY created_at DESC")
    .all(customerId, status) as PendingApprovalRow[];
  return rows.map(toPendingApproval);
}

/** Sets one of a customer's own pending_approvals to a new status (approve/reject) - scoped to that customer, so one customer can never touch another's. Returns null if not found/not theirs/not pending. */
export function setPendingApprovalStatus(customerId: string, id: string, status: "approved" | "rejected"): PendingApproval | null {
  const result = db
    .prepare("UPDATE pending_approvals SET status = ?, updated_at = ? WHERE id = ? AND customer_id = ? AND status = 'pending'")
    .run(status, nowIso(), id, customerId);
  if (result.changes === 0) return null;
  return toPendingApproval(db.prepare("SELECT * FROM pending_approvals WHERE id = ?").get(id) as PendingApprovalRow);
}

/** All customer-approved posts across all customers, oldest first - what `list_approved_pending_posts` (the MCP tool) returns for the routine to actually publish + logPost, then mark done via `mark_pending_approval_published`. */
export function listApprovedPendingPosts(): PendingApproval[] {
  const rows = db.prepare("SELECT * FROM pending_approvals WHERE status = 'approved' ORDER BY created_at").all() as PendingApprovalRow[];
  return rows.map(toPendingApproval);
}

/** Marks an approved pending_approval as published once the routine has actually published it - stops it from being returned by list_approved_pending_posts again. */
export function markPendingApprovalPublished(id: string): boolean {
  const result = db.prepare("UPDATE pending_approvals SET status = 'published', updated_at = ? WHERE id = ? AND status = 'approved'").run(nowIso(), id);
  return result.changes > 0;
}

const STYLE_CACHE_HOURS = 24;

export interface CachedStyleSample {
  caption: string | null;
  mediaType: string;
  timestamp: string;
}

/** Cached style samples for a customer if fetched within the last 24h, otherwise null (caller should re-fetch). */
export function getCachedStyleSamples(customerId: string): CachedStyleSample[] | null {
  const row = db.prepare("SELECT samples_json, fetched_at FROM style_cache WHERE customer_id = ?").get(customerId) as
    | { samples_json: string; fetched_at: string }
    | undefined;
  if (!row) return null;
  const ageMs = Date.now() - new Date(row.fetched_at).getTime();
  if (ageMs > STYLE_CACHE_HOURS * 3_600_000) return null;
  try {
    return JSON.parse(row.samples_json) as CachedStyleSample[];
  } catch {
    return null;
  }
}

export function setCachedStyleSamples(customerId: string, samples: CachedStyleSample[]): void {
  db.prepare(
    `INSERT INTO style_cache (customer_id, samples_json, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(customer_id) DO UPDATE SET samples_json = excluded.samples_json, fetched_at = excluded.fetched_at`,
  ).run(customerId, JSON.stringify(samples), nowIso());
}

export function startTokenRefreshSchedule(intervalHours = 12): NodeJS.Timeout {
  const run = () => refreshExpiringTokens().then((r) => {
    if (r.refreshed.length || r.failed.length) console.log("[panel] Token-Refresh:", r);
  });
  setTimeout(run, 60_000);
  return setInterval(run, intervalHours * 3_600_000);
}
