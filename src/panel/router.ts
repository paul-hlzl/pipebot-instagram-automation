import express, { type Request, type Response, type NextFunction, type Router } from "express";
import path from "node:path";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import sharp from "sharp";
import { PACKAGE_ROOT, getConfig } from "../config.js";
import { db, nowIso, type CustomerRow, type ConnectionRow } from "./db.js";
import { assertEncryptionKey, encrypt, randomToken, sha256 } from "./crypto.js";
import { getProvider, visibleProviders } from "./providers/index.js";
import { ProviderError } from "./providers/types.js";
import {
  activateSavedTheme,
  assertNoBannedWords,
  assertRequiredElements,
  CHANNEL_IMAGE_FORMAT,
  CHANNEL_LABEL,
  connectionStatus,
  countRegenerableBrandingPlannedPosts,
  createPostRequest,
  createSavedTheme,
  deactivateTheme,
  getPlannedPostForCustomer,
  isTrialExpired,
  lastPostRequestForCustomer,
  listContentPillars,
  listPendingApprovalsForCustomer,
  listPlannedPosts,
  listPostsForCustomer,
  listRecentPostRequestsForCustomer,
  listSavedThemes,
  markPlannedPostStatus,
  openPostRequestCount,
  PLANNED_POST_MAX_REGENERATE,
  POST_REQUEST_MAX_OPEN,
  POST_REQUEST_MAX_PER_DAY,
  postRequestCountToday,
  type PublishChannel,
  resolveImageBranding,
  scheduleInputFor,
  setContentPillars,
  setPendingApprovalStatus,
  trialDaysLeft,
  updatePlannedPostImage,
  updatePlannedPostText,
  cancelPostRequest,} from "./credentials.js";
import { generateAndCacheSummary, getAnalyticsSummary, getSummaryCache, logUsageCost, type AnalyticsChannel } from "./analytics.js";
import { regeneratePlannedPostsForBranding } from "./planning.js";
import { deleteObject, uploadAudioBase64 } from "../r2.js";
import { estimateTranscriptionCostUsd, transcribeAudioUrl } from "../audio-transcribe.js";
import { ToolError } from "../errors.js";
import { approveCommentReply, CommentRateLimitError, listPendingCommentApprovals, rejectCommentReply } from "./comments.js";
import { approveReviewReply, listPendingReviewApprovals, rejectReviewReply, ReviewRateLimitError } from "./reviews.js";
import { runVideoPass } from "./videos.js";
import { DEFAULT_VOICE_ID, getVoiceOption, synthesizeSpeech, ttsAvailable, VOICE_OPTIONS, VOICE_PREVIEW_TEXT } from "../tts.js";
import { DEFAULT_VIDEO_LENGTH, VIDEO_LENGTHS, ZOOM_DIRECTIONS } from "../video.js";
import { createAdminRouter } from "./admin.js";
import { triggerRoutineNow } from "./routine-trigger.js";
import { turnstileConfigured, turnstileSiteKey, verifyTurnstileToken } from "./turnstile.js";
import { sendMailBestEffort } from "./mailer.js";
import { accessRecoveryEmail, verificationEmail } from "./emails.js";
import { isDue, isDueForChannel, nextPostAt, nextVideoPostAt, viennaDateStr } from "./schedule.js";
import { anthropicAvailable, helpChatReply, improveBriefing, suggestPillarsWithSearch, suggestTopics, type HelpChatMessage } from "../anthropic.js";
import { subscribeToCommentWebhook } from "../instagram-comments.js";
import { CAROUSEL_MIN_SLIDES, CAROUSEL_MAX_SLIDES } from "../instagram.js";
import { FONT_OPTIONS, DEFAULT_FONT_ID } from "../fonts.js";
import { suggestGradientPartners } from "../gradient.js";
import { analyzeWebsite } from "../website-analyze.js";
import { generateImageUrl } from "../fal.js";

const VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

const MOUNT = (process.env.PANEL_MOUNT_PATH ?? "/panel").replace(/\/$/, "");

/**
 * Das Panel laeuft ab 15.09.2026 unter ZWEI Adressen gleichzeitig:
 *   - https://mcp.pipebot.at/panel  (historisch, bleibt bis auf Weiteres)
 *   - https://app.pipeflow.at/      (neu, Panel liegt direkt auf der Wurzel)
 * Beide zeigen auf denselben Prozess und dieselbe Datenbank.
 *
 * Mount und Basis-URL duerfen deshalb NICHT mehr aus einer globalen Variable kommen: Cookie-Pfad,
 * Weiterleitungen, Links in E-Mails und vor allem die OAuth-redirect_uri muessen zu der Adresse
 * passen, ueber die der Aufruf tatsaechlich kam. Sonst landet ein Kunde, der auf app.pipeflow.at
 * beginnt, nach dem Verbinden auf mcp.pipebot.at - oder bekommt ein Cookie mit Pfad /panel, das
 * unter der neuen Adresse nie mitgeschickt wird.
 */
const APP_HOSTS = (process.env.PANEL_APP_HOSTS ?? "app.pipeflow.at")
  .split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const hostOf = (req: Request): string => String(req.headers.host ?? "").split(":")[0].toLowerCase();
const istAppHost = (req: Request): boolean => APP_HOSTS.includes(hostOf(req));
/** Mount fuer DIESE Anfrage - auf der neuen Adresse leer (Wurzel), sonst wie bisher. */
const mountFor = (req: Request): string => (istAppHost(req) ? "" : MOUNT);
/** Cookie-Pfad: "" waere ungueltig, die Wurzel heisst "/". */
const cookiePathFor = (req: Request): string => mountFor(req) || "/";
const COOKIE = "pp_session";
const LOGO_DIR = path.join(PACKAGE_ROOT, "data/logos");
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const SESSION_DAYS = 90;
const TONES = ["sachlich", "locker", "inspirierend", "humorvoll"];
const FREQUENCIES = ["3x-woche", "werktags", "taeglich"];
const CTAS = ["link_bio", "anrufen", "nachricht", "termin", "keiner"];
const HASHTAG_PREFS = ["keine", "wenige", "viele"];
const COMMENT_AUTOMATION_MODES = ["auto", "approval"];
/** Gleiche zwei Modi wie bei Kommentaren, aber ein eigener Schalter - siehe reviews.ts. */
const REVIEW_AUTOMATION_MODES = ["auto", "approval"];
const LANGUAGES = ["de", "en"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// Panel v6 Aufgabe 2b: einheitliche Meldung ueberall dort, wo ein angemeldeter, aber noch nicht
// bestaetigter Kunde einen KI-/kostenpflichtigen Endpunkt aufruft.
const EMAIL_NOT_VERIFIED_MSG = "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse.";

/** Trial length for newly signed-up customers. Existing customers are never retroactively limited. */
function trialDays(): number {
  const raw = process.env.PANEL_TRIAL_DAYS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 7;
}

const baseUrl = (): string => {
  const url = (process.env.PANEL_BASE_URL ?? "").replace(/\/$/, "");
  if (!url) throw new Error("PANEL_BASE_URL fehlt in .env (z. B. https://mcp.pipebot.at)");
  return url;
};
/** Absolute Basis fuer DIESE Anfrage (Schema + Host), damit erzeugte Links auf der Adresse
 *  bleiben, ueber die der Kunde gekommen ist. Fuer Hintergrundaufgaben ohne Anfrage gilt
 *  weiterhin PANEL_BASE_URL. */
const baseUrlFor = (req: Request): string => {
  const host = String(req.headers.host ?? "");
  if (!host) return baseUrl();
  if (!istAppHost(req) && !host.startsWith("mcp.")) return baseUrl();
  const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0].trim() || "https";
  return `${proto}://${host}`;
};
/** Die redirect_uri MUSS bei Meta/LinkedIn registriert sein - deshalb pro Adresse eine eigene,
 *  und beide dort hinterlegen (siehe Bericht). */
const redirectUri = (providerId: string, req: Request): string =>
  `${baseUrlFor(req)}${mountFor(req)}/callback/${providerId}`;

