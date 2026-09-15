#!/usr/bin/env node
/**
 * Prueft das Onboarding des neuen Panels: die mitwachsende Vorschau "Ihr erster Beitrag" und die
 * hervorgehobene Aktion "Vorschlag aus meiner Website holen".
 * Laeuft im DEMO-Modus der Sandbox (?demo) - dort sind alle Aufrufe gemockt: kein Konto wird
 * angelegt, nichts gespeichert, keine KI-Kosten.
 *
 *   node scripts/redesign-onboarding-test.mjs [out-dir]
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = "https://mcp.pipebot.at/panel/sandbox";
const outDir = process.argv[2] || "docs/redesign/after";
const AXE = (() => { try { return readFileSync("/tmp/axe.min.js", "utf8"); } catch { return null; } })();
mkdirSync(outDir, { recursive: true });

let problems = 0;
const log = (ok, msg, extra) => { if (!ok) problems++; console.log(`  ${ok ? "ok  " : "FAIL"} - ${msg}${extra ? ` (${extra})` : ""}`); };
const text = (page, sel) => page.locator(sel).first().textContent().then((t) => (t || "").trim());

for (const width of [390, 1440]) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 2, isMobile: width < 500, hasTouch: width < 500 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  console.log(`\nBreite ${width}:`);

  await page.goto(`${BASE}/?demo`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);

  // --- Leerer Anfang: ehrliches Skelett statt erfundener Text ---
  log(await page.locator("#first-post").isVisible(), "Vorschau „Ihr erster Beitrag“ ist da");
  log((await page.locator("#fp-caption .sk").count()) === 3, "leerer Anfang zeigt Platzhalter statt erfundenem Text");
  log((await text(page, "#fp-progress")).includes("Firmenname"), "Fortschritt nennt, was noch fehlt", await text(page, "#fp-progress"));

  // --- Wächst mit den Angaben ---
  await page.fill('[name="company"]', "Physio Wien");
  await page.waitForTimeout(250);
  log((await text(page, "#fp-watermark")) === "Physio Wien", "Firmenname erscheint als Beschriftung im Bild");
  log((await text(page, "#fp-headline")) === "Physio Wien", "Überschrift nimmt den Firmennamen, solange nichts Besseres da ist");

  await page.fill("#f-industry", "Physiotherapie");
  await page.waitForTimeout(250);
  log((await text(page, "#fp-headline")) === "Physiotherapie", "Branche schlägt den Firmennamen");

  await page.fill("#f-about", "Rückenschmerzen im Büroalltag. Wir zeigen Übungen für zwischendurch und behandeln in Wien.");
  await page.waitForTimeout(300);
  log((await page.locator("#fp-caption .sk").count()) === 0, "Platzhalter verschwindet, sobald die Beschreibung steht");
  log((await text(page, "#fp-caption")).includes("Rückenschmerzen im Büroalltag."), "erster Satz der Beschreibung steht im Beitragstext");
  log((await text(page, "#fp-headline")) === "Rückenschmerzen im Büroalltag.", "kurzer erster Satz wird zur Überschrift");
  log((await text(page, "#fp-tags")).split(/\s+/).filter(Boolean).length === 3, "„Wenige“ Hashtags = 3 Beispiel-Hashtags", await text(page, "#fp-tags"));
  log((await text(page, "#fp-progress")).startsWith("Alles da"), "Fortschritt meldet Vollständigkeit", await text(page, "#fp-progress"));

  const pillarAdd = page.locator("#pillar-add");
  if (await pillarAdd.count()) {
    await pillarAdd.click();
    await page.waitForTimeout(250);
    await page.locator("[data-pillar-title]").last().fill("Übungen für den Rücken");
    await page.waitForTimeout(300);
    log((await text(page, "#fp-headline")) === "Übungen für den Rücken", "Content-Säule schlägt alles andere");
  } else log(false, "„Säule hinzufügen“ nicht gefunden");

  // --- Hervorgehobene Website-Aktion ---
  const suggest = page.locator("#analyze-website");
  log(await suggest.isVisible(), "„Vorschlag aus meiner Website holen“ ist sichtbar");
  log((await suggest.getAttribute("class")).includes("btn"), "… und ist ein Knopf, kein Fußnoten-Link", await suggest.getAttribute("class"));
  const box = await suggest.boundingBox();
  log(box.height >= 40, "Tap-Ziel mindestens 40px hoch", `${Math.round(box?.height)}px`);
  // Der Hinweis ist beim Minimalismus-Durchgang bewusst kuerzer geworden - geprueft wird, dass
  // ueberhaupt eine kurze Erklaerung danebensteht, nicht mehr ihr genauer Wortlaut.
  const hintText = (await page.locator("#analyze-website-hint").textContent()).trim();
  log(hintText.length > 10 && hintText.length < 120, "kurze Erklärung steht daneben", hintText);

  await page.fill("#f-website", "https://beispiel.at");
  await suggest.click();
  await page.waitForTimeout(700);
  log(await page.locator("[data-website-accept]").isVisible(), "Vorschlag erscheint zum Prüfen (nicht automatisch übernommen)");
  await page.locator("[data-website-accept]").click();
  await page.waitForTimeout(400);
  log((await page.inputValue("#f-industry")) === "Dienstleistung", "Übernehmen füllt die Felder");
  log((await text(page, "#fp-caption")).includes("Ein lokales Unternehmen"), "Vorschau zieht sofort nach");

  await page.screenshot({ path: `${outDir}/21-onboarding-vorschau-${width}.png`, fullPage: true });

  // --- Seite 2: Stil-Felder wirken auf dieselbe Vorschau ---
  await page.locator('[data-formpart="2"]').click();
  await page.waitForTimeout(500);
  log(await page.locator("#first-post").isVisible(), "Vorschau bleibt auf Seite 2 sichtbar");

  await page.selectOption("#f-hashtagPreference", "viele");
  await page.waitForTimeout(250);
  log((await text(page, "#fp-tags")).split(/\s+/).filter(Boolean).length >= 4, "„Viele“ Hashtags zeigt mehr Hashtags", await text(page, "#fp-tags"));

  await page.uncheck('[name="emojisEnabled"]');
  await page.waitForTimeout(250);
  log((await text(page, "#fp-style")).includes("ohne Emojis"), "Emoji-Schalter steht in der Vorschau", await text(page, "#fp-style"));
  log(!(await text(page, "#fp-caption")).includes("✨"), "… und der Beispieltext hat dann keine Emojis");

  await page.evaluate(() => {
    const el = document.getElementById("f-accentColor");
    el.value = "#2e1a1a";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const bg = await page.locator("#fp-media").evaluate((el) => getComputedStyle(el).backgroundColor);
  log(bg === "rgb(46, 26, 26)", "Akzentfarbe färbt das Beitragsbild", bg);

  await page.selectOption("#f-ctaPreference", "termin");
  await page.waitForTimeout(250);
  log((await text(page, "#fp-caption")).includes("Termin buchen"), "gewählter Aufruf steht im Beispieltext");

  for (const name of ["igFeedEnabled", "igStoryEnabled", "linkedinEnabled"]) {
    const cb = page.locator(`[name="${name}"]`);
    if (await cb.isChecked()) await cb.uncheck();
  }
  await page.waitForTimeout(250);
  log((await text(page, "#fp-kicker")) === "Noch kein Kanal gewählt", "ohne Kanal sagt die Vorschau das auch", await text(page, "#fp-kicker"));
  log((await text(page, "#fp-progress")).includes("Kanal"), "Fortschritt nennt den fehlenden Kanal", await text(page, "#fp-progress"));

  await page.screenshot({ path: `${outDir}/21-onboarding-stil-${width}.png`, fullPage: true });

  // --- Überlauf, axe, Konsole ---
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
  log(o.docW <= width + 1, `kein horizontales Scrollen (doc ${o.docW}, erwartet ${width})${o.worst ? ` — breitestes Element: ${o.worst.sel} bis ${o.worst.right}px` : ""}`);

  if (AXE) {
    await page.evaluate(AXE);
    const res = await page.evaluate(async () => await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    }));
    const bad = res.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    log(bad.length === 0, `axe: ${bad.length} kritisch/ernst, ${res.violations.length - bad.length} leicht`);
    for (const v of res.violations) console.log(`         ${bad.includes(v) ? "!" : "·"} ${v.id} (${v.impact}, ${v.nodes.length}×): ${v.help}`);
  }

  log(errors.length === 0, `keine Konsolenfehler${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await ctx.close();
  await browser.close();
}

console.log(problems ? `\n${problems} Problem(e)` : "\nalles grün");
process.exit(problems ? 1 : 0);
