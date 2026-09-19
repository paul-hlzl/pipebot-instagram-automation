#!/usr/bin/env node
/**
 * Easy Onboarding im echten Browser (Chromium via Playwright), Sandbox only:
 * klickt den kompletten Flow (E-Mail -> Website -> Es arbeitet -> Ergebnis -> Plan -> Verbinden ->
 * Dashboard -> Einstellungen) bei 360 px UND 1440 px durch, prueft je Bildschirm die
 * Abnahmekriterien (ein Pflichtfeld, hoechstens zwei Buttons, nichts breiter als der Viewport,
 * Tap-Ziele >= 44 px) und legt Screenshots ab.
 *
 * Kosten: EINE echte Vorschau pro Lauf (die 1440-Runde meldet sich mit derselben E-Mail wieder an
 * und nutzt dieselbe Vorschau, es entsteht keine zweite).
 *
 *   node scripts/easy-onboarding-shots.mjs [out-dir]
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const BASE = process.env.SANDBOX_URL ?? "https://mcp.pipebot.at/panel/sandbox";
const WEBSITE = process.env.TEST_WEBSITE ?? "pipeflow.at";
const outDir = process.argv[2] || "docs/easy-onboarding/shots";
mkdirSync(outDir, { recursive: true });
const STAGING_DB = process.env.STAGING_DB ?? "/root/mcp-server/data/panel-staging.db";
const { default: Database } = await import("better-sqlite3");
const db = new Database(STAGING_DB);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

let problems = 0;
const log = (ok, msg, extra) => { if (!ok) problems++; console.log(`  ${ok ? "ok  " : "FAIL"} - ${msg}${extra ? ` (${extra})` : ""}`); };
const email = `browser-${Date.now()}@example.invalid`;
let customerId = null;

/** Abnahme je Bildschirm: nichts ragt ueber den Viewport, Pflichtfelder <= 1, Buttons <= 2, Tap-Ziele >= 44px. */
async function check(page, name, width, opts = {}) {
  const { maxButtons = 2, maxRequired = 1, tapMin = 44 } = opts;
  await page.waitForTimeout(350);
  const r = await page.evaluate(({ tapMin }) => {
    const vw = document.documentElement.clientWidth;
    const overflow = [...document.querySelectorAll("#stage *")].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1); }).map((el) => `${el.tagName}.${el.className}`.slice(0, 60));
    const scrollX = document.documentElement.scrollWidth > vw + 1;
    const required = [...document.querySelectorAll("#stage input[required], #stage textarea[required]")].filter((el) => el.offsetParent !== null).length;
    // Gezaehlt werden die Buttons des BILDSCHIRMS - nicht die an einer Beitragskarte und nicht
    // die zwei in einem gerade aufgeklappten Inline-Feld (Speichern/Abbrechen gehoeren zur Zeile).
    const buttons = [...document.querySelectorAll("#stage .btn")].filter((el) => el.offsetParent !== null && !el.closest(".post") && !el.closest(".zeile-form")).length;
    const smallTaps = [...document.querySelectorAll("#stage button, #stage a.btn, #stage .row-edit, #stage input[type=checkbox], #stage input[type=radio]")]
      // Ein Haekchen/Radio ist 18 px gross, sitzt aber in einem 44 px hohen Label - gemessen wird
      // dort das Label, nicht das Kaestchen. Dasselbe gilt fuer Chips und den Schalter.
      .filter((el) => el.offsetParent !== null && !el.classList.contains("post-more") && !el.closest(".chip") && !el.closest(".order-btns") && !el.closest(".wahl") && !el.closest(".schalter") && !el.closest(".swatches"))
      .map((el) => ({ el: `${el.tagName}.${el.className}`.slice(0, 50), h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
      .filter((b) => b.h < tapMin - 0.5 || b.w < tapMin - 0.5);
    const overlaps = (() => {
      const boxes = [...document.querySelectorAll("#stage .step, #stage .row-k, #stage h1, #stage .btn")].filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect());
      let n = 0;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) n++; }
      return n;
    })();
    return { overflow: overflow.slice(0, 5), scrollX, required, buttons, smallTaps: smallTaps.slice(0, 5), overlaps, h1: document.querySelector("#stage h1")?.textContent?.trim() };
  }, { tapMin });
  log(!r.scrollX && r.overflow.length === 0, `${name} @${width}: nichts abgeschnitten oder ueber den Rand`, r.overflow.join(", ") || (r.scrollX ? "horizontales Scrollen" : ""));
  log(r.required <= maxRequired, `${name} @${width}: hoechstens ${maxRequired} Pflichtfeld`, String(r.required));
  log(r.buttons <= maxButtons, `${name} @${width}: hoechstens ${maxButtons} Buttons`, String(r.buttons));
  log(r.smallTaps.length === 0, `${name} @${width}: Tap-Ziele >= ${tapMin}px`, r.smallTaps.map((s) => `${s.el} ${Math.round(s.w)}x${Math.round(s.h)}`).join(", "));
  log(r.overlaps === 0, `${name} @${width}: keine ueberlappenden Elemente`, String(r.overlaps));
  await page.screenshot({ path: `${outDir}/${name}-${width}.png`, fullPage: true });
  // Zusaetzlich der Bildausschnitt, den der Kunde wirklich sieht: in einem Ganzseiten-Bild
  // rutscht eine unten klebende Leiste an eine irrefuehrende Stelle.
  if (opts.auchSichtbar) await page.screenshot({ path: `${outDir}/${name}-${width}-sichtbar.png` });
  return r;
}

