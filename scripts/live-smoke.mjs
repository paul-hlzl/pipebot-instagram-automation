#!/usr/bin/env node
/**
 * Rauchtest gegen das LIVE-Panel nach einem Deploy. Meldet sich bewusst NICHT an und ruft keine
 * Kundendaten ab - geprueft wird nur, was jeder Besucher ohnehin sieht: dass alle Dateien des
 * neuen Panels ausgeliefert werden, die Seite ohne Konsolenfehler laedt, die Schrift vom eigenen
 * Server kommt (kein Google Fonts) und am Handy nichts seitlich heraussteht.
 *
 *   node scripts/live-smoke.mjs [basis-url]
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const BASE = process.argv[2] || "https://mcp.pipebot.at/panel";
let problems = 0;
const log = (ok, msg, extra) => { if (!ok) problems++; console.log(`  ${ok ? "ok  " : "FAIL"} - ${msg}${extra ? ` (${extra})` : ""}`); };

console.log(`Dateien unter ${BASE}:`);
for (const [path, must] of [
  ["/", "panel.js"],
  ["/panel.css", "--paper"],
  ["/panel.js", "Pipeflow"],
  ["/admin/", "status-line"],
  ["/manifest.webmanifest", "Pipeflow"],
  ["/fonts/SchibstedGrotesk-latin.woff2", null],
  ["/icon-192.png", null],
  ["/api/health", "ok"],
]) {
  const res = await fetch(`${BASE}${path}`);
  const body = must ? await res.text() : "";
  log(res.ok && (!must || body.includes(must)), `${path} -> HTTP ${res.status}${must ? `, enthält „${must}“` : ""}`);
}

console.log("\nSeite im Browser (abgemeldet, nur die öffentliche Ansicht):");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
const external = new Set();
// Abgemeldet beantwortet der Server /api/me erwartungsgemaess mit 401 - genau daraufhin zeigt das
// Panel die Anmeldung. Der Browser meldet das trotzdem als Konsolenfehler; alles andere zaehlt.
const expected401 = (t) => /401/.test(t) && /Failed to load resource/.test(t);
page.on("console", (m) => { if (m.type() === "error" && !expected401(m.text())) errors.push(m.text()); });
page.on("response", (r) => { if (!r.ok() && !(r.status() === 401 && r.url().endsWith("/api/me"))) errors.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("request", (r) => { const h = new URL(r.url()).host; if (h !== new URL(BASE).host) external.add(h); });

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
log(await page.locator("#company").count() > 0, "Startseite rendert das Panel (Formular ist da)");
log(await page.evaluate(async () => { await document.fonts.ready; return getComputedStyle(document.body).fontFamily.includes("Schibsted"); }), "Schrift: Schibsted Grotesk aktiv (selbst gehostet)");
log(external.size === 0, `keine externen Anfragen${external.size ? `: ${[...external].join(", ")}` : ""}`);
const docW = await page.evaluate(() => document.documentElement.scrollWidth);
log(docW <= 391, `kein horizontales Scrollen bei 390 (doc ${docW})`);
log(errors.length === 0, `keine Konsolenfehler${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
await browser.close();

console.log(problems ? `\n${problems} Problem(e)` : "\nalles grün");
process.exit(problems ? 1 : 0);
