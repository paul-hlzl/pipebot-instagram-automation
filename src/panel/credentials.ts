/**
 * Schnittstelle zwischen Kunden-Panel und MCP-Tools.
 * MCP-Tools holen sich Tokens NUR über diese Datei – nie direkt aus der DB.
 */
import { db, nowIso, cleanupExpired, type ConnectionRow, type CustomerRow, type PostRow } from "./db.js";
import { randomToken } from "./crypto.js";
import { decrypt, encrypt } from "./crypto.js";
import { getProvider } from "./providers/index.js";
import type { Provider, TokenSet } from "./providers/types.js";
import { isDue, nextPostAt } from "./schedule.js";

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
  /** Free-text topics/phrasing this customer wants avoided. */
  avoidTopics: string | null;
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
    ctaPreference: c.cta_preference,
    trialEndsAt: c.trial_ends_at,
    trialExpired: isTrialExpired({ trialEndsAt: c.trial_ends_at }),
    trialDaysLeft: trialDaysLeft(c.trial_ends_at),
    dueNow: isDue({ customerId: c.id, frequency: c.frequency, postTime: c.post_time }),
    nextPostAt: nextPostAt({ customerId: c.id, frequency: c.frequency, postTime: c.post_time }),
    channels: channelsFor(c.id),
  };
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

  const customerRow = db.prepare("SELECT trial_ends_at FROM customers WHERE id = ?").get(customerId) as
    | { trial_ends_at: string | null }
    | undefined;
  if (customerRow && isTrialExpired({ trialEndsAt: customerRow.trial_ends_at })) {
    // Second line of defense - list_customers already exposes trialExpired so a well-behaved
    // routine skips these customers on its own, but this check makes it impossible to
    // publish for an expired trial even if that gets missed.
    throw new Error(`Kunde ${customerId}: Probezeitraum abgelaufen. Keine Veröffentlichung möglich, bis der Kunde freigeschaltet wird.`);
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
  post: { externalPostId?: string; headline?: string; caption?: string; imageUrl?: string },
): void {
  db.prepare(
    `INSERT INTO posts (id, customer_id, provider, external_post_id, headline, caption, image_url, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `post_${randomToken(9)}`,
    customerId,
    provider,
    post.externalPostId ?? null,
    post.headline ?? null,
    post.caption ?? null,
    post.imageUrl ?? null,
    nowIso(),
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

export function startTokenRefreshSchedule(intervalHours = 12): NodeJS.Timeout {
  const run = () => refreshExpiringTokens().then((r) => {
    if (r.refreshed.length || r.failed.length) console.log("[panel] Token-Refresh:", r);
  });
  setTimeout(run, 60_000);
  return setInterval(run, intervalHours * 3_600_000);
}
