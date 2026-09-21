/**
 * Admin dashboard for Paul: overview of all customers, trial/connection status, and a
 * small set of actions (extend trial, unlock, sperren/entsperren, loeschen). Das Loeschen kam
 * am 20.09.2026 dazu - vorher gab es das nur als Einmal-Werkzeug und im Selbstbedienungsweg
 * des Kunden; alle drei teilen sich jetzt kunde-entfernen.ts.
 *
 * Mounted inside the panel router (`router.use("/admin", createAdminRouter())`), so it
 * sits before the global MCP bearer-token gate in http-server.ts and gets the panel's
 * security headers / JSON body parser for free.
 *
 * 21.09.2026 - "Angemeldet bleiben": eine Sitzung haelt weiterhin 12 Stunden, mit Haken bei der
 * Anmeldung 30 Tage. Dazu zwei Zusagen, die im Code und nicht in der Disziplin haengen:
 * ein Wechsel des Adminpassworts macht JEDE bestehende Sitzung ungueltig (pw_fingerprint,
 * siehe unten), und jede Sitzung ist einzeln abmeldbar (/api/sessions).
 */
import express, { type Request, type Response, type NextFunction, type Router } from "express";
import path from "node:path";
import crypto from "node:crypto";
import { db, nowIso, type CustomerRow, type ConnectionRow, type PostRow } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";
import { cancelPostRequest, connectionStatus, isTrialExpired, trialDaysLeft } from "./credentials.js";
import { sendMail } from "./mailer.js";
import { firstPostLiveEmail, pendingApprovalsSummaryEmail, tokenExpiringEmail, trialEndingEmail, verificationEmail, weeklyAnalyticsReportEmail } from "./emails.js";
import { getAnalyticsSummary, usageCostSummary } from "./analytics.js";
import { entferneKunde, sammleKundenDateien } from "./kunde-entfernen.js";
import { deleteObject } from "../r2.js";
import { getConfig } from "../config.js";
import { promises as fsPromises } from "node:fs";
import { commentStatsForCustomer } from "./comments.js";

const COOKIE = "pp_admin";
// Der Cookie-Pfad stand hier fest auf "/panel/admin". Unter /panel/sandbox/admin hat der Browser
// das Sitzungs-Cookie deshalb NIE zurueckgeschickt: die Anmeldung lieferte 200, der naechste
// Aufruf von /api/me 401 - die Sandbox-Admin-Seite war praktisch nicht benutzbar (gefunden beim
// Redesign Phase 6). Gleiche Herleitung wie im Kunden-Router (router.ts MOUNT); ohne
// PANEL_MOUNT_PATH bleibt es exakt "/panel/admin" wie bisher.
const MOUNT = (process.env.PANEL_MOUNT_PATH ?? "/panel").replace(/\/$/, "");
// Zweite Adresse (app.pipeflow.at, Panel auf der Wurzel): der Cookie-Pfad muss zu der Adresse
// passen, ueber die der Aufruf kam - genau dieser Fehler hat die Sandbox-Admin-Seite schon einmal
// unbenutzbar gemacht (Login 200, danach /api/me 401), damals durch einen fest verdrahteten Pfad.
const APP_HOSTS = (process.env.PANEL_APP_HOSTS ?? "app.pipeflow.at")
  .split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const cookiePathFor = (req: Request): string => {
  const host = String(req.headers.host ?? "").split(":")[0].toLowerCase();
  return APP_HOSTS.includes(host) ? `/${ADMIN_SEGMENT}` : `${MOUNT}/${ADMIN_SEGMENT}`;
};
/**
 * Das Pfadsegment des Adminbereichs. Standard "admin" - identisch zum Verhalten vor dem
 * 20.09.2026. Mit PANEL_ADMIN_PATH wird daraus ein geheimes Segment, und der Bereich ist von
 * aussen nicht mehr auffindbar. Schraegstriche werden abgeschnitten, damit ein Eintrag mit
 * fuehrendem "/" nicht zu einer doppelten Einhaengung fuehrt.
 */
export const ADMIN_SEGMENT = (process.env.PANEL_ADMIN_PATH ?? "admin").replace(/^\/+|\/+$/g, "") || "admin";

