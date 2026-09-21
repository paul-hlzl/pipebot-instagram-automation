#!/usr/bin/env node
/**
 * Sichtpruefung des Adminbereichs nach der Umstellung auf das Design des Kundenbereichs
 * (Auftrag 21.09.2026). Laeuft gegen eine EIGENE, kurzlebige Instanz auf Port 3113 mit einer
 * frischen Datenbank voller erfundener Kunden - nie gegen Produktion, Sandbox oder echte Daten.
 *
 *   node scripts/admin-ansicht-pruefen.mjs [ausgabe-verzeichnis] [pfad-zum-dist]
 *
 * Geprueft wird bei 360 und 1440 Pixeln Breite:
 *   - kein horizontales Scrollen (Anmeldung, Uebersicht, Detail-Dialog)
 *   - Schriften und Wortmarke wie im Kundenpanel (Inter, Instrument Serif, Pillenknoepfe)
 *   - keine Konsolenfehler, axe-core ohne kritische/ernste Verstoesse
 *   - Loeschknopf sichtbar abgesetzt und mit Tippbestaetigung
 * Ausserdem entstehen Bildschirmfotos im Ausgabe-Verzeichnis.
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";

const outDir = process.argv[2] || "docs/admin-neu";
const DIST = process.argv[3] ?? new URL("../dist/index.js", import.meta.url).pathname;
const PORT = 3113;
const ADMIN = `http://localhost:${PORT}/panel/admin/`;
const PW = "pruef-passwort-nur-lokal";
const dir = mkdtempSync(path.join(tmpdir(), "pf-adminansicht-"));
const dbPath = path.join(dir, "panel-test.db");
const AXE = (() => { try { return readFileSync("/tmp/axe.min.js", "utf8"); } catch { return null; } })();
mkdirSync(outDir, { recursive: true });

let problems = 0;
const log = (ok, msg) => { if (!ok) problems++; console.log(`  ${ok ? "ok  " : "FAIL"} - ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, [DIST], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    PORT: String(PORT), PANEL_DB_PATH: dbPath, PANEL_ADMIN_PASSWORD: PW, PANEL_ADMIN_PATH: "admin",
    PANEL_MOUNT_PATH: "/panel", PANEL_PUBLIC_DIR: new URL("../public/panel", import.meta.url).pathname,
    PANEL_MAIL_DRY_RUN: "1", PANEL_BASE_URL: "http://localhost", PANEL_SANDBOX: "true",
    PANEL_ENCRYPTION_KEY: randomBytes(32).toString("hex"), MCP_AUTH_TOKEN: randomBytes(16).toString("hex"),
    ROUTINE_TRIGGER_URL: "", ROUTINE_TRIGGER_TOKEN: "",
    IG_APP_ID: "", IG_APP_SECRET: "", INSTAGRAM_APP_ID: "", INSTAGRAM_APP_SECRET: "",
    LINKEDIN_CLIENT_ID: "", LINKEDIN_CLIENT_SECRET: "", TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "",
    ANTHROPIC_API_KEY: "", FAL_API_KEY: "test", IG_USER_ID: "test", IG_ACCESS_TOKEN: "test",
    MEDIA_STORAGE_BUCKET_URL: "https://test.invalid", MEDIA_STORAGE_ENDPOINT: "https://test.invalid",
    MEDIA_STORAGE_ACCESS_KEY: "test", MEDIA_STORAGE_SECRET_KEY: "test", MEDIA_STORAGE_BUCKET_NAME: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", () => {});
child.stderr.on("data", () => {});

let code = 1;
try {
  let oben = false;
  for (let i = 0; i < 60 && !oben; i++) {
    try { oben = (await fetch(`http://localhost:${PORT}/panel/api/health`)).ok; } catch { await sleep(250); }
  }
  if (!oben) throw new Error("Server kam nicht hoch");

  // --- Erfundene Kunden, damit die Liste etwas zu zeigen hat ---
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath);
  const jetzt = new Date().toISOString();
  const tage = (n) => new Date(Date.now() + n * 86400000).toISOString();
  const kunden = [
    ["cus_a", "Tischlerei Gruber GmbH", "Maria Gruber", "office@gruber.invalid", "active", tage(9)],
    ["cus_b", "Bäckerei Steinbauer", "Hans Steinbauer", "hans@steinbauer.invalid", "active", null],
    ["cus_c", "Physiotherapie am Ring", "Lena Hofer", "praxis@amring.invalid", "paused", tage(-3)],
    ["cus_d", "Elektro Wimmer e.U.", "Josef Wimmer", "j.wimmer@elektro.invalid", "active", tage(21)],
    ["cus_e", "Blumenwerkstatt Aigner", "Sofia Aigner", "hallo@blumenwerkstatt.invalid", "active", tage(2)],
  ];
  const ein = db.prepare(`INSERT INTO customers (id, company, contact_name, email, status, trial_ends_at, login_key_hash, consent_at, created_at, updated_at, website, industry, tone, frequency, post_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  kunden.forEach(([id, firma, name, mail, status, trial], i) => {
    ein.run(id, firma, name, mail, status, trial, createHash("sha256").update(id).digest("hex"), jetzt,
      new Date(Date.now() - (i + 2) * 86400000).toISOString(), jetzt,
      "https://beispiel.invalid", "Handwerk", "freundlich", "woechentlich", "09:00");
  });
  const conn = db.prepare("INSERT INTO connections (customer_id, provider, account_id, account_name, access_token_enc, expires_at, connected_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  conn.run("cus_a", "instagram", "ig-a", "@tischlerei_gruber", "nicht-entschluesselbar", tage(60), jetzt, jetzt);
  conn.run("cus_a", "linkedin", "li-a", "Tischlerei Gruber", "nicht-entschluesselbar", tage(4), jetzt, jetzt);
  conn.run("cus_c", "instagram", "ig-c", "@physio_amring", "nicht-entschluesselbar", tage(-1), jetzt, jetzt);
  conn.run("cus_d", "instagram", "ig-d", "@elektro_wimmer", "nicht-entschluesselbar", tage(90), jetzt, jetzt);
  const post = db.prepare("INSERT INTO posts (id, customer_id, provider, headline, caption, image_url, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (let i = 0; i < 12; i++) {
    post.run(`p${i}`, i % 2 ? "cus_a" : "cus_d", "instagram", `Beitrag ${i + 1}`,
      "Ein erfundener Beispieltext für die Sichtprüfung der Adminliste.", null,
      new Date(Date.now() - i * 43200000).toISOString());
  }
  db.close();

  const browser = await chromium.launch();
  for (const width of [360, 1440]) {
    console.log(`\n${width}px:`);
    const ctx = await browser.newContext({ viewport: { width, height: width === 360 ? 780 : 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const fehler = [];
    // Die Seite fragt beim Start /api/me - solange niemand angemeldet ist, antwortet der Server
    // mit 401 und der Browser schreibt das in die Konsole. Das ist der normale Weg zur
    // Anmeldeseite und war vor dieser Aenderung genauso; alles andere zaehlt als Fehler.
    page.on("console", (m) => { if (m.type() === "error" && !/401 \(Unauthorized\)/.test(m.text())) fehler.push(m.text()); });
    page.on("pageerror", (e) => fehler.push(String(e)));

    await page.goto(ADMIN, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outDir, `admin-${width}-anmeldung.png`), fullPage: true });
    log(!(await page.locator("text=Nur für Paul").count()), "Anmeldung: Hinweissatz ist weg");
    log(await page.locator("#remember").count() === 1, "Anmeldung: Haken 'Angemeldet bleiben' da");
    log(await page.locator("form#loginform button[type=submit]").count() === 1, "Anmeldung: genau ein Knopf");
    log(await page.locator("form#loginform input").count() === 2, "Anmeldung: nur Passwortfeld und Haken");
    await noOverflow(page, width, "Anmeldung");
    await axeRun(page, "Anmeldung");

    // Schriften wie im Kundenpanel
    const schrift = await page.evaluate(() => {
      const brand = document.querySelector(".brand");
      const body = getComputedStyle(document.body).fontFamily;
      const btn = document.querySelector("form#loginform button[type=submit]") || document.querySelector(".btn");
      return {
        body, brand: brand ? getComputedStyle(brand).fontFamily : null,
        brandText: brand ? brand.textContent.trim() : null,
        radius: btn ? getComputedStyle(btn).borderRadius : null,
        hoehe: btn ? getComputedStyle(btn).minHeight : null,
      };
    });
    log(/Inter/.test(schrift.body), `Fließtext ist Inter (${schrift.body})`);
    log(/Instrument Serif/.test(schrift.brand ?? ""), `Wortmarke in Instrument Serif (${schrift.brand})`);
    log(schrift.brandText === "Pipeflow", `Wortmarke lautet "Pipeflow" (${schrift.brandText})`);
    log(schrift.radius === "100px", `Knöpfe sind Pillen (${schrift.radius})`);
    log(schrift.hoehe === "50px", `Knopfhöhe wie im Kundenpanel (${schrift.hoehe})`);

    // Anmelden und Uebersicht
    await page.fill("#pw", PW);
    await page.click("form#loginform button[type=submit]");
    await page.waitForSelector("table", { timeout: 10000 });
    await page.screenshot({ path: path.join(outDir, `admin-${width}-uebersicht.png`), fullPage: true });
    log((await page.locator("tbody tr[data-id]").count()) === 5, "Übersicht: alle fünf Kunden stehen da");
    log((await page.locator("[data-action=delete]").count()) === 5, "Übersicht: Löschknopf je Kunde");
    await noOverflow(page, width, "Übersicht");
    await axeRun(page, "Übersicht");

    const rot = await page.evaluate(() => {
      const b = document.querySelector("[data-action=delete]");
      const gefahr = b.closest(".gruppe");
      const harmlos = gefahr.previousElementSibling;
      const g = gefahr.getBoundingClientRect(), h = harmlos.getBoundingClientRect();
      // Stehen beide Gruppen auf derselben Zeile, zaehlt der waagrechte Abstand; bricht die
      // Gefahrengruppe in eine eigene Zeile um, ist sie ohnehin abgesetzt.
      const eineZeile = Math.abs(g.top - h.top) < 4;
      return { farbe: getComputedStyle(b).color, abstand: eineZeile ? Math.round(g.left - h.right) : 999 };
    });
    log(/180, 35, 24|182, 35, 24|rgb\(180/.test(rot.farbe) || rot.farbe !== "rgb(0, 0, 0)", `Löschen ist farblich abgesetzt (${rot.farbe})`);
    if (width === 1440) log(rot.abstand >= 24, `Löschen steht abgesetzt von den harmlosen Aktionen (${rot.abstand}px)`);

    // Sitzungsliste
    log((await page.locator("#h-sitzungen").count()) === 1, "Sitzungen: Abschnitt vorhanden");
    const sitzungen = await page.locator("tr[data-session]").count();
    log(sitzungen >= 1 && (await page.locator("[data-action=logout-session]").count()) === sitzungen, `Sitzungen: jede einzeln abmeldbar (${sitzungen})`);
    log((await page.locator("text=dieses Gerät").count()) === 1, "Sitzungen: eigene Sitzung markiert");

    // Loeschdialog: Tippbestaetigung, dann abbrechen (es wird nichts geloescht)
    await page.locator("[data-action=delete]").first().click();
    await page.waitForSelector("#confirm-overlay:not([hidden])");
    log(!(await page.locator("#confirm-inputwrap").isHidden()), "Löschen verlangt weiterhin den Firmennamen");
    await page.screenshot({ path: path.join(outDir, `admin-${width}-loeschen.png`) });
    await page.keyboard.press("Escape");
    await page.waitForSelector("#confirm-overlay[hidden]", { state: "attached" });

    // Detail-Dialog
    await page.locator("[data-action=details]").first().click();
    await page.waitForSelector("#detail-overlay");
    await page.screenshot({ path: path.join(outDir, `admin-${width}-details.png`) });
    await noOverflow(page, width, "Detail-Dialog");
    await page.keyboard.press("Escape");

    log(fehler.length === 0, `keine Konsolenfehler${fehler.length ? ` (${fehler.slice(0, 2).join(" | ")})` : ""}`);
    await ctx.close();
  }
  await browser.close();
  console.log(`\nBilder in ${outDir}`);
  console.log(problems === 0 ? "\nAlles in Ordnung." : `\n${problems} Problem(e).`);
  code = problems === 0 ? 0 : 1;
} catch (err) {
  console.error("\nAbbruch:", err.stack || err.message);
  code = 2;
} finally {
  child.kill("SIGTERM");
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}

async function noOverflow(page, width, name) {
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
  if (!AXE) { console.log("       (axe übersprungen: /tmp/axe.min.js fehlt)"); return; }
  await page.evaluate(AXE);
  const res = await page.evaluate(async () => await window.axe.run(document, {
    resultTypes: ["violations"],
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  }));
  const bad = res.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  log(bad.length === 0, `${name}: ${bad.length} kritisch/ernst, ${res.violations.length - bad.length} leicht`);
  for (const v of res.violations) {
    console.log(`         ${bad.includes(v) ? "!" : "·"} ${v.id} (${v.impact}, ${v.nodes.length}×): ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`           ${n.target.join(" ")} :: ${(n.failureSummary || "").split("\n").filter(Boolean).slice(-1)[0] ?? ""}`);
  }
}

process.exit(code);
