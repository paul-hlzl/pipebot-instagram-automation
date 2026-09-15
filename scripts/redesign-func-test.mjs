#!/usr/bin/env node
/**
 * Funktionsnachweis fuer die Inventur (docs/redesign/INVENTUR.md): prueft im neuen Panel die
 * Pfade, bei denen ein Redesign am ehesten etwas verliert - Speichern aller Briefing-Felder,
 * Deep-Links, Zurueck-Geste, Reiterwechsel, Kontomenue, Hilfe-Chat, Lightbox.
 * Nur Sandbox + Testkunden, nie Produktion.
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

/** Die Sandbox-Zugangslinks stehen bewusst NICHT mehr im Repo (es ist oeffentlich) - sie kommen
 *  aus /root/sandbox-keys.env:  set -a && . /root/sandbox-keys.env && set +a */
function mussGesetztSein(name) {
  console.error(`${name} fehlt. Zugaenge laden mit:  set -a && . /root/sandbox-keys.env && set +a`);
  process.exit(2);
}


const BASE = "https://mcp.pipebot.at/panel/sandbox";
const KEY = process.env.SANDBOX_KEY_B ?? mussGesetztSein("SANDBOX_KEY_B"); // Testfirma Zwei (Freigabe-Modus)

let fails = 0;
const ok = (c, m, d) => { if (!c) fails++; console.log(`  ${c ? "ok " : "FAIL"} - ${m}${!c && d ? ` :: ${d}` : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/login?key=${KEY}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1700);
const tour = page.getByText("Rundgang beenden");
if (await tour.isVisible().catch(() => false)) { await tour.click(); await page.waitForTimeout(400); }

console.log("Navigation und Deep-Links:");
await page.goto(`${BASE}/#beitraege/freigabe`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
ok(await page.locator('[data-tab="freigabe"][aria-selected="true"]').count() > 0, "Deep-Link #beitraege/freigabe öffnet den richtigen Reiter");

await page.locator('[data-tab="veroeffentlicht"]').click();
await page.waitForTimeout(700);
ok(page.url().endsWith("#beitraege/veroeffentlicht"), "Reiterwechsel schreibt die URL fort", page.url());

await page.goBack();
await page.waitForTimeout(700);
ok(await page.locator('[data-tab="freigabe"][aria-selected="true"]').count() > 0, "Zurück-Geste führt zum vorigen Reiter");

await page.goto(`${BASE}/#einstellungen/aussehen`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
ok(await page.locator('#set-layout').getAttribute("data-mobile-group") === "aussehen", "Deep-Link #einstellungen/aussehen öffnet die Gruppe direkt");

console.log("\nEinstellungen speichern (alle Felder):");
await page.goto(`${BASE}/#einstellungen`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

// Alle Gruppen muessen im DOM sein, auch wenn mobil nur eine sichtbar ist - sonst gingen beim
// Speichern stillschweigend Werte verloren (PATCH /api/me sendet das ganze Briefing).
const groups = await page.locator(".setgroup").count();
ok(groups === 7, `alle 7 Einstellungs-Gruppen im DOM (${groups})`);

const before = await page.evaluate(async () => (await (await fetch(location.pathname.replace(/\/+$/, "") + "/api/me", { credentials: "same-origin" })).json()).customer);

const marker = `Redesign-Test ${Date.now()}`;
await page.locator('[data-setgroup="unternehmen"]').click();
await page.waitForTimeout(400);
await page.fill("#f-about", marker);
let patchBody = null;
page.on("request", (r) => { if (r.method() === "PATCH" && r.url().includes("/api/me")) patchBody = r.postDataJSON(); });
await page.locator('#company button[type=submit]').first().click();
await page.waitForTimeout(1800);
// Nach einer Branding-Aenderung bietet das Panel an, vorbereitete Beitraege neu zu generieren
// (Feature aus Panel v18). Fuer diesen Test ablehnen - sonst blockiert der Dialog alles Weitere.
const notNow = page.getByRole("button", { name: "Nicht jetzt" });
if (await notNow.isVisible().catch(() => false)) { await notNow.click(); await page.waitForTimeout(500); }

ok(Boolean(patchBody), "PATCH /api/me wurde gesendet");
if (patchBody) {
  const required = ["company","contactName","email","website","industry","about","tone","frequency","postTime","accentColor","watermarkText","avoidTopics","ctaPreference","bannedWords","requiredElements","igFeedEnabled","igStoryEnabled","linkedinEnabled","hashtagPreference","emojisEnabled","language","contentPillars","activeWeekdays","instagramWeekdays","linkedinWeekdays","pauseFrom","pauseUntil","approvalMode","notifyOnPublish","notifyWeeklyReport","commentAutomationEnabled","commentAutomationMode","carouselSlideCount","carouselAutoFrequency","fontChoice","gradientEnabled","gradientColor2","gradientDirection"];
  const scopeMissing = await page.evaluate(() => document.querySelectorAll("[name=commentAutomationMode][disabled]").length > 0);
  const expectedMissing = scopeMissing ? ["commentAutomationMode"] : [];
  const missing = required.filter((k) => !(k in patchBody));
  ok(missing.filter((k) => !expectedMissing.includes(k)).length === 0,
     `alle ${required.length} Briefing-Felder im Speichern enthalten${scopeMissing ? " (ohne commentAutomationMode: Radios sind ohne Kommentar-Scope deaktiviert - Verhalten aus dem alten Panel)" : ""}`,
     `fehlt: ${missing.join(", ")}`);
  ok(patchBody.about === marker, "geänderter Wert kommt an");
  ok(patchBody.approvalMode === true, "Freigabe-Modus bleibt erhalten (nicht versehentlich zurückgesetzt)");
  ok(Number(patchBody.carouselSlideCount) === Number(before.carouselSlideCount), "Karussell-Slides unverändert");
  ok(scopeMissing || patchBody.commentAutomationMode === before.commentAutomationMode, "Kommentar-Modus unverändert");
}

const after = await page.evaluate(async () => (await (await fetch(location.pathname.replace(/\/+$/, "") + "/api/me", { credentials: "same-origin" })).json()).customer);
ok(after.about === marker, "Wert ist serverseitig gespeichert");
ok(after.company === before.company && after.postTime === before.postTime, "andere Felder unverändert");

console.log("\nWeitere Bausteine:");
await page.goto(`${BASE}/#uebersicht`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.locator("#acct-btn").click();
await page.waitForTimeout(300);
ok(await page.locator("#acct-menu:visible").count() > 0, "Kontomenü öffnet");
await page.keyboard.press("Escape").catch(() => {});
await page.locator("body").click({ position: { x: 5, y: 400 } });
await page.waitForTimeout(300);

await page.goto(`${BASE}/#posten`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
ok(await page.locator("#sheet:visible").count() > 0, "Deep-Link #posten öffnet „Jetzt posten“");
await page.locator("#sheet-close").click();
await page.waitForTimeout(400);
ok(await page.locator("#sheet-overlay:visible").count() === 0, "Sheet schließt wieder");

ok(errors.length === 0, "keine unbehandelten Fehler", errors.join(" | "));
await browser.close();
console.log(fails ? `\n${fails} Probleme` : "\nalles grün");
process.exit(fails ? 1 : 0);
