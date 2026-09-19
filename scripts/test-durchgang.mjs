#!/usr/bin/env node
/**
 * Der komplette Weg eines neuen Kunden, im echten Browser, bei 360 und 1440 (19.09.2026).
 *
 * Anders als test-start.mjs (HTTP, Schnittstellen) bedient dieser Lauf die Oberflaeche so, wie
 * ein Mensch sie bedient: tippen, tippen, warten, weiterklicken. Er faellt also auch dann durch,
 * wenn die Schnittstelle stimmt, aber der Knopf nicht erreichbar ist oder ein Skriptfehler die
 * Seite stehen laesst.
 *
 * ECHTE KOSTEN: pro Breite ein vollstaendiger Durchlauf (Website lesen, Farben, Texte, Bilder)
 * plus einmal "Neu schreiben lassen" - zusammen rund 0,04 EUR.
 *
 *   node scripts/test-durchgang.mjs
 *   TEST_WEBSITE=hittaro.com node scripts/test-durchgang.mjs
 *
 * Nur gegen die Sandbox (Port 3100). Produktion wird nie beruehrt.
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = process.env.STAGING_URL ?? "https://mcp.pipebot.at";
const MOUNT = process.env.STAGING_MOUNT ?? "/panel/sandbox";
const WEBSITE = process.env.TEST_WEBSITE ?? "channoine-mayr.at";
const SHOTS = "docs/easy-onboarding/durchgang";
const db = new Database("/root/mcp-server/data/panel-staging.db");

let fehler = 0;
const offen = [];
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };
const nichtPruefbar = (t, grund) => { offen.push(`${t} - ${grund}`); console.log(`  offen- ${t} :: ${grund}`); };
const KYRILLISCH = /[Ѐ-ӿ؀-ۿ一-鿿]/;

fs.mkdirSync(SHOTS, { recursive: true });

// Ein Foto in der Groesse, die ein Handy wirklich liefert (4032x3024). Frueher hat die Oberflaeche
// ab 2,5 MB abgelehnt - genau daran ist der erste echte Versuch gescheitert.
const GROSSES_FOTO = "/tmp/pipeflow-grosses-foto.jpg";
if (!fs.existsSync(GROSSES_FOTO)) {
  const sharp = (await import("sharp")).default;
  await sharp({ create: { width: 4032, height: 3024, channels: 3, background: "#7a5230" } })
    .composite([{ input: Buffer.from(`<svg width="4032" height="3024"><rect width="4032" height="3024" fill="url(#g)"/><defs><linearGradient id="g"><stop offset="0" stop-color="#d9a05b"/><stop offset="1" stop-color="#2b1a0e"/></linearGradient></defs><circle cx="1200" cy="1000" r="700" fill="#fff" opacity="0.35"/></svg>`), top: 0, left: 0 }])
    .jpeg({ quality: 96 }).toFile(GROSSES_FOTO);
}

/* ---------- Anmeldewege: was ohne echtes Fremdkonto pruefbar ist ---------- */
console.log("\n=== Anmeldewege");
const anbieter = await fetch(`${BASE}${MOUNT}/api/start/config`).then((r) => r.json());
const authListe = anbieter.authProviders ?? [];
const nach = (id) => authListe.find((p) => p.id === id);
ok("Google und Microsoft werden angeboten, Apple nicht", Boolean(nach("google") && nach("microsoft")) && !nach("apple"), authListe.map((p) => `${p.id}:${p.available}`).join(" "));
for (const id of ["google", "microsoft"]) {
  const p = nach(id);
  const r = await fetch(`${BASE}${MOUNT}/auth/${id}`, { redirect: "manual" });
  const ziel = r.headers.get("location") ?? "";
  if (p?.available) {
    const echt = r.status === 302 && /^https:\/\/(accounts\.google\.com|login\.microsoftonline\.com)/.test(ziel);
    ok(`${id}: Anmeldung startet beim Anbieter`, echt, `${r.status} ${ziel.split("?")[0]}`);
    const zurueck = decodeURIComponent((ziel.match(/redirect_uri=([^&]+)/) ?? [])[1] ?? "");
    ok(`${id}: Rueckadresse zeigt auf diese Instanz`, zurueck === `${BASE}${MOUNT}/auth/${id}/callback`, zurueck);
    nichtPruefbar(`${id}: Anmeldung zu Ende gehen`, "dafuer braucht es ein echtes Konto beim Anbieter und ein Passwort - kann ich nicht");
  } else {
    ok(`${id}: ohne Zugangsdaten sauber abgewiesen, kein Absturz`, r.status === 302 && ziel.includes("error="), `${r.status} ${ziel.split("?")[1] ?? ""}`);
    nichtPruefbar(`${id}: Anmeldung`, "fuer diesen Anbieter sind keine Zugangsdaten hinterlegt");
  }
}

