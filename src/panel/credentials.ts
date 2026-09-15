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
  type PlannedPostRow,
  type PlanningErrorRow,
  type PostMediaRow,
  type PostRequestRow,
  type PostRow,
  type SavedThemeRow,
} from "./db.js";
import { randomToken } from "./crypto.js";
import { decrypt, encrypt } from "./crypto.js";
import { getProvider } from "./providers/index.js";
import type { Provider, TokenSet } from "./providers/types.js";
import { isDue, isDueForChannel, nextPostAt, viennaDateStr, type ScheduleInput } from "./schedule.js";
import { getRecentMedia, type InstagramCredentials } from "../instagram.js";
import type { LinkedInCredentials } from "../linkedin.js";
import type { ImageBranding } from "../fal.js";
import { sendMailBestEffort } from "./mailer.js";
import { approvalNeededEmail, firstPostLiveEmail, pendingApprovalsSummaryEmail, postPublishedEmail, tokenExpiringEmail } from "./emails.js";

const DAY = 86_400_000;

export type ConnectionStatus = "ok" | "renew-soon" | "expired";

function canAutoRefresh(provider: Provider, row: ConnectionRow): boolean {
  if (!provider.refresh) return false;
  if (provider.autoRefresh === "always") return true;
  if (provider.autoRefresh === "with-refresh-token") return Boolean(row.refresh_token_enc);
  return false;
}

/** Panel v20: 14 Tage statt vorher 7 - genug Vorlauf, dass eine E-Mail-Warnung (siehe
 *  sendExpiryWarnings) den Kunden vor einem stillen Ausfall erreicht, nicht erst kurz davor. */
export const RENEW_SOON_WINDOW_DAYS = 14;

export function connectionStatus(row: ConnectionRow): ConnectionStatus {
  if (!row.expires_at) return "ok";
  const left = new Date(row.expires_at).getTime() - Date.now();
  if (left <= 0) {
    // Google: der Access-Token ist nur ein Stundenticket, der Refresh-Token der eigentliche
    // Zugang - "abgelaufen" waere hier fast immer angezeigt und fast immer falsch. Fuer
    // Instagram/LinkedIn (kein refreshAfterExpiry) bleibt es exakt wie bisher.
    const p = getProvider(row.provider);
    return p?.refreshAfterExpiry && canAutoRefresh(p, row) ? "ok" : "expired";
  }
  const provider = getProvider(row.provider);
  if (provider && !canAutoRefresh(provider, row) && left < RENEW_SOON_WINDOW_DAYS * DAY) return "renew-soon";
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
  /** Absolute local file path to this customer's uploaded logo, or null. Not a public URL - only meaningful server-side (image generation). */
  logoUrl: string | null;
  channels: ChannelOverview[];
  /** Panel v14: how many slides a carousel/video-slideshow should have for this customer (3-7,
   *  see instagram.ts CAROUSEL_MIN_SLIDES/CAROUSEL_MAX_SLIDES) - pass this many `slides` to
   *  generate_and_publish_carousel_post. */
  carouselSlideCount: number;
  /** Panel v14: whether/how often the DAILY routine should pick carousel/video-slideshow instead
   *  of a single image - 'off' (default, single-image only unless a customer/routine explicitly
   *  requests otherwise), 'weekly' (about once a week), or 'always'. Manual "Jetzt posten" always
   *  picks its format explicitly regardless of this setting. */
  carouselAutoFrequency: "off" | "weekly" | "always";
  /** Panel v15: id aus fonts.ts's FONT_OPTIONS - wirkt auf Headline/Wasserzeichen/Karussell-Text
   *  ueberall dort, wo Bilder generiert werden (siehe resolveImageBranding). */
  fontChoice: string;
  /** Panel v15: wenn true UND gradientColor2 gesetzt ist, ersetzt ein Zwei-Farben-Verlauf (accentColor -> gradientColor2)
   *  den bisherigen Einzelfarben-Hintergrund - siehe gradient.ts. */
  gradientEnabled: boolean;
  gradientColor2: string | null;
  gradientDirection: "horizontal" | "vertical" | "diagonal";
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
    videoWeekdays: c.video_weekdays,
    videoPostTime: c.video_post_time,
    pauseFrom: c.pause_from,
    pauseUntil: c.pause_until,
  };
}

function overview(c: CustomerRow): CustomerOverview {
  // Theme-resolved, not the raw columns - a customer with an active saved theme should
  // generate images with that theme's color/watermark, not their old plain fields.
  const branding = effectiveBranding(c);
  // Panel v6 Aufgabe 2b: an unverified customer must never look "due" to the K1-K9 routine
  // (list_customers is what it reads) - otherwise K3's fallback would still spontaneously
  // generate (and pay for) a post for them via K4-K8 even though planning.ts already skips
  // them, since the routine's prompt itself is off-limits to edit this session (rule 7). Same
  // mechanism already used for customer_paused, just extended - no routine-prompt change needed.
  const notReady = Boolean(c.customer_paused) || !c.email_verified;
  return {
    customerId: c.id,
    company: c.company,
    website: c.website,
    industry: c.industry,
    about: c.about,
    tone: c.tone,
    frequency: c.frequency,
    postTime: c.post_time,
    accentColor: branding.accentColor,
    watermarkText: branding.watermarkText,
    avoidTopics: c.avoid_topics,
    bannedWords: c.banned_words,
    requiredElements: c.required_elements,
    ctaPreference: c.cta_preference,
    trialEndsAt: c.trial_ends_at,
    trialExpired: isTrialExpired({ trialEndsAt: c.trial_ends_at }),
    trialDaysLeft: trialDaysLeft(c.trial_ends_at),
    // A customer who paused themselves is never "due", same effect as an unmet schedule -
    // the routine doesn't need a separate flag to remember to check.
    dueNow: notReady ? false : isDue(scheduleInputFor(c)),
    nextPostAt: nextPostAt(scheduleInputFor(c)),
    instagramDueNow: notReady ? false : isDueForChannel(scheduleInputFor(c), "instagram"),
    linkedinDueNow: notReady ? false : isDueForChannel(scheduleInputFor(c), "linkedin"),
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
    logoUrl: c.logo_url,
    channels: channelsFor(c.id),
    carouselSlideCount: c.carousel_slide_count,
    carouselAutoFrequency: (c.carousel_auto_frequency as CustomerOverview["carouselAutoFrequency"]) || "off",
    fontChoice: c.font_choice || "inter",
    gradientEnabled: Boolean(c.gradient_enabled),
    gradientColor2: c.gradient_color2,
    gradientDirection: (c.gradient_direction as CustomerOverview["gradientDirection"]) || "diagonal",
  };
}

export type PublishChannel = "ig_feed" | "ig_story" | "linkedin";

export const CHANNEL_LABEL: Record<PublishChannel, string> = {
  ig_feed: "Instagram Feed",
  ig_story: "Instagram Story",
  linkedin: "LinkedIn",
};

const CHANNEL_COLUMN: Record<PublishChannel, "ig_feed_enabled" | "ig_story_enabled" | "linkedin_enabled"> = {
  ig_feed: "ig_feed_enabled",
  ig_story: "ig_story_enabled",
  linkedin: "linkedin_enabled",
};