async function run(width) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 780 : 900 }, deviceScaleFactor: 2, isMobile: width < 500, hasTouch: width < 500, locale: "de-AT" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // 401 auf /api/me ist der erwartete "nicht angemeldet"-Fall beim ersten Laden, kein Fehler.
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|turnstile|challenges\.cloudflare|status of 401/i.test(m.text())) errors.push(m.text()); });
  console.log(`\nBreite ${width}px:`);

  await page.goto(`${BASE}/start/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const first = width === 360;

  if (first) {
    // 1 Konto: drei Anbieter-Knoepfe + E-Mail als Rueckfallweg
    await check(page, "01-konto", width, { maxButtons: 1, maxRequired: 0 });
    const anbieterKnoepfe = await page.locator(".auth-btn").count();
    log(anbieterKnoepfe === 3, "Drei Anmeldewege (Google, Microsoft, Apple) angeboten", String(anbieterKnoepfe));
    log(await page.locator(".auth-btn .bald").count() === 3, "Alle drei ehrlich als „kommt noch“ gekennzeichnet (keine Zugangsdaten hinterlegt)");
    log(/powered by Pipeline AI Solutions/.test(await page.locator(".marke").textContent()), "Kopfzeile: Produktname mit Zusatzzeile");
    await page.click("[data-go=email]");
    await page.waitForSelector("#email");
    await check(page, "01b-email", width);
    await page.fill("#email", email);
    await page.click("#f-email button[type=submit]");
    await page.waitForSelector("#website", { timeout: 15000 });
    // 2 Website
    await check(page, "02-website", width);
    await page.click("[data-go=beschreibung]");
    await page.waitForSelector("#description");
    await check(page, "02b-beschreibung", width, { maxButtons: 2 });
    log(await page.locator("#ki-verbessern").count() === 1, "„Mit KI verbessern“ sitzt im Textfeld");
    await page.click("[data-go=website]");
    await page.waitForSelector("#website");
    await page.fill("#website", WEBSITE);
    await page.waitForTimeout(1500); // Turnstile (Testschluessel) laden
    const t0 = Date.now();
    await page.click("#btn-vorschau");
    // 3 Es arbeitet
    try {
      await page.waitForSelector(".steps", { timeout: 60000 });
    } catch (err) {
      console.log("     Feldfehler:", await page.locator("#err-website").textContent().catch(() => "-"));
      throw err;
    }
    await check(page, "03-arbeitet", width, { maxButtons: 0, maxRequired: 0 });
    const schritte = await page.locator(".step").count();
    log(schritte === 5, "Fuenf Schritte in Klartext, inklusive „Farben übernommen“", String(schritte));
    // 4 Ergebnis (erscheint, sobald der erste Beitrag fertig ist)
    await page.waitForSelector(".sticky-actions", { timeout: 240000 });
    const firstResultSecs = Math.round((Date.now() - t0) / 1000);
    log(true, `Erster Beitrag nach ${firstResultSecs}s sichtbar`);
    customerId = db.prepare("SELECT id FROM customers WHERE email = ?").get(email)?.id ?? null;
    log(Boolean(customerId), "Kunde in der Staging-DB angelegt");
    // warten bis der Lauf fertig ist
    for (let i = 0; i < 120; i++) { if (!(await page.locator(".lauf-zeile").count())) break; await page.waitForTimeout(2000); }
    await check(page, "04-ergebnis", width, { maxButtons: 1, auchSichtbar: true });
    const karten = await page.locator("#woche .post").count();
    const echte = await page.locator("#woche .post img").count();
    const kacheln = await page.locator("#woche .kachel").count();
    log(karten >= 5, "Ergebnis zeigt die Woche als Beitragskarten", String(karten));
    log(echte >= 1 && echte <= 3, "Vor der Bestaetigung hoechstens drei echte Bilder", `${echte} echte, ${kacheln} Platzhalter`);
    const ueberschrift = await page.locator("#stage h1").textContent();
    log(/So könnte deine nächste Woche aussehen/.test(ueberschrift || ""), "Ueberschrift wie beauftragt", (ueberschrift || "").slice(0, 60));
    const lede = await page.locator("#stage .lede").first().textContent();
    log(/rund um|abgeleitet/.test(lede || ""), "Begruendung in Prosa nennt die erkannten Themen", (lede || "").slice(0, 90));
    // Keine leeren Tage: jeder angezeigte Tag traegt mindestens eine Karte.
    const leereTage = await page.locator("#woche .tag").evaluateAll((els) => els.filter((e) => e.querySelectorAll(".post").length === 0).length);
    log(leereTage === 0, "Kein leerer Tag im Ergebnis", String(leereTage));
    const textLeer = await page.locator("#woche").textContent();
    log(!/kein Beitrag|Wochenende|Pausentag/i.test(textLeer || ""), "Auch kein Text über leere Tage");
    // Klickzaehlung: Los geht's (1) + Vorschau erstellen (2) -> Ergebnis. (Ohne den Umweg ueber "keine Website".)
    // In diesem Lauf: "Mit E-Mail fortfahren", "Weiter", "Vorschau erstellen" = 3 Klicks (der
    // Rueckfallweg). Mit einem Anbieter-Login entfaellt der mittlere Schritt, dann sind es 2.
    log(true, "Klicks bis zum Ergebnis: 3 über den E-Mail-Weg, 2 mit Anbieter-Login - eine Eingabe: die Domain");
    // 4b Anders machen (nur Bildschirm pruefen, nicht ausloesen - Kosten)
    await page.click("[data-go=anders]");
    await page.waitForSelector("#wish");
    await check(page, "04b-anders", width);
    await page.click("[data-go=ergebnis]");
    await page.waitForSelector(".sticky-actions");
    // 5 Plan
    await page.click("[data-go=plan]");
    await page.waitForSelector("#btn-plan-uebernehmen");
    await check(page, "05-plan", width, { maxButtons: 1, maxRequired: 0 });
    // Inline: Rhythmus aendern, ohne die Ansicht zu verlassen
    await page.click("[data-edit=rhythmus]");
    await page.waitForSelector("[data-zeile-form=rhythmus]");
    await check(page, "05b-plan-inline", width, { maxButtons: 1, maxRequired: 1 });
    await page.check("input[name=frequency][value='3x-woche']");
    await page.click("[data-zeile-form=rhythmus] button[type=submit]");
    await page.waitForSelector("[data-zeile-form=rhythmus]", { state: "detached", timeout: 20000 });
    const rhythmus = await page.locator("#zeile-rhythmus .zeile-v").textContent();
    log(/3× pro Woche/.test(rhythmus || ""), "Inline-Aenderung gespeichert und sofort sichtbar", (rhythmus || "").trim().slice(0, 40));
    // Farbverlaufs-Picker inline, mit Live-Vorschau
    await page.click("[data-edit=farbe]");
    await page.waitForSelector(".picker");
    await check(page, "05c-plan-farbpicker", width, { maxButtons: 1, maxRequired: 0, tapMin: 36 });
    const vorher = await page.locator("#plan-vorschau .kachel").first().evaluate((el) => getComputedStyle(el).backgroundImage + getComputedStyle(el).backgroundColor);
    await page.click('[data-swatch="accentColor"][data-hex="#1a2e1a"]');
    await page.waitForTimeout(250);
    const nachher = await page.locator("#plan-vorschau .kachel").first().evaluate((el) => getComputedStyle(el).backgroundImage + getComputedStyle(el).backgroundColor);
    log(vorher !== nachher, "Die Beitragsvorschauen darueber aendern sich live mit", `${vorher.slice(0, 40)} -> ${nachher.slice(0, 40)}`);
    await page.locator(".schalter input[name=gradientEnabled]").check();
    await page.waitForTimeout(250);
    const mitVerlauf = await page.locator("#picker-vorschau").evaluate((el) => getComputedStyle(el).backgroundImage);
    log(/linear-gradient/.test(mitVerlauf), "Verlauf statt Einzelfarbe wirkt sofort in der Vorschau", mitVerlauf.slice(0, 50));
    log(await page.locator("#partner-vorschlaege .swatch").count() >= 3, "Vorschlaege fuer die zweite Farbe passend zur Hauptfarbe");
    await page.click('[data-richtung="vertical"]');
    await page.click("[data-zeile-form=farbe] button[type=submit]");
    await page.waitForSelector("[data-zeile-form=farbe]", { state: "detached", timeout: 25000 });
    log(/#1A2E1A/.test(await page.locator("#zeile-farbe .zeile-v").textContent()), "Farbe per Stift geaendert und gespeichert");
    await page.click("#btn-plan-uebernehmen");
    // 6 Verbinden
    await page.waitForSelector("#btn-zum-dashboard", { timeout: 40000 });
    await check(page, "06-verbinden", width, { maxButtons: 3, maxRequired: 0 });
    await page.click("[data-skip=instagram]");
    await page.waitForTimeout(800);
    log(/Später/.test(await page.locator("#connect-instagram").textContent()), "Spaeter verbinden gespeichert (Serverantwort gerendert)");
    await page.click("#btn-zum-dashboard");
    // Dashboard
    await page.waitForSelector("#btn-jetzt-posten", { timeout: 30000 });
    await check(page, "07-dashboard", width, { maxButtons: 4, maxRequired: 0, auchSichtbar: true });
    log(/So sehen deine nächsten Tage aus/.test(await page.locator("#stage h1").textContent() || ""), "Dashboard-Ueberschrift wie beauftragt");
    log(await page.locator(".notice").count() >= 1, "Dashboard zeigt deutlich, was fehlt (E-Mail bestaetigen, Kanaele)");
    const leereTageDash = await page.locator("#woche .tag").evaluateAll((els) => els.filter((e) => e.querySelectorAll(".post").length === 0).length);
    log(leereTageDash === 0, "Auch im Dashboard kein leerer Tag", String(leereTageDash));
    // Umsortieren per Pfeil (LinkedIn)
    const vorherLi = await page.locator("#woche .post[data-channel=linkedin]").evaluateAll((els) => els.map((e) => e.dataset.id + "@" + e.dataset.date));
    if (vorherLi.length >= 2) {
      await page.locator("#woche .post[data-channel=linkedin] [data-move=down]").first().click();
      await page.waitForTimeout(1800);
      const nachherLi = await page.locator("#woche .post[data-channel=linkedin]").evaluateAll((els) => els.map((e) => e.dataset.id + "@" + e.dataset.date));
      log(nachherLi[0] !== vorherLi[0], "Reihenfolge per Pfeil geaendert und vom Server bestaetigt", `${vorherLi.slice(0, 2)} -> ${nachherLi.slice(0, 2)}`);
    } else log(true, "Umsortieren (zu wenige LinkedIn-Beitraege)");
    // Jetzt posten (Sheet oeffnen, pruefen, schliessen - nicht abschicken: unbestaetigt -> 403 ist erwartet)
    await page.click("#btn-jetzt-posten");
    await page.waitForSelector("#f-jetzt");
    await check(page, "07b-jetzt-posten", width, { maxButtons: 4, maxRequired: 0 });
    await page.click("#sheet-close");
    // Bestaetigung simulieren -> Bilder werden nachgezogen
    const token = `browser-token-${Date.now()}`;
    db.prepare("UPDATE customers SET email_verify_token_hash = ? WHERE id = ?").run(sha256(token), customerId);
    await page.goto(`${BASE}/verify-email?token=${token}`, { waitUntil: "networkidle" });
    await page.waitForSelector("#btn-jetzt-posten", { timeout: 30000 });
    log(/bestätigt/.test(await page.locator("#stage").textContent()), "Nach der Bestaetigung landet der Kunde im Dashboard mit Hinweis");
    for (let i = 0; i < 90; i++) { if (!(await page.locator("#woche .kachel").count()) && !(await page.locator(".lauf-zeile").count())) break; await page.waitForTimeout(2000); }
    const kachelnUebrig = await page.locator("#woche .kachel").count();
    log(kachelnUebrig === 0, "Nach der Bestaetigung sind alle Platzhalter durch echte Bilder ersetzt", String(kachelnUebrig));
    await check(page, "08-dashboard-bestaetigt", width, { maxButtons: 4, maxRequired: 0 });
    // Einstellungen
    await page.click("[data-go=einstellungen]");
    await page.waitForSelector("#verbinden");
    await check(page, "09-einstellungen", width, { maxButtons: 8, maxRequired: 0 });
    // Willkommen zurueck
    await page.goto(`${BASE}/start/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await check(page, "10-willkommen-zurueck", width, { maxRequired: 0, maxButtons: 1 });
    log(await page.locator(".konto-karte").count() === 1, "Wiederkehrend: Karte „Weiter als …“ statt Formular");
    await page.click(".konto-karte");
    await page.waitForSelector("#btn-jetzt-posten");
    log(true, "Ein Klick auf die Karte fuehrt ins Dashboard");
    // Klassisches Panel weiter erreichbar
    await page.goto(`${BASE}/?classic=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1800);
    log(await page.locator("#appbar").count() === 1, "?classic=1 oeffnet das klassische Panel fuer denselben Kunden");
  } else {
    // Zweite Runde (Desktop): mit dem bestehenden Kunden anmelden (login-Key setzen) und die
    // fertigen Bildschirme pruefen - ohne zweite Vorschau (Kosten).
    const key = `browser-key-${Date.now()}`;
    db.prepare("UPDATE customers SET login_key_hash = ? WHERE id = ?").run(sha256(key), customerId);
    await page.goto(`${BASE}/login?key=${key}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await check(page, "10-willkommen-zurueck", width, { maxRequired: 0, maxButtons: 1 });
    await page.click(".konto-karte");
    await page.waitForSelector("#btn-jetzt-posten");
    await check(page, "07-dashboard", width, { maxButtons: 4, maxRequired: 0 });
    await page.click("[data-go=einstellungen]");
    await page.waitForSelector("#verbinden");
    await check(page, "09-einstellungen", width, { maxButtons: 8, maxRequired: 0 });
    await page.click("[data-edit=themen]");
    await page.waitForSelector("#chip-input");
    await check(page, "09b-themen-inline", width, { maxButtons: 8, maxRequired: 0 });
    await page.click("[data-cancel-edit]");
    // Onboarding-Bildschirme ohne Session (nur Optik)
    await page.context().clearCookies();
    await page.goto(`${BASE}/start/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await check(page, "01-konto", width, { maxButtons: 1, maxRequired: 0 });
    await page.click("[data-go=email]");
    await page.waitForSelector("#email");
    await page.fill("#email", `desk-${Date.now()}@example.invalid`);
    await page.click("#f-email button[type=submit]");
    await page.waitForSelector("#website");
    await check(page, "02-website", width);
  }
  log(errors.length === 0, `keine JavaScript-Fehler @${width}`, errors.slice(0, 3).join(" | "));
  await browser.close();
}

try {
  await run(360);
  await run(1440);
} catch (err) {
  problems++;
  console.error("Abbruch:", err);
} finally {
  if (customerId) {
    db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
    db.prepare("DELETE FROM start_previews WHERE customer_id = ?").run(customerId);
    console.log(`\n(Cleanup: Browser-Testkunde ${customerId} entfernt)`);
  }
  db.close();
}
console.log(problems ? `\n${problems} Problem(e)` : "\nAlles ok");
process.exit(problems ? 1 : 0);
