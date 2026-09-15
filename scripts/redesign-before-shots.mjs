#!/usr/bin/env node
/**
 * Vorher-Screenshots des ALTEN Panels (public/panel/index.html, Tag pre-redesign).
 * Läuft gegen einen lokalen Static-Server im Demo-Modus - beruehrt weder Produktion noch die
 * Sandbox und braucht keine Kundendaten (mockApi liefert die Beispieldaten).
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const outDir = process.argv[2] || "docs/redesign/before";
const widths = (process.argv.slice(3).length ? process.argv.slice(3) : ["390", "1440"]).map(Number);
const html = readFileSync("public/panel/index.html", "utf8");

// Das alte Panel leitet seinen Mount aus dem Pfad ab ("/panel"), deshalb genau dort ausliefern.
const server = createServer((req, res) => {
  if (req.url.startsWith("/panel")) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(8811, "127.0.0.1", r));
const BASE = "http://127.0.0.1:8811/panel";

async function seedDemoCustomer(page) {
  // Demo-Modus startet ohne Kunden -> Onboarding einmal durchklicken, damit Übersicht,
  // Vorschau, Verlauf und Einstellungen ueberhaupt erreichbar sind.
  await page.fill("#f-company", "Praxis Sonnenschein");
  await page.fill("#f-contactName", "Andrea Muster");
  await page.fill("#f-email", "demo@example.invalid");
  // Seite 1 -> 2 ueber den Seitenwechsel-Button (nicht ueber den Namen: "Weiter: Ihr Stil" und
  // "Weiter zu Instagram" sind beides Buttons mit "Weiter" im Text).
  const next = page.locator("[data-formpart]").first();
  if (await next.isVisible().catch(() => false)) { await next.click(); await page.waitForTimeout(600); }
  const consent = page.locator('[name=consent]');
  if (await consent.count()) await consent.check().catch(() => {});
  const submit = page.locator('#company button[type=submit]').first();
  if (await submit.isVisible().catch(() => false)) { await submit.click(); await page.waitForTimeout(1200); }
  // Im Demo-Modus legt ein Klick auf "Verbinden" eine fingierte Verbindung an (demoConnect) -
  // ohne mindestens eine Verbindung zeigt das alte Panel die Übersicht gar nicht erst an.
  // Nach dem Klick zeigt das Panel kurz eine "Weiterleitung zu …"-Overlay-Schicht, die weitere
  // Klicks abfaengt - daher grosszuegig warten und Fehler tolerieren.
  for (let i = 0; i < 3; i++) {
    const connect = page.locator("[data-connect]:visible").first();
    if (!(await connect.count())) break;
    await connect.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1600);
  }
}

for (const width of widths) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 2,
    isMobile: width < 500, hasTouch: width < 500,
  })).newPage();

  console.log(`Breite ${width}:`);
  await page.goto(`${BASE}/?demo`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1900);
  await page.screenshot({ path: `${outDir}/01-onboarding-${width}.png`, fullPage: true });
  console.log(`   ${outDir}/01-onboarding-${width}.png`);

  await seedDemoCustomer(page);
  for (const [step, name] of [
    ["dashboard", "02-uebersicht"],
    ["preview", "03-vorschau-7-tage"],
    ["history", "04-verlauf"],
    ["analytics", "05-analytics"],
    ["settings", "06-einstellungen"],
    ["guide", "07-was-kann-pipeflow"],
  ]) {
    const link = page.locator(`[data-go="${step}"]:visible`).first();
    if (!(await link.count())) { console.log(`   (übersprungen: ${name})`); continue; }
    await link.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${outDir}/${name}-${width}.png`, fullPage: true });
    console.log(`   ${outDir}/${name}-${width}.png`);
  }
  await browser.close();
}
server.close();
console.log("fertig");
