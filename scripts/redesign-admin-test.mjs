#!/usr/bin/env node
/**
 * Pruefwerkzeug fuer die Admin-Seite im Redesign ("Flow", Phase 6).
 * Laeuft ausschliesslich gegen die SANDBOX (/panel/sandbox/admin) - dort haengt die Staging-DB
 * (PANEL_DB_PATH=data/panel-staging.db, PANEL_MAIL_DRY_RUN=1), also nur Testkunden.
 * Das Admin-Passwort kommt aus der Umgebung, nie aus dem Code:
 *   PANEL_ADMIN_PASSWORD="…" node scripts/redesign-admin-test.mjs [out-dir] [praefix]
 *
 * Geprueft wird: Anmeldung (falsch/richtig), Statussatz, Kundenliste, Detail-Dialog (Escape +
 * Fokus zurueck), eigener Eingabedialog statt window.prompt, kein horizontales Scrollen,
 * keine Konsolenfehler, axe-core ohne kritische/ernste Verstoesse. Es wird nichts veraendert:
 * der Verlaengern-Dialog wird bewusst abgebrochen.
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = "https://mcp.pipebot.at/panel/sandbox/admin/";
const PW = process.env.PANEL_ADMIN_PASSWORD;
if (!PW) { console.error("PANEL_ADMIN_PASSWORD fehlt (nur Staging-Passwort verwenden)."); process.exit(2); }
const outDir = process.argv[2] || "docs/redesign/after";
const prefix = process.argv[3] || "20-admin";
const AXE = (() => { try { return readFileSync("/tmp/axe.min.js", "utf8"); } catch { return null; } })();
mkdirSync(outDir, { recursive: true });

let problems = 0;
const log = (ok, msg) => { if (!ok) problems++; console.log(`  ${ok ? "ok  " : "FAIL"} - ${msg}`); };

async function noOverflow(page, width, name) {
  // Gegen die eingestellte Breite pruefen, nicht gegen innerWidth (waechst bei Ueberlauf mit).
  const o = await page.evaluate(() => {
    let worst = null;
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > document.documentElement.clientWidth + 1 && (!worst || r.right > worst.right)) {
        worst = { right: Math.round(r.right), sel: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.split(" ").filter(Boolean).slice(0, 2).join(".") : "") };
      }
    });
    return { docW: document.documentElement.scrollWidth, worst };
  });
  log(o.docW <= width + 1, `${name}: kein horizontales Scrollen (doc ${o.docW}, erwartet ${width})${o.worst ? ` — breitestes Element: ${o.worst.sel} bis ${o.worst.right}px` : ""}`);
}

async function axeRun(page, name) {
  if (!AXE) { console.log("       (axe uebersprungen: /tmp/axe.min.js fehlt)"); return; }
  await page.evaluate(AXE);
  const res = await page.evaluate(async () => await window.axe.run(document, {
    resultTypes: ["violations"],
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  }));
  const bad = res.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  log(bad.length === 0, `${name}: ${bad.length} kritisch/ernst, ${res.violations.length - bad.length} leicht`);
  for (const v of res.violations) console.log(`         ${bad.includes(v) ? "!" : "·"} ${v.id} (${v.impact}, ${v.nodes.length}×): ${v.help}`);
}

for (const width of [390, 1440]) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 2, isMobile: width < 500, hasTouch: width < 500 });
  const page = await ctx.newPage();
  const errors = [];
  // Der erste /api/me-Aufruf ist vor der Anmeldung erwartungsgemaess 401 - der Browser meldet das
  // als Konsolenfehler, obwohl die Seite korrekt reagiert (sie zeigt die Anmeldung).
  const expected401 = (t) => /401/.test(t) && /Failed to load resource/.test(t);
  page.on("console", (m) => { if (m.type() === "error" && !expected401(m.text())) errors.push(m.text()); });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  const external = new Set();
  page.on("request", (r) => { const h = new URL(r.url()).host; if (h !== "mcp.pipebot.at") external.add(h); });
  console.log(`\nBreite ${width}:`);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  log(await page.getByLabel("Passwort").isVisible(), "Anmeldung: Passwortfeld sichtbar");
  await noOverflow(page, width, "Anmeldung");
  await page.screenshot({ path: `${outDir}/${prefix}-login-${width}.png`, fullPage: true });
  await axeRun(page, "Anmeldung (axe)");

  // Falsches Passwort -> Hinweis, kein Absturz. Nur einmal je Lauf: die Admin-Anmeldung sperrt
  // nach 8 Versuchen je Viertelstunde und IP - bei zwei Breiten waere der Test sonst selbst schuld.
  if (width === 390) {
    await page.getByLabel("Passwort").fill("definitiv-falsch");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await page.waitForTimeout(700);
    log(await page.getByText("Falsches Passwort.").isVisible().catch(() => false), "Anmeldung: falsches Passwort wird gemeldet");
  }

  await page.getByLabel("Passwort").fill(PW);
  await page.getByRole("button", { name: "Anmelden" }).click();
  // Ohne diese Wartebedingung laeuft der Test bei abgelehnter Anmeldung erst 30s spaeter in einen
  // nichtssagenden Timeout. Haeufigster Grund: die Sperre nach 8 Anmeldeversuchen je Viertelstunde
  // (in-memory, ein Neustart der Staging-Instanz setzt sie zurueck).
  try {
    await page.locator(".status-line").waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    const notice = await page.locator(".notice").textContent().catch(() => null);
    console.log(`  ABBRUCH - Anmeldung nicht moeglich${notice ? `: ${notice.trim()}` : ""}`);
    process.exit(1);
  }

  const statusText = await page.locator(".status-line").first().textContent().catch(() => null);
  log(Boolean(statusText), `Übersicht: ein Statussatz („${(statusText || "").trim()}")`);
  log((await page.locator(".metrics .metric").count()) === 6, "Übersicht: sechs Zahlen");
  const rows = await page.locator("tbody tr[data-id]").count();
  log(rows > 0, `Übersicht: ${rows} Kunden in der Liste`);
  log(await page.getByRole("button", { name: "Abmelden" }).isVisible(), "Kopf: Abmelden sichtbar");
  await noOverflow(page, width, "Übersicht");
  await page.screenshot({ path: `${outDir}/${prefix}-${width}.png`, fullPage: true });
  await axeRun(page, "Übersicht (axe)");

  // Detail-Dialog: oeffnen, mit Escape schliessen, Fokus zurueck auf den Ausloeser
  const detailsBtn = page.locator('[data-action="details"]').first();
  await detailsBtn.click();
  await page.waitForTimeout(600);
  log(await page.locator("#detail-overlay .modal").first().isVisible(), "Detail-Dialog öffnet");
  await page.screenshot({ path: `${outDir}/${prefix}-details-${width}.png`, fullPage: false });
  await axeRun(page, "Detail-Dialog (axe)");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  log((await page.locator("#detail-overlay").count()) === 0, "Detail-Dialog schließt mit Escape");
  log(await page.evaluate(() => document.activeElement?.dataset?.action === "details"), "Fokus kehrt zum auslösenden Knopf zurück");

  // Verlaengern: eigener Dialog statt window.prompt - und Abbrechen aendert nichts
  let nativePrompt = false;
  page.on("dialog", async (d) => { nativePrompt = true; await d.dismiss(); });
  const trialBefore = await page.locator('tbody tr[data-id]').first().locator('td[data-label="Testphase"]').textContent();
  await page.locator('[data-action="extend"]').first().click();
  await page.waitForTimeout(500);
  log(!nativePrompt, "„+7 Tage“ öffnet keinen System-Dialog");
  log(await page.locator("#confirm-input").isVisible(), "„+7 Tage“ öffnet den eigenen Eingabedialog");
  log((await page.locator("#confirm-input").inputValue()) === "7", "Eingabedialog ist mit 7 vorbelegt");
  await page.screenshot({ path: `${outDir}/${prefix}-dialog-${width}.png`, fullPage: false });
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await page.waitForTimeout(600);
  const trialAfter = await page.locator('tbody tr[data-id]').first().locator('td[data-label="Testphase"]').textContent();
  log(trialBefore === trialAfter, "Abbrechen verändert nichts");

  // Schrift wirklich selbst gehostet (kein Google-Fonts-Aufruf)
  const fontOk = await page.evaluate(async () => {
    await document.fonts.ready;
    return getComputedStyle(document.body).fontFamily.includes("Schibsted");
  });
  log(fontOk, "Schrift: Schibsted Grotesk aktiv (selbst gehostet)");

  log(external.size === 0, `keine externen Anfragen${external.size ? `: ${[...external].join(", ")}` : ""}`);
  log(errors.length === 0, `keine Konsolenfehler${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await ctx.close();
  await browser.close();
}

console.log(problems ? `\n${problems} Problem(e)` : "\nalles grün");
process.exit(problems ? 1 : 0);