// ---------- Hilfsfunktionen ----------

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function startSession(res: Response, customerId: string, req: Request = res.req as Request): void {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), customerId, expires);
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=${cookiePathFor(req)}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`);
}

function currentCustomer(req: Request): CustomerRow | undefined {
  const token = readCookie(req, COOKIE);
  if (!token) return undefined;
  return db
    .prepare(
      `SELECT c.* FROM sessions s JOIN customers c ON c.id = s.customer_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND c.status = 'active'`,
    )
    .get(sha256(token), nowIso()) as CustomerRow | undefined;
}

const hits = new Map<string, number[]>();
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

/**
 * Wie rateLimited, aber getrennt in Pruefen und Zaehlen - fuer Aktionen, bei denen nur ein
 * ERFOLGREICHER Aufruf aufs Konto gehen soll.
 *
 * Anlass (15.09.2026): /api/analyze-website zaehlte jeden Versuch, auch den gescheiterten. Wer
 * seine Adresse zuerst falsch eintippte, war danach eine Minute ausgesperrt - und bekam beim
 * zweiten, diesmal richtigen Versuch nicht die eigentliche Fehlermeldung zu sehen, sondern die
 * Sperre. Der Schutz richtete sich damit gegen genau die Leute, die er nicht treffen soll: ein
 * gescheiterter Abruf kostet uns nichts, nur ein erfolgreicher loest den Anthropic-Aufruf aus.
 *
 * Gibt die Restwartezeit in Millisekunden zurueck (0 = frei), damit die Meldung die tatsaechliche
 * Wartezeit nennen kann statt einer pauschalen Angabe.
 */
function rateLimitRetryAfterMs(key: string, max: number, windowMs: number): number {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.set(key, list);
  if (list.length < max) return 0;
  return Math.max(1, windowMs - (now - Math.min(...list)));
}

/** Zaehlt einen Aufruf auf das Limit von rateLimitRetryAfterMs. */
function rateLimitRecord(key: string): void {
  hits.set(key, [...(hits.get(key) ?? []), Date.now()]);
}

/** "noch 3 Minuten" / "noch 40 Sekunden" - fuer Sperrmeldungen. */
function warteText(ms: number): string {
  const sekunden = Math.ceil(ms / 1000);
  if (sekunden < 90) return `noch ${sekunden} Sekunde${sekunden === 1 ? "" : "n"}`;
  const minuten = Math.ceil(sekunden / 60);
  return `noch ${minuten} Minute${minuten === 1 ? "" : "n"}`;
}

/**
 * One-line analytics summary for the help-chat's accountContext (Panel v9 Aufgabe 4) - only ever
 * called with the currently logged-in customer's own id (see the /api/help-chat handler), never
 * reachable with another customer's id from client input.
 */
function analyticsContextLine(customerId: string): string {
  const a = getAnalyticsSummary(customerId);
  if (!a.hasData) return "noch keine Daten (der tägliche Abgleich mit Instagram läuft im Hintergrund, in ein paar Tagen verfügbar)";
  const growth = a.current.followerGrowth != null ? `${a.current.followerGrowth >= 0 ? "+" : ""}${a.current.followerGrowth}` : "unbekannt";
  return (
    `Follower ${a.current.followerCount ?? "unbekannt"} (letzte 7 Tage ${growth}), Reichweite letzte 7 Tage ${a.current.reach} ` +
    `(Vorwoche ${a.previous.reach}), Views letzte 7 Tage ${a.current.views}, Engagement-Rate ${a.current.engagementRate != null ? `${a.current.engagementRate}%` : "unbekannt"}`
  );
}

const clientIp = (req: Request): string =>
  (String(req.headers["x-forwarded-for"] ?? "").split(",")[0] || req.socket.remoteAddress || "unknown").trim();

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

interface BriefingInput {
  company: string; contactName: string; email: string; website: string; industry: string;
  about: string; tone: string; frequency: string; postTime: string;
  accentColor: string; watermarkText: string; avoidTopics: string; ctaPreference: string; bannedWords: string; requiredElements: string; customHashtags: string;
  igFeedEnabled: boolean; igStoryEnabled: boolean; linkedinEnabled: boolean;
  hashtagPreference: string; emojisEnabled: boolean; language: string;
  contentPillars: { title: string; description?: string; weight?: number }[];
  activeWeekdays: string; instagramWeekdays: string; linkedinWeekdays: string;
  pauseFrom: string; pauseUntil: string;
  approvalMode: boolean;
  notifyOnPublish: boolean;
  notifyWeeklyReport: boolean;
  commentAutomationEnabled: boolean;
  commentAutomationMode: string;
  googleReviewAutomationEnabled: boolean;
  googleReviewMode: string;
  googleReviewPostsEnabled: boolean;
  googleReviewPostMinStars: number;
  videoEnabled: boolean;
  videoWeekdays: string;
  videoPostTime: string;
  videoLengthSeconds: number;
  videoZoomDirection: string;
  videoVoice: string;
  videoVoiceEnabled: boolean;
  carouselSlideCount: number;
  carouselAutoFrequency: string;
  fontChoice: string;
  gradientEnabled: boolean;
  gradientColor2: string;
  gradientDirection: string;
}

const CAROUSEL_AUTO_FREQUENCIES = ["off", "weekly", "always"];
const GRADIENT_DIRECTIONS = ["horizontal", "vertical", "diagonal"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalizes a "1,3,5"-style weekday list: valid digits 1-7 only, deduplicated, sorted - empty string if nothing usable survives. */
function cleanWeekdayList(raw: unknown, max: number): string {
  const s = str(raw, max);
  if (!s) return "";
  const days = [...new Set(s.split(",").map((d) => Number(d.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((a, b) => a - b);
  return days.join(",");
}

/** Content pillars come from the JSON body as an array - validate shape defensively, drop anything malformed instead of erroring the whole save. */
function parsePillarsInput(raw: unknown): { title: string; description?: string; weight?: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({
      title: str(p.title, 60),
      description: str(p.description, 300),
      weight: Number.isFinite(Number(p.weight)) ? Number(p.weight) : 1,
    }))
    .filter((p) => p.title)
    .slice(0, 6);
}

function parseBriefing(body: Record<string, unknown>): { data: BriefingInput; errors: Record<string, string> } {
  const data: BriefingInput = {
    company: str(body.company, 120),
    contactName: str(body.contactName, 120),
    email: str(body.email, 200).toLowerCase(),
    website: str(body.website, 300),
    industry: str(body.industry, 120),
    about: str(body.about, 2000),
    tone: str(body.tone, 30),
    frequency: str(body.frequency, 30),
    postTime: str(body.postTime, 5),
    accentColor: str(body.accentColor, 7),
    watermarkText: str(body.watermarkText, 40),
    avoidTopics: str(body.avoidTopics, 500),
    ctaPreference: str(body.ctaPreference, 30),
    bannedWords: str(body.bannedWords, 500),
    requiredElements: str(body.requiredElements, 500),
    customHashtags: str(body.customHashtags, 500),
    igFeedEnabled: bool(body.igFeedEnabled, true),
    igStoryEnabled: bool(body.igStoryEnabled, true),
    linkedinEnabled: bool(body.linkedinEnabled, true),
    hashtagPreference: str(body.hashtagPreference, 20) || "wenige",
    emojisEnabled: bool(body.emojisEnabled, true),
    language: str(body.language, 5) || "de",
    contentPillars: parsePillarsInput(body.contentPillars),
    activeWeekdays: cleanWeekdayList(body.activeWeekdays, 20),
    instagramWeekdays: cleanWeekdayList(body.instagramWeekdays, 20),
    linkedinWeekdays: cleanWeekdayList(body.linkedinWeekdays, 20),
    pauseFrom: str(body.pauseFrom, 10),
    pauseUntil: str(body.pauseUntil, 10),
    approvalMode: bool(body.approvalMode, false),
    notifyOnPublish: bool(body.notifyOnPublish, false),
    notifyWeeklyReport: bool(body.notifyWeeklyReport, false),
    commentAutomationEnabled: bool(body.commentAutomationEnabled, false),
    commentAutomationMode: str(body.commentAutomationMode, 20) || "approval",
    googleReviewAutomationEnabled: bool(body.googleReviewAutomationEnabled, false),
    googleReviewMode: str(body.googleReviewMode, 20) || "approval",
    googleReviewPostsEnabled: bool(body.googleReviewPostsEnabled, false),
    googleReviewPostMinStars: Number.isFinite(Number(body.googleReviewPostMinStars)) ? Math.round(Number(body.googleReviewPostMinStars)) : 4,
    videoEnabled: bool(body.videoEnabled, false),
    videoWeekdays: cleanWeekdayList(body.videoWeekdays, 20),
    videoPostTime: str(body.videoPostTime, 5),
    videoLengthSeconds: Number.isFinite(Number(body.videoLengthSeconds)) ? Math.round(Number(body.videoLengthSeconds)) : DEFAULT_VIDEO_LENGTH,
    videoZoomDirection: str(body.videoZoomDirection, 20) || "alternate",
    videoVoice: str(body.videoVoice, 60) || DEFAULT_VOICE_ID,
    videoVoiceEnabled: bool(body.videoVoiceEnabled, true),
    carouselSlideCount: Number.isFinite(Number(body.carouselSlideCount)) ? Math.round(Number(body.carouselSlideCount)) : 5,
    carouselAutoFrequency: str(body.carouselAutoFrequency, 20) || "off",
    fontChoice: str(body.fontChoice, 20) || "inter",
    gradientEnabled: bool(body.gradientEnabled, false),
    gradientColor2: str(body.gradientColor2, 7),
    gradientDirection: str(body.gradientDirection, 20) || "diagonal",
  };
  const errors: Record<string, string> = {};
  if (!COMMENT_AUTOMATION_MODES.includes(data.commentAutomationMode)) data.commentAutomationMode = "approval";
  if (!REVIEW_AUTOMATION_MODES.includes(data.googleReviewMode)) data.googleReviewMode = "approval";
  // 1-5 Sterne; alles andere faellt auf den Standard 4 zurueck (nicht auf 1 - "ab 1 Stern einen
  // Lob-Beitrag bauen" waere das Letzte, was ein Tippfehler ausloesen duerfte).
  if (data.googleReviewPostMinStars < 1 || data.googleReviewPostMinStars > 5) data.googleReviewPostMinStars = 4;
  if (!(VIDEO_LENGTHS as readonly number[]).includes(data.videoLengthSeconds)) data.videoLengthSeconds = DEFAULT_VIDEO_LENGTH;
  if (!ZOOM_DIRECTIONS.includes(data.videoZoomDirection as (typeof ZOOM_DIRECTIONS)[number])) data.videoZoomDirection = "alternate";
  if (!VOICE_OPTIONS.some((v) => v.id === data.videoVoice)) data.videoVoice = DEFAULT_VOICE_ID;
  if (data.videoPostTime && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(data.videoPostTime)) data.videoPostTime = "";
  if (data.carouselSlideCount < CAROUSEL_MIN_SLIDES || data.carouselSlideCount > CAROUSEL_MAX_SLIDES) data.carouselSlideCount = 5;
  if (!CAROUSEL_AUTO_FREQUENCIES.includes(data.carouselAutoFrequency)) data.carouselAutoFrequency = "off";
  if (!FONT_OPTIONS.some((f) => f.id === data.fontChoice)) data.fontChoice = DEFAULT_FONT_ID;
  if (!GRADIENT_DIRECTIONS.includes(data.gradientDirection)) data.gradientDirection = "diagonal";
  if (data.gradientColor2 && !HEX_COLOR.test(data.gradientColor2)) data.gradientColor2 = "";
  // Farbverlauf braucht zwingend eine zweite Farbe - ohne die bleibt er einfach aus (fuellt sich
  // nicht selbst auf, damit nie versehentlich mit einer leeren/kaputten zweiten Farbe gerendert wird).
  if (!data.gradientColor2) data.gradientEnabled = false;
  if (data.pauseFrom && !ISO_DATE.test(data.pauseFrom)) data.pauseFrom = "";
  if (data.pauseUntil && !ISO_DATE.test(data.pauseUntil)) data.pauseUntil = "";
  // A pause end before its start makes no sense - drop both rather than silently misbehaving.
  if (data.pauseFrom && data.pauseUntil && data.pauseUntil < data.pauseFrom) {
    data.pauseFrom = "";
    data.pauseUntil = "";
  }
  if (!data.company) errors.company = "Bitte geben Sie Ihren Firmennamen ein.";
  if (!data.contactName) errors.contactName = "Bitte geben Sie Ihren Namen ein.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) errors.email = "Bitte geben Sie eine gültige E-Mail-Adresse ein.";
  if (!TONES.includes(data.tone)) data.tone = "sachlich";
  if (!FREQUENCIES.includes(data.frequency)) data.frequency = "werktags";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.postTime)) data.postTime = "15:00";
  if (data.accentColor && !HEX_COLOR.test(data.accentColor)) data.accentColor = "";
  if (!CTAS.includes(data.ctaPreference)) data.ctaPreference = "link_bio";
  if (!HASHTAG_PREFS.includes(data.hashtagPreference)) data.hashtagPreference = "wenige";
  if (!LANGUAGES.includes(data.language)) data.language = "de";
  return { data, errors };
}

/** Human labels for the branding-regen offer banner - see BRANDING_REGEN_FIELDS below. */
const BRANDING_REGEN_FIELD_LABELS: Record<string, string> = {
  company: "Firmenname",
  industry: "Branche",
  about: "Beschreibung",
  tone: "Tonalität",
  contentPillars: "Themenschwerpunkte",
};

/**
 * Vergleichbare Form der Content-Saeulen - genau so normalisiert, wie setContentPillars sie
 * ablegt (trimmen, kuerzen, Gewicht auf 1..5), damit ein Speichern ohne echte Aenderung nicht
 * faelschlich als Profilaenderung zaehlt. Die Reihenfolge ist egal, deshalb sortiert.
 */
function pillarFingerprint(pillars: { title: string; description?: string | null; weight?: number }[]): string {
  return pillars
    .map((p) => ({
      title: (p.title ?? "").trim().slice(0, 60),
      description: (p.description ?? "").trim().slice(0, 300),
      weight: Math.min(5, Math.max(1, Math.round(p.weight ?? 1))),
    }))
    .filter((p) => p.title)
    .map((p) => `${p.title}|${p.description}|${p.weight}`)
    .sort()
    .join("\n");
}

/**
 * Which BriefingInput fields are "content-relevant" enough that changing them should offer to
 * regenerate the still-open 7-day preview (see PATCH /api/me below and
 * planning.ts's regeneratePlannedPostsForBranding). Deliberately narrow - these are exactly the
 * fields generatePlannedPostContent's prompt actually uses to write the text (company/industry/
 * about/tone). Purely visual settings (accentColor, watermarkText, fontChoice, gradient*, logo)
 * do NOT belong here: a plain image re-render would cover those, but that's a different, cheaper
 * operation (see updatePlannedPostImage / the "Mit dieser Farbe neu erstellen" button, which
 * already exists per-post) - lumping them into this text-regeneration offer would just waste
 * money re-writing captions that didn't need to change.
 */
function brandingFieldsChanged(before: CustomerRow, data: BriefingInput): string[] {
  const changed: string[] = [];
  if (before.company !== data.company) changed.push("company");
  if ((before.industry ?? "") !== data.industry) changed.push("industry");
  if ((before.about ?? "") !== data.about) changed.push("about");
  if (before.tone !== data.tone) changed.push("tone");
  return changed;
}

/** Panel v20: which analytics channel a request is for - accepts `?channel=` (GET) or a JSON
 *  body's `channel` (POST), falls back to 'instagram' for any unrecognized/missing value so an
 *  old cached frontend or a stray value never 400s, it just gets the pre-v20 default behavior. */
function analyticsChannelParam(req: Request): AnalyticsChannel {
  const raw = str(req.query.channel, 20) || str(req.body?.channel, 20);
  return raw === "linkedin" ? "linkedin" : "instagram";
}

function publicState(c: CustomerRow) {
  const rows = db.prepare("SELECT * FROM connections WHERE customer_id = ?").all(c.id) as ConnectionRow[];
  return {
    customer: {
      company: c.company, contactName: c.contact_name, email: c.email, website: c.website ?? "",
      industry: c.industry ?? "", about: c.about ?? "", tone: c.tone, frequency: c.frequency, postTime: c.post_time,
      accentColor: c.accent_color ?? "", watermarkText: c.watermark_text ?? "",
      avoidTopics: c.avoid_topics ?? "", ctaPreference: c.cta_preference ?? "link_bio",
      bannedWords: c.banned_words ?? "",
      requiredElements: c.required_elements ?? "",
      customHashtags: c.custom_hashtags ?? "",
      trialEndsAt: c.trial_ends_at,
      trialExpired: isTrialExpired({ trialEndsAt: c.trial_ends_at }),
      trialDaysLeft: trialDaysLeft(c.trial_ends_at),
      nextPostAt: nextPostAt(scheduleInputFor(c)),
      dueNow: (c.customer_paused || !c.email_verified) ? false : isDue(scheduleInputFor(c)),
      instagramDueNow: (c.customer_paused || !c.email_verified) ? false : isDueForChannel(scheduleInputFor(c), "instagram"),
      linkedinDueNow: (c.customer_paused || !c.email_verified) ? false : isDueForChannel(scheduleInputFor(c), "linkedin"),
      activeWeekdays: c.active_weekdays, instagramWeekdays: c.instagram_weekdays, linkedinWeekdays: c.linkedin_weekdays,
      pauseFrom: c.pause_from, pauseUntil: c.pause_until,
      approvalMode: Boolean(c.approval_mode),
      notifyOnPublish: Boolean(c.notify_on_publish),
      notifyWeeklyReport: Boolean(c.notify_weekly_report),
      commentAutomationEnabled: Boolean(c.comment_automation_enabled),
      commentAutomationMode: c.comment_automation_mode || "approval",
      googleReviewAutomationEnabled: Boolean(c.google_review_automation_enabled),
      googleReviewMode: c.google_review_mode || "approval",
      googleReviewPostsEnabled: Boolean(c.google_review_posts_enabled),
      googleReviewPostMinStars: c.google_review_post_min_stars || 4,
      videoEnabled: Boolean(c.video_enabled),
      videoWeekdays: c.video_weekdays,
      videoPostTime: c.video_post_time ?? "",
      videoLengthSeconds: c.video_length_seconds || DEFAULT_VIDEO_LENGTH,
      videoZoomDirection: c.video_zoom_direction || "alternate",
      videoVoice: c.video_voice || DEFAULT_VOICE_ID,
      videoVoiceEnabled: Boolean(c.video_voice_enabled),
      // null = keine Video-Tage gewaehlt, dann entsteht auch nie automatisch eines.
      nextVideoPostAt: nextVideoPostAt(scheduleInputFor(c)),
      // Panel v11: steuert nur, ob der einmalige Erst-Rundgang noch angeboten wird - die
      // "Was kann Pipeflow?"-Ansicht selbst ist davon unabhaengig immer erreichbar.
      tourDone: Boolean(c.tour_done_at),
      emailVerified: Boolean(c.email_verified),
      igFeedEnabled: Boolean(c.ig_feed_enabled), igStoryEnabled: Boolean(c.ig_story_enabled),
      linkedinEnabled: Boolean(c.linkedin_enabled), hashtagPreference: c.hashtag_pref || "wenige",
      emojisEnabled: Boolean(c.emojis_enabled), language: c.language || "de",
      carouselSlideCount: c.carousel_slide_count, carouselAutoFrequency: c.carousel_auto_frequency || "off",
      fontChoice: c.font_choice || "inter",
      gradientEnabled: Boolean(c.gradient_enabled), gradientColor2: c.gradient_color2 ?? "", gradientDirection: c.gradient_direction || "diagonal",
      customerPaused: Boolean(c.customer_paused),
      contentPillars: listContentPillars(c.id),
      lastPostRequest: lastPostRequestForCustomer(c.id),
      // Panel v8: "Jetzt posten" mit Kanalauswahl - eine einzelne "letzte Anfrage" reicht nicht
      // mehr, wenn ein Klick pro Kanal eine eigene Zeile anlegt (siehe listRecentPostRequestsForCustomer).
      postRequests: listRecentPostRequestsForCustomer(c.id),
      savedThemes: listSavedThemes(c.id),
      activeThemeId: c.active_theme_id,
      hasLogo: Boolean(c.logo_url),
      skippedProviders: (c.skipped_providers ?? "").split(",").filter(Boolean),
    },
    connections: rows.map((r) => ({
      provider: r.provider,
      accountName: r.account_name,
      connectedAt: r.connected_at,
      expiresAt: r.expires_at,
      status: connectionStatus(r),
      // Panel v11 ("nur zeigen, was tatsaechlich funktioniert"): das Panel muss unterscheiden
      // koennen, ob eine Funktion fuer DIESE Verbindung ueberhaupt greift - z. B. laeuft die
      // Kommentar-Automatisierung nur mit instagram_business_manage_comments, das aelteren
      // Verbindungen fehlt (erst in v10 zu den SCOPES ergaenzt, siehe providers/instagram.ts).
      // Nur die Namen der erteilten Berechtigungen, keine Tokens.
      scopes: (r.scopes ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    })),
  };
}

const backTo = (res: Response, params: Record<string, string>): void =>
  res.redirect(303, `${mountFor(res.req as Request)}/?${new URLSearchParams(params)}`);

type Handler = (req: Request, res: Response) => Promise<void> | void;
const safe = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

// ---------- Router ----------

export function createPanelRouter(): Router {
  assertEncryptionKey();
  baseUrl();
  const router = express.Router();
  // Waehrend des Redesigns hat die Sandbox (PANEL_SANDBOX=true) aus public/panel-redesign
  // serviert, damit am neuen Panel gebaut werden konnte, ohne Produktion anzufassen - beide
  // laufen aus demselben Arbeitsverzeichnis und liefern index.html direkt von der Platte, eine
  // Aenderung waere sonst ohne Deploy sofort live gewesen. Seit dem Livegang (15.09.2026) ist das
  // neue Panel in public/panel, die Weiche ist damit erledigt. Fuer die naechste grosse Runde
  // genuegt PANEL_PUBLIC_DIR in der Staging-Umgebung.
  const publicDir = process.env.PANEL_PUBLIC_DIR ?? path.resolve(process.cwd(), "public/panel");
  // Generated post/story images (approval-review cards, style samples) are hosted on the R2
  // media bucket, not this origin - img-src must allow that domain or browsers silently drop
  // the <img> load (shows as an empty box, no console-visible network error to the user).
  const mediaOrigin = new URL(getConfig().mediaBucketUrl).origin;

  router.use((_req, res, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    // Security-Review 2026-09-13: fehlte komplett (weder hier noch in nginx) - ohne HSTS kann ein
    // Angreifer im selben Netz (offenes WLAN etc.) den ersten Aufruf auf Klartext-HTTP herunter-
    // stufen, bevor die Redirect-Kette in nginx greift. Kein `preload` (das erfordert eine
    // Anmeldung bei Browserherstellern und bindet die gesamte Domain inkl. aller anderen unter
    // mcp.pipebot.at laufenden Dienste dauerhaft - nicht ohne Ruecksprache).
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader(
      "Content-Security-Policy",
      // Das Panel hostet Schibsted Grotesk selbst (assets/fonts, serviert unter ${mount}/fonts)
      // statt es von Google Fonts zu laden - DSGVO-Grund, siehe docs/redesign/PLAN.md. Mit dem
      // Livegang am 15.09.2026 ist die letzte Seite umgestellt, die noch Google Fonts geladen hat
      // (das alte public/panel/index.html); fonts.googleapis.com und fonts.gstatic.com sind
      // deshalb jetzt auch in der CSP raus - das Panel laedt damit nichts mehr von Dritten.
      // media-src kommt aus v22 (Video-Diashow): die Videos liegen wie die Bilder auf R2.
      `default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: ${mediaOrigin}; media-src 'self' data: ${mediaOrigin}; connect-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; form-action 'self'`,
    );
    next();
  });
  // Logo-Upload (Aufgabe 9): eigener, groesserer JSON-Parser NUR fuer diese Route, registriert
  // VOR dem globalen 50kb-Parser unten - der wuerde ein Base64-Bild sonst schon ablehnen,
  // bevor der Handler hier ueberhaupt laeuft.
  router.post(
    "/api/logo",
    express.json({ limit: "3mb" }),
    safe(async (req, res) => {
      const c = currentCustomer(req);
      if (!c) {
        res.status(401).json({ error: "Nicht angemeldet" });
        return;
      }
      // Security-Review 2026-09-13: einziger kostenpflichtiger Endpunkt (sharp-Bildverarbeitung +
      // Festplatten-Schreibzugriff pro Aufruf) ohne jedes Limit - ein Kunde (oder ein
      // kompromittiertes Konto) hätte das beliebig oft hintereinander auslösen können. 20/Stunde
      // ist grosszügig fuer legitime Nutzung (ein Logo wird normalerweise einmal, vielleicht ein
      // paarmal beim Ausprobieren, hochgeladen), begrenzt aber echten Missbrauch.
      if (rateLimited(`logo-upload:${c.id}`, 20, 3_600_000)) {
        res.status(429).json({ error: "Zu viele Uploads. Bitte in einer Stunde erneut versuchen." });
        return;
      }
      const raw = typeof req.body?.imageBase64 === "string" ? req.body.imageBase64.trim() : "";
      const match = /^data:image\/(png|jpe?g);base64,([a-z0-9+/=\s]+)$/i.exec(raw);
      if (!match) {
        res.status(400).json({ error: "Bitte eine PNG- oder JPG-Datei hochladen." });
        return;
      }
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > LOGO_MAX_BYTES) {
        res.status(400).json({ error: "Datei zu groß - maximal 2 MB." });
        return;
      }
      let resized: Buffer;
      try {
        resized = await sharp(buffer).resize(512, 512, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
      } catch {
        res.status(400).json({ error: "Die Datei konnte nicht als Bild gelesen werden." });
        return;
      }
      await fsPromises.mkdir(LOGO_DIR, { recursive: true });
      const logoPath = path.join(LOGO_DIR, `${c.id}.png`);
      await fsPromises.writeFile(logoPath, resized);
      db.prepare("UPDATE customers SET logo_url = ?, updated_at = ? WHERE id = ?").run(logoPath, nowIso(), c.id);
      res.json(publicState(db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow));
    }),
  );

  // Liefert das eigene Logo zurueck (fuer die Vorschau im Formular) - nie oeffentlich, immer
  // nur mit gueltiger Kunden-Session, nie der Pfad eines anderen Kunden erratbar.
  router.get(
    "/api/logo",
    safe(async (req, res) => {
      const c = currentCustomer(req);
      if (!c) {
        res.status(401).json({ error: "Nicht angemeldet" });
        return;
      }
      const row = db.prepare("SELECT logo_url FROM customers WHERE id = ?").get(c.id) as { logo_url: string | null } | undefined;
      if (!row?.logo_url) {
        res.status(404).end();
        return;
      }
      try {
        await fsPromises.access(row.logo_url);
      } catch {
        res.status(404).end();
        return;
      }
      res.sendFile(row.logo_url);
    }),
  );

  router.delete(
    "/api/logo",
    safe(async (req, res) => {
      const c = currentCustomer(req);
      if (!c) {
        res.status(401).json({ error: "Nicht angemeldet" });
        return;
      }
      const row = db.prepare("SELECT logo_url FROM customers WHERE id = ?").get(c.id) as { logo_url: string | null } | undefined;
      if (row?.logo_url) {
        await fsPromises.unlink(row.logo_url).catch(() => {});
      }
      db.prepare("UPDATE customers SET logo_url = NULL, updated_at = ? WHERE id = ?").run(nowIso(), c.id);
      res.json(publicState(db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow));
    }),
  );

  router.use(express.json({ limit: "50kb" }));

  router.use("/admin", createAdminRouter(publicDir));

  // Panel v15: dieselben Schriftdateien, die die Bild-Rendering-Pipeline serverseitig nutzt
  // (fonts.ts/assets/fonts) - hier oeffentlich servierbar, damit das Panel per @font-face eine
  // echte Live-Vorschau zeigen kann, statt die Schrift nur beim Namen zu nennen.
  // Datenschutzerklaerung: das Panel verlinkt sie in der Einwilligung beim Signup. Bis 15.09.2026
  // zeigte der Link auf https://pipebot.at/datenschutz - diese Seite antwortet mit 404, die
  // Einwilligung verwies also ins Leere. Ausgeliefert wird jetzt assets/datenschutz.html, sobald
  // die Datei existiert; solange nicht, sagt die Antwort klar warum (statt still 404).
  // Der INHALT kommt von Paul bzw. seiner Rechtsberatung - hier steht nur die Zustellung.
  router.get("/datenschutz", (req, res) => {
    // Eine einzige dauerhafte Adresse: sobald PANEL_PRIVACY_CANONICAL_URL gesetzt ist, leiten alle
    // anderen Adressen dorthin weiter. Grund: die URL wird bei Meta, LinkedIn und Google
    // hinterlegt - jede Aenderung ist dort Nacharbeit an drei Stellen. Ohne die Variable liefert
    // jede Adresse die Seite selbst aus (aktueller Zustand, bis DNS fuer app.pipeflow.at steht).
    const kanonisch = (process.env.PANEL_PRIVACY_CANONICAL_URL ?? "").replace(/\/$/, "");
    if (kanonisch) {
      const hier = `${baseUrlFor(req)}${mountFor(req)}/datenschutz`;
      if (hier !== kanonisch) {
        res.redirect(301, kanonisch);
        return;
      }
    }
    const datei = path.join(PACKAGE_ROOT, "assets/datenschutz.html");
    if (fs.existsSync(datei)) {
      res.type("html").sendFile(datei);
      return;
    }
    console.error("[panel] /datenschutz angefragt, aber assets/datenschutz.html fehlt - die Einwilligung verlinkt damit ins Leere.");
    res
      .status(503)
      .type("html")
      .send("<!doctype html><meta charset=utf-8><title>Datenschutzerklärung</title><p style=\"font:16px system-ui;padding:24px\">Die Datenschutzerklärung wird gerade finalisiert und ist in Kürze hier abrufbar. Fragen jederzeit an office@pipebot.at.</p>");
  });

  router.use("/fonts", express.static(path.join(PACKAGE_ROOT, "assets/fonts"), { maxAge: "7d" }));

  // Redesign: das neue Panel ist in index.html + panel.css + panel.js aufgeteilt (die alte
  // 250-KB-Einzeldatei war nicht mehr sinnvoll wartbar). Statisch aus demselben publicDir, damit
  // beide Mount-Pfade (/panel und /panel/sandbox) ohne Sonderfall funktionieren - express.static
  // laesst alles durch, was keine Datei ist, die API-Routen darunter bleiben also unberuehrt.
  router.use(express.static(publicDir, { index: false, maxAge: "5m" }));

  router.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

  // Keine Auth noetig (wie /health am Server-Root) - liefert bewusst nichts Sensibles, nur
  // ob die DB erreichbar ist und welche Version laeuft.
  router.get("/api/health", (_req, res) => {
    try {
      db.prepare("SELECT 1").get();
      res.json({ status: "ok", version: VERSION });
    } catch (err) {
      console.error("[panel] Health-Check fehlgeschlagen:", err);
      res.status(503).json({ status: "error" });
    }
  });

  router.get("/api/providers", (_req, res) => {
    res.json({
      providers: visibleProviders().map((p) => ({
        id: p.id, name: p.name, tagline: p.tagline, notice: p.notice ?? null, guide: p.guide, available: p.isConfigured(),
      })),
      aiAvailable: anthropicAvailable(),
      // Video-Diashow: Stimmen-Auswahl fuers Panel. `voicePreviewAvailable` sagt dem Frontend, ob
      // der Vorhoer-Knopf ueberhaupt etwas liefern kann (ohne GOOGLE_TTS_API_KEY nicht).
      videoVoices: VOICE_OPTIONS.map((v) => ({ id: v.id, label: v.label, description: v.description, tier: v.tier })),
      voicePreviewAvailable: ttsAvailable(),
      videoLengths: VIDEO_LENGTHS,
      trialDays: trialDays(),
      turnstileSiteKey: turnstileSiteKey(),
      // Dauerhafte Staging-Testadresse (/panel/sandbox) - steuert nur den Testversion-Banner und
      // die Demo-Hinweistexte im Frontend, nie in Produktion gesetzt.
      sandbox: process.env.PANEL_SANDBOX === "true",
    });
  });

  // Nutzt Kunden-Stichworte + Firmenname/Branche, um einen konkreteren Briefing-Text
  // vorzuschlagen. Funktioniert auch waehrend des Signups (noch keine Session) - daher kein
  // currentCustomer()-Zwang, aber ein strenges IP-Rate-Limit gegen Missbrauch/Kosten.
  router.post(
    "/api/improve-briefing",
    safe(async (req, res) => {
      if (rateLimited(`improve:${clientIp(req)}`, 6, 10 * 60_000)) {
        res.status(429).json({ error: "Zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen." });
        return;
      }
      const c = currentCustomer(req);
      if (c && !c.email_verified) {
        res.status(403).json({ error: EMAIL_NOT_VERIFIED_MSG });
        return;
      }
      if (!anthropicAvailable()) {
        res.status(503).json({ error: "KI-Vorschläge sind gerade nicht verfügbar." });
        return;
      }
      const company = str(req.body?.company, 120);
      const industry = str(req.body?.industry, 120);
      const about = str(req.body?.about, 2000);
      if (!about) {
        res.status(400).json({ error: "Bitte geben Sie zuerst ein paar Stichworte ein." });
        return;
      }
      try {
        const suggestion = await improveBriefing({ company, industry, about });
        res.json({ suggestion });
      } catch (err) {
        console.error("[panel] improve-briefing fehlgeschlagen:", err);
        res.status(502).json({ error: "Der Vorschlag konnte gerade nicht erstellt werden. Bitte später erneut versuchen." });
      }
    }),
  );

  // Panel v13, Diktierfunktion-Fallback (siehe Session-Bericht): server-seitige Transkription fuer
  // Browser ohne Web Speech API (v.a. iOS Safari) - der Client nimmt per MediaRecorder auf und
  // schickt die fertige Aufnahme hier als Base64 hoch. Gleiche Absicherung wie /api/improve-briefing
  // (auch waehrend des Signups nutzbar, kein erzwungener Login), aber zusaetzlich mit einer harten
  // Laengen-Grenze (90s) - laenger waere sowohl teurer als auch kein "kurzes Diktat" mehr.
  router.post(
    "/api/transcribe-audio",
    express.json({ limit: "12mb" }), // Basis64-Sprachaufnahme, groesser als der globale 10kb/50kb-Parser unten erlaubt
    safe(async (req, res) => {
      if (rateLimited(`transcribe:${clientIp(req)}`, 20, 60 * 60_000)) {
        res.status(429).json({ error: "Zu viele Diktier-Anfragen. Bitte in einer Stunde erneut versuchen." });
        return;
      }
      const c = currentCustomer(req);
      if (c && !c.email_verified) {
        res.status(403).json({ error: EMAIL_NOT_VERIFIED_MSG });
        return;
      }
      const audioBase64 = typeof req.body?.audioBase64 === "string" ? req.body.audioBase64 : "";
      const durationSeconds = Number(req.body?.durationSeconds) || 0;
      if (!audioBase64) {
        res.status(400).json({ error: "Keine Aufnahme erhalten." });
        return;
      }
      if (durationSeconds > 90) {
        res.status(400).json({ error: "Aufnahme zu lang - bitte maximal 90 Sekunden am Stück diktieren." });
        return;
      }
      let uploaded: { url: string; key: string } | undefined;
      try {
        uploaded = await uploadAudioBase64(audioBase64);
        const { text } = await transcribeAudioUrl(uploaded.url, c?.language || "de");
        // Wird geloggt, sobald der fal.ai-Aufruf selbst durchgelaufen ist - unabhaengig davon, ob
        // ein Text erkannt wurde. Ein leeres Ergebnis (stille/unverstaendliche Aufnahme) hat fal.ai
        // trotzdem in Rechnung gestellt; das erst NACH der leer-Pruefung zu loggen wuerde genau
        // diese Kosten unsichtbar machen (siehe audio-transcribe.ts Dateikopf).
        logUsageCost(c ? c.id : null, "voice-dictation", estimateTranscriptionCostUsd(durationSeconds));
        if (!text) {
          res.status(502).json({ error: "Die Aufnahme enthielt keinen erkennbaren Text. Bitte erneut versuchen oder selbst eintippen." });
          return;
        }
        res.json({ text });
      } catch (err) {
        console.error(`[panel] ${c ? c.id : clientIp(req)}: Diktier-Transkription fehlgeschlagen:`, err instanceof Error ? err.message : err);
        res.status(502).json({ error: err instanceof ToolError ? err.message : "Transkription gerade nicht möglich. Bitte erneut versuchen oder selbst eintippen." });
      } finally {
        // Aufraeumen laeuft unabhaengig davon, ob die Transkription geklappt hat - eine
        // Sprachaufnahme wird nie dauerhaft gespeichert (siehe r2.ts uploadAudioBase64).
        if (uploaded) deleteObject(uploaded.key).catch(() => {});
      }
    }),
  );

  /*
   * Ruft eine vom Kunden eingegebene URL ab (SSRF-Schutz in website-analyze.ts/ssrf-safe-fetch.ts)
   * und schickt den Text an Anthropic.
   *
   * Grenze: 5 ERFOLGREICHE Abrufe pro Stunde und IP (bis 15.09.2026: 1 pro Minute, jeder Versuch
   * gezaehlt). Begruendung der Zahl mit gemessenen Werten: Geld kostet nur der erfolgreiche
   * Abruf, und der liegt bei $0.00196 im Schnitt (17 protokollierte Aufrufe in usage_costs).
   * Fuenf Abrufe pro Stunde und IP sind damit rund ein Cent - waehrend im Formular realistisch
   * ein bis drei gebraucht werden: einmal probieren, Adresse korrigieren, nochmal. Genau diesen
   * Ablauf hat die alte Minutensperre getroffen.
   */
  /* Fehlermeldungen an den Kunden kommen ab hier nur noch aus ToolError - unserer eigenen Klasse
     mit bewusst formulierten, deutschen Texten. `err instanceof Error` (wie es vorher an fuenf
     Stellen stand) laesst dagegen JEDE interne Meldung durch: einen Axios-Text wie "Request failed
     with status code 529" ebenso wie "Invalid authentication tag length: 1". Das ist dieselbe
     Fehlerklasse wie "Failed to fetch" im Browser, nur auf der Serverseite. */
  const ANALYZE_MAX_PRO_STUNDE = 5;
  router.post(
    "/api/analyze-website",
    safe(async (req, res) => {
      const limitKey = `analyze-website:${clientIp(req)}`;
      const wartenMs = rateLimitRetryAfterMs(limitKey, ANALYZE_MAX_PRO_STUNDE, 3_600_000);
      if (wartenMs > 0) {
        res.status(429).json({
          error: `Sie haben die Website-Analyse ${ANALYZE_MAX_PRO_STUNDE}× in der letzten Stunde genutzt. Bitte ${warteText(wartenMs)} warten - oder tragen Sie Branche und Beschreibung einfach selbst ein.`,
        });
        return;
      }
      const c = currentCustomer(req);
      if (c && !c.email_verified) {
        res.status(403).json({ error: EMAIL_NOT_VERIFIED_MSG });
        return;
      }
      if (!anthropicAvailable()) {
        res.status(503).json({ error: "KI-Vorschläge sind gerade nicht verfügbar." });
        return;
      }
      const website = str(req.body?.website, 300);
      if (!website) {
        res.status(400).json({ error: "Bitte geben Sie zuerst Ihre Website-Adresse ein." });
        return;
      }
      try {
        const suggestion = await analyzeWebsite(website);
        // Erst jetzt zaehlen: nur dieser Weg hat tatsaechlich einen Anthropic-Aufruf verursacht.
        rateLimitRecord(limitKey);
        logUsageCost(c?.id ?? null, "analyze-website", suggestion.costUsd ?? null);
        res.json({ suggestion });
      } catch (err) {
        console.error("[panel] analyze-website fehlgeschlagen:", err);
        res.status(502).json({ error: err instanceof ToolError ? err.message : "Die Website konnte gerade nicht analysiert werden. Bitte versuchen Sie es in einer Minute noch einmal." });
      }
    }),
  );

  // Content-Saeulen per KI + Web-Suche vorschlagen (Zusatz-Aufgabe nach Panel v5). Laeuft auch
  // waehrend des Signups, wie improve-briefing/analyze-website - aber strenger begrenzt (3/Tag
  // statt 1/Minute oder 6/10min), weil eine Web-Suche pro Aufruf deutlich teurer ist als die
  // anderen KI-Endpunkte (siehe suggestPillarsWithSearch's Doc-Kommentar). Rate-Limit-Schluessel
  // ist die Kunden-Session falls vorhanden, sonst die IP (wie bei improve-briefing/
  // analyze-website waehrend des Signups).
  router.post(
    "/api/suggest-pillars",
    safe(async (req, res) => {
      const c = currentCustomer(req);
      if (rateLimited(`suggest-pillars:${c ? c.id : clientIp(req)}`, 3, 24 * 3_600_000)) {
        res.status(429).json({ error: "Maximal 3 KI-Vorschläge pro Tag." });
        return;
      }
      if (c && !c.email_verified) {
        res.status(403).json({ error: EMAIL_NOT_VERIFIED_MSG });
        return;
      }
      if (!anthropicAvailable()) {
        res.status(503).json({ error: "KI-Vorschläge sind gerade nicht verfügbar." });
        return;
      }
      const company = str(req.body?.company, 120);
      const industry = str(req.body?.industry, 120);
      const about = str(req.body?.about, 2000);
      const website = str(req.body?.website, 300);
      const keywords = str(req.body?.keywords, 300);
      try {
        const pillars = await suggestPillarsWithSearch({ company, industry, about, website, keywords });
        res.json({ pillars });
      } catch (err) {
        console.error("[panel] suggest-pillars fehlgeschlagen:", err);
        res.status(502).json({ error: "Die Vorschläge konnten gerade nicht erstellt werden. Bitte später erneut versuchen." });
      }
    }),
  );

  // Themenvorschlaege fuer das "Jetzt posten"-Feld (Panel v5, Aufgabe 2). Braucht eine Session
  // (im Gegensatz zu improve-briefing/analyze-website, die auch waehrend des Signups laufen) -
  // die Vorschlaege basieren auf diesem Kunden's eigenen Content-Saeulen/letzten Beitraegen.
  router.post(
    "/api/suggest-topics",
    safe(async (req, res) => {
      const c = currentCustomer(req);
      if (!c) {
        res.status(401).json({ error: "Nicht angemeldet" });
        return;
      }
      if (rateLimited(`suggest-topics:${c.id}`, 6, 10 * 60_000)) {
        res.status(429).json({ error: "Zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen." });
        return;
      }
      if (!c.email_verified) {
        res.status(403).json({ error: EMAIL_NOT_VERIFIED_MSG });
        return;
      }
      if (!anthropicAvailable()) {
        res.status(503).json({ error: "KI-Vorschläge sind gerade nicht verfügbar." });
        return;
      }
      try {
        const recentHeadlines = listPostsForCustomer(c.id, 5)
          .map((p) => p.headline)
          .filter((h): h is string => Boolean(h));
        const topics = await suggestTopics({
          industry: c.industry ?? "",
          about: c.about ?? "",
          tone: c.tone ?? "sachlich",
          contentPillars: listContentPillars(c.id),
          recentHeadlines,
        });
        res.json({ topics });
      } catch (err) {
        console.error("[panel] suggest-topics fehlgeschlagen:", err);
        res.status(502).json({ error: "Die Vorschläge konnten gerade nicht erstellt werden. Bitte später erneut versuchen." });
      }
    }),
  );

  // Panel v6 Aufgabe 6: Hilfe-Chat. Funktioniert auch ohne Login (z. B. ein Interessent vor dem
  // Signup) - Rate-Limit-Schluessel ist dann die IP statt der Kunden-ID, wie bei
  // improve-briefing/analyze-website. Verlauf lebt nur clientseitig fuer die Sitzung, der Server
  // ist pro Anfrage zustandslos (der Client schickt die bisherigen Nachrichten mit).
  router.post(
    "/api/help-chat",
    safe(async (req, res) => {
      const c = currentCustomer(req);
      if (rateLimited(`help-chat:${c ? c.id : clientIp(req)}`, 20, 3_600_000)) {
        res.status(429).json({ error: "Zu viele Nachrichten. Bitte in einer Stunde erneut versuchen." });
        return;
      }
      if (c && !c.email_verified) {
        res.status(403).json({ error: EMAIL_NOT_VERIFIED_MSG });
        return;
      }
      if (!anthropicAvailable()) {
        res.status(503).json({ error: "Der Hilfe-Chat ist gerade nicht verfügbar." });
        return;
      }
      const rawMessages: unknown[] = Array.isArray(req.body?.messages) ? req.body.messages : [];
      // Serverseitig auf die letzten 10 Nachrichten begrenzt (unabhaengig davon, was der Client
      // schickt) - deckelt die Anthropic-Kosten pro Anfrage, auch bei einem sehr langen Verlauf.
      const messages: HelpChatMessage[] = rawMessages
        .filter((m: unknown): m is { role: string; content: string } =>
          Boolean(m) && typeof m === "object" && ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") && typeof (m as { content?: unknown }).content === "string",
        )
        .slice(-10)
        .map((m) => ({ role: m.role as "user" | "assistant", content: str(m.content, 2000) }));
      if (!messages.length || messages[messages.length - 1].role !== "user") {
        res.status(400).json({ error: "Bitte schreiben Sie zuerst eine Frage." });
        return;
      }

      let accountContext: string | undefined;
      if (c) {
        const connections = db.prepare("SELECT * FROM connections WHERE customer_id = ?").all(c.id) as ConnectionRow[];
        const channelLines = ["instagram", "linkedin"].map((provider) => {
          const conn = connections.find((r) => r.provider === provider);
          const label = conn ? connectionStatus(conn) : "nicht verbunden";
          return `${provider}: ${label}`;
        });
        const approvalsWaiting = c.approval_mode ? listPendingApprovalsForCustomer(c.id).length : 0;
        accountContext =
          `Kontostand dieses angemeldeten Kunden (nur zur Beantwortung nutzen, nicht als Rohdaten-Liste zurückgeben):\n` +
          `- Firma: ${c.company}\n` +
          `- Status: ${c.status === "active" ? "aktiv" : "pausiert (vom Admin)"}${c.customer_paused ? ", vom Kunden selbst pausiert" : ""}\n` +
          `- Trial: ${isTrialExpired({ trialEndsAt: c.trial_ends_at }) ? "abgelaufen" : c.trial_ends_at ? `noch ${trialDaysLeft(c.trial_ends_at)} Tage` : "kein Trial-Limit"}\n` +
          `- E-Mail bestätigt: ${c.email_verified ? "ja" : "nein"}\n` +
          `- Freigabe-Modus: ${c.approval_mode ? "an" : "aus"}\n` +
          `- Kanäle: ${channelLines.join(", ")}\n` +
          `- Wartende Freigaben: ${approvalsWaiting}\n` +
          `- Analytics: ${analyticsContextLine(c.id)}`;
      }

      try {
        const reply = await helpChatReply({ messages, accountContext });
        res.json({ reply });
      } catch (err) {
        console.error("[panel] help-chat fehlgeschlagen:", err);
        res.status(502).json({ error: "Der Hilfe-Chat konnte gerade nicht antworten. Bitte später erneut versuchen." });
      }
    }),
  );

  router.get("/api/me", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    res.json(publicState(c));
  });

  router.post("/api/signup", safe(async (req, res) => {
    if (rateLimited(`signup:${clientIp(req)}`, 5, 3_600_000)) {
      res.status(429).json({ error: "Zu viele Versuche. Bitte in einer Stunde erneut probieren." });
      return;
    }
    // Panel v6 Aufgabe 2a: CAPTCHA vor allem anderen pruefen, solange konfiguriert - lehnt
    // Bot-Anfragen frueh ab, bevor ueberhaupt Validierung/DB-Schreiben passiert. Ohne
    // TURNSTILE_SECRET_KEY komplett uebersprungen (Feature aus, siehe turnstile.ts).
    if (turnstileConfigured()) {
      const captchaOk = await verifyTurnstileToken(str(req.body?.["cf-turnstile-response"], 3000), clientIp(req), hostOf(req));
      if (!captchaOk) {
        res.status(400).json({ error: "Sicherheitsprüfung fehlgeschlagen. Bitte laden Sie die Seite neu und versuchen Sie es erneut." });
        return;
      }
    }
    if (req.body?.consent !== true) {
      res.status(400).json({ error: "Bitte stimmen Sie der Datenverarbeitung zu.", fields: { consent: "Zustimmung erforderlich." } });
      return;
    }
    const { data, errors } = parseBriefing(req.body ?? {});
    if (Object.keys(errors).length) {
      res.status(400).json({ error: "Bitte prüfen Sie Ihre Angaben.", fields: errors });
      return;
    }
    const id = `cus_${randomToken(9)}`;
    const now = nowIso();
    const trialEndsAt = new Date(Date.now() + trialDays() * 86_400_000).toISOString();
    // Panel v6 Aufgabe 2b: E-Mail-Bestaetigung - roher Token nur jetzt kurz im Speicher, in der
    // DB steht nur der Hash (gleiches Muster wie login_key_hash/access-link).
    const verifyToken = randomToken(24);
    db.prepare(
      /* 15.09.2026: Die Spaltenliste hinkte dem Formular hinterher. Alles, was seit Panel v10
         dazugekommen ist - Kommentar-Automatik, Google-Bewertungen, Video-Diashow und (neu) der
         Farbverlauf - wird im Onboarding abgefragt, landete beim Signup aber nirgends: der
         Interessent stellte es ein, bekam 201 zurueck und fand seine Einstellung danach auf
         Standard. Ueber PATCH /api/me ging es, nur beim ersten Mal nicht. Aufgefallen beim
         Einbau des Verlaufs ins Onboarding, betraf aber 13 weitere Felder mit. */
      `INSERT INTO customers (id, company, contact_name, email, website, industry, about, tone, frequency, post_time,
         accent_color, watermark_text, avoid_topics, cta_preference, trial_ends_at,
         ig_feed_enabled, ig_story_enabled, linkedin_enabled, hashtag_pref, emojis_enabled, language, banned_words, required_elements, custom_hashtags,
         active_weekdays, instagram_weekdays, linkedin_weekdays, pause_from, pause_until, approval_mode, notify_on_publish, notify_weekly_report,
         gradient_enabled, gradient_color2, gradient_direction, font_choice,
         comment_automation_enabled, comment_automation_mode,
         google_review_automation_enabled, google_review_mode, google_review_posts_enabled, google_review_post_min_stars,
         video_enabled, video_weekdays, video_post_time, video_length_seconds, video_zoom_direction, video_voice, video_voice_enabled,
         carousel_slide_count, carousel_auto_frequency,
         login_key_hash, email_verify_token_hash, consent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, data.company, data.contactName, data.email, data.website || null, data.industry || null, data.about || null,
      data.tone, data.frequency, data.postTime,
      data.accentColor || null, data.watermarkText || null, data.avoidTopics || null, data.ctaPreference || null, trialEndsAt,
      data.igFeedEnabled ? 1 : 0, data.igStoryEnabled ? 1 : 0, data.linkedinEnabled ? 1 : 0, data.hashtagPreference, data.emojisEnabled ? 1 : 0, data.language, data.bannedWords || null, data.requiredElements || null, data.customHashtags || null,
      data.activeWeekdays || null, data.instagramWeekdays || null, data.linkedinWeekdays || null, data.pauseFrom || null, data.pauseUntil || null, data.approvalMode ? 1 : 0, data.notifyOnPublish ? 1 : 0, data.notifyWeeklyReport ? 1 : 0,
      data.gradientEnabled ? 1 : 0, data.gradientColor2 || null, data.gradientDirection, data.fontChoice,
      data.commentAutomationEnabled ? 1 : 0, data.commentAutomationMode,
      data.googleReviewAutomationEnabled ? 1 : 0, data.googleReviewMode, data.googleReviewPostsEnabled ? 1 : 0, data.googleReviewPostMinStars,
      data.videoEnabled ? 1 : 0, data.videoWeekdays || null, data.videoPostTime || null, data.videoLengthSeconds, data.videoZoomDirection, data.videoVoice, data.videoVoiceEnabled ? 1 : 0,
      data.carouselSlideCount, data.carouselAutoFrequency,
      sha256(randomToken()), sha256(verifyToken), now, now, now);
    setContentPillars(id, data.contentPillars);
    startSession(res, id);
    console.log(`[panel] Neuer Kunde: ${data.company} (${id})`);
    sendMailBestEffort(
      verificationEmail({ to: data.email, company: data.company, verifyUrl: `${baseUrlFor(req)}${mountFor(req)}/verify-email?token=${verifyToken}` }),
    );
    const created = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow;
    res.status(201).json(publicState(created));
  }));

  router.patch("/api/me", safe((req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    // Teil-Patch statt Komplettersatz (15.09.2026): parseBriefing fuellt jedes fehlende Feld mit
    // seinem Standard - ein PATCH ohne z. B. commentAutomationEnabled hat die Einstellung also
    // still auf "aus" gesetzt. Diese Falle hat dreimal zugeschlagen (Merge, zwei Testsuiten) und
    // konnte jederzeit echte Kundeneinstellungen loeschen, sobald irgendein Aufrufer ein Feld
    // weglaesst. Deshalb kommt der aktuelle Stand als Grundlage, und nur tatsaechlich
    // mitgeschickte Felder ueberschreiben ihn. Ein leeres {} aendert damit nichts mehr; ein
    // ausdruecklich mitgeschicktes "" oder false loescht/deaktiviert weiterhin wie bisher.
    const incoming = (req.body ?? {}) as Record<string, unknown>;
    const currentBriefing = publicState(c).customer as unknown as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...currentBriefing };
    for (const [key, value] of Object.entries(incoming)) if (value !== undefined) merged[key] = value;
    const { data, errors } = parseBriefing(merged);
    if (Object.keys(errors).length) {
      res.status(400).json({ error: "Bitte prüfen Sie Ihre Angaben.", fields: errors });
      return;
    }
    const changedBrandingFields = brandingFieldsChanged(c, data);
    // Die Themenschwerpunkte steuern unmittelbar, WOVON ein Beitrag handelt - sie gehoeren damit
    // genauso zum inhaltlichen Profil wie Branche oder Beschreibung. Bis 15.09.2026 fehlten sie
    // hier: wer nur seine Saeulen austauschte, bekam weder das Angebot zum Neugenerieren, noch
    // galten seine schon geplanten Beitraege danach als veraltet.
    if (pillarFingerprint(listContentPillars(c.id)) !== pillarFingerprint(data.contentPillars)) {
      changedBrandingFields.push("contentPillars");
    }
    const now = nowIso();
    db.prepare(
      `UPDATE customers SET company=?, contact_name=?, email=?, website=?, industry=?, about=?, tone=?, frequency=?, post_time=?,
         accent_color=?, watermark_text=?, avoid_topics=?, cta_preference=?,
         ig_feed_enabled=?, ig_story_enabled=?, linkedin_enabled=?, hashtag_pref=?, emojis_enabled=?, language=?, banned_words=?, required_elements=?, custom_hashtags=?,
         active_weekdays=?, instagram_weekdays=?, linkedin_weekdays=?, pause_from=?, pause_until=?, approval_mode=?, notify_on_publish=?, notify_weekly_report=?,
         comment_automation_enabled=?, comment_automation_mode=?,
         google_review_automation_enabled=?, google_review_mode=?, google_review_posts_enabled=?, google_review_post_min_stars=?,
         video_enabled=?, video_weekdays=?, video_post_time=?, video_length_seconds=?, video_zoom_direction=?, video_voice=?, video_voice_enabled=?,
         carousel_slide_count=?, carousel_auto_frequency=?,
         font_choice=?, gradient_enabled=?, gradient_color2=?, gradient_direction=?, updated_at=?
         ${changedBrandingFields.length ? ", branding_last_changed_at=?" : ""}
       WHERE id=?`,
    ).run(
      ...[
        data.company, data.contactName, data.email, data.website || null, data.industry || null, data.about || null,
        data.tone, data.frequency, data.postTime,
        data.accentColor || null, data.watermarkText || null, data.avoidTopics || null, data.ctaPreference || null,
        data.igFeedEnabled ? 1 : 0, data.igStoryEnabled ? 1 : 0, data.linkedinEnabled ? 1 : 0, data.hashtagPreference, data.emojisEnabled ? 1 : 0, data.language, data.bannedWords || null, data.requiredElements || null, data.customHashtags || null,
        data.activeWeekdays || null, data.instagramWeekdays || null, data.linkedinWeekdays || null, data.pauseFrom || null, data.pauseUntil || null, data.approvalMode ? 1 : 0, data.notifyOnPublish ? 1 : 0, data.notifyWeeklyReport ? 1 : 0,
        data.commentAutomationEnabled ? 1 : 0, data.commentAutomationMode,
        data.googleReviewAutomationEnabled ? 1 : 0, data.googleReviewMode, data.googleReviewPostsEnabled ? 1 : 0, data.googleReviewPostMinStars,
        data.videoEnabled ? 1 : 0, data.videoWeekdays || null, data.videoPostTime || null, data.videoLengthSeconds, data.videoZoomDirection, data.videoVoice, data.videoVoiceEnabled ? 1 : 0,
        data.carouselSlideCount, data.carouselAutoFrequency,
        data.fontChoice, data.gradientEnabled ? 1 : 0, data.gradientColor2 || null, data.gradientDirection,
        now,
        ...(changedBrandingFields.length ? [now] : []),
        c.id,
      ],
    );
    setContentPillars(c.id, data.contentPillars);
    // Panel v18: only ever an OFFER, never an automatic regeneration (see brandingFieldsChanged's
    // doc comment / Session-Bericht) - null when nothing content-relevant changed, or when there's
    // simply nothing in the 7-day preview left to regenerate.
    let brandingRegenOffer: { changedFields: string[]; changedFieldLabels: string[]; eligibleCount: number; editedCount: number } | null = null;
    if (changedBrandingFields.length) {
      const { eligible, edited } = countRegenerableBrandingPlannedPosts(c.id);
      if (eligible > 0 || edited > 0) {
        brandingRegenOffer = {
          changedFields: changedBrandingFields,
          changedFieldLabels: changedBrandingFields.map((f) => BRANDING_REGEN_FIELD_LABELS[f]),
          eligibleCount: eligible,
          editedCount: edited,
        };
      }
    }
    res.json({ ...publicState(db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow), brandingRegenOffer });
  }));

  // "Diese Änderung betrifft deine noch nicht veröffentlichten Beiträge - jetzt neu generieren?"
  // (see brandingRegenOffer above) - the customer's explicit confirmation from that banner.
  // `includeEdited` only matters if they also confirmed the separate "X Beiträge wurden bereits
  // von dir bearbeitet - auch diese überschreiben?" follow-up; defaults to false so a plain
  // confirm never silently discards a hand-edit.
  router.post(
    "/api/planned-posts/regenerate-for-branding",
    safe(async (req, res) => {
      const c = currentCustomer(req);
      if (!c) {
        res.status(401).json({ error: "Nicht angemeldet" });
        return;
      }
      if (!c.email_verified) {
        res.status(403).json({ error: EMAIL_NOT_VERIFIED_MSG });
        return;
      }
      if (!anthropicAvailable()) {
        res.status(503).json({ error: "Die Neugenerierung ist gerade nicht verfügbar." });
        return;
      }
      // Touches up to a full week of posts (multiple Anthropic + fal.ai calls each) per call -
      // generous enough for "changed my mind and adjusted settings a few times in a row", tight
      // enough that a stray double-click or script can't run up real cost.
      if (rateLimited(`branding-regen:${c.id}`, 3, 3_600_000)) {
        res.status(429).json({ error: "Zu viele Anfragen. Bitte in einer Stunde erneut versuchen." });
        return;
      }
      const includeEdited = req.body?.includeEdited === true;
      try {
        const result = await regeneratePlannedPostsForBranding(c, includeEdited);
        const today = viennaDateStr();
        const to = viennaDateStr(new Date(Date.now() + 6 * 86_400_000));
        res.json({ ...result, posts: listPlannedPosts(c.id, today, to), maxRegenerate: PLANNED_POST_MAX_REGENERATE });
      } catch (err) {
        console.error("[panel] Branding-Neugenerierung fehlgeschlagen:", err);
        res.status(502).json({ error: err instanceof ToolError ? err.message : "Die Neugenerierung konnte gerade nicht durchgeführt werden." });
      }
    }),
  );

  // Panel v11: Erst-Rundgang als gesehen markieren. Serverseitig statt im Browser-Speicher, damit
  // er nicht bei jedem Login/Geraetewechsel wieder auftaucht (siehe db.ts, tour_done_at).
  // Bewusst nur setzbar, nie zuruecksetzbar ueber die API - wiederholen geht ueber die Navigation,
  // dafuer braucht es keinen Server-Zustand.
  router.post("/api/tour-done", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    db.prepare("UPDATE customers SET tour_done_at = ?, updated_at = ? WHERE id = ? AND tour_done_at IS NULL").run(nowIso(), nowIso(), c.id);
    res.json(publicState(db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow));
  });

  // Persönlicher Zugangslink – ersetzt jeden älteren Link
  router.post("/api/access-link", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const key = randomToken(24);
    db.prepare("UPDATE customers SET login_key_hash = ?, updated_at = ? WHERE id = ?").run(sha256(key), nowIso(), c.id);
    res.json({ link: `${baseUrlFor(req)}${mountFor(req)}/login?key=${key}` });
  });

  // Panel v6 Aufgabe 5: "Zugang verloren?" fuer jemanden OHNE Session. Verraet nie, ob eine
  // E-Mail-Adresse zu einem Konto gehoert (Datenschutz) - IMMER dieselbe neutrale Erfolgs-
  // meldung, ob ein Kunde gefunden wurde oder nicht. Erzeugt bei Treffer denselben
  // login_key_hash neu wie /api/access-link (ersetzt jeden aelteren Link automatisch).
  router.post("/api/recover-access", safe(async (req, res) => {
    const email = str(req.body?.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      res.status(400).json({ error: "Bitte geben Sie eine gültige E-Mail-Adresse ein." });
      return;
    }
    // Zwei Ebenen: pro E-Mail-Adresse (Aufgabenstellung, 3x/Stunde) UND pro IP (Backstop gegen
    // das Durchprobieren vieler verschiedener Adressen von einem Absender aus).
    if (rateLimited(`recover-ip:${clientIp(req)}`, 10, 3_600_000) || rateLimited(`recover-email:${email}`, 3, 3_600_000)) {
      res.status(429).json({ error: "Zu viele Anfragen. Bitte in einer Stunde erneut versuchen." });
      return;
    }
    const found = db.prepare("SELECT * FROM customers WHERE email = ? AND status = 'active'").get(email) as CustomerRow | undefined;
    if (found) {
      const key = randomToken(24);
      db.prepare("UPDATE customers SET login_key_hash = ?, updated_at = ? WHERE id = ?").run(sha256(key), nowIso(), found.id);
      sendMailBestEffort(accessRecoveryEmail({ to: found.email, company: found.company, loginUrl: `${baseUrlFor(req)}${mountFor(req)}/login?key=${key}` }));
    }
    res.json({ ok: true, message: "Falls ein Konto mit dieser E-Mail-Adresse existiert, wurde eine E-Mail mit einem neuen Zugangslink verschickt." });
  }));

  // Panel v6 Aufgabe 2b: Bestaetigungslink aus der E-Mail. Findet den Kunden ueber den
  // Token-Hash (wie login_key_hash), setzt email_verified, macht den Token einmalig ungueltig
  // und loggt gleich ein - wer den Link anklicken konnte, hat die E-Mail-Adresse bewiesen.
  router.get("/verify-email", (req, res) => {
    const token = str(req.query.token, 100);
    if (!token) return backTo(res, { error: "verify" });
    const c = db.prepare("SELECT * FROM customers WHERE email_verify_token_hash = ? AND status = 'active'").get(sha256(token)) as CustomerRow | undefined;
    if (!c) return backTo(res, { error: "verify" });
    db.prepare("UPDATE customers SET email_verified = 1, email_verify_token_hash = NULL, updated_at = ? WHERE id = ?").run(nowIso(), c.id);
    startSession(res, c.id);
    console.log(`[panel] ${c.id} (${c.company}) hat die E-Mail-Adresse bestätigt.`);
    res.redirect(303, `${mountFor(req)}/?verified=1`);
  });

  // Erneutes Anfordern, solange email_verified noch 0 ist - braucht eine bestehende Session
  // (nach Signup automatisch vorhanden). Rate-Limit 1x/5min pro Kunde gegen Mail-Flut.
  router.post("/api/resend-verification", safe((req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (c.email_verified) {
      res.json({ ok: true, alreadyVerified: true });
      return;
    }
    if (rateLimited(`resend-verify:${c.id}`, 1, 5 * 60_000)) {
      res.status(429).json({ error: "Bitte warten Sie ein paar Minuten, bevor Sie erneut anfordern." });
      return;
    }
    const verifyToken = randomToken(24);
    db.prepare("UPDATE customers SET email_verify_token_hash = ?, updated_at = ? WHERE id = ?").run(sha256(verifyToken), nowIso(), c.id);
    sendMailBestEffort(
      verificationEmail({ to: c.email, company: c.company, verifyUrl: `${baseUrlFor(req)}${mountFor(req)}/verify-email?token=${verifyToken}` }),
    );
    res.json({ ok: true });
  }));

  router.get("/login", (req, res) => {
    const key = str(req.query.key, 100);
    // Sperre und falscher Schluessel wurden bisher gleich gemeldet ("Link ungueltig") - wer sich
    // ausgesperrt hat, sucht dann am falschen Ende. Eigener Fehlercode dafuer.
    if (!key) return backTo(res, { error: "login" });
    if (rateLimited(`login:${clientIp(req)}`, 20, 3_600_000)) return backTo(res, { error: "login-limit" });
    const c = db.prepare("SELECT * FROM customers WHERE login_key_hash = ? AND status = 'active'").get(sha256(key)) as CustomerRow | undefined;
    if (!c) return backTo(res, { error: "login" });
    startSession(res, c.id);
    res.redirect(303, `${mountFor(req)}/`);
  });

  router.post("/api/logout", (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=${cookiePathFor(req)}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  // Die EINZIGE Loeschfunktion im ganzen Panel - nur der eingeloggte Kunde kann sein eigenes
  // Konto loeschen, nie ein anderer Kunde und nie ein Admin ueber die Oberflaeche (Meta
  // verlangt so einen Selbstbedienungs-Weg fuer instagram_business_basic/-content_publish).
  // ON DELETE CASCADE auf connections/sessions/oauth_states/posts/style_cache raeumt alles auf.
  router.delete("/api/me", safe(async (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: "Bestätigung erforderlich." });
      return;
    }
    // Logo liegt als Datei auf der Platte, nicht in der DB - CASCADE raeumt es nicht mit auf.
    if (c.logo_url) {
      await fsPromises.unlink(c.logo_url).catch(() => {});
    }
    db.prepare("DELETE FROM customers WHERE id = ?").run(c.id);
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=${cookiePathFor(req)}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    console.log(`[panel] Kunde ${c.id} (${c.company}) hat sein Konto inkl. aller Daten gelöscht.`);
    res.json({ ok: true });
  }));

  // Der Kunde sieht nur seine eigenen Posts - nie die anderer Kunden oder Pauls eigenen Account.
  router.get("/api/posts", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    res.json({ posts: listPostsForCustomer(c.id) });
  });

  // Panel v9 Aufgabe 2: Analytics-Tab - reines Lesen der vom täglichen Cron (analytics.ts)
  // gespeicherten Snapshots, kein Live-Graph-API-Aufruf hier (der ist teuer/langsam genug, dass
  // er nur einmal täglich im Hintergrund laufen soll, nicht bei jedem Tab-Aufruf).
  router.get("/api/analytics", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const channel = analyticsChannelParam(req);
    res.json({ ...getAnalyticsSummary(c.id, channel), aiSummary: getSummaryCache(c.id, channel) });
  });

  // Panel v9 Aufgabe 3: "Zusammenfassung anzeigen" - generiert bei Bedarf eine frische
  // KI-Zusammenfassung (statt immer nur die Wochen-Cache aus dem Hintergrund-Lauf zu zeigen) und
  // aktualisiert dabei denselben Cache, den auch runWeeklyAnalyticsSummaries() befuellt. Kosten
  // werden in generateAndCacheSummary() bereits in usage_costs geloggt.
  router.post(
    "/api/analytics-summary",
    safe(async (req, res) => {
      const c = currentCustomer(req);
      if (!c) {
        res.status(401).json({ error: "Nicht angemeldet" });
        return;
      }
      if (rateLimited(`analytics-summary:${c.id}`, 6, 10 * 60_000)) {
        res.status(429).json({ error: "Zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen." });
        return;
      }
      if (!c.email_verified) {
        res.status(403).json({ error: EMAIL_NOT_VERIFIED_MSG });
        return;
      }
      if (!anthropicAvailable()) {
        res.status(503).json({ error: "Die KI-Zusammenfassung ist gerade nicht verfügbar." });
        return;
      }
      const channel = analyticsChannelParam(req);
      if (!getAnalyticsSummary(c.id, channel).hasData) {
        res.status(409).json({ error: "Noch keine Analytics-Daten vorhanden." });
        return;
      }
      try {
        const result = await generateAndCacheSummary(c, channel);
        res.json(result);
      } catch (err) {
        console.error("[panel] analytics-summary fehlgeschlagen:", err);
        res.status(502).json({ error: "Die Zusammenfassung konnte gerade nicht erstellt werden. Bitte später erneut versuchen." });
      }
    }),
  );

  // 7-Tage-Vorschau (Panel v5, Aufgabe 5) - liest, was planning.ts's taegliche Vorausplanung
  // bereits vorbereitet hat. Nur Lesen, kein KI-/Bild-Aufruf hier.
  router.get("/api/planned-posts", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const today = viennaDateStr();
    const to = viennaDateStr(new Date(Date.now() + 6 * 86_400_000));
    res.json({ posts: listPlannedPosts(c.id, today, to), maxRegenerate: PLANNED_POST_MAX_REGENERATE });
  });

  // Kunde bearbeitet Headline/Caption eines vorbereiteten Beitrags. Re-verifiziert bannedWords/
  // requiredElements vor dem Speichern - sonst koennte ein Kunde ein Pflicht-Element aus der
  // Caption entfernen und der Beitrag wuerde beim spaeteren Veroeffentlichen durch die Routine
  // (K0/K1, siehe docs/ROUTINE_TEIL1_V5.md) endlos fehlschlagen, exakt dasselbe Muster wie der
  // ig_story-Fix der letzten Sitzung.
  router.patch(
    "/api/planned-posts/:id",
    safe(async (req, res) => {
      const c = currentCustomer(req);
      if (!c) {
        res.status(401).json({ error: "Nicht angemeldet" });
        return;
      }
      const plan = getPlannedPostForCustomer(c.id, String(req.params.id));
      if (!plan) {
        res.status(404).json({ error: "Beitrag nicht gefunden." });
        return;
      }
      if (plan.status === "published") {
        res.status(400).json({ error: "Dieser Beitrag wurde bereits veröffentlicht und kann nicht mehr bearbeitet werden." });
        return;
      }
      const headline = req.body?.headline !== undefined ? str(req.body.headline, 100) : undefined;
      const caption = req.body?.caption !== undefined ? str(req.body.caption, 2200) : undefined;
      const nextHeadline = headline !== undefined ? headline : plan.headline ?? "";
      const nextCaption = caption !== undefined ? caption : plan.caption ?? "";
      const checkTexts = plan.channel === "ig_story" ? [nextHeadline] : [nextHeadline, nextCaption];
      try {
        assertNoBannedWords(c.id, ...checkTexts);
        assertRequiredElements(c.id, ...checkTexts);
      } catch (err) {
        res.status(400).json({ error: err instanceof ToolError ? err.message : "Der Text konnte nicht gespeichert werden - bitte prüfen Sie ihn noch einmal." });
        return;
      }
      const updated = updatePlannedPostText(plan.id, { headline, caption });
      res.json({ post: updated });
    }),
  );

  // "Mit dieser Farbe neu erstellen" - synchron, loest sofort eine echte fal.ai-Generierung aus
  // (Aufgabe 5/8). PLANNED_POST_MAX_REGENERATE begrenzt das auf 3 Versuche PRO Beitrag.
  router.post(
    "/api/planned-posts/:id/regenerate-image",
    safe(async (req, res) => {
      const c = currentCustomer(req);
      if (!c) {
        res.status(401).json({ error: "Nicht angemeldet" });
        return;
      }
      if (!c.email_verified) {
        res.status(403).json({ error: EMAIL_NOT_VERIFIED_MSG });
        return;
      }
      const plan = getPlannedPostForCustomer(c.id, String(req.params.id));
      if (!plan) {
        res.status(404).json({ error: "Beitrag nicht gefunden." });
        return;
      }
      if (plan.status === "published") {
        res.status(400).json({ error: "Dieser Beitrag wurde bereits veröffentlicht." });
        return;
      }
      if (plan.regenerateCount >= PLANNED_POST_MAX_REGENERATE) {
        res.status(429).json({ error: `Maximale Anzahl an Neuerstellungen (${PLANNED_POST_MAX_REGENERATE}) erreicht.` });
        return;
      }
      const accentColor = str(req.body?.accentColor, 7);
      if (!HEX_COLOR.test(accentColor)) {
        res.status(400).json({ error: "Bitte eine gültige Farbe wählen." });
        return;
      }
      if (!plan.headline) {
        res.status(400).json({ error: "Dieser Beitrag hat keine Schlagzeile - kann nicht neu erstellt werden." });
        return;
      }
      const branding = { ...resolveImageBranding(c.id), accentColor };
      try {
        const generated = await generateImageUrl(plan.headline, CHANNEL_IMAGE_FORMAT[plan.channel as keyof typeof CHANNEL_IMAGE_FORMAT], branding);
        const updated = updatePlannedPostImage(plan.id, generated.imageUrl, accentColor);
        res.json({ post: updated, maxRegenerate: PLANNED_POST_MAX_REGENERATE });
      } catch (err) {
        console.error("[panel] planned-post regenerate-image fehlgeschlagen:", err);
        res.status(502).json({ error: "Das Bild konnte gerade nicht neu erstellt werden. Bitte später erneut versuchen." });
      }
    }),
  );

  // "Diesen Beitrag überspringen" - Kundenwunsch, kein Fehler: die Routine (K0) laesst diesen
  // Kanal/Tag dann aus, ohne spontan zu ersetzen.
  router.post("/api/planned-posts/:id/skip", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const plan = getPlannedPostForCustomer(c.id, String(req.params.id));
    if (!plan) {
      res.status(404).json({ error: "Beitrag nicht gefunden." });
      return;
    }
    if (plan.status === "published") {
      res.status(400).json({ error: "Dieser Beitrag wurde bereits veröffentlicht." });
      return;
    }
    res.json({ post: markPlannedPostStatus(plan.id, "rejected") });
  });

  // "Jetzt schon freigeben" - nur sinnvoll (und nur erlaubt) fuer Kunden mit approvalMode.
  router.post("/api/planned-posts/:id/approve", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (!c.approval_mode) {
      res.status(400).json({ error: "Freigabe-Modus ist für Ihr Konto nicht aktiviert." });
      return;
    }
    const plan = getPlannedPostForCustomer(c.id, String(req.params.id));
    if (!plan) {
      res.status(404).json({ error: "Beitrag nicht gefunden." });
      return;
    }
    if (plan.status === "published" || plan.status === "rejected") {
      res.status(400).json({ error: "Dieser Beitrag kann nicht mehr freigegeben werden." });
      return;
    }
    const updated = markPlannedPostStatus(plan.id, "approved");
    triggerRoutineNow("planned-post-approve");
    res.json({ post: updated });
  });

  router.post("/api/disconnect/:provider", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    db.prepare("DELETE FROM connections WHERE customer_id = ? AND provider = ?").run(c.id, String(req.params.provider));
    res.json(publicState(c));
  });

  // Bugcheck-Fix (2026-09-13): "Später verbinden" persistieren, unabhaengig davon ob der
  // Provider gerade verfuegbar/konfiguriert ist - das ist rein additiv (nie blockierend) und
  // laeuft komplett unabhaengig von isConfigured()/available, siehe /connect/:provider unten,
  // das genau umgekehrt genau DAS prueft. Ohne diese Persistenz sprang ein Reload zwischen zwei
  // Connect-Schritten wieder zum ersten noch offenen Provider zurueck (firstOpenStep() kannte
  // den client-seitigen Skip nicht).
  router.post("/api/skip-provider/:provider", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const provider = getProvider(String(req.params.provider));
    if (!provider) {
      res.status(404).json({ error: "Unbekannter Anbieter" });
      return;
    }
    const skipped = new Set((c.skipped_providers ?? "").split(",").filter(Boolean));
    skipped.add(provider.id);
    db.prepare("UPDATE customers SET skipped_providers = ?, updated_at = ? WHERE id = ?")
      .run([...skipped].join(","), nowIso(), c.id);
    res.json(publicState(db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow));
  });

  // Kunde pausiert/setzt sein eigenes Posting fort - anders als die Admin-Sperre (status)
  // bleibt der Kunde dabei eingeloggt und sieht sein Dashboard weiter normal.
  router.post("/api/pause", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const paused = req.body?.paused === true;
    db.prepare("UPDATE customers SET customer_paused = ?, updated_at = ? WHERE id = ?").run(paused ? 1 : 0, nowIso(), c.id);
    res.json(publicState(db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow));
  });

  const POST_NOW_CHANNELS: PublishChannel[] = ["ig_feed", "ig_story", "linkedin"];
  const POST_NOW_ENABLED_COLUMN: Record<PublishChannel, keyof CustomerRow> = {
    ig_feed: "ig_feed_enabled",
    ig_story: "ig_story_enabled",
    linkedin: "linkedin_enabled",
  };

  // Reine Warteschlange - kein direkter MCP-/KI-Aufruf von hier aus (der Server hat in diesem
  // Kontext keinen Anthropic-Zugriff). Die naechste Routine-Ausfuehrung holt sich offene
  // Anfragen ueber das MCP-Tool `list_post_requests` ab.
  //
  // Panel v8: Kanalauswahl - ein Klick kann mehrere Kanäle gleichzeitig anfragen, jeder gewählte
  // Kanal bekommt seine EIGENE post_requests-Zeile (nie mehr channel=null). Alles-oder-nichts:
  // schlägt die Prüfung für auch nur einen gewählten Kanal fehl (deaktiviert, schon offen, Tages-
  // Limit), wird die GESAMTE Anfrage abgelehnt statt einen Teil stillschweigend zu verwerfen -
  // vorhersagbarer für den Kunden als eine Mischung aus "teils geklappt, teils nicht".
  /**
   * Eine offene Anfrage zuruecknehmen. Vorher blockierte eine haengende Anfrage den Kanal ohne
   * Ablauf und ohne Ausweg ("schon angefragt", ausgegraut) - genau der Zustand, in dem Pauls
   * LinkedIn-Kanal am 15.09.2026 feststeckte.
   */
  router.post("/api/post-now/cancel", safe((req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const id = typeof req.body?.id === "string" ? req.body.id : undefined;
    const anzahl = cancelPostRequest(c.id, id);
    if (!anzahl) {
      res.status(404).json({ error: "Keine offene Anfrage gefunden." });
      return;
    }
    res.json({ ...publicState(db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow), cancelled: anzahl });
  }));

  router.post("/api/post-now", safe((req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (!c.email_verified) {
      res.status(403).json({ error: EMAIL_NOT_VERIFIED_MSG });
      return;
    }
    const requested = Array.isArray(req.body?.channels)
      ? [...new Set(req.body.channels.filter((ch: unknown): ch is string => typeof ch === "string"))]
      : [];
    if (!requested.length) {
      res.status(400).json({ error: "Bitte wählen Sie mindestens einen Kanal aus." });
      return;
    }
    const unknown = requested.filter((ch) => !POST_NOW_CHANNELS.includes(ch as PublishChannel));
    if (unknown.length) {
      res.status(400).json({ error: `Unbekannter Kanal: ${unknown.join(", ")}` });
      return;
    }
    const channels = requested as PublishChannel[];
    // Nie dem Client vertrauen, dass ein deaktivierter Kanal nicht mitgeschickt wird - dieselbe
    // Prüfung, die connectBtn/das Panel selbst schon serverseitig durchsetzt.
    const disabled = channels.filter((ch) => !c[POST_NOW_ENABLED_COLUMN[ch]]);
    if (disabled.length) {
      res.status(400).json({ error: `Kanal deaktiviert: ${disabled.map((ch) => CHANNEL_LABEL[ch]).join(", ")}.` });
      return;
    }
    const alreadyOpen = channels.filter((ch) => openPostRequestCount(c.id, ch) >= POST_REQUEST_MAX_OPEN);
    if (alreadyOpen.length) {
      res.status(429).json({
        error: `Schon eine offene Anfrage für: ${alreadyOpen.map((ch) => CHANNEL_LABEL[ch]).join(", ")}. Bitte warten Sie, bis diese bearbeitet wurde.`,
      });
      return;
    }
    if (postRequestCountToday(c.id) + channels.length > POST_REQUEST_MAX_PER_DAY) {
      res.status(429).json({ error: `Maximal ${POST_REQUEST_MAX_PER_DAY} Anfragen pro Tag - das würde das Limit überschreiten.` });
      return;
    }
    const topic = str(req.body?.topic, 300);
    // Panel v14: Format nur fuer ig_feed relevant (Karussell/Video-Diashow gibt es nur bei
    // Instagram Feed) - fuer jeden anderen mitgewaehlten Kanal bleibt es 'single', unabhaengig
    // davon, was der Client schickt. Die Video-Diashow ist seit Panel v22 fertig (videos.ts);
    // waehlbar im Panel ist sie seit 15.09.2026 (beim Redesign war die Option verlorengegangen).
    const requestedFormat = str(req.body?.format, 30);
    const format = ["carousel", "video_slideshow"].includes(requestedFormat) ? requestedFormat : "single";
    // Pro Anfrage, nicht als Kundeneinstellung: wer oefter sofort postet, will nicht jedes Mal
    // eine Mail (siehe post_requests.notify_email).
    const notifyEmail = req.body?.notifyEmail === true;
    channels.forEach((ch) => createPostRequest(c.id, topic || null, ch, ch === "ig_feed" ? format : "single", notifyEmail));
    triggerRoutineNow("post-now");
    // Video-Diashows macht der Server selbst (videos.ts) - die externe Routine sieht sie gar nicht.
    // Deshalb hier sofort anstossen statt bis zum naechsten Video-Cron zu warten: der Kunde hat
    // gerade auf "Jetzt posten" geklickt. Fire-and-forget, ein Fehler darf die Antwort nie kippen.
    if (format === "video_slideshow" && channels.includes("ig_feed")) {
      runVideoPass().catch((err) => console.error("[panel] Sofort-Video nach 'Jetzt posten' fehlgeschlagen:", err));
    }
    res.json(publicState(c));
  }));

  // Mehrere Farbthemen (Aufgabe 8): NUR ablegen/umschalten - der eigentliche accentColor/
  // watermarkText-Wert im Formular bleibt unberuehrt, ein aktives Thema ueberschreibt ihn nur
  // bei der Bild-Generierung (siehe credentials.ts effectiveBranding()).
  router.post("/api/themes", safe((req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const name = str(req.body?.name, 60);
    if (!name) {
      res.status(400).json({ error: "Bitte geben Sie einen Namen für das Thema ein." });
      return;
    }
    const accentColor = str(req.body?.accentColor, 7);
    const watermarkText = str(req.body?.watermarkText, 40);
    const theme = createSavedTheme(c.id, name, (accentColor && HEX_COLOR.test(accentColor) ? accentColor : null), watermarkText || null);
    res.status(201).json({ ok: true, theme, savedThemes: listSavedThemes(c.id) });
  }));

  router.post("/api/themes/:id/activate", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (!activateSavedTheme(c.id, String(req.params.id))) {
      res.status(404).json({ error: "Thema nicht gefunden." });
      return;
    }
    res.json(publicState(db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow));
  });

  router.post("/api/themes/deactivate", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    deactivateTheme(c.id);
    res.json(publicState(db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow));
  });

  // Freigabe-Modus (Aufgabe 7): eigene ausstehende Beitraege ansehen/freigeben/ablehnen.
  // Freigeben veroeffentlicht NICHT selbst - das holt sich die Routine ueber
  // `list_approved_pending_posts`, siehe Report.
  router.get("/api/approvals", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    res.json({ approvals: listPendingApprovalsForCustomer(c.id) });
  });

  router.post("/api/approvals/:id/approve", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const approval = setPendingApprovalStatus(c.id, String(req.params.id), "approved");
    if (!approval) {
      res.status(404).json({ error: "Beitrag nicht gefunden oder schon bearbeitet." });
      return;
    }
    triggerRoutineNow("approval-approve");
    res.json({ ok: true, approval });
  });

  router.post("/api/approvals/:id/reject", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const approval = setPendingApprovalStatus(c.id, String(req.params.id), "rejected");
    if (!approval) {
      res.status(404).json({ error: "Beitrag nicht gefunden oder schon bearbeitet." });
      return;
    }
    res.json({ ok: true, approval });
  });

  // Panel v10: Kommentar-Automatisierung im Freigabe-Modus (comment_automation_mode = "approval")
  // - eigene Endpunkte statt der Beitrags-Freigabe oben, weil "Freigeben" hier sofort selbst die
  // Instagram-Antwort sendet (approveCommentReply), statt nur einen Status zu setzen, den die
  // externe Routine spaeter abholt (dieses Feature hat keine externe Routine, siehe comments.ts).
  router.get("/api/comment-approvals", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    res.json({ approvals: listPendingCommentApprovals(c.id) });
  });

  router.post("/api/comment-approvals/:id/approve", safe(async (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const editedReply = typeof req.body?.reply === "string" ? req.body.reply : undefined;
    try {
      const approval = await approveCommentReply(c.id, String(req.params.id), editedReply);
      if (!approval) {
        res.status(404).json({ error: "Kommentar nicht gefunden oder schon bearbeitet." });
        return;
      }
      res.json({ ok: true, approval });
    } catch (err) {
      if (err instanceof CommentRateLimitError) {
        res.status(429).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: err instanceof ToolError ? err.message : "Antwort konnte nicht gesendet werden. Bitte versuchen Sie es später noch einmal." });
    }
  }));

  router.post("/api/comment-approvals/:id/reject", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const approval = rejectCommentReply(c.id, String(req.params.id));
    if (!approval) {
      res.status(404).json({ error: "Kommentar nicht gefunden oder schon bearbeitet." });
      return;
    }
    res.json({ ok: true, approval });
  });

  // Google-Bewertungen im Freigabe-Modus (google_review_mode = "approval") - eigene Endpunkte aus
  // demselben Grund wie bei den Kommentaren oben: "Freigeben" schickt die Antwort hier sofort
  // selbst an Google, statt nur einen Status zu setzen, den eine externe Routine spaeter abholt.
  router.get("/api/review-approvals", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    res.json({ approvals: listPendingReviewApprovals(c.id) });
  });

  router.post("/api/review-approvals/:id/approve", safe(async (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const editedReply = typeof req.body?.reply === "string" ? req.body.reply : undefined;
    try {
      const approval = await approveReviewReply(c.id, String(req.params.id), editedReply);
      if (!approval) {
        res.status(404).json({ error: "Bewertung nicht gefunden oder schon bearbeitet." });
        return;
      }
      res.json({ ok: true, approval });
    } catch (err) {
      if (err instanceof ReviewRateLimitError) {
        res.status(429).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: err instanceof ToolError ? err.message : "Antwort konnte nicht gesendet werden. Bitte versuchen Sie es später noch einmal." });
    }
  }));

  router.post("/api/review-approvals/:id/reject", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const approval = rejectReviewReply(c.id, String(req.params.id));
    if (!approval) {
      res.status(404).json({ error: "Bewertung nicht gefunden oder schon bearbeitet." });
      return;
    }
    res.json({ ok: true, approval });
  });

  /**
   * Stimme vorhören (Video-Diashow). Erzeugt einen kurzen Beispielsatz mit der gewählten Stimme
   * und liefert ihn als Data-URL zurück - das Panel spielt ihn direkt ab, ohne dass irgendwo eine
   * Audiodatei liegen bleibt. Strenges Limit pro Kunde: das ist ein Vorhör-Knopf, keine
   * Sprachsynthese-API. Kosten sind winzig (ein Satz), werden aber trotzdem geloggt.
   */
  router.post("/api/voice-preview", safe(async (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (!ttsAvailable()) {
      res.status(503).json({ error: "Die Sprachausgabe ist gerade nicht verfügbar." });
      return;
    }
    if (rateLimited(`voice-preview:${c.id}`, 12, 10 * 60_000)) {
      res.status(429).json({ error: "Zu viele Hörproben. Bitte in ein paar Minuten erneut versuchen." });
      return;
    }
    const voice = getVoiceOption(str(req.body?.voice, 60));
    try {
      const spoken = await synthesizeSpeech(VOICE_PREVIEW_TEXT, voice.id);
      logUsageCost(c.id, "video-tts", spoken.costUsd);
      res.json({ voice: voice.id, label: voice.label, audioDataUrl: `data:${spoken.mimeType};base64,${spoken.audioBase64}` });
    } catch (err) {
      // Die technische Meldung des Dienstes ("Request failed with status code 500") hilft dem
      // Kunden nicht - sie steht im Log, im Panel steht ein Satz, mit dem man etwas anfangen kann.
      console.error("[voice-preview] Hörprobe fehlgeschlagen:", err instanceof Error ? err.message : err);
      res.status(502).json({ error: "Die Hörprobe konnte gerade nicht erzeugt werden. Bitte später erneut versuchen." });
    }
  }));

  // Schritt 1 OAuth: zur Plattform weiterleiten
  router.get("/connect/:provider", (req, res) => {
    const provider = getProvider(String(req.params.provider));
    const c = currentCustomer(req);
    if (!c) return backTo(res, { error: "session" });
    if (!provider) return backTo(res, { error: "failed" });
    if (!provider.isConfigured()) return backTo(res, { error: "not_configured", provider: provider.id });
    const state = randomToken(24);
    db.prepare("INSERT INTO oauth_states (state, customer_id, provider, expires_at) VALUES (?, ?, ?, ?)")
      .run(state, c.id, provider.id, new Date(Date.now() + 15 * 60_000).toISOString());
    res.redirect(302, provider.authorizeUrl(state, redirectUri(provider.id, req)));
  });

  // Schritt 2 OAuth: Rückkehr von der Plattform
  router.get("/callback/:provider", async (req, res) => {
    const provider = getProvider(String(req.params.provider));
    if (!provider) return backTo(res, { error: "failed" });
    const pid = provider.id;

    const state = str(req.query.state, 100);
    const stored = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state) as
      | { customer_id: string; provider: string; expires_at: string }
      | undefined;
    if (stored) db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

    if (req.query.error) return backTo(res, { error: "cancelled", provider: pid });
    if (!stored || stored.provider !== pid || new Date(stored.expires_at).getTime() < Date.now()) {
      return backTo(res, { error: "state", provider: pid });
    }
    const code = str(req.query.code, 2000);
    if (!code) return backTo(res, { error: "failed", provider: pid });

    try {
      const result = await provider.exchangeCode(code, redirectUri(pid, req));
      const now = nowIso();
      db.prepare(
        `INSERT INTO connections (customer_id, provider, account_id, account_name, access_token_enc, refresh_token_enc, expires_at, scopes, connected_at, updated_at, expiry_warning_sent_at)
         VALUES (@customer_id, @provider, @account_id, @account_name, @access, @refresh, @expires, @scopes, @now, @now, NULL)
         ON CONFLICT(customer_id, provider) DO UPDATE SET
           account_id = excluded.account_id, account_name = excluded.account_name,
           access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
           expires_at = excluded.expires_at, scopes = excluded.scopes,
           connected_at = excluded.connected_at, updated_at = excluded.updated_at, expiry_warning_sent_at = NULL,
           blocked_at = NULL, blocked_code = NULL, blocked_reason = NULL`,
      ).run({
        customer_id: stored.customer_id,
        provider: pid,
        account_id: result.accountId,
        account_name: result.accountName,
        access: encrypt(result.accessToken),
        refresh: result.refreshToken ? encrypt(result.refreshToken) : null,
        expires: result.expiresAt ? result.expiresAt.toISOString() : null,
        scopes: result.scopes ?? null,
        now,
      });
      console.log(`[panel] ${stored.customer_id} hat ${provider.name} verbunden (${result.accountName})`);
      if (pid === "instagram") {
        // Panel v11: Webhook-Abo fuer sofortige Kommentar-Antworten - best-effort, darf den
        // Connect-Flow nie blockieren (der Cron-Fallback deckt den Kunden trotzdem ab, siehe
        // comments.ts Dateikopf).
        subscribeToCommentWebhook(result.accountId, { accessToken: result.accessToken, igUserId: result.accountId }).catch((err) =>
          console.error(
            `[panel] ${stored.customer_id}: Webhook-Abo (comments) fehlgeschlagen - faellt bis zum naechsten Cron-Lauf zurueck:`,
            err instanceof Error ? err.message : err,
          ),
        );
      }
      backTo(res, { connected: pid });
    } catch (err) {
      console.error(`[panel] OAuth ${pid} fehlgeschlagen:`, err);
      backTo(res, { error: err instanceof ProviderError ? err.code : "failed", provider: pid });
    }
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[panel] Fehler:", err);
    res.status(500).json({ error: "Da ist auf unserer Seite etwas schiefgelaufen. Bitte versuchen Sie es erneut." });
  });

  return router;
}
