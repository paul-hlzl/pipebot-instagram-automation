/**
 * Admin dashboard for Paul: overview of all customers, trial/connection status, and a
 * small set of safe actions (extend trial, unlock, pause/activate). No delete action here
 * on purpose - deleting a customer's own data is only ever done by the customer themselves
 * (see the self-service "Konto löschen" flow).
 *
 * Mounted inside the panel router (`router.use("/admin", createAdminRouter())`), so it
 * sits before the global MCP bearer-token gate in http-server.ts and gets the panel's
 * security headers / JSON body parser for free.
 */
import express, { type Request, type Response, type NextFunction, type Router } from "express";
import path from "node:path";
import crypto from "node:crypto";
import { db, nowIso, type CustomerRow, type ConnectionRow, type PostRow } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";
import { connectionStatus, isTrialExpired, trialDaysLeft } from "./credentials.js";

const COOKIE = "pp_admin";
const SESSION_HOURS = 12;
const STATUSES = ["active", "paused"] as const;

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

function startAdminSession(res: Response): void {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString();
  db.prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)").run(sha256(token), expires);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/panel/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`,
  );
}

function hasAdminSession(req: Request): boolean {
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const row = db
    .prepare("SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .get(sha256(token), nowIso());
  return Boolean(row);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!hasAdminSession(req)) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
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
  customerId: string;
  company: string;
  contactName: string;
  email: string;
  createdAt: string;
  status: string;
  trial: { unlimited: boolean; expired: boolean; daysLeft: number | null; endsAt: string | null };
  channels: { provider: string; accountName: string | null; status: string }[];
  postCount: number;
  lastPostAt: string | null;
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
  };
}

export function createAdminRouter(): Router {
  const router = express.Router();
  const publicDir = process.env.PANEL_PUBLIC_DIR ?? path.resolve(process.cwd(), "public/panel");

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
      startAdminSession(res);
      res.json({ ok: true });
    }),
  );

  router.post("/api/logout", (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(sha256(token));
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/panel/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
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

  router.get(
    "/api/overview",
    safe((_req, res) => {
      const rows = db.prepare("SELECT * FROM customers ORDER BY created_at DESC").all() as CustomerRow[];
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
      res.json({ metrics, customers });
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

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[panel-admin] Fehler:", err);
    res.status(500).json({ error: "Da ist auf unserer Seite etwas schiefgelaufen." });
  });

  return router;
}
