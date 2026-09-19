/**
 * Die Woche in der Hand des Kunden (Konzept vom 19.09.2026, freigegeben).
 *
 * Genau die Handlungen aus dem Konzept, keine weiteren: doch posten (Ueberspringen zuruecknehmen),
 * auf einen anderen Tag, einzeln neu schreiben lassen, eigenes Bild, eigener Beitrag, und ein
 * Schritt Rueckgaengig. Bearbeiten (PATCH), Ueberspringen und Freigeben gibt es schon in router.ts.
 *
 * Jede Handlung hier ist Kundenarbeit: sie setzt origin = 'kunde' bzw. image_source = 'kunde',
 * und ab da greift der Ueberschreibschutz (credentials.ts, darfNeuGeschriebenWerden).
 *
 * Rueckgaengig ist serverseitig, ein Schritt je Beitrag: vor jeder Aenderung wird die Zeile in
 * planned_post_undo gesichert (eine Zeile je Beitrag, wird ueberschrieben). Das ist bewusst kein
 * Verlauf - es deckt "falsch getippt", mehr nicht. Die Herkunft wird dabei NIE auf 'auto'
 * zurueckgesetzt: was der Kunde einmal angefasst hat, bleibt geschuetzt, auch nach Rueckgaengig.
 */
import express from "express";
import type { Request, Response, Router } from "express";
import sharp from "sharp";
import { db, nowIso, type CustomerRow } from "./db.js";
import {
  createPlannedPost, getPlannedPost, getPlannedPostForCustomer, listContentPillars,
  resolveImageBranding, updatePlannedPostText, updatePlannedPostImage, PLANNED_POST_MAX_REGENERATE, CHANNEL_IMAGE_FORMAT,
  type PlannedPost,
} from "./credentials.js";
import { generatePost, type PlannableChannel } from "./planning.js";
import { generateImageUrl } from "../fal.js";
import { uploadImageBase64 } from "../r2.js";
import { logUsageCost } from "./analytics.js";
import { viennaDateStr } from "./schedule.js";
import { ToolError } from "../errors.js";

