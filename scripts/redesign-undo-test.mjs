#!/usr/bin/env node
/**
 * Beweist die kritische Zusage aus dem Auftrag: "Rückgängig" bei der Freigabe darf den
 * Routine-Sofort-Trigger NICHT vorzeitig ausloesen. /api/approvals/:id/approve ruft serverseitig
 * triggerRoutineNow() auf (router.ts) - der Aufruf darf deshalb erst NACH dem Undo-Fenster
 * rausgehen, und bei "Rückgängig" gar nicht.
 * Laeuft nur gegen die Sandbox mit Testkunden.
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

/** Die Sandbox-Zugangslinks stehen bewusst NICHT mehr im Repo (es ist oeffentlich) - sie kommen
 *  aus /root/sandbox-keys.env:  set -a && . /root/sandbox-keys.env && set +a */
function mussGesetztSein(name) {
  console.error(`${name} fehlt. Zugaenge laden mit:  set -a && . /root/sandbox-keys.env && set +a`);
  process.exit(2);
}


const BASE = "https://mcp.pipebot.at/panel/sandbox";
const KEY_APPROVAL = process.env.SANDBOX_KEY_B ?? mussGesetztSein("SANDBOX_KEY_B");

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "ok " : "FAIL"} - ${msg}`); };

async function openApprovals(page) {
  await page.goto(`${BASE}/login?key=${KEY_APPROVAL}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const endTour = page.getByText("Rundgang beenden");
  if (await endTour.isVisible().catch(() => false)) { await endTour.click(); await page.waitForTimeout(300); }
  await page.goto(`${BASE}/#beitraege/freigabe`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

const approveCalls = [];
page.on("request", (r) => {
  if (/\/api\/approvals\/[^/]+\/(approve|reject)/.test(r.url())) approveCalls.push({ url: r.url(), at: Date.now() });
});

console.log("Freigabe mit Rückgängig:");
await openApprovals(page);

const cards = await page.locator(".approval-card").count();
ok(cards >= 2, `${cards} Freigabe-Karten sichtbar`);

// --- 1. Freigeben, dann sofort Rückgängig: es darf NIE ein Server-Aufruf erfolgen ---
await page.locator("[data-approve]").first().click();
await page.waitForTimeout(400);
ok(await page.locator(".toast").isVisible(), "Toast mit Rückgängig erscheint sofort");
ok(approveCalls.length === 0, `kein Server-Aufruf im Undo-Fenster (bisher ${approveCalls.length})`);
const afterHide = await page.locator(".approval-card").count();
ok(afterHide === cards - 1, "Karte verschwindet sofort (optimistisch)");

await page.locator(".toast button").first().click();
await page.waitForTimeout(500);
ok(approveCalls.length === 0, "nach Rückgängig immer noch kein Server-Aufruf");
ok((await page.locator(".approval-card").count()) === cards, "Karte ist wieder da");

// --- 2. Freigeben und Fenster ablaufen lassen: erst dann geht der Aufruf raus ---
const t0 = Date.now();
await page.locator("[data-approve]").first().click();
await page.waitForTimeout(3000);
ok(approveCalls.length === 0, "nach 3s immer noch kein Aufruf (Fenster laeuft 6s)");
await page.waitForTimeout(4500);
ok(approveCalls.length === 1, `genau ein Aufruf nach Ablauf (${approveCalls.length})`);
if (approveCalls.length) {
  const delay = approveCalls[0].at - t0;
  ok(delay >= 5500, `Aufruf erst nach ${Math.round(delay / 100) / 10}s (>= 5,5s)`);
  ok(/\/approve$/.test(approveCalls[0].url), "es war die Freigabe (approve)");
}

await browser.close();
console.log(fails ? `\n${fails} Probleme` : "\nalles grün");
process.exit(fails ? 1 : 0);
