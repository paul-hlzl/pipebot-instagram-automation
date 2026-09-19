/**
 * Testmodus der Sandbox (Auftrag vom 19.09.2026).
 *
 * Ziel: den kompletten Easy-Onboarding-Flow beliebig oft von vorne durchklicken, ohne sich
 * jedes Mal eine E-Mail-Adresse auszudenken - und ohne dass dabei etwas entsteht, das wie ein
 * echter Kunde aussieht.
 *
 * Der Trick ist bewusst NICHT eine weitere Spalte mit einem Filter an jeder Abfrage. Ein
 * Testkunde bekommt `status = 'test'` statt 'active'. Damit sparen ihn alle bestehenden
 * Abfragen automatisch aus - naechtliche Planung, Kommentar- und Bewertungsautomatik,
 * Analytics, Trial-Mails, Stillstands-Wache, `list_customers`, Video-Kandidaten. Es gibt genau
 * drei Stellen, die eigens angepasst werden mussten, und alle drei sind hier dokumentiert:
 *
 *   1. router.ts, currentCustomer(): laesst 'test' als Sitzung zu - sonst koennte der Testkunde
 *      das Panel gar nicht bedienen.
 *   2. admin.ts, /api/overview: listet bewusst ALLE Status, also auch 'test' - dort gefiltert.
 *   3. analytics.ts, Kostenuebersicht: summiert usage_costs ohne Kundenbezug - dort gefiltert.
 *
 * Sicherheit: die Routen existieren nur, wenn PANEL_SANDBOX=true UND ein PANEL_TEST_KEY gesetzt
 * ist. Ohne beides meldet der Einstieg 404 (nicht 403 - wer raet, soll nicht erfahren, dass es
 * den Weg gibt). Der Schluessel wird zeichenweise konstant verglichen.
 */
import { timingSafeEqual } from "node:crypto";
import type { Request, Response, Router } from "express";
import { db, nowIso, type CustomerRow } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";
import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "../config.js";

/** Das automatisch geholte Logo liegt als Datei, nicht nur als Zeile - sonst bleiben nach
 *  jedem Testlauf verwaiste PNGs in data/logos liegen (am 19.09.2026 waren es vier). */
function logoDateiWeg(customerId: string): void {
  const row = db.prepare("SELECT detected_logo_url FROM customers WHERE id = ?").get(customerId) as { detected_logo_url: string | null } | undefined;
  const datei = row?.detected_logo_url ?? path.join(PACKAGE_ROOT, "data/logos", `auto-${customerId}.png`);
  try {
    fs.unlinkSync(datei);
  } catch {
    // Keine Datei da - nichts zu tun.
  }
}

function kundeLaden(id: string): CustomerRow {
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow;
}

/** Testkunden sind 24 Stunden gueltig; aeltere raeumt der naechste Einstieg weg. */
const TEST_TTL_MS = 24 * 3_600_000;

/** Laeuft dieser Prozess als Sandbox? Einzige Quelle fuer alle Sandbox-only-Wege hier.
 *  Produktion setzt PANEL_SANDBOX nie - und koennte es nicht unbemerkt, weil dieselbe
 *  Variable das Testversion-Band ueber dem Kundenpanel einschaltet (siehe start-quota.ts). */
export function sandboxBetrieb(): boolean {
  return process.env.PANEL_SANDBOX === "true";
}

export function testmodusMoeglich(): boolean {
  return sandboxBetrieb() && Boolean(process.env.PANEL_TEST_KEY);
}

function schluesselStimmt(eingabe: string): boolean {
  const soll = process.env.PANEL_TEST_KEY ?? "";
  if (!soll || !eingabe) return false;
  const a = Buffer.from(eingabe);
  const b = Buffer.from(soll);
  // timingSafeEqual verlangt gleiche Laenge - die Laenge selbst ist kein Geheimnis.
  return a.length === b.length && timingSafeEqual(a, b);
}

export function istTestkunde(c: CustomerRow | undefined | null): boolean {
  return Boolean(c && (c as { status?: string }).status === "test");
}

/** Alle Tabellen mit einer customer_id - einmal beim Start ermittelt, nicht fest verdrahtet,
 *  damit eine spaeter dazukommende Tabelle beim Zuruecksetzen nicht vergessen wird. */
function tabellenMitKunde(): string[] {
  const namen = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  return namen.filter((n) => (db.prepare(`PRAGMA table_info(${n})`).all() as { name: string }[]).some((c) => c.name === "customer_id"));
}

