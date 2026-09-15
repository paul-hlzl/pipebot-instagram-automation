#!/usr/bin/env node
/**
 * Screenshot-Werkzeug fuer das Panel-Redesign ("Flow").
 * Laeuft ausschliesslich gegen die Sandbox (/panel/sandbox) und den Demo-Modus - nie gegen
 * Produktion, nie mit echten Kundenkonten (nur die Testkunden aus docs/SANDBOX.md).
 *
 * Aufruf: node scripts/redesign-shots.mjs <out-dir> [breiten...]
 *   z.B.  node scripts/redesign-shots.mjs docs/redesign/before 390 1440
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

/** Die Sandbox-Zugangslinks stehen bewusst NICHT mehr im Repo (es ist oeffentlich) - sie kommen
 *  aus /root/sandbox-keys.env:  set -a && . /root/sandbox-keys.env && set +a */
function mussGesetztSein(name) {
  console.error(`${name} fehlt. Zugaenge laden mit:  set -a && . /root/sandbox-keys.env && set +a`);
  process.exit(2);
}


const BASE = "https://mcp.pipebot.at/panel/sandbox";
// Testkunden laut docs/SANDBOX.md - per echtem Signup angelegte Sandbox-Konten, keine echten Kunden.
const KEY_PLAIN = process.env.SANDBOX_KEY_A ?? mussGesetztSein("SANDBOX_KEY_A"); // Testfirma Eins (ohne Freigabe-Modus)
const KEY_APPROVAL = process.env.SANDBOX_KEY_B ?? mussGesetztSein("SANDBOX_KEY_B"); // Testfirma Zwei (Freigabe-Modus)

const outDir = process.argv[2] || "docs/redesign/before";
const widths = (process.argv.slice(3).length ? process.argv.slice(3) : ["390", "1440"]).map(Number);

/** Klickt Splash/Rundgang weg, damit die eigentliche Ansicht sichtbar ist. */
async function settle(page) {
  await page.waitForTimeout(1800); // Intro-Splash laeuft 1,5s
  const endTour = page.getByText("Rundgang beenden");
  if (await endTour.isVisible().catch(() => false)) {
    await endTour.click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(400);
}

async function shot(page, name, width) {
  const file = `${outDir}/${name}-${width}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log("  ", file);
}

/** Navigiert ueber die sichtbare UI (S.step ist im IIFE gekapselt, nicht von aussen setzbar).
 *  Wichtig: `[data-go=...]` kommt mehrfach vor (Navigation, Fusszeile, versteckte Bloecke) -
 *  ohne :visible laeuft Playwright in einen Timeout auf einem unsichtbaren Treffer. */
async function goto(page, label) {
  const link = page.locator(`[data-go="${label}"]:visible`).first();
  await link.click({ timeout: 8000 });
  await page.waitForTimeout(900);
}

async function run(width) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 900 },
    deviceScaleFactor: 2,
    isMobile: width < 500,
    hasTouch: width < 500,
  });
  const page = await ctx.newPage();

  console.log(`Breite ${width}:`);

  // 1. Onboarding (Demo-Modus, frisches Konto ohne Daten)
  await page.goto(`${BASE}/?demo`, { waitUntil: "networkidle" });
  await settle(page);
  await shot(page, "01-onboarding", width);

  // 2. Testfirma Eins: Uebersicht, Beitraege, Verlauf, Analytics, Einstellungen, Hilfe
  await page.goto(`${BASE}/login?key=${KEY_PLAIN}`, { waitUntil: "networkidle" });
  await settle(page);
  await shot(page, "02-dashboard", width);

  for (const [step, name] of [
    ["preview", "03-beitraege-vorschau"],
    ["history", "04-verlauf"],
    ["analytics", "05-analytics"],
    ["settings", "06-einstellungen"],
    ["guide", "07-was-kann-pipeflow"],
  ]) {
    try {
      await goto(page, step);
      await shot(page, name, width);
    } catch (err) {
      console.log(`   (uebersprungen: ${name} - ${err.message.split("\n")[0]})`);
    }
  }

  // 3. Testfirma Zwei: Freigabe-Modus (wartende Freigaben auf der Uebersicht)
  await page.goto(`${BASE}/login?key=${KEY_APPROVAL}`, { waitUntil: "networkidle" });
  await settle(page);
  await shot(page, "08-freigabe-modus-dashboard", width);

  await browser.close();
}

mkdirSync(outDir, { recursive: true });
for (const w of widths) await run(w);
console.log("fertig:", outDir);
