/**
 * "Jetzt posten": Themenvorschläge und die Farbe für genau diesen einen Beitrag (20.09.2026).
 *   node scripts/test-jetzt-posten.mjs
 *
 * Kosten: ein Anthropic-Aufruf für die drei Vorschläge (rund 0,002 EUR). Veröffentlicht wird
 * nichts - die Anfrage bleibt liegen, der Test räumt sie weg.
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = "https://mcp.pipebot.at", MOUNT = "/panel/sandbox";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const KEY = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8")).apps[0].env.PANEL_TEST_KEY;
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session="));
let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const jetzt = new Date().toISOString();
db.prepare("UPDATE customers SET company='Mayr Kosmetik', industry='Kosmetik', about='Kosmetikstudio mit Ausbildung zur Beauty Advisorin.', accent_color='#00818f', gradient_color2='#355cf0', gradient_enabled=1, email_verified=1, tour_done_at=?, ig_feed_enabled=1, ig_story_enabled=0, linkedin_enabled=0 WHERE id=?").run(jetzt, id);
db.prepare("DELETE FROM post_requests WHERE customer_id=?").run(id);

const browser = await chromium.launch();
for (const breite of [360, 1440]) {
  console.log(`\n@${breite}`);
  db.prepare("DELETE FROM post_requests WHERE customer_id=?").run(id);
  const ctx = await browser.newContext({ viewport: { width: breite, height: breite === 360 ? 780 : 900 } });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const seitenfehler = []; page.on("pageerror", (e) => seitenfehler.push(e.message));
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#btn-jetzt-posten", { timeout: 20000 });
  await page.click("#btn-jetzt-posten");
  await page.waitForSelector("#f-jetzt", { timeout: 8000 });
  await page.waitForTimeout(400);

  // 1) Minimalismus: genau eine zusaetzliche Zeile fuer Vorschlaege, eine fuer die Farbe
  const aufbau = await page.evaluate(() => {
    const blatt = document.querySelector("#sheet-body");
    return {
      knoepfe: [...blatt.querySelectorAll("button")].map((b) => b.textContent.trim()),
      tupfer: blatt.querySelectorAll(".tupfer-el").length,
      farbfeld: Boolean(blatt.querySelector('input[type="color"]')),
      // Bedienelemente, nicht Beschriftungen: die Feldbeschriftung "Thema" ist Text, kein Ziel.
      ziele: [...blatt.querySelectorAll("button, .tupfer-el, .wahl label")].map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h > 0),
    };
  });
  ok("Nur ein zusätzlicher Knopf im Fenster (Vorschläge) neben 'Jetzt posten'",
    aufbau.knoepfe.filter((t) => t && t !== "Jetzt posten").join("|") === "Themen vorschlagen", aufbau.knoepfe.join(" | "));
  ok("Eine Reihe Farbtupfer samt freier Wahl", aufbau.tupfer === 5 && aufbau.farbfeld, `${aufbau.tupfer} Tupfer, freie Wahl: ${aufbau.farbfeld}`);
  ok("Alle Tippflächen mindestens 44 px", Math.min(...aufbau.ziele) >= 43.5, `kleinste ${Math.min(...aufbau.ziele)}`);
  const ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok("Kein Querscrollen mit offenem Blatt", ueberlauf <= 0, `${ueberlauf}px`);

  // 2) Vorschlaege kommen erst auf Tipp und setzen sich ins Feld
  ok("Vor dem Tipp steht kein Vorschlag da", await page.locator("#themen-liste").isHidden());
  await page.click("#themen-vorschlag");
  await page.waitForSelector("#themen-liste .chip-thema", { timeout: 30000 });
  // Auf dem Chip steht die kurze Fassung, im data-Attribut der ganze Vorschlag - der kommt
  // ins Feld.
  const chips = await page.$$eval("#themen-liste .chip-thema", (e) => e.map((c) => ({ kurz: c.textContent.trim(), ganz: c.dataset.thema })));
  ok("Drei Vorschläge, passend zur Firma", chips.length === 3 && chips.every((c) => c.ganz.length > 12), chips.map((c) => c.kurz).join(" · "));
  await page.click("#themen-liste .chip-thema");
  await page.waitForTimeout(300);
  const imFeld = await page.inputValue("#topic");
  ok("Antippen setzt den ganzen Vorschlag ins Feld, nicht die gekürzte Anzeige",
    imFeld === chips[0].ganz && imFeld.length > chips[0].kurz.length - 2 && await page.locator("#themen-liste").isHidden(), imFeld.slice(0, 40));

  // 3) Farbe nur fuer diesen Beitrag
  await page.click(".tupfer-el:nth-child(3)"); // dunklere Geschwisterfarbe
  await page.click("#f-jetzt button[type=submit]");
  await page.waitForTimeout(1500);
  const anfrage = db.prepare("SELECT topic, accent_color, status FROM post_requests WHERE customer_id=? ORDER BY created_at DESC LIMIT 1").get(id);
  ok("Die Anfrage trägt Thema und die gewählte Farbe", Boolean(anfrage) && anfrage.topic === imFeld && /^#[0-9a-f]{6}$/.test(anfrage.accent_color || ""), JSON.stringify(anfrage));
  const kunde = db.prepare("SELECT accent_color FROM customers WHERE id=?").get(id);
  ok("Die Grundeinstellung des Kunden bleibt unberührt", kunde.accent_color === "#00818f", kunde.accent_color);
  ok(`@${breite}: Keine Skriptfehler`, seitenfehler.length === 0, seitenfehler.join(" | "));
  await ctx.close();
}
await browser.close();
db.prepare("DELETE FROM post_requests WHERE customer_id=?").run(id);
console.log(fehler ? `\n${fehler} Bruchstelle(n)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
