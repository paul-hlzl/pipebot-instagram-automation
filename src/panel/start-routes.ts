/**
 * Easy Onboarding - die wenigen zusaetzlichen Endpunkte fuer die neue Oberflaeche unter
 * ${mount}/start/ (Sandbox-Auftrag 19.09.2026). Alles Weitere nutzt die bestehenden Routen
 * (/api/me, PATCH /api/me, /api/planned-posts, /api/approvals, /api/post-now,
 * /api/skip-provider, /connect, /verify-email, /api/resend-verification).
 *
 * Neu und warum:
 *   POST /api/start/begin    - EIN Feld (E-Mail): bekannt -> Anmeldelink per Mail, sonst weiter.
 *   POST /api/start/preview  - EIN Feld (Website oder Beschreibung): legt das Konto mit allem
 *                              Abgeleiteten an, startet die Vorausplanung SOFORT (statt 03:00)
 *                              und ist der einzige Ort, an dem der Kostenschutz greift.
 *   GET  /api/start/status   - Fortschritt in Klartext + die Woche, so weit sie fertig ist.
 *   POST /api/start/adjust   - "Anders machen": ein Freitext -> Beschreibung/Tonalitaet/
 *                              vermeiden/Themen -> Woche neu schreiben.
 *   POST /api/start/replan   - nach "Plan uebernehmen" (Kanaele/Rhythmus geaendert): fehlende
 *                              Slots auffuellen, mit denselben Deckeln.
 *
 * Alles additiv; das klassische Panel und die Routine kennen diese Routen nicht und brauchen
 * sie nicht.
 */
import type { Request, Response, Router } from "express";
import { db, nowIso, type CustomerRow } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";
import { anthropicAvailable, suggestFromWebsite, interpretAdjustmentWish, type WebsiteSuggestion } from "../anthropic.js";
import { analyzeWebsite } from "../website-analyze.js";
import { ToolError } from "../errors.js";
import { listContentPillars, listPlannedPosts, setContentPillars, PLANNED_POST_MAX_REGENERATE } from "./credentials.js";
import { logUsageCost } from "./analytics.js";
import { viennaDateStr } from "./schedule.js";
import { turnstileConfigured, verifyTurnstileToken } from "./turnstile.js";
import { sendMailBestEffort } from "./mailer.js";
import { loginLinkEmail, verificationEmail } from "./emails.js";
import { countAdjustsForCustomer, countPreviews, decidePreviewQuota, normalizeDomain, previewLimits, recordPreview } from "./start-quota.js";
import { getStartJob, isJobRunning, runAdjustJob, runPlanWeekJob } from "./start-jobs.js";
import { PLANNING_LOOKAHEAD_DAYS } from "./planning.js";

