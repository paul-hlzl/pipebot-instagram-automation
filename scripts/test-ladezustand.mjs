/**
 * Der Ergebnisbildschirm erscheint fertig (Auftrag 19.09.2026).
 *
 * Geprueft wird das, was der Kunde sieht: kein Nachpoppen, kein Springen - und wie lange er
 * tatsaechlich auf den Ladezustand schaut. Gemessen wird an einem ECHTEN Durchlauf (kostet
 * rund 0,03 USD je Breite), nicht an einer Nachbildung.
 *
 *   node scripts/test-ladezustand.mjs
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = process.env.SANDBOX_URL ?? "https://mcp.pipebot.at";
const MOUNT = "/panel/sandbox";
const WEBSITE = process.env.TEST_WEBSITE ?? "channoine-mayr.at";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const KEY = (() => { const j = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8")); return (Array.isArray(j.apps) ? j.apps[0] : j).env.PANEL_TEST_KEY; })();
let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session="));

const zeiten = [];
const browser = await chromium.launch();

for (const [breite, hoehe] of [[360, 780], [1440, 900]]) {
  // Jede Breite mit frischem Kunden UND ohne Zwischenspeicher: das ist der langsamste Fall,
  // den ein echter Neukunde erlebt.
  db.prepare("DELETE FROM domain_cache WHERE domain = ?").run(WEBSITE);
  const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
  const ck = cookieOf(ein);
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe } });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${MOUNT}/start/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#website", { timeout: 20000 });

  // Mitschreiben, was sich auf dem Ergebnisbildschirm noch bewegt, nachdem er da ist.
  await page.evaluate(() => {
    window.__beben = { karten: [], hoehen: [] };
    window.__beben.spur = [];
    const beo = new MutationObserver((records) => {
      if (!document.querySelector(".streifen")) return;
      window.__beben.karten.push(document.querySelectorAll(".tagdetail .post, .tagkarte").length);
      window.__beben.hoehen.push(document.documentElement.scrollHeight);
      window.__beben.spur.push({
        t: Math.round(performance.now()),
        tage: document.querySelectorAll(".tagkarte").length,
        posts: document.querySelectorAll(".tagdetail .post").length,
        ziele: records.map((r) => (r.target.className || r.target.nodeName || "?").toString().slice(0, 30)),
      });
    });
    beo.observe(document.getElementById("stage"), { childList: true, subtree: true });
  });

  await page.fill("#website", WEBSITE);
  const t0 = Date.now();
  await page.click("#btn-vorschau");
  // Seit dem neuen Ladebildschirm (19.09.2026) heisst der Block .lade-zeile, nicht mehr .steps.
  await page.waitForSelector(".lade-zeile", { timeout: 20000 });
  const tLade = Date.now();
  await page.waitForSelector(".streifen", { timeout: 120000 });
  const tFertig = Date.now();
  // Zwei Sekunden zusehen, ob noch etwas nachrueckt.
  await page.waitForTimeout(2500);

  const m = await page.evaluate(() => {
    const bilder = [...document.querySelectorAll(".tagdetail .post img, .tagkarte img")];
    return {
      karten: window.__beben.karten,
      hoehen: window.__beben.hoehen,
      bilder: bilder.length,
      geladen: bilder.filter((b) => b.complete && b.naturalWidth > 0).length,
      platzhalter: document.querySelectorAll(".tagdetail .kachel-notiz, .skeleton").length,
      spur: window.__beben.spur,
    };
  });
  const wartezeit = (tFertig - t0) / 1000;
  zeiten.push({ breite, wartezeit, ladezustand: (tFertig - tLade) / 1000 });
  console.log(`\n@${breite}: Ladezustand ${((tFertig - tLade) / 1000).toFixed(1)} s, gesamt ab Klick ${wartezeit.toFixed(1)} s`);
  ok(`@${breite}: Beim Erscheinen sind alle Bilder schon geladen`, m.bilder > 0 && m.geladen === m.bilder, `${m.geladen} von ${m.bilder}`);
  ok(`@${breite}: Keine Platzhalter im sichtbaren Tag`, m.platzhalter === 0, String(m.platzhalter));
  const kartenStabil = new Set(m.karten).size <= 1;
  const hoehenStabil = new Set(m.hoehen).size <= 1;
  if (!kartenStabil) console.log("   Spur:", JSON.stringify(m.spur));
  ok(`@${breite}: Nach dem Erscheinen kommt keine Karte mehr dazu`, kartenStabil, `Werte: ${[...new Set(m.karten)].join(", ") || "keine Aenderung"}`);
  ok(`@${breite}: Die Seite springt nicht in der Hoehe`, hoehenStabil, `Werte: ${[...new Set(m.hoehen)].join(", ") || "keine Aenderung"}`);
  await page.screenshot({ path: `docs/easy-onboarding/layout/fertig-${breite}.png` });
  await ctx.close();
  await fetch(`${BASE}${MOUNT}/api/start/test/end`, { method: "POST", headers: { cookie: ck } });
}

// ---- Ein haengendes Bild darf den Bildschirm nicht blockieren -----------------------------
{
  console.log("\nEin Bild haengt:");
  const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
  const ck = cookieOf(ein);
  const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
  // Zwischenspeicher ist jetzt warm - der Lauf ist schnell, es geht hier nur ums Bild.
  await fetch(`${BASE}${MOUNT}/api/start/preview`, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ website: WEBSITE }) });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await (await fetch(`${BASE}${MOUNT}/api/start/status`, { headers: { cookie: ck } })).json();
    if (["done", "error", "idle"].includes(st.job?.phase ?? "idle") && (st.posts || []).length) break;
  }
  // Eine Bildadresse im Browser haengen lassen. Eine unerreichbare IP taugt dafuer NICHT:
  // die scheitert sofort, und "sofort gescheitert" ist kein Haenger. Playwright haelt die
  // Anfrage stattdessen offen, ohne sie je zu beantworten - genau der Fall aus dem Auftrag.
  const erster = db.prepare("SELECT image_url FROM planned_posts WHERE customer_id = ? AND image_url IS NOT NULL ORDER BY scheduled_for LIMIT 1").get(id);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(erster.image_url, () => { /* nie beantworten */ });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const t = Date.now();
  await page.goto(`${BASE}${MOUNT}/start/`, { waitUntil: "domcontentloaded" });
  let erschienen = null;
  try {
    await page.waitForSelector(".streifen", { timeout: 30000 });
    erschienen = (Date.now() - t) / 1000;
  } catch { /* nicht erschienen */ }
  ok("Der Bildschirm kommt trotzdem", erschienen !== null, erschienen ? `${erschienen.toFixed(1)} s` : "nie");
  // Die Notbremse beim Vorladen steht auf 9 Sekunden - der Bildschirm muss also warten,
  // aber deutlich darunter bleiben statt ewig zu haengen.
  ok("Er wartet auf das Bild, gibt aber auf", erschienen !== null && erschienen >= 7 && erschienen < 15, erschienen ? `${erschienen.toFixed(1)} s` : "-");
  await ctx.close();
  await fetch(`${BASE}${MOUNT}/api/start/test/end`, { method: "POST", headers: { cookie: ck } });
}

await browser.close();

console.log("\nWartezeit auf den Ladezustand:");
for (const z of zeiten) console.log(`  ${String(z.breite).padStart(4)} px: ${z.ladezustand.toFixed(1)} s`);
const laengste = Math.max(...zeiten.map((z) => z.ladezustand));
ok(`Die laengste Wartezeit bleibt unter 60 s`, laengste < 60, `${laengste.toFixed(1)} s`);
console.log(fehler ? `\n${fehler} Problem(e)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