/** Loescht einen Testkunden restlos. Wirft, wenn der Kunde KEIN Testkunde ist - diese Funktion
 *  darf unter keinen Umstaenden einen echten Kunden anfassen. */
export function testkundeLoeschen(customerId: string): void {
  const row = db.prepare("SELECT id, status FROM customers WHERE id = ?").get(customerId) as { id: string; status: string } | undefined;
  if (!row) return;
  if (row.status !== "test") throw new Error(`Abgelehnt: ${customerId} ist kein Testkunde (status=${row.status}).`);
  logoDateiWeg(customerId);
  const loeschen = db.transaction(() => {
    for (const tabelle of tabellenMitKunde()) db.prepare(`DELETE FROM ${tabelle} WHERE customer_id = ?`).run(customerId);
    db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
  });
  loeschen();
}

/**
 * Setzt ein angemeldetes Sandbox-Konto auf Anfang: alles, was aus der Website-Analyse und der
 * Planung entstanden ist, faellt weg, der Kunde und seine Sitzung bleiben (Auftrag 19.09.2026).
 *
 * Bewusst NICHT geloescht: `sessions` (sonst fliegt der Angemeldete raus statt neu anzufangen),
 * `connections` und `oauth_states` (die Kanalverbindungen sind nicht Teil der Woche, und in der
 * Sandbox liessen sie sich gar nicht neu herstellen).
 *
 * Nur Sandbox. Der Aufrufer prueft das; hier steht die Sperre trotzdem noch einmal, weil diese
 * Funktion Kundendaten wegwirft und niemals aus Versehen in Produktion laufen darf.
 */
const NICHT_LOESCHEN = new Set(["sessions", "connections", "oauth_states"]);

export function kontoZuruecksetzen(customerId: string): void {
  if (!sandboxBetrieb()) throw new Error("Abgelehnt: Zuruecksetzen gibt es nur in der Sandbox.");
  const row = db.prepare("SELECT id FROM customers WHERE id = ?").get(customerId) as { id: string } | undefined;
  if (!row) throw new Error(`Abgelehnt: ${customerId} gibt es nicht.`);
  logoDateiWeg(customerId);
  const zuruecksetzen = db.transaction(() => {
    for (const tabelle of tabellenMitKunde()) {
      if (NICHT_LOESCHEN.has(tabelle)) continue;
      db.prepare(`DELETE FROM ${tabelle} WHERE customer_id = ?`).run(customerId);
    }
    // Alles, was die Website-Analyse gesetzt hat, zurueck auf den Zustand direkt nach dem
    // Anlegen. `tour_done_at = NULL` ist der Schalter, der die Oberflaeche wieder bei der
    // Website-Frage beginnen laesst (siehe boot() in start.js).
    db.prepare(
      `UPDATE customers SET tour_done_at = NULL, website = NULL, industry = NULL, about = NULL,
         tone = 'sachlich', custom_hashtags = NULL, avoid_topics = NULL, watermark_text = NULL,
         accent_color = NULL, gradient_color2 = NULL, gradient_enabled = 0, gradient_direction = 'diagonal',
         detected_logo_url = NULL, detected_logo_tile = 0,
         branding_last_changed_at = NULL, skipped_providers = NULL, customer_paused = 0, updated_at = ?
       WHERE id = ?`,
    ).run(nowIso(), customerId);
  });
  zuruecksetzen();
  console.log(`[testmodus] Sandbox-Konto zurueckgesetzt: ${customerId}`);
}

export function alteTestkundenAufraeumen(now: number = Date.now()): number {
  const alt = db.prepare("SELECT id FROM customers WHERE status = 'test' AND created_at < ?").all(new Date(now - TEST_TTL_MS).toISOString()) as { id: string }[];
  for (const k of alt) testkundeLoeschen(k.id);
  return alt.length;
}

/** Frischer Testkunde: wie ein neuer Kunde, aber als bestaetigt gefuehrt, damit weder eine
 *  Bestaetigungsmail noetig ist noch das Bilderbudget fuer Unbestaetigte greift. */
