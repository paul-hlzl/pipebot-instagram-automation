#!/usr/bin/env node
/**
 * Barrierefreiheits-Check (axe-core) fuer das neue Panel. axe wird zur Laufzeit in die Seite
 * injiziert (kein Produktiv-Abhaengigkeit, kein externes CDN im Panel selbst) - die Datei liegt
 * lokal unter /tmp/axe.min.js:
 *   curl -s -o /tmp/axe.min.js https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js
 * Nur Sandbox + Testkunden.
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const BASE = "https://mcp.pipebot.at/panel/sandbox";
const KEY = "cJaCXkVjls9umce3x9Pvg-KA3Q29eBWU";
const AXE = readFileSync("/tmp/axe.min.js", "utf8");

const VIEWS = [
  ["#uebersicht", "Übersicht"],
  ["#beitraege/geplant", "Beiträge · Geplant"],
  ["#beitraege/freigabe", "Beiträge · Zur Freigabe"],
  ["#analytics", "Analytics"],
  ["#einstellungen", "Einstellungen"],
];

let critical = 0;
const browser = await chromium.launch();

for (const width of [390, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, isMobile: width < 500, hasTouch: width < 500 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?key=${KEY}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1700);
  const tour = page.getByText("Rundgang beenden");
  if (await tour.isVisible().catch(() => false)) { await tour.click(); await page.waitForTimeout(400); }

  console.log(`\nBreite ${width}:`);
  for (const [hash, name] of VIEWS) {
    await page.goto(`${BASE}/${hash}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await page.evaluate(AXE);
    const res = await page.evaluate(async () =>
      await window.axe.run(document, { resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })
    );
    const bad = res.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    const minor = res.violations.length - bad.length;
    critical += bad.length;
    console.log(`  ${bad.length ? "FAIL" : "ok "} - ${name}: ${bad.length} kritisch/ernst, ${minor} leicht`);
    for (const v of bad) console.log(`         ${v.id} (${v.impact}, ${v.nodes.length}×): ${v.help}`);
    for (const v of res.violations.filter((x) => !bad.includes(x))) console.log(`         · ${v.id} (${v.impact}, ${v.nodes.length}×): ${v.help}`);
  }
  await ctx.close();
}

await browser.close();
console.log(critical ? `\n${critical} kritische/ernste Verstöße` : "\nkeine kritischen oder ernsten Verstöße");
process.exit(critical ? 1 : 0);