db.exec(`CREATE TABLE IF NOT EXISTS planned_post_undo (
  post_id TEXT PRIMARY KEY REFERENCES planned_posts(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);

const AENDERBAR = new Set(["planned", "edited", "approved"]);
const KANAELE: PlannableChannel[] = ["ig_feed", "ig_story", "linkedin"];
/** Wie weit voraus ein Tag gewaehlt werden darf. */
const TAGE_VORAUS = 13;

/** Sichert die Zeile fuer genau einen Schritt Rueckgaengig. Aufrufen VOR der Aenderung. */
export function merken(postId: string, label: string): void {
  const row = db.prepare("SELECT status, scheduled_for, headline, caption, image_url, image_source, accent_color_used FROM planned_posts WHERE id = ?").get(postId);
  if (!row) return;
  db.prepare("INSERT INTO planned_post_undo (post_id, snapshot, label, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(post_id) DO UPDATE SET snapshot = excluded.snapshot, label = excluded.label, created_at = excluded.created_at")
    .run(postId, JSON.stringify(row), label, nowIso());
}

function kundenarbeit(postId: string, status?: string): void {
  // 'planned' wird zu 'edited' - 'approved' bleibt freigegeben, 'rejected' bleibt uebersprungen.
  db.prepare("UPDATE planned_posts SET origin = 'kunde', status = CASE WHEN status = 'planned' THEN 'edited' ELSE status END, updated_at = ? WHERE id = ?").run(nowIso(), postId);
  if (status) db.prepare("UPDATE planned_posts SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), postId);
}

function tagFrei(customerId: string, channel: string, tag: string, ausser?: string): boolean {
  const row = db.prepare("SELECT id FROM planned_posts WHERE customer_id = ? AND channel = ? AND scheduled_for = ? AND status NOT IN ('rejected') AND id != ?").get(customerId, channel, tag, ausser ?? "") as { id: string } | undefined;
  return !row;
}

function tagGueltig(tag: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tag)) return false;
  const heute = viennaDateStr();
  const max = viennaDateStr(new Date(Date.now() + TAGE_VORAUS * 86_400_000));
  return tag >= heute && tag <= max;
}

function kanalAktiv(c: CustomerRow, channel: string): boolean {
  return (channel === "ig_feed" && Boolean(c.ig_feed_enabled)) || (channel === "ig_story" && Boolean(c.ig_story_enabled)) || (channel === "linkedin" && Boolean(c.linkedin_enabled));
}

export interface WocheKontext {
  currentCustomer(req: Request): CustomerRow | undefined;
  rateLimited(key: string, max: number, windowMs: number): boolean;
}

export function registerWocheRoutes(router: Router, ctx: WocheKontext): void {
  const mitKunde = (req: Request, res: Response): { c: CustomerRow; plan: PlannedPost } | null => {
    const c = ctx.currentCustomer(req);
    if (!c) { res.status(401).json({ error: "Nicht angemeldet." }); return null; }
    const plan = getPlannedPostForCustomer(c.id, String(req.params.id));
    if (!plan) { res.status(404).json({ error: "Beitrag nicht gefunden." }); return null; }
    return { c, plan };
  };
  const antwort = (res: Response, id: string) => res.json({ post: getPlannedPost(id) });

  // ---------- Doch posten ----------
  router.post("/api/planned-posts/:id/unskip", (req, res) => {
    const k = mitKunde(req, res); if (!k) return;
    if (k.plan.status !== "rejected") { res.status(400).json({ error: "Dieser Beitrag ist nicht übersprungen." }); return; }
    if (!tagFrei(k.c.id, k.plan.channel, k.plan.scheduledFor, k.plan.id)) { res.status(409).json({ error: "An diesem Tag ist inzwischen ein anderer Beitrag geplant." }); return; }
    merken(k.plan.id, "Übersprungen");
    db.prepare("UPDATE planned_posts SET status = ?, updated_at = ? WHERE id = ?").run(k.plan.origin === "kunde" ? "edited" : "planned", nowIso(), k.plan.id);
    antwort(res, k.plan.id);
  });

  // ---------- Anderer Tag ----------
  router.post("/api/planned-posts/:id/move", (req, res) => {
    const k = mitKunde(req, res); if (!k) return;
    const tag = String(req.body?.scheduledFor ?? "");
    if (!AENDERBAR.has(k.plan.status)) { res.status(400).json({ error: "Dieser Beitrag lässt sich nicht mehr verschieben." }); return; }
    if (!tagGueltig(tag)) { res.status(400).json({ error: "Bitte einen Tag in den nächsten zwei Wochen wählen." }); return; }
    if (!tagFrei(k.c.id, k.plan.channel, tag, k.plan.id)) { res.status(409).json({ error: "An diesem Tag ist auf diesem Kanal schon ein Beitrag geplant." }); return; }
    merken(k.plan.id, "Verschoben");
    db.prepare("UPDATE planned_posts SET scheduled_for = ?, updated_at = ? WHERE id = ?").run(tag, nowIso(), k.plan.id);
    kundenarbeit(k.plan.id);
    antwort(res, k.plan.id);
  });

  // ---------- Einzeln neu schreiben lassen ----------
  router.post("/api/planned-posts/:id/regenerate", async (req, res) => {
    const k = mitKunde(req, res); if (!k) return;
    if (!AENDERBAR.has(k.plan.status)) { res.status(400).json({ error: "Dieser Beitrag lässt sich nicht mehr neu schreiben." }); return; }
    if (k.plan.regenerateCount >= PLANNED_POST_MAX_REGENERATE) { res.status(429).json({ error: `Dieser Beitrag wurde schon ${PLANNED_POST_MAX_REGENERATE}-mal neu geschrieben - bitte selbst anpassen.` }); return; }
    if (ctx.rateLimited(`regen:${k.c.id}`, 20, 3_600_000)) { res.status(429).json({ error: "Zu viele Neuerstellungen in kurzer Zeit." }); return; }
    try {
      const pillars = listContentPillars(k.c.id);
      const pillar = k.plan.pillarTitle ? pillars.find((p) => p.title === k.plan.pillarTitle) ?? { id: "", title: k.plan.pillarTitle, description: null, weight: 1 } : null;
      const vergeben = (db.prepare("SELECT headline FROM planned_posts WHERE customer_id = ? AND id != ? AND status NOT IN ('rejected') AND scheduled_for >= ?").all(k.c.id, k.plan.id, viennaDateStr()) as { headline: string | null }[]).map((r) => r.headline).filter((h): h is string => Boolean(h));
      const neu = await generatePost(k.c, k.plan.channel as PlannableChannel, pillar, "planned-post-regenerate", {
        withImage: k.plan.imageSource !== "kunde",
        farbSchluessel: `${k.plan.scheduledFor}|${k.plan.channel}`,
        vergebenJetzt: () => vergeben,
      });
      merken(k.plan.id, "Neu geschrieben");
      // Der Kunde hat es verlangt - das Ergebnis bleibt seine Arbeit (origin kunde) und damit
      // vor jeder Automatik geschuetzt. Ein eigenes Bild bleibt, nur der Text wird neu.
      updatePlannedPostText(k.plan.id, { headline: neu.headline, caption: neu.caption });
      if (k.plan.imageSource !== "kunde" && neu.imageUrl) updatePlannedPostImage(k.plan.id, neu.imageUrl, neu.accentColorUsed ?? "");
      antwort(res, k.plan.id);
    } catch (err) {
      res.status(502).json({ error: err instanceof ToolError ? err.message : "Das Neuschreiben hat gerade nicht geklappt. Bitte in einer Minute noch einmal." });
    }
  });

  // ---------- Eigenes Bild ----------
  // ---------- Eigener Beitrag ----------
  router.post("/api/planned-posts", async (req, res) => {
    const c = ctx.currentCustomer(req);
    if (!c) { res.status(401).json({ error: "Nicht angemeldet." }); return; }
    const channel = String(req.body?.channel ?? "");
    const tag = String(req.body?.scheduledFor ?? "");
    const headline = String(req.body?.headline ?? "").trim().slice(0, 80);
    const caption = String(req.body?.caption ?? "").trim().slice(0, 2200);
    if (!KANAELE.includes(channel as PlannableChannel) || !kanalAktiv(c, channel)) { res.status(400).json({ error: "Bitte einen aktiven Kanal wählen." }); return; }
    if (!tagGueltig(tag)) { res.status(400).json({ error: "Bitte einen Tag in den nächsten zwei Wochen wählen." }); return; }
    if (!tagFrei(c.id, channel, tag)) { res.status(409).json({ error: "An diesem Tag ist auf diesem Kanal schon ein Beitrag geplant." }); return; }
    if (headline.length < 3) { res.status(400).json({ error: "Bitte eine Überschrift eingeben." }); return; }
    if (channel !== "ig_story" && caption.length < 3) { res.status(400).json({ error: "Bitte einen Text eingeben." }); return; }
    if (ctx.rateLimited(`eigen:${c.id}`, 30, 3_600_000)) { res.status(429).json({ error: "Zu viele Beiträge in kurzer Zeit." }); return; }
    // Bild in den Markenfarben, lokal gerendert - der eigene Beitrag sieht aus wie die Woche.
    let imageUrl = "";
    let accent: string | undefined;
    try {
      const branding = resolveImageBranding(c.id);
      const bild = await generateImageUrl(headline, CHANNEL_IMAGE_FORMAT[channel as PlannableChannel], branding);
      logUsageCost(c.id, "planned-post-eigen", bild.costUsd);
      imageUrl = bild.imageUrl;
      accent = branding.accentColor;
    } catch {
      // Ohne Bild anlegen - der Nachtrag holt es, ein eigenes Bild kann jederzeit hochgeladen werden.
    }
    const post = createPlannedPost({ customerId: c.id, channel, scheduledFor: tag, headline, caption: channel === "ig_story" ? "" : caption, imageUrl: imageUrl || undefined, accentColorUsed: accent });
    db.prepare("UPDATE planned_posts SET origin = 'kunde', status = 'edited', pillar_title = NULL, updated_at = ? WHERE id = ?").run(nowIso(), post.id);
    merken(post.id, "Eigener Beitrag");
    res.status(201).json({ post: getPlannedPost(post.id) });
  });

  // ---------- Rückgängig, ein Schritt ----------
  router.post("/api/planned-posts/:id/undo", (req, res) => {
    const k = mitKunde(req, res); if (!k) return;
    const u = db.prepare("SELECT snapshot, label FROM planned_post_undo WHERE post_id = ?").get(k.plan.id) as { snapshot: string; label: string } | undefined;
    if (!u) { res.status(404).json({ error: "Nichts zum Rückgängigmachen." }); return; }
    if (k.plan.status === "published" || k.plan.status === "submitted") { res.status(400).json({ error: "Dieser Beitrag ist schon unterwegs." }); return; }
    const s = JSON.parse(u.snapshot) as { status: string; scheduled_for: string; headline: string | null; caption: string | null; image_url: string | null; image_source: string; accent_color_used: string | null };
    // Ein eigener Beitrag wird beim Rueckgaengig nicht geloescht, sondern uebersprungen - so bleibt
    // auch DAS umkehrbar. Erkennbar an der Sicherung "Eigener Beitrag".
    const status = u.label === "Eigener Beitrag" ? "rejected" : s.status;
    if (status !== "rejected" && !tagFrei(k.c.id, k.plan.channel, s.scheduled_for, k.plan.id)) { res.status(409).json({ error: "Der frühere Tag ist inzwischen belegt." }); return; }
    db.prepare("UPDATE planned_posts SET status = ?, scheduled_for = ?, headline = ?, caption = ?, image_url = ?, image_source = ?, accent_color_used = ?, updated_at = ? WHERE id = ?")
      .run(status, s.scheduled_for, s.headline, s.caption, s.image_url, s.image_source, s.accent_color_used, nowIso(), k.plan.id);
    db.prepare("DELETE FROM planned_post_undo WHERE post_id = ?").run(k.plan.id);
    res.json({ post: getPlannedPost(k.plan.id), label: u.label });
  });
}

/**
 * Die Bildroute wird SEPARAT montiert, und zwar VOR dem globalen 50-KB-Parser in router.ts.
 * Ein eigener Parser an der Route selbst genuegt nicht: der globale Parser laeuft frueher und
 * hat den Koerper dann schon abgelehnt (gemessen am 19.09.2026 mit einem 11,8-MB-Handyfoto:
 * "entity.too.large", limit 51200). Der Browser verkleinert vorher auf 1080x1080, die 8 MB sind
 * die Reserve fuer Geraete, die das nicht koennen.
 */
export function registerWocheBildRoute(router: Router, ctx: WocheKontext): void {
  const mitKunde = (req: Request, res: Response): { c: CustomerRow; plan: PlannedPost } | null => {
    const c = ctx.currentCustomer(req);
    if (!c) { res.status(401).json({ error: "Nicht angemeldet." }); return null; }
    const plan = getPlannedPost(String(req.params.id ?? ""));
    if (!plan || plan.customerId !== c.id) { res.status(404).json({ error: "Dieser Beitrag existiert nicht." }); return null; }
    return { c, plan };
  };
  const antwort = (res: Response, id: string) => res.json({ post: getPlannedPost(id) });
  // Eigener Bild-Parser: der globale Parser in router.ts steht bei 50 KB, ein Bild sprengt das
  // sofort (413, fuer den Kunden ein nichtssagender Fehler). Der Browser schickt hier ~200 KB,
  // 8 MB sind die Reserve fuer Clients, die nicht verkleinern koennen.
  router.post("/api/planned-posts/:id/image", express.json({ limit: "8mb" }), async (req, res) => {
    const k = mitKunde(req, res); if (!k) return;
    if (!AENDERBAR.has(k.plan.status)) { res.status(400).json({ error: "Dieser Beitrag lässt sich nicht mehr ändern." }); return; }
    if (ctx.rateLimited(`bild:${k.c.id}`, 30, 3_600_000)) { res.status(429).json({ error: "Zu viele Bilder in kurzer Zeit." }); return; }
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image ?? ""));
    if (!m) { res.status(400).json({ error: "Bitte ein Bild als PNG, JPEG oder WebP wählen." }); return; }
    try {
      const roh = Buffer.from(m[2], "base64");
      // Auf ein sauberes Quadrat bringen - dieselbe Groesse, die Pipeflow selbst erzeugt.
      const fertig = await sharp(roh).rotate().resize(1080, 1080, { fit: "cover", position: "attention" }).jpeg({ quality: 90 }).toBuffer();
      const url = await uploadImageBase64(fertig.toString("base64"));
      merken(k.plan.id, "Eigenes Bild");
      db.prepare("UPDATE planned_posts SET image_url = ?, image_source = 'kunde', updated_at = ? WHERE id = ?").run(url, nowIso(), k.plan.id);
      kundenarbeit(k.plan.id);
      antwort(res, k.plan.id);
    } catch {
      res.status(400).json({ error: "Das Bild konnte nicht verarbeitet werden." });
    }
  });
}