export interface StartContext {
  currentCustomer(req: Request): CustomerRow | undefined;
  startSession(res: Response, customerId: string, req: Request): void;
  publicState(c: CustomerRow): unknown;
  clientIp(req: Request): string;
  mountFor(req: Request): string;
  baseUrlFor(req: Request): string;
  hostOf(req: Request): string;
  rateLimited(key: string, max: number, windowMs: number): boolean;
  trialDays(): number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

type Handler = (req: Request, res: Response) => Promise<void> | void;
const safe = (fn: Handler) => async (req: Request, res: Response, next: (err?: unknown) => void) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

function customerById(id: string): CustomerRow {
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow;
}

/** "hoelzl-physio.at" -> "Hoelzl Physio" - nur der Notnagel, wenn die Seite keinen Namen hergibt. */
function companyFromDomain(domain: string): string {
  const stem = domain.split(".")[0] ?? "";
  const words = stem.split(/[-_]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ");
}

function previewWindow(): { today: string; to: string } {
  return { today: viennaDateStr(), to: viennaDateStr(new Date(Date.now() + (PLANNING_LOOKAHEAD_DAYS - 1) * 86_400_000)) };
}

/** Was der Ergebnis-Bildschirm braucht, zusaetzlich zu publicState/planned-posts. */
function summaryFor(c: CustomerRow) {
  const pillars = listContentPillars(c.id);
  return {
    company: c.company,
    industry: c.industry ?? "",
    domain: normalizeDomain(c.website),
    pillars: pillars.map((p) => ({ title: p.title, description: p.description ?? "" })),
    limits: previewLimits(),
  };
}

export function registerStartRoutes(router: Router, ctx: StartContext): void {
  // ---------- Bildschirm 1: Einstieg ----------
  router.post(
    "/api/start/begin",
    safe(async (req, res) => {
      if (ctx.rateLimited(`start-begin:${ctx.clientIp(req)}`, 15, 3_600_000)) {
        res.status(429).json({ error: "Zu viele Versuche. Bitte in einer Stunde noch einmal." });
        return;
      }
      const email = str(req.body?.email, 200).toLowerCase();
      if (!EMAIL_RE.test(email)) {
        res.status(400).json({ error: "Das sieht nicht nach einer E-Mail-Adresse aus. Bitte prüfe die Eingabe.", fields: { email: "Bitte eine gültige E-Mail-Adresse eingeben." } });
        return;
      }
      const existing = db.prepare("SELECT * FROM customers WHERE email = ? AND status = 'active' ORDER BY created_at DESC").get(email) as CustomerRow | undefined;
      if (!existing) {
        res.json({ status: "new" });
        return;
      }
      // Bekannt: EINMAL-Anmeldelink schicken (eine Stunde gueltig). Bewusst NICHT wie "Zugang
      // verloren?" den dauerhaften Zugangslink ersetzen - sonst koennte jeder Fremde, der diese
      // Adresse eintippt, den gespeicherten Link des Kunden entwerten. Gleiches Limit je Adresse.
      if (ctx.rateLimited(`start-login-link:${email}`, 3, 3_600_000)) {
        res.json({ status: "known", mailed: false });
        return;
      }
      const token = randomToken(24);
      db.prepare("UPDATE customers SET login_link_token_hash = ?, login_link_expires_at = ?, updated_at = ? WHERE id = ?")
        .run(sha256(token), new Date(Date.now() + 3_600_000).toISOString(), nowIso(), existing.id);
      sendMailBestEffort(loginLinkEmail({ to: existing.email, company: existing.company, loginUrl: `${ctx.baseUrlFor(req)}${ctx.mountFor(req)}/login?key=${token}` }));
      res.json({ status: "known", mailed: true });
    }),
  );

  // ---------- Bildschirm 2 -> 3: Vorschau erstellen ----------
  router.post(
    "/api/start/preview",
    safe(async (req, res) => {
      const ip = ctx.clientIp(req);
      if (ctx.rateLimited(`start-preview:${ip}`, 10, 3_600_000)) {
        res.status(429).json({ error: "Zu viele Versuche. Bitte in einer Stunde noch einmal." });
        return;
      }
      if (ctx.currentCustomer(req)) {
        res.status(409).json({ error: "Du bist schon angemeldet - deine Vorschau liegt im Dashboard." });
        return;
      }
      const email = str(req.body?.email, 200).toLowerCase();
      const website = str(req.body?.website, 300);
      const description = str(req.body?.description, 2000);
      if (!EMAIL_RE.test(email)) {
        res.status(400).json({ error: "Bitte zuerst eine gültige E-Mail-Adresse eingeben.", fields: { email: "Ungültige E-Mail-Adresse." } });
        return;
      }
      if (!website && !description) {
        res.status(400).json({ error: "Bitte deine Website-Adresse eingeben - oder in einem Satz sagen, was dein Unternehmen macht.", fields: { website: "Bitte ausfüllen." } });
        return;
      }
      // Turnstile: unsichtbar direkt vor dem einzigen kostenpflichtigen Schritt. Ohne Schluessel
      // (Sandbox) uebersprungen - exakt wie beim klassischen Signup.
      if (turnstileConfigured()) {
        const ok = await verifyTurnstileToken(str(req.body?.["cf-turnstile-response"], 3000), ip, ctx.hostOf(req));
        if (!ok) {
          res.status(400).json({ error: "Sicherheitsprüfung fehlgeschlagen. Bitte lade die Seite neu und versuche es noch einmal." });
          return;
        }
      }
      if (!anthropicAvailable()) {
        res.status(503).json({ error: "Die Vorschau ist gerade nicht verfügbar. Bitte versuche es in ein paar Minuten noch einmal." });
        return;
      }
      const existing = db.prepare("SELECT * FROM customers WHERE email = ? AND status = 'active'").get(email) as CustomerRow | undefined;
      if (existing) {
        res.status(409).json({ error: "Für diese E-Mail-Adresse gibt es schon ein Konto. Wir schicken dir gern einen Anmeldelink.", known: true });
        return;
      }
      // Kostenschutz - serverseitig, neustartfest (start-quota.ts).
      const domain = normalizeDomain(website);
      const decision = decidePreviewQuota(countPreviews(ip, domain));
      if (!decision.ok) {
        res.status(429).json({ error: decision.message, reason: decision.reason });
        return;
      }

      // Analyse: Website lesen ODER die Beschreibung als "Text der Startseite" behandeln.
      let analysis: WebsiteSuggestion;
      try {
        analysis = website ? await analyzeWebsite(website) : await suggestFromWebsite({ title: "", description: "", bodyText: description });
      } catch (err) {
        const msg = err instanceof ToolError ? err.message : "Die Website konnte gerade nicht gelesen werden.";
        res.status(502).json({ error: `${msg} Du kannst stattdessen in einem Satz beschreiben, was dein Unternehmen macht.`, fallback: "description" });
        return;
      }
      logUsageCost(null, "easy-onboarding-analyze", analysis.costUsd ?? null);

      const company = (analysis.company || (domain ? companyFromDomain(domain) : "") || "Mein Unternehmen").slice(0, 120);
      const id = `cus_${randomToken(9)}`;
      const now = nowIso();
      const trialEndsAt = new Date(Date.now() + ctx.trialDays() * 86_400_000).toISOString();
      const verifyToken = randomToken(24);
      const customHashtags = analysis.hashtags.map((h) => `#${h}`).join(" ");
      // Vorbelegungen: alles aus der Website, der Rest konservativ. Freigabe AN (nichts geht ohne
      // OK raus - der Satz auf Bildschirm 2), werktags, Feed + LinkedIn (Story aus: kostet die
      // Haelfte, und wer sie will, schaltet sie im Plan mit einem Stift ein).
      db.prepare(
        `INSERT INTO customers (id, company, contact_name, email, website, industry, about, tone, frequency, post_time,
           accent_color, watermark_text, avoid_topics, cta_preference, trial_ends_at,
           ig_feed_enabled, ig_story_enabled, linkedin_enabled, hashtag_pref, emojis_enabled, language, custom_hashtags,
           approval_mode, ui_mode, login_key_hash, email_verify_token_hash, consent_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, company, company, email, website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
        analysis.industry || null, analysis.about || description || null, analysis.tone, "werktags", "15:00",
        null, null, null, "link_bio", trialEndsAt,
        1, 0, 1, "wenige", 1, "de", customHashtags || null,
        1, "easy", sha256(randomToken()), sha256(verifyToken), now, now, now,
      );
      setContentPillars(id, analysis.pillars.length ? analysis.pillars.map((p) => ({ ...p, weight: 1 })) : []);
      recordPreview({ ip, domain, email, customerId: id, kind: "preview" });
      ctx.startSession(res, id, req);
      console.log(`[start] Neuer Kunde über Easy Onboarding: ${company} (${id})`);
      sendMailBestEffort(
        verificationEmail({ to: email, company, verifyUrl: `${ctx.baseUrlFor(req)}${ctx.mountFor(req)}/verify-email?token=${verifyToken}` }),
      );

      const limits = previewLimits();
      runPlanWeekJob(id, "preview", {
        concurrency: 3,
        feature: "easy-onboarding-preview",
        imageBudget: limits.imagesUnverified,
        postBudget: limits.postsUnverified,
      });
      res.status(201).json({ status: "started", ...(ctx.publicState(customerById(id)) as object), summary: summaryFor(customerById(id)) });
    }),
  );

  // ---------- Bildschirm 3/4: Fortschritt + Woche ----------
  router.get("/api/start/status", (req, res) => {
    const c = ctx.currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const { today, to } = previewWindow();
    const posts = listPlannedPosts(c.id, today, to);
    const job = getStartJob(c.id);
    res.json({
      job: job ?? { kind: null, phase: "idle", total: 0, done: 0, errors: 0, startedAt: null, finishedAt: null, message: null },
      posts,
      imagesDone: posts.filter((p) => Boolean(p.imageUrl)).length,
      window: { from: today, to },
      maxRegenerate: PLANNED_POST_MAX_REGENERATE,
      summary: summaryFor(c),
      ...(ctx.publicState(c) as object),
    });
  });

  // ---------- Bildschirm 4b: Anders machen ----------
  router.post(
    "/api/start/adjust",
    safe(async (req, res) => {
      const c = ctx.currentCustomer(req);
      if (!c) {
        res.status(401).json({ error: "Nicht angemeldet" });
        return;
      }
      const wish = str(req.body?.wish, 600);
      if (!wish) {
        res.status(400).json({ error: "Sag uns in ein paar Worten, was anders sein soll.", fields: { wish: "Bitte ausfüllen." } });
        return;
      }
      if (isJobRunning(c.id)) {
        res.status(409).json({ error: "Deine Beiträge werden gerade noch erstellt - einen Moment." });
        return;
      }
      if (!anthropicAvailable()) {
        res.status(503).json({ error: "Gerade nicht verfügbar. Bitte in ein paar Minuten noch einmal." });
        return;
      }
      const limits = previewLimits();
      if (!c.email_verified) {
        if (countAdjustsForCustomer(c.id) >= limits.adjustUnverified) {
          res.status(429).json({ error: `Vor der Bestätigung deiner E-Mail-Adresse ist ${limits.adjustUnverified === 1 ? "eine Anpassung" : `${limits.adjustUnverified} Anpassungen`} möglich. Bestätige deine E-Mail - danach kannst du beliebig oft anpassen.`, reason: "unverified" });
          return;
        }
      } else if (ctx.rateLimited(`branding-regen:${c.id}`, 3, 3_600_000)) {
        res.status(429).json({ error: "Zu viele Anpassungen hintereinander. Bitte in einer Stunde noch einmal." });
        return;
      }
      let wishResult;
      try {
        wishResult = await interpretAdjustmentWish({
          wish,
          company: c.company,
          industry: c.industry ?? "",
          about: c.about ?? "",
          tone: c.tone ?? "sachlich",
          avoidTopics: c.avoid_topics ?? "",
          pillars: listContentPillars(c.id),
        });
      } catch (err) {
        res.status(502).json({ error: err instanceof ToolError ? err.message : "Das hat gerade nicht geklappt. Bitte versuche es noch einmal." });
        return;
      }
      logUsageCost(c.id, "easy-onboarding-adjust", wishResult.costUsd);
      const now = nowIso();
      db.prepare("UPDATE customers SET about = ?, tone = ?, avoid_topics = ?, branding_last_changed_at = ?, updated_at = ? WHERE id = ?").run(
        wishResult.about ?? c.about,
        wishResult.tone ?? c.tone,
        wishResult.avoidTopics ?? c.avoid_topics,
        now,
        now,
        c.id,
      );
      if (wishResult.pillars.length) setContentPillars(c.id, wishResult.pillars.map((p) => ({ ...p, weight: 1 })));
      recordPreview({ ip: ctx.clientIp(req), domain: normalizeDomain(c.website), email: c.email, customerId: c.id, kind: "adjust" });
      runAdjustJob(c.id, !c.email_verified);
      res.json({ status: "started", changed: { about: Boolean(wishResult.about), tone: wishResult.tone ?? null, avoidTopics: Boolean(wishResult.avoidTopics), pillars: wishResult.pillars.length > 0 } });
    }),
  );

  // ---------- Bildschirm 5 / Dashboard: nach Plan-Aenderung fehlende Slots auffuellen ----------
  router.post("/api/start/replan", (req, res) => {
    const c = ctx.currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (isJobRunning(c.id)) {
      res.json({ status: "running" });
      return;
    }
    if (!anthropicAvailable()) {
      res.status(503).json({ error: "Gerade nicht verfügbar." });
      return;
    }
    if (ctx.rateLimited(`start-replan:${c.id}`, 6, 3_600_000)) {
      res.status(429).json({ error: "Zu viele Änderungen hintereinander. Bitte in einer Stunde noch einmal." });
      return;
    }
    const limits = previewLimits();
    const { today, to } = previewWindow();
    const posts = listPlannedPosts(c.id, today, to);
    const opts = c.email_verified
      ? { concurrency: 3, feature: "easy-onboarding-replan" }
      : {
          concurrency: 3,
          feature: "easy-onboarding-replan",
          imageBudget: Math.max(0, limits.imagesUnverified - posts.filter((p) => p.imageUrl).length),
          postBudget: Math.max(0, limits.postsUnverified - posts.length),
        };
    runPlanWeekJob(c.id, "replan", opts);
    res.json({ status: "started" });
  });
}

