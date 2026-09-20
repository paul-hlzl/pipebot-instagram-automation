/**
 * LinkedIn: "mit Bild" oder "nur Text mit Hashtags" (Einstellung vom 20.09.2026).
 *   node scripts/test-linkedin-textmodus.mjs
 *
 * Prueft beide Faelle an allen drei Stellen, an denen sie auseinanderlaufen koennen: die Zeile in
 * den Einstellungen (360 und 1440), was der Kunde in seiner Woche sieht, und was der Server beim
 * Planen und beim Veroeffentlichen daraus macht.
 *
 * Kosten: zwei LinkedIn-Beitraege aus einem echten Planungslauf (nur Text, also kein Bild) -
 * gemessen rund 0,004 EUR.
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import fs from "node:fs";

const BASE = "https://mcp.pipebot.at", MOUNT = "/panel/sandbox";
Object.assign(process.env, dotenv.parse(fs.readFileSync("/root/mcp-server/.env", "utf8")), { PANEL_DB_PATH: "/root/mcp-server/data/panel-staging.db" });
const db = new Database("/root/mcp-server/data/panel-staging.db");
const KEY = (() => { const j = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8")); return (Array.isArray(j.apps) ? j.apps[0] : j).env.PANEL_TEST_KEY; })();
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session="));
let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };
const tag = (i) => new Date(Date.now() + i * 86400e3).toISOString().slice(0, 10);
const HAUSBILD = "https://pub-ca94c8f7d991428986a52fce66b47718.r2.dev/posts/2026-09-19T19-24-21-843Z-70cf6161-ffa8-4530-b82e-2a8262e9f529.jpg";

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const jetzt = new Date().toISOString();
db.prepare("UPDATE customers SET company='Channoine Mayr', industry='Kosmetik', about='Kosmetikstudio.', accent_color='#00818f', gradient_color2='#355cf0', gradient_enabled=1, email_verified=1, tour_done_at=?, approval_mode=0, ig_feed_enabled=1, ig_story_enabled=0, linkedin_enabled=1, linkedin_image_mode='bild', frequency='werktags' WHERE id=?").run(jetzt, id);
db.prepare("DELETE FROM planned_posts WHERE customer_id=?").run(id);
for (const [i, ch] of ["ig_feed", "linkedin"].entries()) {
  db.prepare("INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, image_url, pillar_title, created_at, updated_at) VALUES (?,?,?,?,'planned',?,?,?,'Thema',?,?)")
    .run(`plp_l${Date.now()}_${i}`, id, ch, tag(1), `Beitrag ${ch}`, "Text dazu.", HAUSBILD, jetzt, jetzt);
}

/* ---------- Server: was beim Planen und Veroeffentlichen passiert ---------- */
const { mitKundenmarke } = await import("../dist/panel/planning.js");
const { assertLinkedInHasImage, linkedinNurText, istEigenesBild } = await import("../dist/panel/credentials.js");
console.log("Server");
db.prepare("UPDATE customers SET linkedin_image_mode='text' WHERE id=?").run(id);
ok("Einstellung wird gelesen", linkedinNurText(id) === true);
ok("Bei 'nur Text' geht kein Bild mit - auch keines, das die Routine mitschickt", (await mitKundenmarke(id, "linkedin", "Kopf", HAUSBILD)) === undefined);
let warf = false; try { assertLinkedInHasImage("linkedin", null, id); } catch { warf = true; }
ok("Ein LinkedIn-Beitrag ohne Bild ist dann kein Fehler mehr", !warf);
db.prepare("UPDATE customers SET linkedin_image_mode='bild' WHERE id=?").run(id);
ok("Bei 'mit Bild' bekommt das Bild die Markenfarben", (await mitKundenmarke(id, "linkedin", "Kopf", HAUSBILD)) !== HAUSBILD);
warf = false; try { assertLinkedInHasImage("linkedin", null, id); } catch { warf = true; }
ok("Und ein fehlendes Bild bleibt dort ein Fehler", warf);

/* ---------- Die Ausnahme: ein selbst hochgeladenes Bild ueberlebt den Textmodus ---------- */
console.log("\nEigenes Bild des Kunden");
const eigenId = `plp_e${Date.now()}`;
db.prepare("INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, image_url, image_source, origin, pillar_title, created_at, updated_at) VALUES (?,?,?,?,'edited',?,?,?,'kunde','kunde','Thema',?,?)")
  .run(eigenId, id, "linkedin", tag(2), "Mit eigenem Bild", "Text.", HAUSBILD, jetzt, jetzt);
db.prepare("UPDATE customers SET linkedin_image_mode='text' WHERE id=?").run(id);
ok("Der Server erkennt ein eigenes Bild", istEigenesBild(id, HAUSBILD) === true);
ok("Es bleibt bei 'nur Text' erhalten, statt weggelassen zu werden", (await mitKundenmarke(id, "linkedin", "Mit eigenem Bild", HAUSBILD)) === HAUSBILD);
const fremd = HAUSBILD.replace(".jpg", "-fremd.jpg");
ok("Ein von uns erzeugtes Bild geht weiterhin nicht mit", (await mitKundenmarke(id, "linkedin", "Kopf", fremd)) === undefined);
db.prepare("DELETE FROM planned_posts WHERE id=?").run(eigenId);
db.prepare("UPDATE customers SET linkedin_image_mode='bild' WHERE id=?").run(id);