/** Which fal.ai/watermark image format a channel uses - LinkedIn images are square, same as the feed format. */
export const CHANNEL_IMAGE_FORMAT: Record<PublishChannel, "feed" | "story"> = {
  ig_feed: "feed",
  ig_story: "story",
  linkedin: "feed",
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
    `UPDATE connections SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, updated_at = ?, expiry_warning_sent_at = NULL
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
  // Instagram erlaubt Refresh erst, wenn der Token mind. 24h alt ist - das ist der Default.
  // Google widerspricht dem in beide Richtungen (Token lebt nur 1h, laesst sich dafuer auch nach
  // Ablauf noch erneuern), deshalb beides pro Provider ueberschreibbar statt fest verdrahtet.
  const minAge = provider.refreshMinTokenAgeMs ?? DAY;
  if (ageMs <= minAge) return false;
  if (left <= 0) return Boolean(provider.refreshAfterExpiry);
  return left < provider.refreshWithinDays * DAY;
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

  const expired = Boolean(row.expires_at && new Date(row.expires_at).getTime() < Date.now());
  const renewable = expired && provider.refreshAfterExpiry && canAutoRefresh(provider, row);
  if (expired && !renewable) {
    throw new Error(`${provider.name}-Zugang von Kunde ${customerId} ist abgelaufen – Kunde muss im Panel neu verbinden.`);
  }
  let accessToken = decrypt(row.access_token_enc);
  if (shouldRefresh(provider, row)) {
    try {
      accessToken = (await refreshRow(provider, row)).accessToken;
    } catch (err) {
      // Bei einem bereits abgelaufenen Token (Google) ist ein gescheiterter Refresh das Ende -
      // der alte Token taugt dann nichts mehr, weitermachen wuerde nur einen 401 weiterreichen.
      if (renewable) {
        throw new Error(
          `${provider.name}-Zugang von Kunde ${customerId} konnte nicht erneuert werden – Kunde muss im Panel neu verbinden. (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      console.error(`[panel] Refresh ${providerId}/${customerId} fehlgeschlagen (alter Token noch gültig):`, err);
    }
  }
  return { accountId: row.account_id, accountName: row.account_name, accessToken };
}

/**
 * Instagram/LinkedIn/image-branding resolvers - moved here (from index.ts, where they were
 * private helpers used by every MCP publish/generate tool) so planning.ts (v5's server-side
 * daily pre-planning) can call the exact same credential/branding resolution directly, without
 * going through an MCP tool. index.ts imports these too now instead of keeping its own copies -
 * one source of truth for both call paths.
 */

/** Loads a customer's Instagram credentials. undefined = the operator's own .env account (unchanged default behavior). */
export async function resolveInstagramCredentials(customerId?: string): Promise<InstagramCredentials | undefined> {
  if (!customerId) return undefined;
  const cred = await getCredentials(customerId, "instagram");
  return { accessToken: cred.accessToken, igUserId: cred.accountId };
}

/**
 * Zugangsdaten für das Google-Unternehmensprofil eines Kunden. `accountId` ist der Kontoname
 * ("accounts/123"), unter dem seine Filialen und damit alle Bewertungen hängen. Wirft (wie
 * getCredentials) bei abgelaufener Probezeit, Kunden-Pause oder nicht erneuerbarem Token;
 * undefined nur ohne customerId - anders als bei Instagram/LinkedIn gibt es hier bewusst KEIN
 * Fallback auf ein Konto des Betreibers, Bewertungen sind immer die des Kunden.
 */
export async function resolveGoogleCredentials(customerId?: string): Promise<{ accessToken: string; accountName: string } | undefined> {
  if (!customerId) return undefined;
  const cred = await getCredentials(customerId, "google");
  return { accessToken: cred.accessToken, accountName: cred.accountId };
}

/** Loads a customer's LinkedIn credentials. undefined = the operator's own .env account (unchanged default behavior). */
export async function resolveLinkedInCredentials(customerId?: string): Promise<LinkedInCredentials | undefined> {
  if (!customerId) return undefined;
  const cred = await getCredentials(customerId, "linkedin");
  return { accessToken: cred.accessToken, personUrn: cred.accountId };
}

/**
 * Loads a customer's image branding (accent color, watermark text/logo) for the generate_*
 * image tools. No customerId or unknown customer: {} -> generateImageUrl falls back to the
 * default styleguide look (navy, "Pipeline" watermark), exactly as before.
 */
export function resolveImageBranding(customerId?: string): ImageBranding {
  if (!customerId) return {};
  const customer = getCustomerOverview(customerId);
  if (!customer) return {};
  return {
    accentColor: customer.accentColor ?? undefined,
    watermarkText: customer.watermarkText || customer.company || undefined,
    logoPath: customer.logoUrl,
    fontId: customer.fontChoice,
    gradient:
      customer.gradientEnabled && customer.gradientColor2
        ? { color2: customer.gradientColor2, direction: customer.gradientDirection }
        : undefined,
  };
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
  sendExpiryWarnings();
  return { refreshed, failed };
}

/**
 * Panel v20: E-Mail-Warnung für Verbindungen, die NICHT automatisch verlängert werden können
 * (heute: LinkedIn - kein Refresh-Token ohne separaten "Programmatic refresh tokens"-Antrag, läuft
 * nach 60 Tagen still ab). Ohne diese Mail merkt niemand einen abgelaufenen Zugang, bis einfach
 * nichts mehr gepostet wird - genau der stille Ausfall, den dieses Feature verhindern soll.
 * Läuft best-effort direkt nach jedem refreshExpiringTokens-Intervall (alle 12h, siehe
 * startTokenRefreshSchedule) - ein Fehlschlag hier darf den Refresh-Lauf selbst nie stören.
 * Höchstens einmal PRO Ablauf: expiry_warning_sent_at wird bei jedem erfolgreichen Refresh/
 * Neu-Verbinden zurückgesetzt (siehe refreshRow/router.ts's OAuth-Callback), ein neuer Ablauf
 * bekommt also wieder eine eigene Warnung.
 */
function sendExpiryWarnings(): void {
  const rows = db
    .prepare(
      `SELECT c.*, cu.email as customer_email, cu.company as customer_company
       FROM connections c JOIN customers cu ON cu.id = c.customer_id
       WHERE c.expires_at IS NOT NULL AND c.expiry_warning_sent_at IS NULL AND cu.status = 'active'`,
    )
    .all() as (ConnectionRow & { customer_email: string; customer_company: string })[];
  for (const row of rows) {
    const provider = getProvider(row.provider);
    if (!provider || canAutoRefresh(provider, row)) continue; // auto-refresh handles these, no warning needed
    const left = new Date(row.expires_at!).getTime() - Date.now();
    if (left <= 0 || left >= RENEW_SOON_WINDOW_DAYS * DAY) continue;
    try {
      sendMailBestEffort(
        tokenExpiringEmail({
          to: row.customer_email,
          company: row.customer_company,
          channelLabel: provider.name,
          expiresAt: row.expires_at!,
        }),
      );
      db.prepare("UPDATE connections SET expiry_warning_sent_at = ? WHERE customer_id = ? AND provider = ?").run(nowIso(), row.customer_id, row.provider);
    } catch (err) {
      console.error(`[panel] Ablauf-Warnung für ${row.customer_id}/${row.provider} fehlgeschlagen:`, err instanceof Error ? err.message : err);
    }
  }
}

export interface LoggedPost {
  id: string;
  provider: string;
  externalPostId: string | null;
  headline: string | null;
  caption: string | null;
  imageUrl: string | null;
  postedAt: string;
  format: string;
  slides: PostMediaSlide[];
  /** Fertig gerendertes MP4 einer Video-Diashow (sonst null) - der Verlauf spielt es dann ab, statt nur das Standbild zu zeigen. */
  videoUrl?: string | null;
}

/** One slide of a carousel/video-slideshow post - see db.ts's post_media table comment. */
export interface PostMediaSlide {
  position: number;
  imageUrl: string;
  overlayText: string | null;
}

/**
 * Writes a Mehrbild-Post's full slide list (Panel v14) - shared by logPost, savePendingApproval
 * and createPlannedPost so all three owner tables use the exact same post_media shape/insert
 * logic. No-op for an empty/undefined slide list (the ordinary single-image case).
 */
