/**
 * Der Ladebildschirm zeigt echte Zwischenergebnisse (Ansage vom 19.09.2026).
 *
 * Die Zustaende werden GESTELLT, nicht erzeugt: so laesst sich jede Phase einzeln ansehen,
 * der Ablauf ist wiederholbar, und es kostet keinen KI-Aufruf.
 *
 *   node scripts/test-ladebildschirm.mjs
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = "https://mcp.pipebot.at", MOUNT = "/panel/sandbox";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const KEY = (() => { const j = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8")); return (Array.isArray(j.apps) ? j.apps[0] : j).env.PANEL_TEST_KEY; })();
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session="));
let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };

const THEMEN = ["Individuelle Hautbildanalyse", "Beauty-Routinen richtig anwenden", "Beauty von innen", "Ganzheitliche Vitalität", "Cruelty-Free und nachhaltig", "Beauty Advisor Ausbildung", "Unternehmerische Entwicklung", "Make-up Artist Spezialisierung", "Vitalcoach für Wohlbefinden"];
const KOEPFE = ["Richtige Reihenfolge für strahlende Haut", "Gesundheit ist dein größtes Kapital", "Make-up Finishing perfektionieren", "Schönheit mit Herz für Tiere", "Texturen richtig schichten für Glow", "Dein Beauty Business startet hier", "Morgens strahlend, abends erholt", "Wissen, das Frauen verändert", "Energie tanken statt ausbrennen", "Strahlend von innen heraus"];
const gefunden = { company: "Channoine Mayr", pillars: THEMEN, colors: { accentColor: "#a36629", gradientColor2: "#56441a" }, cached: false };
const post = (i) => ({ id: `p${i}`, channel: i % 2 ? "linkedin" : "ig_feed", scheduledFor: `2026-09-2${1 + Math.floor(i / 2)}`, status: "planned", headline: KOEPFE[i], caption: "Text", imageUrl: "" });

const BUEHNEN = [
  { name: "1-liest", job: { phase: "reading", done: 0, total: 0 }, posts: [] },
  { name: "2-farben-und-themen", job: { phase: "colors", done: 0, total: 0, found: gefunden }, posts: [] },
  { name: "3-schreibt", job: { phase: "writing", done: 4, total: 10, found: gefunden }, posts: [0, 1, 2, 3].map(post) },
  { name: "4-fast-fertig", job: { phase: "writing", done: 9, total: 10, found: gefunden }, posts: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(post) },
];

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
// Website setzen, damit die Ueberschrift dieselbe ist wie im Echtbetrieb.
const kid = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
db.prepare("UPDATE customers SET website = 'channoine-mayr.at' WHERE id = ?").run(kid);
const browser = await chromium.launch();
let stufe = 0;
for (const breite of [360, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: breite === 360 ? 780 : 900 } });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  await ctx.route(`**${MOUNT}/api/start/status`, async (route) => {
    const echt = await route.fetch();
    const daten = await echt.json();
    const b = BUEHNEN[stufe];
    await route.fulfill({ json: { ...daten, job: b.job, posts: b.posts } });
  });
  const page = await ctx.newPage();
  console.log(`\n@${breite}`);
  for (let i = 0; i < BUEHNEN.length; i++) {
    stufe = i;
    await page.goto(`${BASE}${MOUNT}/start/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".lade-liste", { timeout: 20000 });
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => ({
      kopf: document.querySelector("h1")?.textContent?.trim(),
      zeit: document.querySelector(".lede")?.textContent?.trim(),
      zeilen: document.querySelectorAll(".lade-zeile").length,
      farbpunkte: document.querySelectorAll(".lade-punkt").length,
      themen: document.querySelectorAll(".lade-thema").length,
      koepfe: document.querySelectorAll(".lade-kopfzeilen li").length,
      rahmen: [...document.querySelectorAll(".lade-liste *")].filter((e) => getComputedStyle(e).borderWidth !== "0px" && getComputedStyle(e).borderStyle !== "none").length,
      hoehe: document.documentElement.scrollHeight,
      fenster: innerHeight,
    }));
    if (breite === 360) await page.screenshot({ path: `docs/easy-onboarding/layout/lade-${BUEHNEN[i].name}.png` });
    console.log(`  ${BUEHNEN[i].name.padEnd(20)} ${JSON.stringify(m)}`);
    if (i === 0) ok(`@${breite}: Zuerst steht da, welche Website gelesen wird`, /channoine-mayr\.at/i.test(m.kopf || ""), m.kopf);
    if (i === 1) {
      ok(`@${breite}: Die erkannten Farben erscheinen als Farbe`, m.farbpunkte === 2, `${m.farbpunkte} Punkte`);
      ok(`@${breite}: Die gefundenen Themen stehen ausgeschrieben da`, m.themen === THEMEN.length, `${m.themen} Themen`);
    }
    if (i === 1 && breite === 360) {
      const start = await page.evaluate(() => [...document.querySelectorAll(".lade-thema")].map((e) => Math.round(e.getBoundingClientRect().left)));
      const links = Math.min(...start);
      const trenner = await page.evaluate(() => [...document.querySelectorAll(".lade-trenner")].filter((e) => e.getBoundingClientRect().left <= 20).length);
      ok("@360: Kein Trennpunkt rutscht an den Zeilenanfang", trenner === 0, `${trenner} am Rand, linkeste Themenkante ${links}`);
    }
    if (i === 3) {
      ok(`@${breite}: Die geschriebenen Überschriften erscheinen`, m.koepfe >= 5, `${m.koepfe} Zeilen`);
      ok(`@${breite}: Der Ladebildschirm bleibt ohne Rahmen und Kästen`, m.rahmen === 0, `${m.rahmen} gerahmte Elemente`);
      if (breite === 360) ok(`@360: Passt ohne Scrollen auf zwei Bildschirmlängen`, m.hoehe / m.fenster <= 2, `${(m.hoehe / m.fenster).toFixed(1)}`);
    }
  }
  await ctx.close();
}
await browser.close();
await fetch(`${BASE}${MOUNT}/api/start/test/end`, { method: "POST", headers: { cookie: ck } });
console.log(fehler ? `\n${fehler} Problem(e)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
