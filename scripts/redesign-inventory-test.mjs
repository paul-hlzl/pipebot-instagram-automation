#!/usr/bin/env node
/**
 * Prueft die uebernommenen Bausteine aus docs/redesign/INVENTUR.md, die beim Redesign nicht
 * umgebaut wurden - genau die, bei denen ein stiller Verlust am wahrscheinlichsten waere.
 * Nur Sandbox + Testkunden.
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const BASE = "https://mcp.pipebot.at/panel/sandbox";
const KEY = "cJaCXkVjls9umce3x9Pvg-KA3Q29eBWU";

let fails = 0;
const ok = (c, m, d) => { if (!c) fails++; console.log(`  ${c ? "ok " : "FAIL"} - ${m}${!c && d ? ` :: ${d}` : ""}`); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/login?key=${KEY}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1700);
const tour = page.getByText("Rundgang beenden");
if (await tour.isVisible().catch(() => false)) { await tour.click(); await page.waitForTimeout(400); }

console.log("Lightbox:");
await page.goto(`${BASE}/#beitraege/geplant`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const media = page.locator(".card-media[data-lightbox]").first();
if (await media.count()) {
  await media.click();
  await page.waitForTimeout(500);
  ok(await page.locator("#lightbox:visible").count() > 0, "Lightbox öffnet aus der Beitragskarte");
  await page.locator(".lightbox-close").click();
  await page.waitForTimeout(400);
  ok(await page.locator("#lightbox:visible").count() === 0, "Lightbox schließt");
} else ok(false, "kein Beitragsbild zum Testen gefunden");

console.log("\nEinstellungen — übernommene Bausteine:");
await page.goto(`${BASE}/#einstellungen/inhalt`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const pillarsBefore = await page.locator("[data-pillar-index]").count();
const addPillar = page.getByRole("button", { name: /Säule hinzufügen|\+ Säule/i }).first();
if (await addPillar.isVisible().catch(() => false)) {
  await addPillar.click();
  await page.waitForTimeout(500);
  ok(await page.locator("[data-pillar-index]").count() === pillarsBefore + 1, "Content-Säule hinzufügen");
  const removed = page.locator("[data-pillar-remove]").last();
  await removed.click();
  await page.waitForTimeout(500);
  ok(await page.locator("[data-pillar-index]").count() === pillarsBefore, "Content-Säule entfernen");
} else ok(false, "Button „Säule hinzufügen“ nicht gefunden");

await page.goto(`${BASE}/#einstellungen/aussehen`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const swatch = page.locator("[data-swatch]").nth(2);
if (await swatch.count()) {
  const before = await page.inputValue("#f-accentColor");
  await swatch.click();
  await page.waitForTimeout(400);
  const after = await page.inputValue("#f-accentColor");
  ok(after !== before || after === (await swatch.getAttribute("data-swatch")), "Farb-Swatch setzt die Akzentfarbe", `${before} -> ${after}`);
  const preview = page.locator(".lp-square").first();
  ok(await preview.count() > 0, "Live-Vorschau des Beitragsbilds vorhanden");
} else ok(false, "keine Farb-Swatches gefunden");

await page.goto(`${BASE}/#einstellungen/kanaele`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const weekday = page.locator('[data-weekday-channel="instagram"] input').first();
if (await weekday.count()) {
  const was = await weekday.isChecked();
  await weekday.click({ force: true });
  await page.waitForTimeout(300);
  ok((await weekday.isChecked()) !== was, "Wochentag-Schalter reagiert");
  await weekday.click({ force: true });
} else ok(false, "keine Wochentag-Schalter gefunden");

console.log("\nKonto und Hilfe:");
await page.goto(`${BASE}/#einstellungen/konto`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
ok(await page.locator("#mklink").count() > 0, "Persönlichen Zugangslink erzeugen vorhanden");
ok(await page.locator("#delete-account").count() > 0, "Konto löschen vorhanden");

await page.goto(`${BASE}/#hilfe`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
ok(await page.locator("#help-chat-form:visible").count() > 0, "Hilfe-Chat öffnet über #hilfe");
ok(await page.locator("[data-chat-starter]").count() > 0, "Chat zeigt Startvorschläge");

ok(errors.length === 0, "keine unbehandelten Fehler", errors.join(" | "));
await browser.close();
console.log(fails ? `\n${fails} Probleme` : "\nalles grün");
process.exit(fails ? 1 : 0);