export function testkundeAnlegen(trialDays: number): CustomerRow {
  const id = `cus_test_${randomToken(8)}`;
  const now = nowIso();
  const email = `testlauf+${randomToken(6)}@sandbox.invalid`;
  db.prepare(
    `INSERT INTO customers (id, status, company, contact_name, email, tone, frequency, post_time, cta_preference, trial_ends_at,
       ig_feed_enabled, ig_story_enabled, linkedin_enabled, hashtag_pref, emojis_enabled, language,
       approval_mode, ui_mode, email_verified, login_key_hash, consent_at, created_at, updated_at)
     VALUES (?, 'test', 'Testlauf', 'Testlauf', ?, 'sachlich', 'werktags', '15:00', 'link_bio', ?, 1, 0, 1, 'wenige', 1, 'de', 1, 'easy', 1, ?, ?, ?, ?)`,
  ).run(id, email, new Date(Date.now() + trialDays * 86_400_000).toISOString(), sha256(randomToken()), now, now, now);
  console.log(`[testmodus] Frischer Testlauf: ${id}`);
  return kundeLaden(id);
}

export interface TestmodusKontext {
  mountFor(req: Request): string;
  clientIp(req: Request): string;
  rateLimited(key: string, max: number, windowMs: number): boolean;
  startSession(res: Response, customerId: string, req: Request): void;
  endSession(res: Response, req: Request): void;
  publicState(c: CustomerRow): unknown;
  trialDays(): number;
  currentCustomer(req: Request): CustomerRow | undefined;
}

export function registerTestmodeRoutes(router: Router, ctx: TestmodusKontext): void {
  // ---------- Einstieg: ein Klick, frischer Durchlauf ----------
  router.get("/start/test", (req, res, next) => {
    if (!testmodusMoeglich()) return next();
    if (ctx.rateLimited(`testmode:${ctx.clientIp(req)}`, 60, 3_600_000)) {
      res.status(429).type("text/plain").send("Zu viele Testlaeufe in kurzer Zeit.");
      return;
    }
    const key = typeof req.query.key === "string" ? req.query.key : "";
    if (!schluesselStimmt(key)) return next();
    alteTestkundenAufraeumen();
    // Ein laufender Testkunde wird beim Einstieg weggeraeumt, damit "nochmal von vorne" auch
    // ueber den Link funktioniert und nicht nur ueber den Knopf.
    const bisher = ctx.currentCustomer(req);
    if (istTestkunde(bisher)) testkundeLoeschen(bisher!.id);
    const neu = testkundeAnlegen(ctx.trialDays());
    ctx.startSession(res, neu.id, req);
    // Der Schluessel darf nicht in der Adresszeile stehenbleiben - Screenshots, Verlauf, Beamer.
    res.redirect(303, `${ctx.mountFor(req)}/start/`);
  });

  // ---------- Zuruecksetzen: ein Klick, wieder von vorne ----------
  // Der Einstieg braucht einen Schluessel, das Zuruecksetzen nicht: wer hier ankommt, ist
  // bereits angemeldet. Nur die Sandbox-Bedingung gilt - in Produktion existiert die Route nicht.
  router.post("/api/start/test/reset", (req, res) => {
    if (!sandboxBetrieb()) {
      res.status(404).json({ error: "Nicht gefunden." });
      return;
    }
    const c = ctx.currentCustomer(req);
    if (!c) {
      res.status(401).json({ error: "Bitte melde dich zuerst an." });
      return;
    }
    // Zwei Faelle, ein Knopf. Testlauf: der Wegwerfkunde wird ersetzt. Angemeldetes
    // Sandbox-Konto: der Kunde bleibt samt Sitzung, nur seine Woche und alles aus der
    // Website-Analyse fallen weg (Auftrag 19.09.2026).
    if (istTestkunde(c)) {
      testkundeLoeschen(c.id);
      const frisch = testkundeAnlegen(ctx.trialDays());
      ctx.startSession(res, frisch.id, req);
      res.json({ status: "reset", art: "testlauf", ...(ctx.publicState(frisch) as object) });
      return;
    }
    kontoZuruecksetzen(c.id);
    const wieder = db.prepare("SELECT * FROM customers WHERE id = ?").get(c.id) as CustomerRow;
    res.json({ status: "reset", art: "konto", ...(ctx.publicState(wieder) as object) });
  });

  // ---------- Testlauf beenden ----------
  router.post("/api/start/test/end", (req, res) => {
    if (!testmodusMoeglich()) {
      res.status(404).json({ error: "Nicht gefunden." });
      return;
    }
    const c = ctx.currentCustomer(req);
    if (!istTestkunde(c)) {
      res.status(403).json({ error: "Das geht nur in einem Testlauf." });
      return;
    }
    testkundeLoeschen(c!.id);
    ctx.endSession(res, req);
    res.json({ status: "ended" });
  });
}