/* ---------- Ein echter Planungslauf im Textmodus erzeugt gar kein Bild ---------- */
db.prepare("UPDATE customers SET linkedin_image_mode='text', ig_feed_enabled=0 WHERE id=?").run(id);
db.prepare("DELETE FROM planned_posts WHERE customer_id=?").run(id);
const { planCustomerWeek } = await import("../dist/panel/planning.js");
const kunde = db.prepare("SELECT * FROM customers WHERE id=?").get(id);
const lauf = await planCustomerWeek(kunde, { concurrency: 2, postBudget: 2, feature: "test-linkedin-textmodus" });
const zeilen = db.prepare("SELECT channel, image_url FROM planned_posts WHERE customer_id=?").all(id);
ok("Der Lauf hat LinkedIn-Beitraege angelegt", zeilen.length >= 1 && zeilen.every((z) => z.channel === "linkedin"), `${lauf.planned} geplant`);
ok("Keiner davon hat ein Bild - es wurde gar keines erzeugt", zeilen.every((z) => !z.image_url), JSON.stringify(zeilen.map((z) => z.image_url)));

/* ---------- Oberflaeche ---------- */
const browser = await chromium.launch();
for (const breite of [360, 1440]) {
  console.log(`\n@${breite}`);
  db.prepare("UPDATE customers SET linkedin_image_mode='bild', ig_feed_enabled=1 WHERE id=?").run(id);
  db.prepare("DELETE FROM planned_posts WHERE customer_id=?").run(id);
  for (const [i, ch] of ["ig_feed", "linkedin"].entries()) {
    db.prepare("INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, image_url, pillar_title, created_at, updated_at) VALUES (?,?,?,?,'planned',?,?,?,'Thema',?,?)")
      .run(`plp_u${Date.now()}_${i}`, id, ch, tag(1), `Beitrag ${ch}`, "Text dazu.", HAUSBILD, jetzt, jetzt);
  }
  const ctx = await browser.newContext({ viewport: { width: breite, height: breite === 360 ? 780 : 900 } });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const seitenfehler = []; page.on("pageerror", (e) => seitenfehler.push(e.message));
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#einstellungen`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#zeile-linkedinbild", { timeout: 20000 });

  const zeile = await page.evaluate(() => {
    const z = document.querySelector("#zeile-linkedinbild");
    return { label: z.querySelector(".zeile-k")?.textContent.trim(), wert: z.querySelector(".zeile-v")?.textContent.trim(), stift: Math.round(z.querySelector(".stift")?.getBoundingClientRect().height ?? 0) };
  });
  ok("Eine Zeile in den Einstellungen, mit dem aktuellen Wert", zeile.label === "LinkedIn-Beiträge" && zeile.wert === "Mit Bild", JSON.stringify(zeile));
  ok("Die Tippfläche zum Ändern ist groß genug", zeile.stift >= 44, `${zeile.stift}px`);

  await page.click('#zeile-linkedinbild [data-edit="linkedinbild"]');
  await page.waitForSelector('#zeile-linkedinbild form', { timeout: 5000 });
  const wahl = await page.$$eval('#zeile-linkedinbild input[name="linkedinImageMode"]', (els) => els.map((e) => e.value));
  ok("Genau zwei Möglichkeiten, nicht mehr", wahl.length === 2 && wahl.join(",") === "bild,text", wahl.join(","));
  const ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok("Kein Querscrollen mit offener Zeile", ueberlauf <= 0, `${ueberlauf}px`);

  await page.check('#zeile-linkedinbild input[value="text"]');
  await page.click('#zeile-linkedinbild button[type="submit"]');
  await page.waitForTimeout(1200);
  ok("Gespeichert", db.prepare("SELECT linkedin_image_mode m FROM customers WHERE id=?").get(id).m === "text");
  ok("Die Zeile zeigt danach den neuen Wert", (await page.textContent("#zeile-linkedinbild .zeile-v"))?.trim() === "Nur Text mit Hashtags");

  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#woche .post", { timeout: 20000 });
  await page.waitForTimeout(400);
  const karten = await page.evaluate(() => [...document.querySelectorAll("#woche .post")].map((k) => ({ kanal: k.querySelector(".chan")?.textContent.trim(), bild: Boolean(k.querySelector(".media")) })));
  ok("Die LinkedIn-Karte zeigt kein Bild mehr", karten.some((k) => k.kanal === "LinkedIn" && !k.bild), JSON.stringify(karten));
  ok("Die Instagram-Karte zeigt weiterhin ihres", karten.some((k) => k.kanal === "Instagram" && k.bild), JSON.stringify(karten));

  // Ein selbst hochgeladenes LinkedIn-Bild bleibt auch im Textmodus sichtbar - und die Zeile
  // sagt es dazu.
  db.prepare("UPDATE planned_posts SET image_source='kunde', origin='kunde' WHERE customer_id=? AND channel='linkedin'").run(id);
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#woche .post", { timeout: 20000 });
  await page.waitForTimeout(400);
  const mitEigenem = await page.evaluate(() => [...document.querySelectorAll("#woche .post")].map((k) => ({ kanal: k.querySelector(".chan")?.textContent.trim(), bild: Boolean(k.querySelector(".media")) })));
  ok("Eigenes Bild bleibt auch bei 'nur Text' sichtbar", mitEigenem.some((k) => k.kanal === "LinkedIn" && k.bild), JSON.stringify(mitEigenem));
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#einstellungen`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#zeile-linkedinbild", { timeout: 20000 });
  const notiz = (await page.textContent("#zeile-linkedinbild .zeile-notiz"))?.trim();
  ok("Die Zeile weist auf die Ausnahme hin", notiz === "Ein Bild, das du selbst hochlädst, geht trotzdem mit raus.", String(notiz));
  ok(`@${breite}: Keine Skriptfehler`, seitenfehler.length === 0, seitenfehler.join(" | "));
  await ctx.close();
}
await browser.close();
db.prepare("UPDATE customers SET linkedin_image_mode='bild' WHERE id=?").run(id);
console.log(fehler ? `\n${fehler} Bruchstelle(n)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