/** Ohne Haken bei "Angemeldet bleiben" - unveraendert der Wert von vorher. */
const SESSION_HOURS = 12;
/** Mit Haken. Bewusst FEST ab Anmeldung, nicht gleitend: "30 Tage auf diesem Geraet" soll ein
 *  Datum sein, das in der Sitzungsliste steht, und keine Zusage, die sich bei jedem Aufruf
 *  selbst verlaengert und damit nie ablaeuft. */
const REMEMBER_DAYS = 30;
const STATUSES = ["active", "paused"] as const;

/**
 * Fingerabdruck des Adminpassworts. Jede Sitzung speichert den ihres Passworts; geprueft wird
 * gegen den des GERADE geltenden. Aendert Paul PANEL_ADMIN_PASSWORD, stimmt kein gespeicherter
 * Wert mehr ueberein und samtliche Sitzungen sind in derselben Sekunde ungueltig - ohne dass
 * irgendwo eine Liste aufgeraeumt werden muss, die man vergessen koennte.
 *
 * scrypt statt sha256: der Wert steht in der Datenbank, das Passwort ist kurz und von Hand
 * gewaehlt. Ein blanker Hash waere offline in Minuten durchprobiert, scrypt nicht. Die
 * Ableitung kostet ~100 ms, deshalb liegt das Ergebnis im Prozess (fuer genau ein Passwort) -
 * pro Anfrage wird nichts neu gerechnet.
 *
 * Grenze, die zum Auftrag gehoert: PANEL_ADMIN_PASSWORD wird beim Start aus der .env gelesen.
 * Ein geaendertes Passwort gilt also ab dem Neustart, den es ohnehin braucht - und genau ab
 * dann sind auch die Sitzungen weg. "Sofort" heisst hier: zum selben Zeitpunkt, zu dem das
 * neue Passwort gilt, nicht spaeter.
 */
const FINGERABDRUCK_SALZ = "pipeflow-admin-sitzungsbindung-v1";
let fingerabdruckCache: { passwort: string; wert: string } | null = null;
function passwortFingerabdruck(passwort: string): string {
  if (fingerabdruckCache?.passwort === passwort) return fingerabdruckCache.wert;
  const wert = crypto.scryptSync(passwort, FINGERABDRUCK_SALZ, 32).toString("hex");
  fingerabdruckCache = { passwort, wert };
  return wert;
}
/** null = kein Adminpasswort gesetzt. Dann gibt es keine Anmeldung und auch keine Sitzung. */
function aktuellerFingerabdruck(): string | null {
  const passwort = process.env.PANEL_ADMIN_PASSWORD?.trim();
  return passwort ? passwortFingerabdruck(passwort) : null;
}

interface AdminSessionRow {
  token_hash: string;
  expires_at: string;
  id: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  remember: number;
  user_agent: string | null;
  ip: string | null;
}

/**
 * Lesbarer Geraetename aus dem User-Agent - "Chrome auf Windows" statt 120 Zeichen Kauderwelsch.
 * Bewusst grob und ohne Bibliothek: die Liste beantwortet die eine Frage, um die es geht ("bin
 * ich das, oder ist das ein fremdes Geraet?"). Reihenfolge zaehlt - Edge und Opera nennen sich
 * selbst auch "Chrome", Chrome nennt sich auch "Safari".
 */
