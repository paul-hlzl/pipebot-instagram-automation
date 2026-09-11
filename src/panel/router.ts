import express, { type Request, type Response, type NextFunction, type Router } from "express";
import path from "node:path";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import sharp from "sharp";
import { PACKAGE_ROOT, getConfig } from "../config.js";
import { db, nowIso, type CustomerRow, type ConnectionRow } from "./db.js";
import { assertEncryptionKey, encrypt, randomToken, sha256 } from "./crypto.js";
import { providers, getProvider } from "./providers/index.js";
import { ProviderError } from "./providers/types.js";
import {
  activateSavedTheme,
  connectionStatus,
  createPostRequest,
  createSavedTheme,
  deactivateTheme,
  isTrialExpired,
  lastPostRequestForCustomer,
  listContentPillars,
  listPendingApprovalsForCustomer,
  listPostsForCustomer,
  listSavedThemes,
  openPostRequestCount,
  POST_REQUEST_MAX_OPEN,
  POST_REQUEST_MAX_PER_DAY,
  postRequestCountToday,
  scheduleInputFor,
  setContentPillars,
  setPendingApprovalStatus,
  trialDaysLeft,
} from "./credentials.js";
import { createAdminRouter } from "./admin.js";
import { isDue, isDueForChannel, nextPostAt } from "./schedule.js";
import { anthropicAvailable, improveBriefing } from "../anthropic.js";
import { analyzeWebsite } from "../website-analyze.js";

const VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

