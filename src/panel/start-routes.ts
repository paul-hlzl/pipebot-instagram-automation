/**
 * Easy Onboarding - die zusaetzlichen Endpunkte fuer die neue Oberflaeche unter ${mount}/start/
 * (Sandbox-Auftrag, Fassung vom 19.09.2026). Alles Weitere nutzt die bestehenden Routen
 * (/api/me, PATCH /api/me, /api/planned-posts, /api/improve-briefing, /api/approvals,
 * /api/post-now, /api/skip-provider, /connect, /verify-email, /api/resend-verification).
 *
 * Neu und warum:
 *   GET  /auth/:provider           - Anmeldung starten (Google/Microsoft; Apple siehe auth-providers.ts)
 *   GET  /auth/:provider/callback  - Rueckkehr vom Anbieter, Konto anlegen oder wiedererkennen
 *   POST /api/start/email          - Rueckfallweg ohne Anbieterkonto: bekannt -> Einmal-Link, sonst Konto
 *   POST /api/start/preview        - EIN Feld (Website oder Beschreibung): analysieren, Markenfarben
 *                                    uebernehmen, Woche sofort planen (statt erst um 03:00 Uhr)
 *   GET  /api/start/status         - Fortschritt in Klartext + die Woche, so weit sie fertig ist
 *   POST /api/start/adjust         - "Anders machen": ein Freitext -> Beschreibung/Ton/vermeiden/Themen
 *   POST /api/start/replan         - nach Plan-Aenderungen fehlende Tage nachziehen
 *   GET  /api/start/config         - welche Anmelde-Anbieter eingerichtet sind
 *
 * Der Kostenschutz (Abschnitt 8) sitzt vollstaendig serverseitig in start-quota.ts und
 * domain_cache; im Browser wird nichts davon durchgesetzt.
 */
import type { Request, Response, Router } from "express";
import { db, nowIso, type CustomerRow } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";
import { anthropicAvailable, interpretAdjustmentWish } from "../anthropic.js";
import { ToolError } from "../errors.js";
import { cacheLesen } from "./start-analysis.js";
import { listContentPillars, listPlannedPosts, setContentPillars, PLANNED_POST_MAX_REGENERATE } from "./credentials.js";
import { logUsageCost } from "./analytics.js";
import { viennaDateStr } from "./schedule.js";
import { turnstileConfigured, verifyTurnstileToken } from "./turnstile.js";
import { sendMailBestEffort } from "./mailer.js";
import { loginLinkEmail, verificationEmail } from "./emails.js";
import { countAdjustsForCustomer, countPreviews, decidePreviewQuota, normalizeDomain, previewLimits, recordPreview } from "./start-quota.js";
import { getStartJob, isJobRunning, runAdjustJob, runPlanWeekJob, runPreviewJob, runRecolorJob } from "./start-jobs.js";
import { PLANNING_LOOKAHEAD_DAYS } from "./planning.js";
import { AuthNotConfiguredError, authProvidersPublic, getAuthProvider } from "./auth-providers.js";

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

/** Notnagel fuer den Firmennamen, bis die Website-Analyse den echten liefert. */
function nameAusEmail(email: string): string {
  const stamm = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return stamm.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").slice(0, 120) || "Mein Unternehmen";
}

/**
 * Legt ein Konto an - der einzige Ort dafuer im neuen Flow. Vorbelegt ist alles, was der Kunde
 * spaeter im Plan-Bildschirm ohnehin sieht: Freigabe an (nichts geht ohne OK raus), werktags um
 * 15:00, Instagram-Feed und LinkedIn (Story aus - halbe Kosten, ein Klick im Plan schaltet sie
 * ein). Firmenname vorerst aus der Adresse; die Website-Analyse ueberschreibt ihn gleich.
 */