function geraeteName(ua: string | null): string {
  const s = ua ?? "";
  if (!s.trim()) return "Unbekanntes Gerät";
  const browser =
    /\bEdgA?\//.test(s) ? "Edge" :
    /\bOPR\/|\bOpera\//.test(s) ? "Opera" :
    /\bFirefox\//.test(s) ? "Firefox" :
    /\bChrome\//.test(s) ? "Chrome" :
    /\bSafari\//.test(s) ? "Safari" :
    "Browser";
  const system =
    /iPhone/.test(s) ? "iPhone" :
    /iPad/.test(s) ? "iPad" :
    /Android/.test(s) ? "Android" :
    /Windows NT/.test(s) ? "Windows" :
    /Mac OS X|Macintosh/.test(s) ? "macOS" :
    /Linux/.test(s) ? "Linux" :
    null;
  return system ? `${browser} auf ${system}` : browser;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function isValidPassword(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    crypto.timingSafeEqual(providedBuf, providedBuf);
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
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

function startAdminSession(res: Response, req: Request, angemeldetBleiben: boolean): void {
  const fingerabdruck = aktuellerFingerabdruck();
  // Kann hier nicht eintreten (ohne Passwort kommt niemand durch die Anmeldung) - aber eine
  // Sitzung ohne Bindung waere eine, die ein Passwortwechsel nicht mehr erreicht.
  if (!fingerabdruck) throw new Error("PANEL_ADMIN_PASSWORD fehlt - keine Sitzung ohne Passwort.");
  const sekunden = angemeldetBleiben ? REMEMBER_DAYS * 86_400 : SESSION_HOURS * 3_600;
  const token = randomToken();
  const jetzt = nowIso();
  const expires = new Date(Date.now() + sekunden * 1000).toISOString();
  // Sitzungen eines frueheren Passworts sind schon durch die Pruefung unten ungueltig; hier
  // verschwinden sie auch aus der Tabelle, damit die Sitzungsliste keine Leichen zeigt.
  // "IS NOT" statt "!=": NULL-sicher, sonst blieben genau die Altzeilen stehen.
  db.prepare("DELETE FROM admin_sessions WHERE pw_fingerprint IS NOT ?").run(fingerabdruck);
  db.prepare(
    `INSERT INTO admin_sessions (token_hash, expires_at, id, created_at, last_seen_at, remember, user_agent, ip, pw_fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sha256(token),
    expires,
    randomToken(12),
    jetzt,
    jetzt,
    angemeldetBleiben ? 1 : 0,
    String(req.headers["user-agent"] ?? "").slice(0, 300),
    clientIp(req),
    fingerabdruck,
  );
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=${cookiePathFor(req)}; HttpOnly; Secure; SameSite=Lax; Max-Age=${sekunden}`,
  );
}

/** Die Sitzung hinter dem Cookie - oder null. Drei Bedingungen, alle drei in EINER Abfrage:
 *  Token bekannt, noch nicht abgelaufen, und an das aktuell geltende Passwort gebunden. */
function currentSession(req: Request): AdminSessionRow | null {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const fingerabdruck = aktuellerFingerabdruck();
  if (!fingerabdruck) return null;
  const row = db
    .prepare("SELECT * FROM admin_sessions WHERE token_hash = ? AND expires_at > ? AND pw_fingerprint = ?")
    .get(sha256(token), nowIso(), fingerabdruck) as AdminSessionRow | undefined;
  return row ?? null;
}

const hasAdminSession = (req: Request): boolean => currentSession(req) !== null;

/** "Zuletzt aktiv" in der Sitzungsliste. Hoechstens einmal je Minute geschrieben - sonst kostet
 *  jede einzelne Anfrage der Oberflaeche einen Schreibzugriff, nur fuer eine Anzeige. */
function beruehreSession(row: AdminSessionRow): void {
  if (row.last_seen_at && Date.now() - new Date(row.last_seen_at).getTime() < 60_000) return;
  db.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?").run(nowIso(), row.token_hash);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const session = currentSession(req);
  if (!session) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
  beruehreSession(session);
  res.locals.adminSession = session;
  next();
}

type Handler = (req: Request, res: Response) => Promise<void> | void;
const safe = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

interface CustomerAdminView {
  /** Wie viele 'Jetzt posten'-Anfragen gerade offen sind - haengt eine, blockiert sie den Kanal. */
  openPostRequests: number;
  customerId: string;
  company: string;
  contactName: string;
  email: string;
  createdAt: string;
  /** Wie sich der Kunde angemeldet hat: 'google' | 'microsoft' | null = per E-Mail/Anmeldeschluessel. */
  authProvider: string | null;
  status: string;
  trial: { unlimited: boolean; expired: boolean; daysLeft: number | null; endsAt: string | null };
  channels: { provider: string; accountName: string | null; status: string }[];
  postCount: number;
  lastPostAt: string | null;
  /** Noch nicht veroeffentlichte Beitraege im Plan - sagt, ob ueberhaupt etwas ansteht. */
  plannedPostCount: number;
  notifyOnPublish: boolean;
  notifyWeeklyReport: boolean;
  analyticsFollowers: number | null;
  commentAutomationEnabled: boolean;
  commentStats30d: { answered: number; skipped: number; pendingApproval: number; rejected: number };
}

function customerAdminView(c: CustomerRow): CustomerAdminView {
  const connections = db.prepare("SELECT * FROM connections WHERE customer_id = ?").all(c.id) as ConnectionRow[];
  const postStats = db
    .prepare("SELECT COUNT(*) as n, MAX(posted_at) as last FROM posts WHERE customer_id = ?")
    .get(c.id) as { n: number; last: string | null };
  return {
    customerId: c.id,
    company: c.company,
    contactName: c.contact_name,
    email: c.email,
    createdAt: c.created_at,
    authProvider: c.auth_provider ?? null,
    status: c.status,
    trial: {
      unlimited: !c.trial_ends_at,
      expired: isTrialExpired({ trialEndsAt: c.trial_ends_at }),
      daysLeft: trialDaysLeft(c.trial_ends_at),
      endsAt: c.trial_ends_at,
    },
    channels: connections.map((r) => ({ provider: r.provider, accountName: r.account_name, status: connectionStatus(r) })),
    postCount: postStats.n,
    lastPostAt: postStats.last,
    plannedPostCount: (db
      .prepare("SELECT COUNT(*) as n FROM planned_posts WHERE customer_id = ?")
      .get(c.id) as { n: number }).n,
    notifyOnPublish: Boolean(c.notify_on_publish),
    notifyWeeklyReport: Boolean(c.notify_weekly_report),
    // Panel v9 Aufgabe 6: kurzer Analytics-Hinweis in der Kundenübersicht (nur Follower-Anzahl,
    // keine grosse eigene Ansicht) - liest die bereits vom taeglichen Cron gespeicherten Snapshots,
    // kein Live-API-Aufruf hier.
    analyticsFollowers: getAnalyticsSummary(c.id).current.followerCount,
    // Panel v10 Punkt 4: Sichtbarkeit, kein eigenes grosses Feature - nur die Zahlen der letzten
    // 30 Tage, keine Kommentar-Inhalte hier (die sieht nur der Kunde selbst im Panel).
    commentAutomationEnabled: Boolean(c.comment_automation_enabled),
    commentStats30d: commentStatsForCustomer(c.id, 30),
    // Sichtbar machen, was sonst nur der Kunde im Panel merkt: haengt hier eine Anfrage?
    openPostRequests: (db
      .prepare("SELECT COUNT(*) as n FROM post_requests WHERE customer_id = ? AND status IN ('pending','processing')")
      .get(c.id) as { n: number }).n,
  };
}

export function createAdminRouter(panelPublicDir?: string): Router {
  const router = express.Router();
  // Redesign Phase 6: das Verzeichnis kommt jetzt vom Panel-Router (der die Sandbox-Weiche auf
  // public/panel-redesign kennt). Vorher stand hier fest public/panel - die Sandbox unter
  // /panel/sandbox/admin/ hat also die PRODUKTIONS-admin.html ausgeliefert, ein Redesign dieser
  // Seite waere dort gar nicht sichtbar gewesen (und nur in Produktion aenderbar). Ohne Argument
  // bleibt das alte Verhalten unveraendert.
  const publicDir = panelPublicDir ?? process.env.PANEL_PUBLIC_DIR ?? path.resolve(process.cwd(), "public/panel");

  router.get("/", (_req, res) => res.sendFile(path.join(publicDir, "admin.html")));

  router.post(
    "/api/login",
    safe((req, res) => {
      if (rateLimited(`admin-login:${clientIp(req)}`, 8, 15 * 60_000)) {
        res.status(429).json({ error: "Zu viele Versuche. Bitte in 15 Minuten erneut probieren." });
        return;
      }
      const expected = process.env.PANEL_ADMIN_PASSWORD?.trim();
      const provided = typeof req.body?.password === "string" ? req.body.password : "";
      if (!expected || !provided || !isValidPassword(provided, expected)) {
        res.status(401).json({ error: "Falsches Passwort." });
        return;
      }
      // Fehlender/ungueltiger Wert = nicht angehakt. Der kurze Ablauf ist der Standard, der
      // lange muss ausdruecklich gewaehlt werden.
      startAdminSession(res, req, req.body?.remember === true);
      res.json({ ok: true });
    }),
  );

  /** Offene "Jetzt posten"-Anfragen eines Kunden zuruecknehmen - der Ausweg, wenn eine Anfrage
   *  haengt und der Kanal im Panel blockiert bleibt (Vorfall 15.09.2026). */
  router.post(
    "/api/customers/:id/cancel-requests",
    safe((req, res) => {
      const anzahl = cancelPostRequest(String(req.params.id));
      res.json({ ok: true, cancelled: anzahl });
    }),
  );

  router.post("/api/logout", (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(sha256(token));
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=${cookiePathFor(req)}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  router.get("/api/me", (req, res) => {
    if (!hasAdminSession(req)) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    res.json({ ok: true });
  });

  router.use(requireAdmin);

  /**
   * Sitzungen dieses Adminkontos - "wo bin ich gerade angemeldet".
   *
   * Der Token-Hash bleibt im Server; nach aussen geht nur die Zufallskennung `id`. Ein
   * abgelaufener Eintrag taucht nicht auf: die Liste zeigt, was JETZT gilt, nicht was einmal war.
   */
  router.get(
    "/api/sessions",
    safe((req, res) => {
      const eigener = res.locals.adminSession as AdminSessionRow;
      const rows = db
        .prepare("SELECT * FROM admin_sessions WHERE expires_at > ? ORDER BY created_at DESC")
        .all(nowIso()) as AdminSessionRow[];
      res.json({
        sessions: rows.map((r) => ({
          id: r.id,
          current: r.token_hash === eigener.token_hash,
          remember: Boolean(r.remember),
          device: geraeteName(r.user_agent),
          ip: r.ip,
          createdAt: r.created_at,
          lastSeenAt: r.last_seen_at,
          expiresAt: r.expires_at,
        })),
      });
    }),
  );

  /** Alle ausser der eigenen. Muss VOR "/api/sessions/:id" stehen, sonst waere "others" die id. */
  router.delete(
    "/api/sessions/others",
    safe((req, res) => {
      const eigener = res.locals.adminSession as AdminSessionRow;
      const ergebnis = db
        .prepare("DELETE FROM admin_sessions WHERE token_hash != ?")
        .run(eigener.token_hash);
      res.json({ ok: true, abgemeldet: ergebnis.changes });
    }),
  );

  /** Eine einzelne Sitzung beenden. Trifft es die eigene, muss auch das Cookie weg - sonst
   *  schickt der Browser weiter ein Token mit, zu dem es keine Zeile mehr gibt. */
  router.delete(
    "/api/sessions/:id",
    safe((req, res) => {
      const eigener = res.locals.adminSession as AdminSessionRow;
      const id = String(req.params.id);
      const row = db.prepare("SELECT token_hash FROM admin_sessions WHERE id = ?").get(id) as
        | { token_hash: string }
        | undefined;
      if (!row) {
        res.status(404).json({ error: "Sitzung nicht gefunden." });
        return;
      }
      db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(id);
      const warEigene = row.token_hash === eigener.token_hash;
      if (warEigene) {
        res.setHeader("Set-Cookie", `${COOKIE}=; Path=${cookiePathFor(req)}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
      }
      res.json({ ok: true, warEigene });
    }),
  );

  router.get(
    "/api/overview",
    safe((_req, res) => {
      // Testlaeufe der Sandbox (status = 'test') gehoeren in keine Kundenliste und in keine
      // Kennzahl - siehe start-testmode.ts.
      const rows = db.prepare("SELECT * FROM customers WHERE status != 'test' ORDER BY created_at DESC").all() as CustomerRow[];
      const customers = rows.map(customerAdminView);
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const postsLast7d = (
        db.prepare("SELECT COUNT(*) as n FROM posts WHERE posted_at >= ?").get(weekAgo) as { n: number }
      ).n;
      const metrics = {
        totalCustomers: customers.length,
        active: customers.filter((c) => c.status === "active").length,
        inTrial: customers.filter((c) => !c.trial.unlimited && !c.trial.expired).length,
        trialExpired: customers.filter((c) => c.trial.expired).length,
        postsLast7Days: postsLast7d,
        connectionsNeedingAction: customers.reduce(
          (n, c) => n + c.channels.filter((ch) => ch.status === "renew-soon" || ch.status === "expired").length,
          0,
        ),
      };
      // Panel v9 Aufgabe 6 (niedrige Prioritaet, "nur falls Zeit bleibt"): grobe Kostenschaetzung
      // der neuen KI-Aufrufe fuer Paul, kein eigenes grosses Feature - siehe usage_costs (Aufgabe 3).
      res.json({ metrics, customers, usageCosts: usageCostSummary(30) });
    }),
  );

  router.get(
    "/api/customers/:id",
    safe((req, res) => {
      const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(String(req.params.id)) as
        | CustomerRow
        | undefined;
      if (!row) {
        res.status(404).json({ error: "Kunde nicht gefunden" });
        return;
      }
      const posts = db
        .prepare("SELECT * FROM posts WHERE customer_id = ? ORDER BY posted_at DESC LIMIT 30")
        .all(row.id) as PostRow[];
      res.json({
        ...customerAdminView(row),
        briefing: {
          website: row.website,
          industry: row.industry,
          about: row.about,
          tone: row.tone,
          frequency: row.frequency,
          postTime: row.post_time,
          accentColor: row.accent_color,
          watermarkText: row.watermark_text,
          avoidTopics: row.avoid_topics,
          ctaPreference: row.cta_preference,
        },
        posts: posts.map((p) => ({
          id: p.id,
          provider: p.provider,
          headline: p.headline,
          caption: p.caption,
          imageUrl: p.image_url,
          postedAt: p.posted_at,
        })),
      });
    }),
  );

  router.post(
    "/api/customers/:id/extend-trial",
    safe((req, res) => {
      const id = String(req.params.id);
      const days = Number(req.body?.days);
      if (!Number.isFinite(days) || days <= 0 || days > 365) {
        res.status(400).json({ error: "Ungültige Anzahl Tage (1-365)." });
        return;
      }
      const row = db.prepare("SELECT trial_ends_at FROM customers WHERE id = ?").get(id) as
        | { trial_ends_at: string | null }
        | undefined;
      if (!row) {
        res.status(404).json({ error: "Kunde nicht gefunden" });
        return;
      }
      // Extend from "now" if the trial already lapsed (or never existed), otherwise from
      // its current end - so extending an active trial adds to it instead of shortening it.
      const base = row.trial_ends_at && new Date(row.trial_ends_at).getTime() > Date.now() ? new Date(row.trial_ends_at) : new Date();
      const next = new Date(base.getTime() + days * 86_400_000).toISOString();
      db.prepare("UPDATE customers SET trial_ends_at = ?, updated_at = ? WHERE id = ?").run(next, nowIso(), id);
      res.json({ ok: true, trialEndsAt: next });
    }),
  );

  router.post(
    "/api/customers/:id/unlimited",
    safe((req, res) => {
      const id = String(req.params.id);
      const result = db.prepare("UPDATE customers SET trial_ends_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), id);
      if (result.changes === 0) {
        res.status(404).json({ error: "Kunde nicht gefunden" });
        return;
      }
      res.json({ ok: true });
    }),
  );

  router.post(
    "/api/customers/:id/status",
    safe((req, res) => {
      const id = String(req.params.id);
      const status = String(req.body?.status ?? "");
      if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
        res.status(400).json({ error: `status muss eines von ${STATUSES.join(", ")} sein.` });
        return;
      }
      const result = db.prepare("UPDATE customers SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
      if (result.changes === 0) {
        res.status(404).json({ error: "Kunde nicht gefunden" });
        return;
      }
      res.json({ ok: true, status });
    }),
  );

  /**
   * Konto endgueltig entfernen (20.09.2026 beauftragt).
   *
   * Der Kommentar oben im Modul sagte frueher, hier gebe es bewusst KEIN Loeschen - das galt,
   * solange nur der Kunde selbst sein Konto entfernen konnte. Jetzt gibt es beides; die Logik
   * teilen sich beide Wege ueber kunde-entfernen.ts, damit nicht zwei Tabellenlisten
   * auseinanderlaufen.
   *
   * Schutz gegen den Fehlgriff: die Firma muss im Rumpf wortgleich mitgeschickt werden. Ein
   * versehentlicher Klick auf die falsche Zeile kann damit nichts ausloesen, ein bewusster
   * schon - dieselbe Sorte Bremse wie `--wirklich` im Werkzeug.
   */
  router.delete(
    "/api/customers/:id",
    safe(async (req, res) => {
      const id = String(req.params.id);
      const row = db.prepare("SELECT company FROM customers WHERE id = ?").get(id) as { company: string } | undefined;
      if (!row) {
        res.status(404).json({ error: "Kunde nicht gefunden" });
        return;
      }
      const bestaetigung = typeof req.body?.company === "string" ? req.body.company.trim() : "";
      if (bestaetigung !== row.company.trim()) {
        res.status(400).json({ error: "Zur Bestätigung bitte den Firmennamen exakt eingeben." });
        return;
      }
      // Dateien VOR den Zeilen - danach weiss niemand mehr, welche es waren. Fehlschlaege beim
      // Aufraeumen halten das Loeschen nicht auf (siehe denselben Weg in router.ts).
      const dateien = sammleKundenDateien(db, id, getConfig().mediaBucketUrl);
      await Promise.all(dateien.r2Schluessel.map((k) => deleteObject(k).catch(() => {})));
      await Promise.all(dateien.lokaleDateien.map((f) => fsPromises.unlink(f).catch(() => {})));

      const ergebnis = entferneKunde(db, id);
      console.warn(
        `[panel-admin] Konto geloescht: ${id} (${row.company}) - ` +
        `${dateien.r2Schluessel.length} Bild(er), ${dateien.lokaleDateien.length} Logo(s), ` +
        `Zeilen ${JSON.stringify(ergebnis.zeilen)}`,
      );
      res.json({ ok: true, geloescht: ergebnis.zeilen, dateien: { objektspeicher: dateien.r2Schluessel.length, logos: dateien.lokaleDateien.length } });
    }),
  );

  // Panel v6 Aufgabe 4: laesst Paul den technischen Mail-Versand selbst pruefen, ohne einen
  // echten Kunden zu behelligen - schickt IMMER mit "[TEST]" im Betreff, nutzt sendMail (nicht
  // sendMailBestEffort), damit ein echter Fehlschlag hier sichtbar wird statt nur geloggt.
  const TEST_EMAIL_TEMPLATES = ["approvals", "trial-ending", "first-post", "verification", "weekly-report", "token-expiring"] as const;
  router.post(
    "/api/test-email",
    safe((req, res) => {
      const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
      const template = TEST_EMAIL_TEMPLATES.includes(req.body?.template) ? req.body.template : "approvals";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
        res.status(400).json({ error: "Bitte eine gültige E-Mail-Adresse angeben." });
        return;
      }
      const testCompany = "Test GmbH";
      const base = (process.env.PANEL_BASE_URL ?? "").replace(/\/$/, "");
      const mount = (process.env.PANEL_MOUNT_PATH ?? "/panel").replace(/\/$/, "");
      const mail =
        template === "trial-ending" ? trialEndingEmail({ to, company: testCompany }) :
        template === "first-post" ? firstPostLiveEmail({ to, company: testCompany }) :
        template === "verification" ? verificationEmail({ to, company: testCompany, verifyUrl: `${base}${mount}/verify-email?token=test-nicht-echt` }) :
        template === "weekly-report" ? weeklyAnalyticsReportEmail({
          to, company: testCompany, followerCount: 542, followerGrowth7d: 12, reach7d: 2860, reachPrev7d: 2450,
          views7d: 3018, engagementRate7d: 14.6,
          aiSummary: "(Test-Text) In der letzten Woche lief es gut: mehr Reichweite als in der Vorwoche und stetiges Follower-Wachstum. Ein Beitrag mit einer konkreten Kundenfrage performte besonders gut - Tipp: das kommende Woche wiederholen.",
        }) :
        template === "token-expiring" ? tokenExpiringEmail({
          to, company: testCompany, channelLabel: "LinkedIn",
          expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        }) :
        pendingApprovalsSummaryEmail({ to, company: testCompany, count: 2 });
      mail.subject = `[TEST] ${mail.subject}`;
      try {
        sendMail(mail);
        res.json({ ok: true });
      } catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : "Versand fehlgeschlagen." });
      }
    }),
  );

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[panel-admin] Fehler:", err);
    res.status(500).json({ error: "Da ist auf unserer Seite etwas schiefgelaufen." });
  });

  return router;
}
