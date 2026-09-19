/**
 * Die Woche in der Hand des Kunden (Konzept 19.09.2026): jede Handlung im echten Browser, bei 360
 * und 1440, gegen einen Testkunden mit gesetzter Woche. Nur "Neu schreiben lassen" braucht KI.
 *   node scripts/test-woche.mjs
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import Database from "better-sqlite3";
import fs from "node:fs";
import sharp from "sharp";

const BASE = "https://mcp.pipebot.at", MOUNT = "/panel/sandbox";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const KEY = (() => { const j = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8")); return (Array.isArray(j.apps) ? j.apps[0] : j).env.PANEL_TEST_KEY; })();
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session="));
let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };
const tag = (i) => new Date(Date.now() + i * 86400e3).toISOString().slice(0, 10);
const zeile = (id) => db.prepare("SELECT status, origin, image_source, scheduled_for, headline, caption, image_url FROM planned_posts WHERE id=?").get(id);

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const jetzt = new Date().toISOString();
db.prepare("UPDATE customers SET company='Channoine Mayr', website='channoine-mayr.at', industry='Kosmetik', accent_color='#a36629', gradient_color2='#56441a', gradient_enabled=1, email_verified=1, tour_done_at=?, approval_mode=0 WHERE id=?").run(jetzt, id);
const KOEPFE = ["Beauty Advisor Ausbildung starten", "Starke Abwehr für jede Lebensphase", "Wissen, das Frauen verändert", "Hautpflege allein reicht nicht aus", "Winterfit mit Pflanzenkraft", "Richtige Reihenfolge für Glow"];
const posts = KOEPFE.map((h, i) => {
  const pid = `plp_w${Date.now()}_${i}`;
  db.prepare("INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, pillar_title, created_at, updated_at) VALUES (?,?,?,?,'planned',?,?,'Thema',?,?)")
    .run(pid, id, i % 2 ? "linkedin" : "ig_feed", tag(Math.floor(i / 2)), h, "Ein Beitragstext, zwei Sätze lang, wie ihn Pipeflow schreibt.", jetzt, jetzt);
  return pid;
});
const bildPng = "data:image/png;base64," + (await sharp({ create: { width: 400, height: 300, channels: 3, background: "#2244aa" } }).png().toBuffer()).toString("base64");

const browser = await chromium.launch();
for (const breite of [360, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: breite === 360 ? 780 : 900 } });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const seitenfehler = []; page.on("pageerror", (e) => seitenfehler.push(e.message));
  const lade = async () => { await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".post", { timeout: 20000 }); await page.waitForTimeout(700); };
  const karte = (pid) => page.locator(`.post[data-id="${pid}"]`);
  console.log(`\n@${breite}`);
  // Alle Beitraege auf Anfang (planned/auto) fuer jede Breite
  for (const [i, pid] of posts.entries()) db.prepare("UPDATE planned_posts SET status='planned', origin='auto', image_source='auto', scheduled_for=?, headline=?, caption='Ein Beitragstext, zwei Sätze lang, wie ihn Pipeflow schreibt.', image_url=NULL WHERE id=?").run(tag(Math.floor(i / 2)), KOEPFE[i], pid);
  db.prepare("DELETE FROM planned_posts WHERE customer_id=? AND id NOT IN (" + posts.map(() => "?").join(",") + ")").run(id, ...posts);
  await lade();

  // 1) Karte: Zustand, zwei Handlungen, kein Ziehen
  const k = await page.evaluate((pid) => {
    const el = document.querySelector(`.post[data-id="${pid}"]`);
    const a = [...el.querySelectorAll(".post-actions .link")];
    return { zust: el.querySelector(".zust")?.textContent.trim(), sichtbar: a.filter((b) => !b.classList.contains("mehr")).map((b) => b.textContent.trim()), mehr: Boolean(el.querySelector("[data-mehr]")), ziehen: document.querySelectorAll("[data-drag], [data-move]").length, ziele: a.map((b) => Math.round(b.getBoundingClientRect().height)) };
  }, posts[0]);
  ok(`Karte zeigt Zustand und genau zwei Handlungen plus ···, nichts zum Ziehen`, k.zust === "Geplant" && k.sichtbar.join("|") === "Bearbeiten|Überspringen" && k.mehr && k.ziehen === 0, JSON.stringify(k));
  ok(`Tippziele mindestens 44 px`, Math.min(...k.ziele) >= 44, k.ziele.join(","));

  // 2) Bearbeiten -> Speichern -> Zustand + Herkunft, dann Rueckgaengig
  await karte(posts[0]).locator("[data-bearbeiten]").click();
  await page.waitForSelector("#f-bearbeiten", { timeout: 5000 });
  await page.fill("#b-kopf", "Mein eigener Titel");
  await page.fill("#b-text", "Mein eigener Text, so wie ich es sage.");
  await page.click("#f-bearbeiten button[type=submit]");
  await page.waitForSelector("#rueck", { timeout: 8000 });
  let z = zeile(posts[0]);
  ok("Bearbeiten speichert, Zustand 'Von dir bearbeitet', Herkunft kunde", z.headline === "Mein eigener Titel" && z.status === "edited" && z.origin === "kunde" && (await karte(posts[0]).locator(".zust").textContent()).trim() === "Von dir bearbeitet");
  await page.click("#rueck [data-undo]");
  await page.waitForTimeout(700);
  z = zeile(posts[0]);
  ok("Rueckgaengig stellt den Text wieder her, Herkunft bleibt geschuetzt", z.headline === KOEPFE[0] && z.status === "planned" && z.origin === "kunde", JSON.stringify(z));

  // 3) Ueberspringen -> Doch posten
  await karte(posts[1]).locator("[data-skip-plan]").click();
  await page.waitForSelector("#rueck", { timeout: 8000 }); await page.evaluate(() => document.querySelector("#rueck")?.remove());
  ok("Ueberspringen daempft die Karte und zeigt 'Doch posten'", zeile(posts[1]).status === "rejected" && (await karte(posts[1]).locator("[data-unskip]").count()) === 1 && (await karte(posts[1]).evaluate((e) => e.classList.contains("ist-uebersprungen"))));
  await karte(posts[1]).locator("[data-unskip]").click();
  await page.waitForTimeout(700);
  ok("Doch posten holt ihn zurueck", zeile(posts[1]).status === "planned", zeile(posts[1]).status);

  // 4) Anderer Tag: belegte Tage gesperrt, freier Tag waehlbar
  await karte(posts[2]).locator("[data-mehr]").click();
  await page.waitForSelector("#f-bearbeiten", { timeout: 5000 });
  await page.click("[data-tag-blatt]");
  await page.waitForSelector("#f-tag", { timeout: 5000 });
  const chips = await page.evaluate(() => [...document.querySelectorAll("#f-tag .chip")].map((c) => ({ t: c.textContent.trim(), aus: c.querySelector("input").disabled })));
  ok("Belegte Tage sind als 'belegt' gesperrt", chips.filter((c) => c.aus).length === 2 && chips.filter((c) => c.aus).every((c) => /belegt/.test(c.t)), chips.filter((c) => c.aus).map((c) => c.t).join("|"));
  await page.click(`#f-tag input[value="${tag(5)}"] + span`);
  await page.click("#f-tag button[type=submit]");
  await page.waitForSelector("#rueck", { timeout: 8000 }); await page.evaluate(() => document.querySelector("#rueck")?.remove());
  ok("Verschieben auf einen freien Tag", zeile(posts[2]).scheduled_for === tag(5) && zeile(posts[2]).origin === "kunde", zeile(posts[2]).scheduled_for);

  // 5) Eigener Beitrag mit Bild in Markenfarben
  await page.click("#eigen-neu");
  await page.waitForSelector("#f-eigen", { timeout: 5000 });
  await page.click(`#f-eigen input[name="scheduledFor"][value="${tag(6)}"] + span`);
  await page.fill("#e-kopf", "Tag der offenen Tür");
  await page.fill("#e-text", "Kommt vorbei, wir zeigen die neue Linie live.");
  await page.click("#f-eigen button[type=submit]");
  await page.waitForSelector("#rueck", { timeout: 20000 }); await page.evaluate(() => document.querySelector("#rueck")?.remove());
  const eigen = db.prepare("SELECT id, status, origin, image_url, pillar_title FROM planned_posts WHERE customer_id=? AND headline='Tag der offenen Tür'").get(id);
  ok("Eigener Beitrag eingeplant, als solcher erkennbar, mit Bild in den Markenfarben", Boolean(eigen) && eigen.origin === "kunde" && eigen.status === "edited" && eigen.pillar_title === null && Boolean(eigen.image_url) && (await page.locator(`.post[data-id="${eigen.id}"] .zust`).textContent()).trim() === "Eigener Beitrag", JSON.stringify(eigen));

  // 6) Eigenes Bild hochladen
  await karte(posts[3]).locator("[data-bearbeiten]").click();
  await page.waitForSelector("#f-bearbeiten", { timeout: 5000 });
  await page.setInputFiles("#bild-datei", { name: "eigen.png", mimeType: "image/png", buffer: Buffer.from(bildPng.split(",")[1], "base64") });
  await page.waitForSelector("#rueck", { timeout: 20000 }); await page.evaluate(() => document.querySelector("#rueck")?.remove());
  ok("Eigenes Bild gesetzt, als Kundenbild markiert", zeile(posts[3]).image_source === "kunde" && /^https?:\/\//.test(zeile(posts[3]).image_url || ""), String(zeile(posts[3]).image_url).slice(0, 40));

  // 7) Pause-Zeile
  await page.click("[data-pause='1']");
  await page.waitForTimeout(700);
  ok("Pausieren ueber die Zeile, Fortsetzen ebenso", (await page.locator(".offen.ist-pausiert").count()) === 1 && db.prepare("SELECT customer_paused p FROM customers WHERE id=?").get(id).p === 1);
  await page.click("[data-pause='0']"); await page.waitForTimeout(500);

  if (breite === 360) {
    // 8) Einzeln neu schreiben lassen (KI, rund 0,002 USD)
    await karte(posts[4]).locator("[data-mehr]").click();
    await page.waitForSelector("#f-bearbeiten", { timeout: 5000 });
    await page.click("[data-regen]");
    await page.waitForSelector("#rueck", { timeout: 60000 }); await page.evaluate(() => document.querySelector("#rueck")?.remove());
    const n = zeile(posts[4]);
    ok("Einzeln neu geschrieben: nur dieser Beitrag, danach Kundenarbeit", n.headline !== KOEPFE[4] && n.origin === "kunde" && zeile(posts[5]).headline === KOEPFE[5], n.headline);
    await page.screenshot({ path: "docs/easy-onboarding/konzept/gebaut-woche-360.png", fullPage: true });
  } else {
    await page.screenshot({ path: "docs/easy-onboarding/konzept/gebaut-woche-1440.png" });
  }
  ok(`@${breite}: Keine Skriptfehler`, seitenfehler.length === 0, seitenfehler.join(" | ").slice(0, 120));
  await ctx.close();
}
await browser.close();
await fetch(`${BASE}${MOUNT}/api/start/test/end`, { method: "POST", headers: { cookie: ck } });
console.log(fehler ? `\n${fehler} Problem(e)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