function createEasyCustomer(input: { email: string; name?: string; authProvider?: string; authSubject?: string; emailVerified: boolean; trialDays: number }): CustomerRow {
  const id = `cus_${randomToken(9)}`;
  const now = nowIso();
  const company = input.name?.trim() ? input.name.trim().slice(0, 120) : nameAusEmail(input.email);
  const trialEndsAt = new Date(Date.now() + input.trialDays * 86_400_000).toISOString();
  db.prepare(
    `INSERT INTO customers (id, company, contact_name, email, tone, frequency, post_time, cta_preference, trial_ends_at,
       ig_feed_enabled, ig_story_enabled, linkedin_enabled, hashtag_pref, emojis_enabled, language,
       approval_mode, ui_mode, email_verified, auth_provider, auth_subject,
       login_key_hash, consent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'sachlich', 'werktags', '15:00', 'link_bio', ?, 1, 0, 1, 'wenige', 1, 'de', 1, 'easy', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, company, company, input.email, trialEndsAt, input.emailVerified ? 1 : 0, input.authProvider ?? null, input.authSubject ?? null, sha256(randomToken()), now, now, now);
  console.log(`[start] Neues Konto (${input.authProvider ?? "E-Mail"}): ${company} (${id})`);
  return customerById(id);
}

function previewWindow(): { today: string; to: string } {
  return { today: viennaDateStr(), to: viennaDateStr(new Date(Date.now() + (PLANNING_LOOKAHEAD_DAYS - 1) * 86_400_000)) };
}

function summaryFor(c: CustomerRow) {
  return {
    company: c.company,
    industry: c.industry ?? "",
    domain: normalizeDomain(c.website),
    pillars: listContentPillars(c.id).map((p) => ({ title: p.title, description: p.description ?? "" })),
    colors: { accentColor: c.accent_color ?? "", gradientColor2: c.gradient_color2 ?? "", gradientEnabled: Boolean(c.gradient_enabled) },
    limits: previewLimits(),
  };
}

/* ------------------------------------- Routen ---------------------------------------- */

export function registerStartRoutes(router: Router, ctx: StartContext): void {
  const redirectUri = (req: Request, providerId: string): string => `${ctx.baseUrlFor(req)}${ctx.mountFor(req)}/auth/${providerId}/callback`;
  const zurueckZumStart = (res: Response, req: Request, params: Record<string, string>): void => {
    res.redirect(303, `${ctx.mountFor(req)}/start/?${new URLSearchParams(params)}`);
  };

  // ---------- Bildschirm 1: Konto ueber Google / Microsoft ----------
  router.get(
    "/auth/:provider",
    safe(async (req, res) => {
      const provider = getAuthProvider(String(req.params.provider));
      if (!provider) return zurueckZumStart(res, req, { autherror: "unknown" });
      if (!provider.isConfigured()) return zurueckZumStart(res, req, { autherror: "not_configured", provider: provider.id });
      if (ctx.rateLimited(`auth-start:${ctx.clientIp(req)}`, 20, 3_600_000)) return zurueckZumStart(res, req, { autherror: "rate" });
      const state = randomToken(24);
      const nonce = randomToken(16);
      db.prepare("INSERT INTO auth_states (state, provider, nonce, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(state, provider.id, nonce, new Date(Date.now() + 15 * 60_000).toISOString(), nowIso());
      res.redirect(302, provider.authorizeUrl(state, nonce, redirectUri(req, provider.id)));
    }),
  );

  router.get(
    "/auth/:provider/callback",
    safe(async (req, res) => {
      const provider = getAuthProvider(String(req.params.provider));
      if (!provider) return zurueckZumStart(res, req, { autherror: "unknown" });
      if (req.query.error) return zurueckZumStart(res, req, { autherror: "cancelled", provider: provider.id });

      const state = str(req.query.state, 100);
      const gespeichert = db.prepare("SELECT * FROM auth_states WHERE state = ?").get(state) as { provider: string; expires_at: string } | undefined;
      if (gespeichert) db.prepare("DELETE FROM auth_states WHERE state = ?").run(state);
      if (!gespeichert || gespeichert.provider !== provider.id || Date.parse(gespeichert.expires_at) < Date.now()) {
        return zurueckZumStart(res, req, { autherror: "state", provider: provider.id });
      }
      const code = str(req.query.code, 2000);
      if (!code) return zurueckZumStart(res, req, { autherror: "failed", provider: provider.id });

      let identitaet;
      try {
        identitaet = await provider.exchangeCode(code, redirectUri(req, provider.id));
      } catch (err) {
        console.error(`[auth] ${provider.id}: Anmeldung fehlgeschlagen:`, err instanceof Error ? err.message : err);
        // Liegt es an unseren eigenen Zugangsdaten, hilft "noch einmal versuchen" nichts.
        const grund = err instanceof AuthNotConfiguredError ? "not_configured" : "failed";
        return zurueckZumStart(res, req, { autherror: grund, provider: provider.id });
      }

      // Wiedererkennen in drei Stufen: bekanntes Anbieterkonto -> bekannte E-Mail-Adresse -> neu.
      // Der mittlere Fall ist der wichtige: bestehende Kunden behalten ihren Zugangslink und
      // bekommen beim ersten Anmelden ueber Google das Anbieterkonto einfach dazugeschrieben.
      let kunde = db.prepare("SELECT * FROM customers WHERE auth_provider = ? AND auth_subject = ? AND status = 'active'").get(provider.id, identitaet.subject) as CustomerRow | undefined;
      if (!kunde) {
        const perMail = db.prepare("SELECT * FROM customers WHERE email = ? AND status = 'active' ORDER BY created_at DESC").get(identitaet.email) as CustomerRow | undefined;
        if (perMail) {
          db.prepare("UPDATE customers SET auth_provider = ?, auth_subject = ?, email_verified = 1, updated_at = ? WHERE id = ?")
            .run(provider.id, identitaet.subject, nowIso(), perMail.id);
          kunde = customerById(perMail.id);
        }
      }
      if (!kunde) {
        if (ctx.rateLimited(`auth-signup:${ctx.clientIp(req)}`, 5, 24 * 3_600_000)) return zurueckZumStart(res, req, { autherror: "rate" });
        kunde = createEasyCustomer({
          email: identitaet.email,
          name: identitaet.name,
          authProvider: provider.id,
          authSubject: identitaet.subject,
          // Die Adresse ist beim Anbieter bestaetigt - ein zweiter Bestaetigungsschritt waere
          // Schikane (Auftrag Abschnitt 5/8). Nur ein Anbieter, der sie ausdruecklich NICHT
          // bestaetigt, faellt auf den E-Mail-Weg zurueck.
          emailVerified: identitaet.emailVerified,
          trialDays: ctx.trialDays(),
        });
        if (!identitaet.emailVerified) {
          const token = randomToken(24);
          db.prepare("UPDATE customers SET email_verify_token_hash = ? WHERE id = ?").run(sha256(token), kunde.id);
          sendMailBestEffort(verificationEmail({ to: kunde.email, company: kunde.company, verifyUrl: `${ctx.baseUrlFor(req)}${ctx.mountFor(req)}/verify-email?token=${token}` }));
        }
      }
      ctx.startSession(res, kunde.id, req);
      zurueckZumStart(res, req, { angemeldet: provider.id });
    }),
  );

  // ---------- Bildschirm 1: Rueckfallweg E-Mail ----------
  router.post(
    "/api/start/email",
    safe(async (req, res) => {
      if (ctx.rateLimited(`start-email:${ctx.clientIp(req)}`, 15, 3_600_000)) {
        res.status(429).json({ error: "Zu viele Versuche. Bitte in einer Stunde noch einmal." });
        return;
      }
      const email = str(req.body?.email, 200).toLowerCase();
      if (!EMAIL_RE.test(email)) {
        res.status(400).json({ error: "Das sieht nicht nach einer E-Mail-Adresse aus. Bitte prüfe die Eingabe.", fields: { email: "Bitte eine gültige E-Mail-Adresse eingeben." } });
        return;
      }
      const vorhanden = db.prepare("SELECT * FROM customers WHERE email = ? AND status = 'active' ORDER BY created_at DESC").get(email) as CustomerRow | undefined;
      if (vorhanden) {
        // Einmal-Anmeldelink (eine Stunde, genau einmal). Bewusst NICHT den dauerhaften
        // Zugangslink ersetzen wie "Zugang verloren?" - sonst koennte jeder Fremde, der eine
        // bekannte Adresse eintippt, den gespeicherten Link eines Kunden entwerten.
        if (!ctx.rateLimited(`start-login-link:${email}`, 3, 3_600_000)) {
          const token = randomToken(24);
          db.prepare("UPDATE customers SET login_link_token_hash = ?, login_link_expires_at = ?, updated_at = ? WHERE id = ?")
            .run(sha256(token), new Date(Date.now() + 3_600_000).toISOString(), nowIso(), vorhanden.id);
          sendMailBestEffort(loginLinkEmail({ to: vorhanden.email, company: vorhanden.company, loginUrl: `${ctx.baseUrlFor(req)}${ctx.mountFor(req)}/login?key=${token}` }));
          res.json({ status: "known", mailed: true });
          return;
        }
        res.json({ status: "known", mailed: false });
        return;
      }
      if (ctx.rateLimited(`start-signup:${ctx.clientIp(req)}`, 5, 24 * 3_600_000)) {
        res.status(429).json({ error: "Von deinem Anschluss wurden heute schon mehrere Konten angelegt. Bitte versuche es morgen noch einmal." });
        return;
      }
      const kunde = createEasyCustomer({ email, emailVerified: false, trialDays: ctx.trialDays() });
      const token = randomToken(24);
      db.prepare("UPDATE customers SET email_verify_token_hash = ? WHERE id = ?").run(sha256(token), kunde.id);
      sendMailBestEffort(verificationEmail({ to: email, company: kunde.company, verifyUrl: `${ctx.baseUrlFor(req)}${ctx.mountFor(req)}/verify-email?token=${token}` }));
      ctx.startSession(res, kunde.id, req);
      res.status(201).json({ status: "created", ...(ctx.publicState(customerById(kunde.id)) as object) });
    }),
  );

  // ---------- Bildschirm 2 -> 3: Vorschau erstellen ----------
  router.post(
    "/api/start/preview",
    safe(async (req, res) => {
      const c = ctx.currentCustomer(req);
      if (!c) {
        res.status(401).json({ error: "Bitte melde dich zuerst an." });
        return;
      }
      const ip = ctx.clientIp(req);
      if (ctx.rateLimited(`start-preview:${ip}`, 10, 3_600_000)) {
        res.status(429).json({ error: "Zu viele Versuche. Bitte in einer Stunde noch einmal." });
        return;
      }
      if (isJobRunning(c.id)) {
        res.json({ status: "running" });
        return;
      }
      const website = str(req.body?.website, 300);
      const description = str(req.body?.description, 2000);
      if (!website && !description) {
        res.status(400).json({ error: "Bitte deine Website-Adresse eingeben - oder in einem Satz sagen, was dein Unternehmen macht.", fields: { website: "Bitte ausfüllen." } });
        return;
      }
      // Turnstile: unsichtbar, direkt vor dem einzigen kostenpflichtigen Schritt. Nach einer
      // Anmeldung ueber Google/Microsoft ueberfluessig (dort hat der Anbieter schon geprueft,
      // dass ein Mensch dahintersteht), deshalb nur fuer Konten aus dem E-Mail-Rueckfallweg.
      if (!c.auth_provider && turnstileConfigured()) {
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
      const { today, to } = previewWindow();
      if (listPlannedPosts(c.id, today, to).length) {
        res.status(409).json({ error: "Für dieses Konto liegt schon eine Woche bereit.", ready: true });
        return;
      }
      const domain = normalizeDomain(website);
      const limits = previewLimits();
      // Konto-Deckel (Abschnitt 8): mehrere Vorschauen pro Konto und Tag sind der teuerste Weg,
      // den ein angemeldeter Nutzer gehen kann.
      const heuteSchon = db.prepare("SELECT COUNT(*) AS n FROM start_previews WHERE customer_id = ? AND created_at > ?").get(c.id, new Date(Date.now() - 86_400_000).toISOString()) as { n: number };
      if (heuteSchon.n >= limits.perAccountPerDay) {
        res.status(429).json({ error: `Mehr als ${limits.perAccountPerDay} Vorschauen pro Tag sind für ein Konto nicht vorgesehen. Bitte morgen noch einmal.`, reason: "account" });
        return;
      }
      // Eine bereits analysierte Domain kostet keine Analyse mehr - dann greift der Deckel nicht.
      const ausCache = Boolean(cacheLesen(domain));
      if (!ausCache) {
        const entscheidung = decidePreviewQuota(countPreviews(ip, domain));
        if (!entscheidung.ok) {
          res.status(429).json({ error: entscheidung.message, reason: entscheidung.reason });
          return;
        }
      }

      recordPreview({ ip, domain, email: c.email, customerId: c.id, kind: "preview" });
      runPreviewJob(c.id, {
        website: website || null,
        description,
        // Ein bestaetigtes Konto (Anbieter-Login oder bestaetigte E-Mail) bekommt die ganze Woche
        // mit echten Bildern. Unbestaetigt: nur die ersten Tage, Rest als Textkarte - genau die
        // Variante aus Abschnitt 8.
        imageBudget: c.email_verified ? undefined : limits.imagesUnverified,
        postBudget: limits.postsUnverified,
      });
      res.status(202).json({ status: "started", cached: ausCache, ...(ctx.publicState(c) as object) });
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
      let wunsch;
      try {
        wunsch = await interpretAdjustmentWish({
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
      logUsageCost(c.id, "easy-onboarding-adjust", wunsch.costUsd);
      const now = nowIso();
      db.prepare("UPDATE customers SET about = ?, tone = ?, avoid_topics = ?, branding_last_changed_at = ?, updated_at = ? WHERE id = ?").run(
        wunsch.about ?? c.about,
        wunsch.tone ?? c.tone,
        wunsch.avoidTopics ?? c.avoid_topics,
        now,
        now,
        c.id,
      );
      if (wunsch.pillars.length) setContentPillars(c.id, wunsch.pillars.map((p) => ({ ...p, weight: 1 })));
      recordPreview({ ip: ctx.clientIp(req), domain: normalizeDomain(c.website), email: c.email, customerId: c.id, kind: "adjust" });
      runAdjustJob(c.id, !c.email_verified);
      res.json({ status: "started", changed: { about: Boolean(wunsch.about), tone: wunsch.tone ?? null, avoidTopics: Boolean(wunsch.avoidTopics), pillars: wunsch.pillars.length > 0 } });
    }),
  );

  // ---------- Bildschirm 5 / Dashboard: fehlende Tage nachziehen ----------
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

  // ---------- Plan-Bildschirm: Farbe geaendert, Bilder nachziehen ----------
  router.post("/api/start/recolor", (req, res) => {
    const c = ctx.currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (isJobRunning(c.id)) {
      res.json({ status: "running" });
      return;
    }
    // Mit Farbverlauf kostet das Rendern nichts (lokal), ohne waere jedes Bild ein fal.ai-Aufruf
    // - deshalb in beiden Faellen begrenzt.
    if (ctx.rateLimited(`start-recolor:${c.id}`, c.gradient_enabled ? 12 : 3, 3_600_000)) {
      res.status(429).json({ error: "Zu viele Farbwechsel hintereinander. Bitte in einer Stunde noch einmal." });
      return;
    }
    runRecolorJob(c.id);
    res.json({ status: "started" });
  });

  // ---------- Was Bildschirm 1 wissen muss ----------
  router.get("/api/start/config", (_req, res) => {
    res.json({ authProviders: authProvidersPublic() });
  });
}