function savePostMedia(ownerType: "post" | "pending_approval" | "planned_post", ownerId: string, slides?: { imageUrl: string; overlayText?: string }[]): void {
  if (!slides || slides.length === 0) return;
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO post_media (id, owner_type, owner_id, position, image_url, overlay_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  slides.forEach((slide, i) => {
    insert.run(`pm_${randomToken(9)}`, ownerType, ownerId, i, slide.imageUrl, slide.overlayText ?? null, now);
  });
}

/** Reads back a Mehrbild-Post's slides, oldest position first - empty array for an ordinary
 *  single-image post (nothing was ever written for it). */
function getPostMedia(ownerType: "post" | "pending_approval" | "planned_post", ownerId: string): PostMediaSlide[] {
  const rows = db
    .prepare("SELECT * FROM post_media WHERE owner_type = ? AND owner_id = ? ORDER BY position")
    .all(ownerType, ownerId) as PostMediaRow[];
  return rows.map((r) => ({ position: r.position, imageUrl: r.image_url, overlayText: r.overlay_text }));
}

/**
 * Record a post that was just published for a customer, so the panel's
 * "Verlauf" tab can show it. Call this from the publish_* MCP tools right
 * after a successful publish, whenever a customer_id was given. Never call
 * this for your own (non-customer) posts - the panel only shows customer
 * history.
 */
/** Panel v8 Aufgabe 2: Bezeichnung fürs E-Mail-Wording ("Ihr Instagram-Feed-Beitrag ist
 *  online") - bewusst eigene, bindestrich-verbundene Variante statt CHANNEL_LABEL (das für die
 *  Panel-UI "Instagram Feed" mit Leerzeichen nutzt), passend zusammengesetzt für einen
 *  Fließtext-Satz. "instagram" (ohne Feed/Story-Unterscheidung) deckt alte Posts ab, die vor
 *  dieser Funktion geloggt wurden bzw. Aufrufer, die keinen genaueren Kanal übergeben.
 */
export const EMAIL_CHANNEL_LABEL: Record<string, string> = {
  ig_feed: "Instagram-Feed",
  ig_story: "Instagram-Story",
  linkedin: "LinkedIn",
  instagram: "Instagram",
};

export function logPost(
  customerId: string,
  provider: string,
  post: {
    externalPostId?: string;
    headline?: string;
    caption?: string;
    imageUrl?: string;
    pillarTitle?: string;
    channel?: string;
    /** Panel v14: 'carousel' | 'video_slideshow' - omit/undefined for the ordinary single-image case. */
    format?: string;
    /** Full slide list for a carousel/video-slideshow post - `imageUrl` above stays the cover/first slide either way. */
    slides?: { imageUrl: string; overlayText?: string }[];
    /** Fertig gerendertes MP4 (nur format='video_slideshow'). */
    videoUrl?: string;
  },
): void {
  // Panel v6 Aufgabe 4d: vor dem Insert geprueft, damit "war das der allererste Post" korrekt
  // ist - danach waere die neue Zeile selbst schon mitgezaehlt.
  const isFirstPost = (db.prepare("SELECT COUNT(*) as n FROM posts WHERE customer_id = ?").get(customerId) as { n: number }).n === 0;
  const id = `post_${randomToken(9)}`;
  db.prepare(
    `INSERT INTO posts (id, customer_id, provider, external_post_id, headline, caption, image_url, posted_at, pillar_title, format, video_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    customerId,
    provider,
    post.externalPostId ?? null,
    post.headline ?? null,
    post.caption ?? null,
    post.imageUrl ?? null,
    nowIso(),
    post.pillarTitle ?? null,
    post.format ?? "single",
    post.videoUrl ?? null,
  );
  savePostMedia("post", id, post.slides);
  // Eine offene "Jetzt posten"-Anfrage fuer denselben Kanal ist mit dieser Veroeffentlichung
  // erfuellt - hier schliessen, statt darauf zu vertrauen, dass die externe Routine
  // mark_post_request_done aufruft (Vorfall 15.09.2026, siehe closeOpenPostRequestAfterPublish).
  try {
    closeOpenPostRequestAfterPublish(customerId, provider, post.channel);
  } catch (err) {
    console.error("[post-request] Abschluss nach Veroeffentlichung fehlgeschlagen:", err instanceof Error ? err.message : err);
  }
  if (isFirstPost) maybeSendFirstPostEmail(customerId);
  maybeSendPostPublishedEmail(customerId, post.channel ?? provider);
}

/** Panel v6 Aufgabe 4d: "Ihr erster Beitrag ist live!" - garantiert nur einmal, dank des
 *  atomaren UPDATE...WHERE first_post_email_sent_at IS NULL als "Claim". */
function maybeSendFirstPostEmail(customerId: string): void {
  const row = db.prepare("SELECT email, company FROM customers WHERE id = ? AND first_post_email_sent_at IS NULL").get(customerId) as
    | { email: string; company: string }
    | undefined;
  if (!row) return;
  const result = db
    .prepare("UPDATE customers SET first_post_email_sent_at = ? WHERE id = ? AND first_post_email_sent_at IS NULL")
    .run(nowIso(), customerId);
  if (result.changes === 0) return;
  sendMailBestEffort(firstPostLiveEmail({ to: row.email, company: row.company }));
}

/** Panel v8 Aufgabe 2: opt-in (notify_on_publish) - anders als maybeSendFirstPostEmail läuft
 *  das hier bei JEDER Veröffentlichung, nicht nur der ersten, und nur für Kunden, die es
 *  aktiviert haben. Kein "nur einmal"-Claim nötig (im Gegensatz zur first-post-Mail gibt es hier
 *  keine Deduplizierungs-Anforderung - jeder Aufruf entspricht einer echten, neuen Veröffentlichung). */
function maybeSendPostPublishedEmail(customerId: string, channel: string): void {
  const row = db.prepare("SELECT email, company, notify_on_publish FROM customers WHERE id = ?").get(customerId) as
    | { email: string; company: string; notify_on_publish: number }
    | undefined;
  if (!row || !row.notify_on_publish) return;
  sendMailBestEffort(postPublishedEmail({ to: row.email, company: row.company, channelLabel: EMAIL_CHANNEL_LABEL[channel] ?? "neuer" }));
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
    format: r.format,
    videoUrl: r.video_url,
    slides: r.format === "single" ? [] : getPostMedia("post", r.id),
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
/**
 * Weighted-random pick among `pillars`, avoiding `avoidTitle` when given (falls back to the
 * full list if avoiding it would empty the pool). Factored out of pickPillarForToday so
 * planning.ts (v5) can rotate pillars across a whole 7-day plan in one run - pickPillarForToday
 * itself only ever "avoids" whatever the last REAL post used, which would pick the same pillar
 * for every day of a freshly-generated week (no new `posts` rows exist yet mid-planning).
 */
export function pickWeightedPillar(pillars: ContentPillar[], avoidTitle: string | null): ContentPillar | null {
  if (!pillars.length) return null;
  if (pillars.length === 1) return pillars[0];
  const pool = avoidTitle ? pillars.filter((p) => p.title !== avoidTitle) : pillars;
  const candidates = pool.length ? pool : pillars;

  const totalWeight = candidates.reduce((sum, p) => sum + p.weight, 0);
  let r = Math.random() * totalWeight;
  for (const p of candidates) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return candidates[candidates.length - 1];
}

/** Today's pick, avoiding whatever pillar the customer's most recent REAL post used - unchanged behavior/signature. */
export function pickPillarForToday(customerId: string): ContentPillar | null {
  const pillars = listContentPillars(customerId);
  if (!pillars.length) return null;
  const lastPost = db
    .prepare("SELECT pillar_title FROM posts WHERE customer_id = ? ORDER BY posted_at DESC LIMIT 1")
    .get(customerId) as { pillar_title: string | null } | undefined;
  return pickWeightedPillar(pillars, lastPost?.pillar_title ?? null);
}

export function splitCommaList(raw: string | null): string[] {
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

/**
 * Bugreport 2026-09-13: LinkedIn-Entwürfe kamen inkonsistent an - manche mit generiertem Bild,
 * manche als reiner Text-Platzhalter, je nachdem ob der spontane K4-K8-Pfad an ein Bild dachte
 * oder nicht. Entscheidung: LinkedIn bekommt IMMER ein Bild, dieselbe Konvention, die die
 * Vorausplanung (planning.ts) bereits für jeden Kanal verwendet - siehe CHANNEL_IMAGE_FORMAT
 * oben ("linkedin" -> "feed", exakt wie ig_feed). Hart durchgesetzt statt nur im Routine-Prompt
 * zu stehen, damit ein vom Modell übersehener Fall nicht wieder zu einem bildlosen Entwurf
 * führt. Call this from every LinkedIn-bound save/publish path (save_pending_approval,
 * submitPlannedPostForApproval, publish_linkedin_post) before the actual save/network call.
 */
export function assertLinkedInHasImage(channel: string, imageUrl: string | null | undefined): void {
  if (channel !== "linkedin") return;
  if (!imageUrl || !imageUrl.trim()) {
    throw new Error(
      "LinkedIn-Beiträge brauchen immer ein Bild (dieselbe Bildgenerierung wie für den Instagram-Feed - " +
        "CHANNEL_IMAGE_FORMAT.linkedin ist \"feed\"). Zuerst generate_post_image aufrufen und dessen imageUrl " +
        "mitgeben (bzw. publish_linkedin_image_post statt publish_linkedin_post verwenden), dann erneut versuchen.",
    );
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
  /** Panel v14: 'single' (default) | 'carousel' | 'video_slideshow' - only meaningful for
   *  channel='ig_feed', see Session-Bericht Teil C. Ignore for ig_story/linkedin requests. */
  format: string;
}

function toPostRequest(r: PostRequestRow): PostRequest {
  return { id: r.id, customerId: r.customer_id, topic: r.topic, channel: r.channel, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, format: r.format };
}

/** Panel v8: per CHANNEL, not per customer overall - a customer may now have up to one open
 *  request per channel (ig_feed/ig_story/linkedin) at the same time, since a single "Jetzt
 *  posten" click can select multiple channels at once. */
export const POST_REQUEST_MAX_OPEN = 1;
/** Still a total across ALL channels combined, deliberately not multiplied per channel - keeps
 *  the original daily budget intact even though one click can now create up to 3 rows at once. */
export const POST_REQUEST_MAX_PER_DAY = 3;

/**
 * How many still-pending requests this customer currently has - overall, or (Panel v8) for one
 * specific channel, now that a single "Jetzt posten" submission can queue one request per
 * selected channel independently (see POST_REQUEST_MAX_OPEN's new per-channel meaning below).
 */
export function openPostRequestCount(customerId: string, channel?: string | null): number {
  // 'processing' counts as open too (claimed by an in-flight routine run, not fulfilled yet) -
  // otherwise a customer could queue a second "Jetzt posten" for the same channel while the
  // first is mid-publish, the moment listOpenPostRequests() claims it.
  if (channel) {
    return (
      db
        .prepare("SELECT COUNT(*) as n FROM post_requests WHERE customer_id = ? AND status IN ('pending', 'processing') AND channel = ?")
        .get(customerId, channel) as { n: number }
    ).n;
  }
  return (
    db.prepare("SELECT COUNT(*) as n FROM post_requests WHERE customer_id = ? AND status IN ('pending', 'processing')").get(customerId) as {
      n: number;
    }
  ).n;
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
export function createPostRequest(customerId: string, topic: string | null, channel: string | null = null, format: string = "single"): PostRequest {
  const id = `preq_${randomToken(9)}`;
  const now = nowIso();
  db.prepare(
    `INSERT INTO post_requests (id, customer_id, topic, channel, status, created_at, updated_at, format) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(id, customerId, topic || null, channel, now, now, format);
  return { id, customerId, topic, channel, status: "pending", createdAt: now, updatedAt: now, format };
}

/** Most recent request for one customer (any status), for the panel's own status display. Null if they never asked. */
export function lastPostRequestForCustomer(customerId: string): PostRequest | null {
  const row = db
    .prepare("SELECT * FROM post_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(customerId) as PostRequestRow | undefined;
  return row ? toPostRequest(row) : null;
}

/**
 * Panel v8: a single "Jetzt posten" click can now queue one request per selected channel, so the
 * panel needs more than just the single most recent one to show independent per-channel status
 * (e.g. "LinkedIn ausstehend" while Instagram Feed already went through). 10 is generous - a
 * customer is capped at POST_REQUEST_MAX_PER_DAY (3) new rows per day anyway.
 */
export function listRecentPostRequestsForCustomer(customerId: string, limit = 10): PostRequest[] {
  const rows = db
    .prepare("SELECT * FROM post_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(customerId, limit) as PostRequestRow[];
  return rows.map(toPostRequest);
}

/**
 * A request stuck in 'processing' this long is assumed abandoned (the routine run that claimed
 * it crashed, timed out, or otherwise never reached mark_post_request_done) and becomes claimable
 * again - generous enough to cover one full hourly routine run plus retries without ever
 * matching the routine's own ~1h cadence (which is exactly what caused the incident this
 * constant fixes: a request that stayed 'pending' forever was re-read and re-published by every
 * single hourly run, see docs/incidents - 14 duplicate carousel posts for cus_bW0p_HapELUZ on
 * 2026-09-14/15 before Instagram's own abuse detection started rejecting further publishes).
 */
const POST_REQUEST_STALE_PROCESSING_MS = 3 * 3_600_000;

/**
 * All still-open requests across all customers, oldest first - what the routine should process
 * before its regular customer loop. Atomically CLAIMS them (flips 'pending' -> 'processing' in
 * the same call) so a request is only ever handed to ONE routine run at a time: previously this
 * was a plain SELECT with no claim, so a request the routine forgot (or failed) to pass to
 * mark_post_request_done stayed 'pending' forever and got silently re-published by every
 * subsequent hourly run - unbounded, since nothing here ever verified whether a near-identical
 * post had already gone out. A 'processing' row that's older than
 * POST_REQUEST_STALE_PROCESSING_MS is treated as abandoned and reclaimed for one more attempt,
 * so a genuine crash mid-run still eventually gets retried instead of being stuck forever.
 */
/**
 * Panel v22: Video-Anfragen (format='video_slideshow') sind hier BEWUSST ausgenommen. Sie werden
 * vollständig serverseitig abgearbeitet (videos.ts) - würde die externe Routine sie ebenfalls
 * sehen, würde sie versuchen, daraus mit den Bild-Werkzeugen einen Beitrag zu machen, und der
 * Kunde bekäme am Ende zwei. Dasselbe gilt für listApprovedPendingPosts weiter unten.
 */
export function listOpenPostRequests(): PostRequest[] {
  const staleBefore = new Date(Date.now() - POST_REQUEST_STALE_PROCESSING_MS).toISOString();
  const claimable = db
    .prepare(
      "SELECT id FROM post_requests WHERE format != 'video_slideshow' AND (status = 'pending' OR (status = 'processing' AND updated_at < ?)) ORDER BY created_at",
    )
    .all(staleBefore) as { id: string }[];
  if (claimable.length === 0) return [];

  const now = nowIso();
  const claim = db.prepare("UPDATE post_requests SET status = 'processing', updated_at = ? WHERE id = ?");
  const claimAll = db.transaction((ids: string[]) => {
    for (const id of ids) claim.run(now, id);
  });
  claimAll(claimable.map((r) => r.id));

  const rows = db
    .prepare(`SELECT * FROM post_requests WHERE id IN (${claimable.map(() => "?").join(",")}) ORDER BY created_at`)
    .all(...claimable.map((r) => r.id)) as PostRequestRow[];
  return rows.map(toPostRequest);
}

/** Marks a request done once the routine has fulfilled it. Returns false if the id doesn't exist (already handled by someone else, or invalid). */
/**
 * Schliesst eine offene "Jetzt posten"-Anfrage, sobald fuer denselben Kunden und Kanal
 * tatsaechlich veroeffentlicht wurde - unabhaengig davon, ob die externe Routine hinterher
 * mark_post_request_done aufruft.
 *
 * Warum das noetig ist (Vorfall 15.09.2026): Die Routine hatte die LinkedIn-Anfrage von Paul
 * geclaimt, VIERMAL veroeffentlicht (12:43:54, 12:44:01, 12:44:05, 12:44:09) und danach nie
 * abgeschlossen. Die Anfrage blieb in 'processing' stehen, blockierte den Kanal im Panel
 * ("schon angefragt") und waere nach Ablauf der Stale-Frist erneut zur Veroeffentlichung
 * freigegeben worden. Der Abschluss darf nicht davon abhaengen, dass ein externer Aufrufer sich
 * korrekt verhaelt: wer veroeffentlicht hat, hat die Anfrage erfuellt.
 */
export function closeOpenPostRequestAfterPublish(customerId: string, provider: string, channel?: string): number {
  const kanal = channel ?? (provider === "linkedin" ? "linkedin" : null);
  const zeile = kanal
    ? db
        .prepare(
          "SELECT id FROM post_requests WHERE customer_id = ? AND status IN ('pending','processing') AND (channel = ? OR channel IS NULL) ORDER BY created_at LIMIT 1",
        )
        .get(customerId, kanal)
    : db
        .prepare("SELECT id FROM post_requests WHERE customer_id = ? AND status IN ('pending','processing') ORDER BY created_at LIMIT 1")
        .get(customerId);
  if (!zeile) return 0;
  const id = (zeile as { id: string }).id;
  db.prepare("UPDATE post_requests SET status = 'done', updated_at = ? WHERE id = ?").run(nowIso(), id);
  console.error(`[post-request] ${id} nach Veroeffentlichung (${provider}${channel ? "/" + channel : ""}) automatisch abgeschlossen`);
  return 1;
}

/**
 * Zieht eine offene Anfrage zurueck. Bis 15.09.2026 gab es dafuer keinen Weg: eine haengende
 * Anfrage blockierte den Kanal ohne Ablauf und ohne Abbruchmoeglichkeit.
 */
export function cancelPostRequest(customerId: string, id?: string): number {
  const result = id
    ? db
        .prepare("UPDATE post_requests SET status = 'cancelled', updated_at = ? WHERE id = ? AND customer_id = ? AND status IN ('pending','processing')")
        .run(nowIso(), id, customerId)
    : db
        .prepare("UPDATE post_requests SET status = 'cancelled', updated_at = ? WHERE customer_id = ? AND status IN ('pending','processing')")
        .run(nowIso(), customerId);
  return result.changes;
}

export function markPostRequestDone(id: string): boolean {
  const result = db.prepare("UPDATE post_requests SET status = 'done', updated_at = ? WHERE id = ?").run(nowIso(), id);
  return result.changes > 0;
}

export interface PendingApproval {
  id: string;
  customerId: string;
  provider: string;
  /** ig_feed/ig_story/linkedin - the exact channel from save_pending_approval. Falls back to
   *  `provider` for rows written before this field existed (NULL there). */
  channel: string;
  headline: string | null;
  caption: string | null;
  imageUrl: string | null;
  pillarTitle: string | null;
  /** Panel v7: 'planning' (filed as-is from the nightly pre-planning) or 'routine' (spontaneously
   *  generated on the spot). Null for rows written before this field existed. */
  source: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  format: string;
  /** Panel v22: fertig gerendertes MP4 einer Video-Diashow (sonst null). `imageUrl` bleibt daneben
   *  mit dem Standbild belegt, damit jede bestehende Vorschau-/Verlaufs-Ansicht weiter funktioniert. */
  videoUrl: string | null;
  /** Panel v14: full slide list for a carousel/video-slideshow approval - empty for 'single'. The
   *  customer's approval-card preview needs every slide, not just the cover `imageUrl`. */
  slides: PostMediaSlide[];
  /** Panel v19: when this row's headline/caption text was last written (fresh generation, a
   *  server-side stale-regen, or copied over from a planned_post's own timestamp) - see
   *  planning.ts's isBrandingStale / getFreshApprovedPendingPosts. Null for rows written before
   *  this field existed. */
  brandingVersionAtGeneration: string | null;
}

function toPendingApproval(r: PendingApprovalRow): PendingApproval {
  return {
    id: r.id,
    customerId: r.customer_id,
    provider: r.provider,
    channel: r.channel ?? r.provider,
    headline: r.headline,
    caption: r.caption,
    imageUrl: r.image_url,
    pillarTitle: r.pillar_title,
    source: r.source,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    format: r.format,
    videoUrl: r.video_url,
    slides: r.format === "single" ? [] : getPostMedia("pending_approval", r.id),
    brandingVersionAtGeneration: r.branding_version_at_generation,
  };
}

/**
 * Hard, server-side duplicate guard (bug: 8 pending_approvals rows for one approvalMode customer
 * on one day - see report 2026-09-13). True if this customer/channel already has a row that still
 * counts as "in the queue" for the given Vienna calendar date - 'pending' (awaiting the customer's
 * review) or 'approved' (reviewed, waiting to be published). A 'rejected' or already-'published'
 * row never blocks a fresh attempt - only an open, undecided slot does. Deliberately keyed on
 * `channel` (ig_feed/ig_story/linkedin), not the coarser `provider` - a customer can legitimately
 * get one ig_feed AND one ig_story entry the same day, that's two different channels.
 */
export function hasPendingOrApprovedToday(customerId: string, channel: string, dateStr: string = viennaDateStr()): boolean {
  const rows = db
    .prepare(
      `SELECT created_at FROM pending_approvals
       WHERE customer_id = ? AND channel = ? AND status IN ('pending', 'approved')
       ORDER BY created_at DESC LIMIT 10`,
    )
    .all(customerId, channel) as { created_at: string }[];
  return rows.some((r) => viennaDateStr(new Date(r.created_at)) === dateStr);
}

/**
 * Used by `save_pending_approval` (the MCP tool) when a customer has `approval_mode` on -
 * files a generated post away for the customer to review in their panel instead of
 * publishing it. Whether to call this instead of a publish tool is the routine's own decision
 * (based on `approvalMode` from list_customers) - nothing here intercepts the publish tools.
 *
 * Returns null instead of inserting when `hasPendingOrApprovedToday` already holds for this
 * customer/channel - a hard guard against the K3b/K4-K8 duplicate-draft bug, enforced here (the
 * one place both callers - the `save_pending_approval` tool AND `submitPlannedPostForApproval`,
 * which also calls this function - go through) rather than relying on the routine prompt text to
 * remember to check first. Deliberately unconditional: it doesn't matter whether the existing
 * entry came from spontaneous generation or from the nightly pre-planning - either way the
 * slot is already covered, so a second one is never created.
 */
export function savePendingApproval(input: {
  customerId: string;
  provider: string;
  channel: string;
  headline?: string;
  caption?: string;
  imageUrl?: string;
  pillarTitle?: string;
  /** Panel v7: defaults to 'routine' (the MCP tool wrapper never passes this - every call through
   *  it IS a spontaneous generation). submitPlannedPostForApproval passes 'planning' explicitly. */
  source?: string;
  /** Panel v14: 'carousel' | 'video_slideshow' - omit/undefined for the ordinary single-image case. */
  format?: string;
  /** Full slide list for a carousel/video-slideshow approval - `imageUrl` above stays the cover/first slide. */
  slides?: { imageUrl: string; overlayText?: string }[];
  /** Fertig gerendertes MP4 (nur format='video_slideshow') - siehe PendingApproval.videoUrl. */
  videoUrl?: string;
  /** Panel v19: when this content's text was actually written - defaults to now (a fresh, on-the-spot
   *  generation, the overwhelmingly common case for this function). submitPlannedPostForApproval
   *  passes the SOURCE planned_post's own timestamp instead, since it's copying existing content
   *  verbatim, not generating anything new - see its call site. */
  brandingVersionAtGeneration?: string;
}): PendingApproval | null {
  if (hasPendingOrApprovedToday(input.customerId, input.channel)) return null;
  const id = `appr_${randomToken(9)}`;
  const now = nowIso();
  db.prepare(
    `INSERT INTO pending_approvals (id, customer_id, provider, channel, headline, caption, image_url, pillar_title, source, status, created_at, updated_at, format, branding_version_at_generation, video_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.customerId,
    input.provider,
    input.channel,
    input.headline ?? null,
    input.caption ?? null,
    input.imageUrl ?? null,
    input.pillarTitle ?? null,
    input.source ?? "routine",
    now,
    now,
    input.format ?? "single",
    input.brandingVersionAtGeneration ?? now,
    input.videoUrl ?? null,
  );
  savePostMedia("pending_approval", id, input.slides);
  maybeSendApprovalsSummaryEmail(input.customerId);
  maybeSendApprovalNeededEmail(input.customerId, input.channel);
  return toPendingApproval(
    db.prepare("SELECT * FROM pending_approvals WHERE id = ?").get(id) as PendingApprovalRow,
  );
}

/**
 * Panel v6 Aufgabe 4b: "X Beiträge warten auf Ihre Freigabe" - gesammelt statt pro Eintrag,
 * höchstens 1x/24h pro Kunde (approval_email_sent_at ist der Guard). Die ERSTE neue
 * pending_approvals-Zeile innerhalb eines 24h-Fensters löst die Mail aus (mit der aktuellen
 * Gesamtzahl wartender Beiträge, nicht nur der einen neuen), jede weitere im selben Fenster wird
 * stillschweigend mitgezählt statt eine eigene Mail zu verursachen.
 */
function maybeSendApprovalsSummaryEmail(customerId: string): void {
  const row = db.prepare("SELECT email, company, approval_email_sent_at FROM customers WHERE id = ?").get(customerId) as
    | { email: string; company: string; approval_email_sent_at: string | null }
    | undefined;
  if (!row) return;
  const last = row.approval_email_sent_at ? new Date(row.approval_email_sent_at).getTime() : 0;
  if (Date.now() - last < 24 * 3_600_000) return;
  const result = db
    .prepare("UPDATE customers SET approval_email_sent_at = ? WHERE id = ? AND (approval_email_sent_at IS NULL OR approval_email_sent_at = ?)")
    .run(nowIso(), customerId, row.approval_email_sent_at);
  if (result.changes === 0) return; // gerade von einem parallelen Aufruf beansprucht
  const count = listPendingApprovalsForCustomer(customerId).length;
  sendMailBestEffort(pendingApprovalsSummaryEmail({ to: row.email, company: row.company, count }));
}

/** Panel v8 Aufgabe 2: opt-in (notify_on_publish, derselbe Schalter), sofortiger Einzel-Hinweis
 *  für JEDEN neuen zur-Freigabe-Eintrag - unabhängig von/zusätzlich zu der gesammelten,
 *  höchstens 1x/Tag laufenden Erinnerung oben (maybeSendApprovalsSummaryEmail), die unverändert
 *  weiterläuft. Kein Dedup-Claim nötig, jeder Aufruf ist ein echter neuer Eintrag (savePendingApproval
 *  ruft dies nur bei einem tatsächlichen INSERT auf, nie bei einem vom Duplikat-Schutz blockierten). */
function maybeSendApprovalNeededEmail(customerId: string, channel: string): void {
  const row = db.prepare("SELECT email, company, notify_on_publish FROM customers WHERE id = ?").get(customerId) as
    | { email: string; company: string; notify_on_publish: number }
    | undefined;
  if (!row || !row.notify_on_publish) return;
  sendMailBestEffort(approvalNeededEmail({ to: row.email, company: row.company, channelLabel: EMAIL_CHANNEL_LABEL[channel] ?? "neuer" }));
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
  // Video-Diashows fehlen hier absichtlich - sie veroeffentlicht der Server selbst (videos.ts),
  // die externe Routine kann kein Video hochladen. Siehe listOpenPostRequests oben.
  const rows = db
    .prepare("SELECT * FROM pending_approvals WHERE status = 'approved' AND format != 'video_slideshow' ORDER BY created_at")
    .all() as PendingApprovalRow[];
  return rows.map(toPendingApproval);
}

/** Gegenstueck zu listApprovedPendingPosts fuer den Server-Pfad: freigegebene Video-Diashows, die
 *  noch veroeffentlicht werden muessen (siehe videos.ts's publishApprovedVideos). */
export function listApprovedVideoPosts(): PendingApproval[] {
  const rows = db
    .prepare("SELECT * FROM pending_approvals WHERE status = 'approved' AND format = 'video_slideshow' ORDER BY created_at")
    .all() as PendingApprovalRow[];
  return rows.map(toPendingApproval);
}

/** Marks an approved pending_approval as published once the routine has actually published it - stops it from being returned by list_approved_pending_posts again. */
export function markPendingApprovalPublished(id: string): boolean {
  const result = db.prepare("UPDATE pending_approvals SET status = 'published', updated_at = ? WHERE id = ? AND status = 'approved'").run(nowIso(), id);
  return result.changes > 0;
}

/**
 * Panel v19: overwrites an 'approved' pending_approval's text+image after the stale-content guard
 * regenerated it (see planning.ts's getFreshApprovedPendingPosts) - keeps its status 'approved'
 * (the customer's approval of THIS SLOT still stands, only the actual wording/image changes to
 * match their current branding) and bumps branding_version_at_generation to now.
 */
export function overwritePendingApprovalContent(id: string, fields: { headline: string; caption: string; imageUrl: string }): PendingApproval | null {
  const now = nowIso();
  const result = db
    .prepare("UPDATE pending_approvals SET headline = ?, caption = ?, image_url = ?, updated_at = ?, branding_version_at_generation = ? WHERE id = ? AND status = 'approved'")
    .run(fields.headline, fields.caption, fields.imageUrl, now, now, id);
  if (result.changes === 0) return null;
  return toPendingApproval(db.prepare("SELECT * FROM pending_approvals WHERE id = ?").get(id) as PendingApprovalRow);
}

/**
 * Panel v19: force-rejects an approved pending_approval that turned out stale AND couldn't be
 * safely regenerated (e.g. a carousel/video-slideshow, which has no server-side text generator) -
 * unlike setPendingApprovalStatus, this isn't the customer's own approve/reject action and isn't
 * restricted to status 'pending', so it works on an already-'approved' row.
 */
export function forceRejectPendingApproval(id: string): boolean {
  const result = db.prepare("UPDATE pending_approvals SET status = 'rejected', updated_at = ? WHERE id = ?").run(nowIso(), id);
  return result.changes > 0;
}

export interface PlannedPost {
  id: string;
  customerId: string;
  channel: string;
  scheduledFor: string;
  status: string;
  headline: string | null;
  caption: string | null;
  imageUrl: string | null;
  pillarTitle: string | null;
  accentColorUsed: string | null;
  regenerateCount: number;
  createdAt: string;
  updatedAt: string;
  /** Panel v19: when this row's headline/caption text was last written - first generation, a
   *  server-side regeneration (branding-regen feature or the stale-content guard), or the
   *  customer's own manual edit all bump this. Null for rows written before this field existed -
   *  see planning.ts's isBrandingStale, which treats that as "unknown age, assume stale" once the
   *  customer has ANY recorded branding change. */
  brandingVersionAtGeneration: string | null;
}

function toPlannedPost(r: PlannedPostRow): PlannedPost {
  return {
    id: r.id,
    customerId: r.customer_id,
    channel: r.channel,
    scheduledFor: r.scheduled_for,
    status: r.status,
    headline: r.headline,
    caption: r.caption,
    imageUrl: r.image_url,
    pillarTitle: r.pillar_title,
    accentColorUsed: r.accent_color_used,
    regenerateCount: r.regenerate_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    brandingVersionAtGeneration: r.branding_version_at_generation,
  };
}

/** Above this many "Mit dieser Farbe neu erstellen" regenerations, the panel hides the button (cost control, task 8). */
export const PLANNED_POST_MAX_REGENERATE = 3;

/** Creates one planned_posts row (planning.ts, one per due customer/channel/day). */
export function createPlannedPost(input: {
  customerId: string;
  channel: string;
  scheduledFor: string;
  headline?: string;
  caption?: string;
  imageUrl?: string;
  pillarTitle?: string;
  accentColorUsed?: string;
}): PlannedPost {
  const id = `plan_${randomToken(9)}`;
  const now = nowIso();
  db.prepare(
    `INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, image_url, pillar_title, accent_color_used, regenerate_count, created_at, updated_at, branding_version_at_generation)
     VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    id,
    input.customerId,
    input.channel,
    input.scheduledFor,
    input.headline ?? null,
    input.caption ?? null,
    input.imageUrl ?? null,
    input.pillarTitle ?? null,
    input.accentColorUsed ?? null,
    now,
    now,
    now,
  );
  return toPlannedPost(db.prepare("SELECT * FROM planned_posts WHERE id = ?").get(id) as PlannedPostRow);
}

/** One customer's planned post for one channel/day, or null - planning.ts's idempotency check and the
 *  `get_planned_post` MCP tool (K0 in the routine, task 6) both use this exact lookup shape. */
export function getPlannedPostByChannelDate(customerId: string, channel: string, scheduledFor: string): PlannedPost | null {
  const row = db
    .prepare("SELECT * FROM planned_posts WHERE customer_id = ? AND channel = ? AND scheduled_for = ?")
    .get(customerId, channel, scheduledFor) as PlannedPostRow | undefined;
  return row ? toPlannedPost(row) : null;
}

/** A customer's planned posts in a date range (both ends inclusive, YYYY-MM-DD), earliest first - the panel's "Vorschau" tab. */
export function listPlannedPosts(customerId: string, fromDate: string, toDate: string): PlannedPost[] {
  const rows = db
    .prepare("SELECT * FROM planned_posts WHERE customer_id = ? AND scheduled_for >= ? AND scheduled_for <= ? ORDER BY scheduled_for, channel")
    .all(customerId, fromDate, toDate) as PlannedPostRow[];
  return rows.map(toPlannedPost);
}

export function getPlannedPost(id: string): PlannedPost | null {
  const row = db.prepare("SELECT * FROM planned_posts WHERE id = ?").get(id) as PlannedPostRow | undefined;
  return row ? toPlannedPost(row) : null;
}

/** customer_id-scoped lookup for the panel's own endpoints - never lets a customer read/edit another's row. */
export function getPlannedPostForCustomer(customerId: string, id: string): PlannedPost | null {
  const row = db.prepare("SELECT * FROM planned_posts WHERE id = ? AND customer_id = ?").get(id, customerId) as PlannedPostRow | undefined;
  return row ? toPlannedPost(row) : null;
}

/**
 * Edits headline/caption on a planned post (customer edit in the "Vorschau" tab). Moves a plain
 * 'planned' row to 'edited' so the routine/panel can tell it was customer-touched; a row already
 * past that (approved/rejected/published) keeps its status - editing text after approval doesn't
 * silently un-approve it. Also bumps branding_version_at_generation to now - this is the
 * customer's OWN freshly-written text, so it counts as current regardless of when the row was
 * first generated (see planning.ts's isBrandingStale).
 */
export function updatePlannedPostText(id: string, fields: { headline?: string; caption?: string }): PlannedPost | null {
  const row = db.prepare("SELECT * FROM planned_posts WHERE id = ?").get(id) as PlannedPostRow | undefined;
  if (!row) return null;
  const headline = fields.headline !== undefined ? fields.headline : row.headline;
  const caption = fields.caption !== undefined ? fields.caption : row.caption;
  const nextStatus = row.status === "planned" ? "edited" : row.status;
  db.prepare("UPDATE planned_posts SET headline = ?, caption = ?, status = ?, updated_at = ?, branding_version_at_generation = ? WHERE id = ?").run(
    headline,
    caption,
    nextStatus,
    nowIso(),
    nowIso(),
    id,
  );
  return getPlannedPost(id);
}

/** Sets a planned post's status directly (approve/reject, or the routine marking it published) - no text/image change. */
export function markPlannedPostStatus(id: string, status: string): PlannedPost | null {
  const result = db.prepare("UPDATE planned_posts SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
  if (result.changes === 0) return null;
  return getPlannedPost(id);
}

/**
 * Panel v7 fix: used by the `submit_planned_post_for_approval` MCP tool (K3b, approvalMode
 * customers) to file an ALREADY-PREPARED planned_post into pending_approvals AS-IS, without
 * generating anything new. Fixes a real customer-visible bug (Andrea Hölzl): the previous K3b
 * behavior discarded the exact post the customer already saw/edited in "Vorschau" and generated
 * a completely different one at due-time, so the "Wartet auf Ihre Freigabe" card never matched
 * what the customer had reviewed - and doubled Anthropic/fal.ai cost for the same slot (once in
 * planning.ts overnight, once again here).
 *
 * Re-checks bannedWords/requiredElements before filing (same backstop `save_pending_approval`'s
 * tool wrapper applies) - the text was already checked when planning.ts first created it and
 * again on every customer edit, but a customer could edit their bannedWords/requiredElements
 * list AFTER a post was already prepared, so re-checking here is not redundant.
 *
 * Only acts on status 'planned'/'edited' - returns null (no-op) for anything else, so calling it
 * twice (e.g. a retried tool call) can never file the same planned_post twice; marks the row
 * 'submitted' on success so a later run's K3b treats it as already handled instead of dueNow
 * re-triggering it.
 */
export function submitPlannedPostForApproval(plannedPostId: string): PendingApproval | null {
  const plan = getPlannedPost(plannedPostId);
  if (!plan) return null;
  if (plan.status !== "planned" && plan.status !== "edited") return null;

  const checkTexts = plan.channel === "ig_story" ? [plan.headline ?? undefined] : [plan.headline ?? undefined, plan.caption ?? undefined];
  assertNoBannedWords(plan.customerId, ...checkTexts);
  assertRequiredElements(plan.customerId, ...checkTexts);
  assertLinkedInHasImage(plan.channel, plan.imageUrl);

  const provider = plan.channel === "linkedin" ? "linkedin" : "instagram";
  const approval = savePendingApproval({
    customerId: plan.customerId,
    provider,
    channel: plan.channel,
    headline: plan.headline ?? undefined,
    caption: plan.caption ?? undefined,
    imageUrl: plan.imageUrl ?? undefined,
    pillarTitle: plan.pillarTitle ?? undefined,
    source: "planning",
    brandingVersionAtGeneration: plan.brandingVersionAtGeneration ?? undefined,
  });
  // Mark 'submitted' even when savePendingApproval returned null (hasPendingOrApprovedToday
  // already found another open entry for this customer/channel/day, e.g. filed earlier the same
  // day via the K4-K8 spontaneous path) - the slot is covered either way, and leaving this
  // planned_post at 'planned' would make K3b retry it every single run, forever.
  markPlannedPostStatus(plan.id, "submitted");
  return approval;
}

/**
 * Replaces a planned post's image (customer's "Mit dieser Farbe neu erstellen") and increments
 * regenerate_count. Caller (the router) is responsible for checking PLANNED_POST_MAX_REGENERATE
 * against the current count BEFORE calling generation - this function only records the result.
 */
export function updatePlannedPostImage(id: string, imageUrl: string, accentColorUsed: string): PlannedPost | null {
  const result = db
    .prepare("UPDATE planned_posts SET image_url = ?, accent_color_used = ?, regenerate_count = regenerate_count + 1, updated_at = ? WHERE id = ?")
    .run(imageUrl, accentColorUsed, nowIso(), id);
  if (result.changes === 0) return null;
  return getPlannedPost(id);
}

/**
 * How many of a customer's still-open (today..+6 days) planned posts would be affected by a
 * "regenerate after branding change" offer (see router.ts's PATCH /api/me and
 * planning.ts's regeneratePlannedPostsForBranding) - split by whether the customer already
 * edited them, so the panel can show "N Beiträge" for the plain offer and a separate "M davon
 * haben Sie bereits bearbeitet" warning before anyone touches an edited one.
 */
export function countRegenerableBrandingPlannedPosts(customerId: string): { eligible: number; edited: number } {
  const today = viennaDateStr();
  const to = viennaDateStr(new Date(Date.now() + 6 * 86_400_000));
  const rows = db
    .prepare("SELECT status FROM planned_posts WHERE customer_id = ? AND scheduled_for >= ? AND scheduled_for <= ?")
    .all(customerId, today, to) as { status: string }[];
  return {
    eligible: rows.filter((r) => r.status === "planned").length,
    edited: rows.filter((r) => r.status === "edited").length,
  };
}

/**
 * Overwrites a planned post's generated content wholesale (headline/caption/image) after a
 * branding-driven regeneration - unlike updatePlannedPostText (a customer's own hand-edit,
 * which moves 'planned' -> 'edited'), this is the SERVER replacing AI-generated content with
 * fresher AI-generated content, so the row goes back to plain 'planned' regardless of its
 * previous status (including from 'edited', when the caller explicitly opted to overwrite
 * edited rows too) - the old edit is gone, there is nothing left to flag as customer-touched.
 * Does not touch regenerate_count (that budget is specifically for the customer's own "Mit
 * dieser Farbe neu erstellen" button, a separate feature/limit).
 */
export function overwritePlannedPostContent(id: string, fields: { headline: string; caption: string; imageUrl: string; accentColorUsed?: string | null }): PlannedPost | null {
  const now = nowIso();
  const result = db
    .prepare(
      "UPDATE planned_posts SET headline = ?, caption = ?, image_url = ?, accent_color_used = ?, status = 'planned', updated_at = ?, branding_version_at_generation = ? WHERE id = ?",
    )
    .run(fields.headline, fields.caption, fields.imageUrl, fields.accentColorUsed ?? null, now, now, id);
  if (result.changes === 0) return null;
  return getPlannedPost(id);
}

/** Records one skipped customer/day/channel from a planning run (task 4/8's safety net) - never throws, best-effort. */
export function logPlanningError(customerId: string | null, channel: string | null, scheduledFor: string | null, message: string): void {
  try {
    db.prepare(
      `INSERT INTO planning_errors (id, customer_id, channel, scheduled_for, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(`plerr_${randomToken(9)}`, customerId, channel, scheduledFor, message.slice(0, 500), nowIso());
  } catch (err) {
    console.error("[panel] logPlanningError selbst fehlgeschlagen:", err);
  }
}

export interface PlanningError {
  customerId: string | null;
  channel: string | null;
  scheduledFor: string | null;
  message: string;
  createdAt: string;
}

/** Most recent planning-run errors, newest first - for the report/admin view. */
export function listRecentPlanningErrors(limit = 50): PlanningError[] {
  const rows = db.prepare("SELECT * FROM planning_errors ORDER BY created_at DESC LIMIT ?").all(limit) as PlanningErrorRow[];
  return rows.map((r) => ({ customerId: r.customer_id, channel: r.channel, scheduledFor: r.scheduled_for, message: r.message, createdAt: r.created_at }));
}

export interface SavedTheme {
  id: string;
  name: string;
  accentColor: string | null;
  watermarkText: string | null;
  createdAt: string;
}

function toSavedTheme(r: SavedThemeRow): SavedTheme {
  return { id: r.id, name: r.name, accentColor: r.accent_color, watermarkText: r.watermark_text, createdAt: r.created_at };
}

/** A customer's saved color themes, oldest first. */
export function listSavedThemes(customerId: string): SavedTheme[] {
  const rows = db.prepare("SELECT * FROM saved_themes WHERE customer_id = ? ORDER BY created_at").all(customerId) as SavedThemeRow[];
  return rows.map(toSavedTheme);
}

/** Saves the customer's current accent color / watermark text as a new named theme (doesn't activate it). */
export function createSavedTheme(customerId: string, name: string, accentColor: string | null, watermarkText: string | null): SavedTheme {
  const id = `theme_${randomToken(9)}`;
  const now = nowIso();
  db.prepare(
    "INSERT INTO saved_themes (id, customer_id, name, accent_color, watermark_text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, customerId, name, accentColor || null, watermarkText || null, now);
  return { id, name, accentColor, watermarkText, createdAt: now };
}

/** Activates one of a customer's own saved themes (their generated images use its color/watermark from now on). False if the theme doesn't exist or isn't theirs. */
export function activateSavedTheme(customerId: string, themeId: string): boolean {
  const owned = db.prepare("SELECT 1 FROM saved_themes WHERE id = ? AND customer_id = ?").get(themeId, customerId);
  if (!owned) return false;
  db.prepare("UPDATE customers SET active_theme_id = ?, updated_at = ? WHERE id = ?").run(themeId, nowIso(), customerId);
  return true;
}

/** Switches a customer back to their plain accent_color/watermark_text fields (no active theme). */
export function deactivateTheme(customerId: string): void {
  db.prepare("UPDATE customers SET active_theme_id = NULL, updated_at = ? WHERE id = ?").run(nowIso(), customerId);
}

/**
 * The accent color / watermark text that should actually be used for this customer's
 * generated images: their active saved theme if they have one, otherwise their plain
 * accent_color/watermark_text fields exactly as before v4 (full backward compatibility - a
 * customer who never touches themes has `active_theme_id` NULL forever).
 */
export function effectiveBranding(c: CustomerRow): { accentColor: string | null; watermarkText: string | null } {
  if (c.active_theme_id) {
    const theme = db
      .prepare("SELECT accent_color, watermark_text FROM saved_themes WHERE id = ? AND customer_id = ?")
      .get(c.active_theme_id, c.id) as { accent_color: string | null; watermark_text: string | null } | undefined;
    if (theme) return { accentColor: theme.accent_color, watermarkText: theme.watermark_text };
  }
  return { accentColor: c.accent_color, watermarkText: c.watermark_text };
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

/**
 * Full get_customer_style_samples behavior (cache check, credential resolution, Graph API call,
 * cache write) as a plain function, not just an MCP tool - the MCP tool below calls this
 * directly, and so does planning.ts's server-side pre-planning (v5), so both go through the
 * exact same logic/cache instead of two implementations drifting apart.
 */
export async function getStyleSamples(customerId: string): Promise<{ samples: CachedStyleSample[]; cached: boolean }> {
  const cached = getCachedStyleSamples(customerId);
  if (cached) return { samples: cached, cached: true };
  let creds: InstagramCredentials | undefined;
  try {
    creds = await resolveInstagramCredentials(customerId);
  } catch (credError) {
    // Not connected yet is a normal, expected case here - unlike a real trial/token error,
    // don't surface it as a failure.
    if (credError instanceof Error && credError.message.includes("nicht verbunden")) {
      return { samples: [], cached: false };
    }
    throw credError;
  }
  if (!creds) return { samples: [], cached: false };
  const samples = await getRecentMedia(creds, 10);
  setCachedStyleSamples(customerId, samples);
  return { samples, cached: false };
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
