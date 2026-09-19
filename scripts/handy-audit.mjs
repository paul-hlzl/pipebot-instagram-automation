#!/usr/bin/env node
/**
 * Handy-Durchgang (Auftrag Punkt 3) plus Nachweis fuer den Licht-Hintergrund (Punkt 2).
 * Laeuft denselben Weg bei 360 und 1440 px und misst je Bildschirm, was sich am Handy
 * schlechter anfuehlen kann: Scroll-Laenge, Zeilenlaenge, Groesse der Beitragskarte,
 * kleinste Tap-Flaeche. Zusaetzlich werden echte Pixel aus dem Screenshot gelesen, um
 * Textkontrast und die Abhebung der Karten gegen den Lichtverlauf zu belegen.
 *
 *   node scripts/handy-audit.mjs [ziel-ordner]
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";

const BASE = process.env.SANDBOX_URL ?? "https://mcp.pipebot.at/panel/sandbox";
const WEBSITE = process.env.TEST_WEBSITE ?? "hittaro.com";
const outDir = process.argv[2] || "docs/easy-onboarding/handy";
mkdirSync(outDir, { recursive: true });
const STAGING_DB = "/root/mcp-server/data/panel-staging.db";
const { default: Database } = await import("better-sqlite3");
const db = new Database(STAGING_DB);
const email = `handy-${Date.now()}@example.invalid`;
let customerId = null;

const leuchte = ([r, g, b]) => { const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const kontrast = (a, b) => { const [h, d] = [leuchte(a), leuchte(b)].sort((x, y) => y - x); return Math.round(((h + 0.05) / (d + 0.05)) * 10) / 10; };
async function pixel(datei, x, y) {
  const { data } = await sharp(datei).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}

const zeilen = [];
async function messen(page, name, breite, datei) {
  const m = await page.evaluate(() => {
    const vh = window.innerHeight;
    const text = [...document.querySelectorAll("#stage p, #stage h1, #stage li, #stage .zeile-v")].filter((e) => e.offsetParent);
    // Zeichen pro Zeile: grober Lesbarkeitswert (ideal 45-75 im Fliesstext)
    const proZeile = text.map((e) => {
      const st = getComputedStyle(e);
      const zeichenBreite = parseFloat(st.fontSize) * 0.5;
      return Math.round(e.getBoundingClientRect().width / zeichenBreite);
    });
    const karte = document.querySelector("#stage .post");
    const bild = document.querySelector("#stage .media");
    const ziele = [...document.querySelectorAll("#stage button, #stage a.btn, #stage a.auth-btn, #stage .stift")].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height));
    return {
      seitenhoehe: Math.round(document.documentElement.scrollHeight),
      bildschirme: Math.round((document.documentElement.scrollHeight / vh) * 10) / 10,
      maxZeile: proZeile.length ? Math.max(...proZeile) : 0,
      karteBreite: karte ? Math.round(karte.getBoundingClientRect().width) : 0,
      bildHoehe: bild ? Math.round(bild.getBoundingClientRect().height) : 0,
      kleinstesZiel: ziele.length ? Math.min(...ziele) : 0,
      h1Groesse: parseFloat(getComputedStyle(document.querySelector("#stage h1") || document.body).fontSize),
    };
  });
  await page.screenshot({ path: datei, fullPage: false });
  zeilen.push({ name, breite, ...m });
  return m;
}

for (const breite of [360, 1440]) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: breite, height: breite < 500 ? 780 : 900 }, deviceScaleFactor: 1, isMobile: breite < 500, hasTouch: breite < 500, locale: "de-AT" });
  const page = await ctx.newPage();
  console.log(`\n===== ${breite} px`);
  await page.goto(`${BASE}/start/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await messen(page, "1 Konto", breite, `${outDir}/${breite}-1-konto.png`);

  if (breite === 360) {
    await page.click("[data-go=email]");
    await page.waitForSelector("#email");
    await page.fill("#email", email);
    await page.click("#f-email button[type=submit]");
    await page.waitForSelector("#website", { timeout: 20000 });
  } else {
    // Desktop meldet sich am selben Konto an, damit keine zweite Vorschau entsteht.
    const key = `handy-key-${Date.now()}`;
    db.prepare("UPDATE customers SET login_key_hash = ? WHERE email = ?").run(createHash("sha256").update(key).digest("hex"), email);
    await page.goto(`${BASE}/login?key=${key}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
  }

  if (breite !== 360) {
    // Ein eingerichtetes Konto landet auf der Begruessungskarte, nicht direkt in der Uebersicht.
    if (await page.locator(".konto-karte").count()) { await page.click(".konto-karte"); await page.waitForTimeout(800); }
    // Das Konto ist nach dem ersten Durchgang eingerichtet: Ergebnis- und Plan-Bildschirm
    // gehoeren zum Onboarding und sind vorbei. Gemessen werden die Ansichten, die es jetzt gibt -
    // dieselben Wochenkarten und dieselben Plan-Zeilen, nur in ihrem Dauerzuhause.
    await page.waitForSelector("#btn-jetzt-posten", { timeout: 40000 });
    await messen(page, "7 Übersicht", breite, `${outDir}/${breite}-7-uebersicht.png`);
    const dateiD = `${outDir}/${breite}-7-uebersicht.png`;
    const obenBgD = await pixel(dateiD, 4, 150);
    const posD = await page.locator("#woche .post").first().boundingBox();
    const karteD = posD ? await pixel(dateiD, posD.x + 6, posD.y + 6) : null;
    const nebenD = posD ? await pixel(dateiD, Math.max(2, posD.x - 8), posD.y + 6) : null;
    console.log(`  Licht oben: rgb(${obenBgD}) | Kontrast zu Text: ${kontrast(obenBgD, [13, 13, 13])}:1`);
    if (karteD) console.log(`  Karte rgb(${karteD}) gegen Umgebung rgb(${nebenD}) | Unterschied ${Math.round(Math.hypot(...karteD.map((v, i) => v - nebenD[i])))}`);
    await page.click("[data-go=einstellungen]");
    await page.waitForSelector("#verbinden");
    await messen(page, "8 Einstellungen", breite, `${outDir}/${breite}-8-einstellungen.png`);
    await page.click("[data-edit=farbe]");
    await page.waitForSelector(".picker");
    await messen(page, "5b Farbpicker", breite, `${outDir}/${breite}-5b-picker.png`);
    console.log("  Farbpicker:", JSON.stringify(await page.evaluate(() => {
      const p = document.querySelector(".picker").getBoundingClientRect();
      return { pickerOben: Math.round(p.top), pickerHoehe: Math.round(p.height), fensterHoehe: window.innerHeight };
    })));
    await browser.close();
    continue;
  }
  if (breite === 360) {
    await messen(page, "2 Website", breite, `${outDir}/${breite}-2-website.png`);
    await page.fill("#website", WEBSITE);
    await page.click("#btn-vorschau");
    await page.waitForSelector(".steps", { timeout: 60000 });
    await messen(page, "3 Arbeitet", breite, `${outDir}/${breite}-3-arbeitet.png`);
    await page.waitForSelector(".sticky-actions", { timeout: 240000 });
    customerId = db.prepare("SELECT id FROM customers WHERE email = ?").get(email)?.id ?? null;
    for (let i = 0; i < 120; i++) { if (!(await page.locator(".lauf-zeile").count())) break; await page.waitForTimeout(2000); }
  }

  const erg = await messen(page, "4 Ergebnis", breite, `${outDir}/${breite}-4-ergebnis.png`);
  // Lichtnachweis: Hintergrund oben, Hintergrund unten, Kartenflaeche - aus echten Pixeln.
  const datei = `${outDir}/${breite}-4-ergebnis.png`;
  const obenBg = await pixel(datei, 4, 150);
  const kartePos = await page.locator("#woche .post").first().boundingBox();
  const karteBg = kartePos ? await pixel(datei, kartePos.x + 6, kartePos.y + 6) : null;
  const nebenKarte = kartePos ? await pixel(datei, Math.max(2, kartePos.x - 6), kartePos.y + 6) : null;
  console.log(`  Licht oben: rgb(${obenBg}) | Kontrast zu Text #0d0d0d: ${kontrast(obenBg, [13, 13, 13])}:1`);
  if (karteBg) console.log(`  Karte rgb(${karteBg}) gegen Umgebung rgb(${nebenKarte}) | Unterschied ${Math.round(Math.hypot(...karteBg.map((v, i) => v - nebenKarte[i])))}`);

  await page.click("[data-go=plan]");
  await page.waitForSelector("#btn-plan-uebernehmen");
  await messen(page, "5 Plan", breite, `${outDir}/${breite}-5-plan.png`);
  await page.click("[data-edit=farbe]");
  await page.waitForSelector(".picker");
  await messen(page, "5b Farbpicker", breite, `${outDir}/${breite}-5b-picker.png`);
  const pickerSicht = await page.evaluate(() => {
    const p = document.querySelector(".picker").getBoundingClientRect();
    const k = document.querySelector("#plan-vorschau .post")?.getBoundingClientRect();
    return { pickerOben: Math.round(p.top), pickerHoehe: Math.round(p.height), vorschauSichtbar: k ? k.bottom > 0 && k.top < window.innerHeight : null, fensterHoehe: window.innerHeight };
  });
  console.log("  Farbpicker:", JSON.stringify(pickerSicht));
  await page.click("[data-cancel-edit]");
  await page.click("#btn-plan-uebernehmen");
  await page.waitForSelector("#btn-zum-dashboard", { timeout: 60000 });
  await messen(page, "6 Verbinden", breite, `${outDir}/${breite}-6-verbinden.png`);
  await page.click("#btn-zum-dashboard");
  await page.waitForSelector("#btn-jetzt-posten", { timeout: 30000 });
  await messen(page, "7 Übersicht", breite, `${outDir}/${breite}-7-uebersicht.png`);
  await page.click("[data-go=einstellungen]");
  await page.waitForSelector("#verbinden");
  await messen(page, "8 Einstellungen", breite, `${outDir}/${breite}-8-einstellungen.png`);
  await browser.close();
}

console.log("\n| Bildschirm | Breite | Seitenhöhe | Bildschirmlängen | max. Zeichen/Zeile | Karte | Bildhöhe | kleinstes Ziel | H1 |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const z of zeilen) console.log(`| ${z.name} | ${z.breite} | ${z.seitenhoehe} | ${z.bildschirme} | ${z.maxZeile} | ${z.karteBreite || "-"} | ${z.bildHoehe || "-"} | ${z.kleinstesZiel} | ${z.h1Groesse} |`);

if (customerId) {
  db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
  db.prepare("DELETE FROM start_previews WHERE customer_id = ?").run(customerId);
  console.log(`\n(Testkunde ${customerId} entfernt)`);
}
db.close();