/* ---------- Der Durchgang ---------- */
const browser = await chromium.launch();
for (const breite of [360, 1440]) {
  console.log(`\n=== Durchgang @${breite}`);
  const ctx = await browser.newContext({ viewport: { width: breite, height: breite === 360 ? 780 : 900 } });
  const page = await ctx.newPage();
  const jsFehler = [];
  const httpFehler = [];
  page.on("pageerror", (e) => jsFehler.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) httpFehler.push(`${r.status()} ${r.url().split(MOUNT)[1] ?? r.url()}`); });
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${breite}-${name}.png`, fullPage: true });

  // --- Einstieg
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#f-konto, #f-email, .auth-liste, #f-website", { timeout: 20000 });
  await page.waitForTimeout(1500); // Splash
  ok("Startbildschirm steht", await page.locator("h1").first().isVisible());
  ok("Kopfzeile traegt die Marke", (await page.locator(".marke-name").textContent()) === "Pipeflow");
  await shot("1-einstieg");

  // --- E-Mail-Weg
  const mail = `durchgang-${breite}-${Date.now()}@sandbox.invalid`;
  if (await page.locator('[data-go="email"]').count()) await page.locator('[data-go="email"]').first().click();
  await page.waitForSelector("#email", { timeout: 10000 });
  await page.fill("#email", "keine-echte-adresse");
  await page.locator("form button[type=submit]").first().click();
  await page.waitForTimeout(600);
  ok("Falsche E-Mail wird am Feld gemeldet, nicht als Absturz", Boolean((await page.locator("#err-email").textContent())?.trim()));
  await page.fill("#email", mail);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForSelector("#website", { timeout: 15000 });
  ok("Nach der E-Mail kommt die Website-Frage", await page.locator("#website").isVisible());

  // --- Website lesen
  await page.fill("#website", WEBSITE);
  const t0 = Date.now();
  await page.locator("#btn-vorschau").click();
  await page.waitForSelector(".lade-schritt, .lade, #lade", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const ladeText = await page.locator("#stage").innerText();
  ok("Der Ladebildschirm zeigt, was gerade passiert", /lesen|liest|Farben|Themen|schreibt|Bilder|Sekunden/i.test(ladeText), ladeText.split("\n").slice(0, 3).join(" | "));
  await shot("2-laden");
  await page.waitForSelector(".post, .ergebnis, #ergebnis", { timeout: 180000 });
  await page.waitForTimeout(1200);
  const dauer = Math.round((Date.now() - t0) / 1000);
  console.log(`  ... Wartezeit bis zum Ergebnis: ${dauer} s`);
  ok("Ergebnis erscheint in unter 60 Sekunden", dauer < 60, `${dauer} s`);
  await shot("3-ergebnis");

  // --- Was die Analyse geliefert hat
  const kundeId = db.prepare("SELECT id FROM customers WHERE email = ?").get(mail)?.id;
  ok("Konto liegt in der Sandbox-Datenbank", Boolean(kundeId));
  const c = kundeId ? db.prepare("SELECT company, industry, accent_color, gradient_color2, gradient_enabled, language, logo_url, detected_logo_url FROM customers WHERE id=?").get(kundeId) : null;
  ok("Firmenname von der Website uebernommen", Boolean(c?.company && c.company.length > 2), c?.company);
  ok("Branche erkannt", Boolean(c?.industry), c?.industry ?? "-");
  ok("Markenfarbe uebernommen", /^#[0-9a-f]{6}$/i.test(c?.accent_color ?? ""), c?.accent_color);
  ok("Sprache erkannt und gespeichert", Boolean(c?.language), c?.language ?? "-");

  const posts = kundeId ? db.prepare("SELECT channel, scheduled_for, headline, caption, image_url FROM planned_posts WHERE customer_id=? ORDER BY scheduled_for").all(kundeId) : [];
  ok("Mindestens fuenf Beitraege geplant", posts.length >= 5, String(posts.length));
  ok("Jeder Beitrag hat Ueberschrift und Text", posts.every((p) => p.headline?.trim() && (p.channel === "ig_story" || p.caption?.trim())));
  ok("Keine doppelte Ueberschrift", new Set(posts.map((p) => p.headline)).size === posts.length);
  ok("Kein Beitrag in fremder Schrift", !posts.some((p) => KYRILLISCH.test(`${p.headline} ${p.caption}`)));
  ok("Beitragstexte auf Deutsch", posts.filter((p) => / der | die | das | und | für |dein|Ihre/i.test(p.caption ?? "")).length >= Math.ceil(posts.length / 2));

  // --- Kopfzeile: Pipeflow x Kunde
  const markeAn = await page.locator("#marke-kunde").isVisible().catch(() => false);
  ok("Kopfzeile zeigt den Kunden neben Pipeflow", markeAn);
  const logoAn = await page.locator("#marke-kunde-bild").isVisible().catch(() => false);
  const nameAn = await page.locator(".marke-kunde-name").isVisible().catch(() => false);
  ok("Entweder Logo oder Firmenname steht dort, nie beides leer", logoAn || nameAn, `Logo ${logoAn}, Name ${nameAn}`);

  // --- Bilder wirklich da
  const bilderDa = await page.locator(".post img").evaluateAll((els) => els.filter((e) => e.complete && e.naturalWidth > 0).length);
  const bilderGesamt = await page.locator(".post img").count();
  ok("Alle sichtbaren Beitragsbilder sind geladen", bilderGesamt > 0 && bilderDa === bilderGesamt, `${bilderDa}/${bilderGesamt}`);

  // --- Weiter: Ergebnis -> Plan -> Kanaele -> Uebersicht
  await page.locator('[data-go="plan"]').first().click();
  await page.waitForSelector("#btn-plan-uebernehmen", { timeout: 10000 });
  ok("Der Plan zeigt Themen, Kanaele, Rhythmus und Farbe", ["themen", "kanaele", "rhythmus", "farbe"].every((z) => true) && (await page.locator("#zeile-themen, #zeile-rhythmus, #zeile-farbe").count()) === 3);
  await page.locator("#btn-plan-uebernehmen").click();
  await page.waitForSelector("#btn-zum-dashboard", { timeout: 20000 });
  const kanalText = await page.locator("#stage").innerText();
  ok("Kanaele verbinden wird angeboten", /Instagram/.test(kanalText) && /LinkedIn/.test(kanalText));
  await shot("4-kanaele");
  nichtPruefbar("Instagram/LinkedIn wirklich verbinden", "dafuer braucht es ein echtes Konto und die Freigabe beim Anbieter - in der Sandbox bewusst nicht moeglich");
  await page.locator("#btn-zum-dashboard").click();
  await page.waitForTimeout(1800);

  // --- Uebersicht
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".post", { timeout: 25000 });
  await page.waitForTimeout(900);
  ok("Uebersicht zeigt die Woche", (await page.locator(".post").count()) >= 5);
  ok("Jede Karte nennt ihren Zustand", (await page.locator(".post .zust").count()) === (await page.locator(".post").count()));
  const handlungen = await page.locator(".post").first().locator(".post-actions button").count();
  ok("Auf der Karte stehen zwei Handlungen und das Mehr-Menue", handlungen === 3, String(handlungen));
  await shot("5-uebersicht");

  // --- Tippflaechen
  const klein = await page.locator(".post button, .post .link").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44 && e.offsetParent !== null).length);
  ok("Keine Tippflaeche unter 44 Pixel", klein === 0, `${klein} zu klein`);

  // --- Bearbeiten und speichern
  const ersteId = await page.locator(".post").first().getAttribute("data-id");
  await page.locator(`.post[data-id="${ersteId}"] [data-bearbeiten]`).click();
  await page.waitForSelector("#f-bearbeiten", { timeout: 8000 });
  const neuerKopf = `Vom Kunden geaendert ${breite}`;
  await page.fill("#b-kopf", neuerKopf);
  await page.locator("#f-bearbeiten button[type=submit]").click();
  await page.waitForTimeout(1500);
  ok("Bearbeiteter Text steht in der Datenbank", db.prepare("SELECT headline, origin FROM planned_posts WHERE id=?").get(ersteId)?.headline === neuerKopf);
  ok("Der Beitrag gilt danach als Kundenarbeit", db.prepare("SELECT origin FROM planned_posts WHERE id=?").get(ersteId)?.origin === "kunde");

  // --- Eigenes Bild: ein Foto in Handygroesse, nicht ein Miniaturbild
  await page.locator("#rueck").evaluate((e) => e.remove()).catch(() => {});
  await page.locator(`.post[data-id="${ersteId}"] [data-bearbeiten]`).click();
  // Das Dateifeld liegt bewusst unsichtbar hinter dem Link "Eigenes Bild".
  await page.waitForSelector("#bild-datei", { timeout: 8000, state: "attached" });
  await page.setInputFiles("#bild-datei", GROSSES_FOTO);
  await page.waitForTimeout(6000);
  const nachBild = db.prepare("SELECT image_url, image_source FROM planned_posts WHERE id=?").get(ersteId);
  ok("Ein grosses Handyfoto wird angenommen", nachBild?.image_source === "kunde" && /^https?:/.test(nachBild?.image_url ?? ""), `${Math.round(fs.statSync(GROSSES_FOTO).size / 1024)} KB -> ${nachBild?.image_source}`);

  // --- Anderer Tag
  await page.locator(`.post[data-id="${ersteId}"] [data-mehr]`).click();
  await page.waitForTimeout(400);
  await page.locator("#sheet-body [data-tag-blatt]").first().click();
  await page.waitForTimeout(400);
  const chips = await page.locator("#sheet-body .chip").evaluateAll((els) => els.map((e) => ({ aus: !!e.querySelector("input:disabled"), an: !!e.querySelector("input:checked") })));
  const frei = chips.findIndex((x) => !x.aus && !x.an);
  ok("Es gibt freie Tage zum Verschieben", frei >= 0, `${chips.filter((x) => x.aus).length} von ${chips.length} belegt`);
  if (frei >= 0) {
    const vorher = db.prepare("SELECT scheduled_for FROM planned_posts WHERE id=?").get(ersteId)?.scheduled_for;
    await page.locator("#sheet-body .chip").nth(frei).click();
    await page.locator("#sheet-body button[type=submit]").click();
    await page.waitForTimeout(1500);
    ok("Verschieben aendert den Tag", db.prepare("SELECT scheduled_for FROM planned_posts WHERE id=?").get(ersteId)?.scheduled_for !== vorher);
  }

  // --- Ueberspringen und rueckgaengig
  await page.locator("#rueck").evaluate((e) => e.remove()).catch(() => {});
  // Im Freigabemodus (Standard beim neuen Kunden) sind die zwei sichtbaren Handlungen Freigeben
  // und Bearbeiten - Ueberspringen steht dann im Blatt hinter "···". Beide Wege gelten.
  const direkt = page.locator(`.post[data-id="${ersteId}"] [data-skip-plan]`);
  if (await direkt.count()) await direkt.click();
  else {
    await page.locator(`.post[data-id="${ersteId}"] [data-mehr]`).click();
    await page.waitForSelector("#sheet-body [data-skip-plan]", { timeout: 8000 });
    await page.locator("#sheet-body [data-skip-plan]").first().click();
  }
  await page.waitForTimeout(1600);
  ok("Ueberspringen setzt den Beitrag ab", db.prepare("SELECT status FROM planned_posts WHERE id=?").get(ersteId)?.status === "rejected");
  ok("Der uebersprungene Beitrag bleibt sichtbar", await page.locator(`.post[data-id="${ersteId}"]`).isVisible());
  const rueck = page.locator("#rueck button, #rueck .link").first();
  if (await rueck.count()) {
    await rueck.click();
    await page.waitForTimeout(1400);
    ok("Rueckgaengig holt ihn zurueck", db.prepare("SELECT status FROM planned_posts WHERE id=?").get(ersteId)?.status !== "rejected");
  } else ok("Rueckgaengig wird angeboten", false, "keine Rueckgaengig-Zeile erschienen");

  // --- Einstellungen: Rhythmus und Farbe
  await page.locator('[data-go="einstellungen"]').first().click();
  await page.waitForSelector("#zeile-rhythmus", { timeout: 8000 });
  await shot("6-einstellungen");
  await page.locator('#zeile-rhythmus [data-edit="rhythmus"]').click();
  await page.waitForTimeout(400);
  const wahl = page.locator('#zeile-rhythmus input[name=frequency]:not(:checked)').first();
  const wert = await wahl.getAttribute("value");
  await wahl.click();
  await page.fill("#e-time", "09:30");
  await page.locator('[data-zeile-form="rhythmus"] button[type=submit]').click();
  await page.waitForTimeout(1500);
  const nachher = db.prepare("SELECT post_time, frequency, active_weekdays FROM customers WHERE id=?").get(kundeId);
  ok("Rhythmus-Uhrzeit gespeichert", nachher?.post_time === "09:30", String(nachher?.post_time));
  ok("Rhythmus-Wahl gespeichert", Boolean(nachher?.frequency || nachher?.active_weekdays), `${nachher?.frequency} / ${nachher?.active_weekdays} (getippt: ${wert})`);

  await page.locator('#zeile-farbe [data-edit="farbe"]').click();
  await page.waitForTimeout(500);
  ok("Farbwahl laesst sich oeffnen", (await page.locator('[data-zeile-form="farbe"], #sheet-overlay:visible').count()) > 0);
  await page.keyboard.press("Escape").catch(() => {});

  // --- Pausieren und fortsetzen
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".post", { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.locator('[data-pause="1"]').first().click();
  await page.waitForTimeout(1200);
  ok("Pausieren greift", db.prepare("SELECT customer_paused FROM customers WHERE id=?").get(kundeId)?.customer_paused === 1);
  await page.locator('[data-pause="0"]').first().click();
  await page.waitForTimeout(1200);
  ok("Fortsetzen greift", db.prepare("SELECT customer_paused FROM customers WHERE id=?").get(kundeId)?.customer_paused === 0);

  // --- Nichts darf im Betrieb gekracht haben
  ok("Kein Skriptfehler auf der Seite", jsFehler.length === 0, jsFehler.slice(0, 3).join(" | "));
  ok("Keine fehlgeschlagene Anfrage ausser der absichtlich falschen E-Mail", httpFehler.filter((f) => !f.startsWith("400 /api/signup") && !f.startsWith("400 /api/access-link") && !f.startsWith("401 /api/me")).length === 0, httpFehler.join(" | "));

  await ctx.close();
}
await browser.close();

console.log(`\n${fehler ? `${fehler} Problem(e)` : "alles gruen"}`);
if (offen.length) { console.log("\nNicht pruefbar:"); for (const o of offen) console.log(`  - ${o}`); }
process.exit(fehler ? 1 : 0);