const MOUNT = (process.env.PANEL_MOUNT_PATH ?? "/panel").replace(/\/$/, "");
const COOKIE = "pp_session";
const LOGO_DIR = path.join(PACKAGE_ROOT, "data/logos");
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const SESSION_DAYS = 90;
const TONES = ["sachlich", "locker", "inspirierend", "humorvoll"];
const FREQUENCIES = ["3x-woche", "werktags", "taeglich"];
const CTAS = ["link_bio", "anrufen", "nachricht", "termin", "keiner"];
const HASHTAG_PREFS = ["keine", "wenige", "viele"];
const LANGUAGES = ["de", "en"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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
const redirectUri = (providerId: string): string => `${baseUrl()}${MOUNT}/callback/${providerId}`;

// ---------- Hilfsfunktionen ----------

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function startSession(res: Response, customerId: string): void {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), customerId, expires);
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=${MOUNT}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`);
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

const clientIp = (req: Request): string =>
  (String(req.headers["x-forwarded-for"] ?? "").split(",")[0] || req.socket.remoteAddress || "unknown").trim();

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

interface BriefingInput {
  company: string; contactName: string; email: string; website: string; industry: string;
  about: string; tone: string; frequency: string; postTime: string;
  accentColor: string; watermarkText: string; avoidTopics: string; ctaPreference: string; bannedWords: string; requiredElements: string;
  igFeedEnabled: boolean; igStoryEnabled: boolean; linkedinEnabled: boolean;
  hashtagPreference: string; emojisEnabled: boolean; language: string;
  contentPillars: { title: string; description?: string; weight?: number }[];
  activeWeekdays: string; instagramWeekdays: string; linkedinWeekdays: string;
  pauseFrom: string; pauseUntil: string;
  approvalMode: boolean;
}

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
  };
  const errors: Record<string, string> = {};
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
      trialEndsAt: c.trial_ends_at,
      trialExpired: isTrialExpired({ trialEndsAt: c.trial_ends_at }),
      trialDaysLeft: trialDaysLeft(c.trial_ends_at),
      nextPostAt: nextPostAt(scheduleInputFor(c)),
      dueNow: c.customer_paused ? false : isDue(scheduleInputFor(c)),
      instagramDueNow: c.customer_paused ? false : isDueForChannel(scheduleInputFor(c), "instagram"),
      linkedinDueNow: c.customer_paused ? false : isDueForChannel(scheduleInputFor(c), "linkedin"),
      activeWeekdays: c.active_weekdays, instagramWeekdays: c.instagram_weekdays, linkedinWeekdays: c.linkedin_weekdays,
      pauseFrom: c.pause_from, pauseUntil: c.pause_until,
      approvalMode: Boolean(c.approval_mode),
      igFeedEnabled: Boolean(c.ig_feed_enabled), igStoryEnabled: Boolean(c.ig_story_enabled),
      linkedinEnabled: Boolean(c.linkedin_enabled), hashtagPreference: c.hashtag_pref || "wenige",
      emojisEnabled: Boolean(c.emojis_enabled), language: c.language || "de",
      customerPaused: Boolean(c.customer_paused),
      contentPillars: listContentPillars(c.id),
      lastPostRequest: lastPostRequestForCustomer(c.id),
      savedThemes: listSavedThemes(c.id),
      activeThemeId: c.active_theme_id,
      hasLogo: Boolean(c.logo_url),
    },
    connections: rows.map((r) => ({
      provider: r.provider,
      accountName: r.account_name,
      connectedAt: r.connected_at,
      expiresAt: r.expires_at,
      status: connectionStatus(r),
    })),
  };
}

const backTo = (res: Response, params: Record<string, string>): void =>
  res.redirect(303, `${MOUNT}/?${new URLSearchParams(params)}`);

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
  const publicDir = process.env.PANEL_PUBLIC_DIR ?? path.resolve(process.cwd(), "public/panel");
  // Generated post/story images (approval-review cards, style samples) are hosted on the R2
  // media bucket, not this origin - img-src must allow that domain or browsers silently drop
  // the <img> load (shows as an empty box, no console-visible network error to the user).
  const mediaOrigin = new URL(getConfig().mediaBucketUrl).origin;

  router.use((_req, res, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: ${mediaOrigin}; connect-src 'self'; frame-ancestors 'none'; form-action 'self'`,
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

  router.use("/admin", createAdminRouter());

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
      providers: providers.map((p) => ({
        id: p.id, name: p.name, tagline: p.tagline, notice: p.notice ?? null, guide: p.guide, available: p.isConfigured(),
      })),
      aiAvailable: anthropicAvailable(),
      trialDays: trialDays(),
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

  // Gleiche Absicherung wie /api/improve-briefing, aber strenger (1/Minute statt 6/10min) -
  // ruft eine vom Kunden eingegebene URL ab (SSRF-Schutz in website-analyze.ts/
  // ssrf-safe-fetch.ts), daher zusaetzlich kostspieliger/riskanter pro Aufruf.
  router.post(
    "/api/analyze-website",
    safe(async (req, res) => {
      if (rateLimited(`analyze-website:${clientIp(req)}`, 1, 60_000)) {
        res.status(429).json({ error: "Bitte warten Sie eine Minute, bevor Sie es erneut versuchen." });
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
        res.json({ suggestion });
      } catch (err) {
        console.error("[panel] analyze-website fehlgeschlagen:", err);
        res.status(502).json({ error: err instanceof Error ? err.message : "Die Website konnte nicht analysiert werden." });
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

  router.post("/api/signup", safe((req, res) => {
    if (rateLimited(`signup:${clientIp(req)}`, 5, 3_600_000)) {
      res.status(429).json({ error: "Zu viele Versuche. Bitte in einer Stunde erneut probieren." });
      return;
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
    db.prepare(
      `INSERT INTO customers (id, company, contact_name, email, website, industry, about, tone, frequency, post_time,
         accent_color, watermark_text, avoid_topics, cta_preference, trial_ends_at,
         ig_feed_enabled, ig_story_enabled, linkedin_enabled, hashtag_pref, emojis_enabled, language, banned_words, required_elements,
         active_weekdays, instagram_weekdays, linkedin_weekdays, pause_from, pause_until, approval_mode,
         login_key_hash, consent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, data.company, data.contactName, data.email, data.website || null, data.industry || null, data.about || null,
      data.tone, data.frequency, data.postTime,
      data.accentColor || null, data.watermarkText || null, data.avoidTopics || null, data.ctaPreference || null, trialEndsAt,
      data.igFeedEnabled ? 1 : 0, data.igStoryEnabled ? 1 : 0, data.linkedinEnabled ? 1 : 0, data.hashtagPreference, data.emojisEnabled ? 1 : 0, data.language, data.bannedWords || null, data.requiredElements || null,
      data.activeWeekdays || null, data.instagramWeekdays || null, data.linkedinWeekdays || null, data.pauseFrom || null, data.pauseUntil || null, data.approvalMode ? 1 : 0,
      sha256(randomToken()), now, now, now);
    setContentPillars(id, data.contentPillars);
    startSession(res, id);
    console.log(`[panel] Neuer Kunde: ${data.company} (${id})`);
    const created = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow;
    res.status(201).json(publicState(created));
  }));

  router.patch("/api/me", safe((req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const { data, errors } = parseBriefing(req.body ?? {});
    if (Object.keys(errors).length) {
      res.status(400).json({ error: "Bitte prüfen Sie Ihre Angaben.", fields: errors });
      return;
    }
    db.prepare(
      `UPDATE customers SET company=?, contact_name=?, email=?, website=?, industry=?, about=?, tone=?, frequency=?, post_time=?,
         accent_color=?, watermark_text=?, avoid_topics=?, cta_preference=?,
         ig_feed_enabled=?, ig_story_enabled=?, linkedin_enabled=?, hashtag_pref=?, emojis_enabled=?, language=?, banned_words=?, required_elements=?,
         active_weekdays=?, instagram_weekdays=?, linkedin_weekdays=?, pause_from=?, pause_until=?, approval_mode=?, updated_at=?
       WHERE id=?`,
    ).run(data.company, data.contactName, data.email, data.website || null, data.industry || null, data.about || null,
      data.tone, data.frequency, data.postTime,
      data.accentColor || null, data.watermarkText || null, data.avoidTopics || null, data.ctaPreference || null,
      data.igFeedEnabled ? 1 : 0, data.igStoryEnabled ? 1 : 0, data.linkedinEnabled ? 1 : 0, data.hashtagPreference, data.emojisEnabled ? 1 : 0, data.language, data.bannedWords || null, data.requiredElements || null,
      data.activeWeekdays || null, data.instagramWeekdays || null, data.linkedinWeekdays || null, data.pauseFrom || null, data.pauseUntil || null, data.approvalMode ? 1 : 0,
      nowIso(), c.id);
    setContentPillars(c.id, data.contentPillars);
    res.json(publicState(db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow));
  }));

  // Persönlicher Zugangslink – ersetzt jeden älteren Link
  router.post("/api/access-link", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const key = randomToken(24);
    db.prepare("UPDATE customers SET login_key_hash = ?, updated_at = ? WHERE id = ?").run(sha256(key), nowIso(), c.id);
    res.json({ link: `${baseUrl()}${MOUNT}/login?key=${key}` });
  });

  router.get("/login", (req, res) => {
    const key = str(req.query.key, 100);
    if (!key || rateLimited(`login:${clientIp(req)}`, 20, 3_600_000)) return backTo(res, { error: "login" });
    const c = db.prepare("SELECT * FROM customers WHERE login_key_hash = ? AND status = 'active'").get(sha256(key)) as CustomerRow | undefined;
    if (!c) return backTo(res, { error: "login" });
    startSession(res, c.id);
    res.redirect(303, `${MOUNT}/`);
  });

  router.post("/api/logout", (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=${MOUNT}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
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
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=${MOUNT}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
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

  router.post("/api/disconnect/:provider", (req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    db.prepare("DELETE FROM connections WHERE customer_id = ? AND provider = ?").run(c.id, String(req.params.provider));
    res.json(publicState(c));
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

  // Reine Warteschlange - kein direkter MCP-/KI-Aufruf von hier aus (der Server hat in diesem
  // Kontext keinen Anthropic-Zugriff). Die naechste Routine-Ausfuehrung holt sich offene
  // Anfragen ueber das MCP-Tool `list_post_requests` ab.
  router.post("/api/post-now", safe((req, res) => {
    const c = currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (openPostRequestCount(c.id) >= POST_REQUEST_MAX_OPEN) {
      res.status(429).json({ error: "Sie haben schon eine offene Anfrage. Bitte warten Sie, bis diese bearbeitet wurde." });
      return;
    }
    if (postRequestCountToday(c.id) >= POST_REQUEST_MAX_PER_DAY) {
      res.status(429).json({ error: `Maximal ${POST_REQUEST_MAX_PER_DAY} Anfragen pro Tag.` });
      return;
    }
    const topic = str(req.body?.topic, 300);
    const request = createPostRequest(c.id, topic || null);
    res.json({ ok: true, request });
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
    res.redirect(302, provider.authorizeUrl(state, redirectUri(provider.id)));
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
      const result = await provider.exchangeCode(code, redirectUri(pid));
      const now = nowIso();
      db.prepare(
        `INSERT INTO connections (customer_id, provider, account_id, account_name, access_token_enc, refresh_token_enc, expires_at, scopes, connected_at, updated_at)
         VALUES (@customer_id, @provider, @account_id, @account_name, @access, @refresh, @expires, @scopes, @now, @now)
         ON CONFLICT(customer_id, provider) DO UPDATE SET
           account_id = excluded.account_id, account_name = excluded.account_name,
           access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
           expires_at = excluded.expires_at, scopes = excluded.scopes,
           connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
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
