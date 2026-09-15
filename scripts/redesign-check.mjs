#!/usr/bin/env node
/**
 * Prüfwerkzeug fürs Redesign: laedt eine Ansicht in der Sandbox, sammelt Konsolenfehler,
 * prueft auf horizontales Scrollen (scrollWidth <= innerWidth) und schiesst einen Screenshot.
 * Nur Sandbox/Demo, nie Produktion, nie echte Kundenkonten.
 *
 *   node scripts/redesign-check.mjs <out-dir> [breiten...]
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const BASE = "https://mcp.pipebot.at/panel/sandbox";
const KEY_PLAIN = "4ld5fnINw5ZeNUEjOZNhRXp-PZTxS4je";
const KEY_APPROVAL = "cJaCXkVjls9umce3x9Pvg-KA3Q29eBWU";

const outDir = process.argv[2] || "docs/redesign/after";
const widths = (process.argv.slice(3).length ? process.argv.slice(3) : ["390", "1440"]).map(Number);

let problems = 0;
const log = (ok, msg) => { if (!ok) problems++; console.log(`  ${ok ? "ok " : "FAIL"} - ${msg}`); };

async function checkPage(page, name, width) {
  await page.waitForTimeout(700);
  // Gegen die EINGESTELLTE Breite pruefen, nicht gegen innerWidth: bei echtem Ueberlauf zoomt
  // der mobile Browser heraus, innerWidth waechst mit - der Test waere dann immer gruen.
  const o = await page.evaluate(() => {
    const docW = document.documentElement.scrollWidth;
    let worst = null;
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > document.documentElement.clientWidth + 1) {
        if (!worst || r.right > worst.right) worst = { right: Math.round(r.right), sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").filter(Boolean).slice(0,2).join(".") : "") };
      }
    });
    return { docW, innerW: window.innerWidth, worst };
  });
  const ok_ = o.docW <= width + 1 && o.innerW <= width + 1;
  log(ok_, `${name}: kein horizontales Scrollen (doc ${o.docW}, innerWidth ${o.innerW}, erwartet ${width})${o.worst ? ` — breitestes Element: ${o.worst.sel} bis ${o.worst.right}px` : ""}`);
  await page.screenshot({ path: `${outDir}/${name}-${width}.png`, fullPage: true });
}

async function run(width) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 900 },
    deviceScaleFactor: 2, isMobile: width < 500, hasTouch: width < 500,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  console.log(`\nBreite ${width}:`);
  await page.goto(`${BASE}/login?key=${KEY_APPROVAL}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const endTour = page.getByText("Rundgang beenden");
  if (await endTour.isVisible().catch(() => false)) { await endTour.click(); await page.waitForTimeout(300); }
  await checkPage(page, "10-uebersicht", width);

  for (const [hash, name] of [
    ["#beitraege/geplant", "11-beitraege-geplant"],
    ["#beitraege/freigabe", "12-beitraege-freigabe"],
    ["#beitraege/veroeffentlicht", "13-beitraege-veroeffentlicht"],
    ["#analytics", "14-analytics"],
    ["#einstellungen", "15-einstellungen"],
  ]) {
    await page.goto(`${BASE}/${hash}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await checkPage(page, name, width);
  }

  // Jetzt posten (Sheet)
  await page.goto(`${BASE}/#uebersicht`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const postBtn = page.locator("[data-open-post-now]:visible").first();
  if (await postBtn.count()) {
    await postBtn.click();
    await page.waitForTimeout(600);
    await checkPage(page, "16-jetzt-posten", width);
  } else {
    log(false, "„Jetzt posten“ nicht erreichbar");
  }

  // Onboarding im Demo-Modus
  await page.goto(`${BASE}/?demo`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  await checkPage(page, "17-onboarding", width);

  log(errors.length === 0, `keine Konsolenfehler${errors.length ? `: ${errors.slice(0, 4).join(" | ")}` : ""}`);
  await browser.close();
}

mkdirSync(outDir, { recursive: true });
for (const w of widths) await run(w);
console.log(problems ? `\n${problems} Probleme` : "\nalles grün");
process.exit(problems ? 1 : 0);
