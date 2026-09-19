/**
 * "Pipeflow ✕ Firma" in der Kopfzeile (19.09.2026): Logo, wenn eines da ist, sonst der
 * Firmenname in der Markenfarbe an derselben Stelle. Lange Namen werden gekappt.
 *   node scripts/test-kopfzeile.mjs
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

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const browser = await chromium.launch();
const lesen = async (page) => page.evaluate(() => {
  const h = document.querySelector("#marke-kunde"), n = document.querySelector("#marke-kunde-name"), b = document.querySelector("#marke-kunde-bild");
  const top = document.querySelector("#top").getBoundingClientRect();
  return {
    sichtbar: h && !h.hidden, alsName: n && !n.hidden, alsBild: b && !b.hidden && b.naturalWidth > 0,
    text: n?.textContent ?? "", farbe: n ? getComputedStyle(n).color : null,
    nameBreite: n ? Math.round(n.getBoundingClientRect().width) : 0,
    abgeschnitten: n ? n.scrollWidth > n.clientWidth : false,
    kopfHoehe: Math.round(top.height), rechts: Math.round((h?.getBoundingClientRect().right) ?? 0), fenster: innerWidth,
    ledeFirma: [...document.querySelectorAll("h1 + .lede")].some((e) => /Channoine|Mayr/.test(e.textContent)),
  };
});
for (const breite of [360, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: breite === 360 ? 780 : 900 } });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  console.log(`\n@${breite}`);
  // 1) Vor der Analyse: nichts
  db.prepare("UPDATE customers SET company='Testlauf', website=NULL, industry=NULL, accent_color=NULL, gradient_enabled=0, detected_logo_url=NULL, tour_done_at=NULL WHERE id=?").run(id);
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector("#website", { timeout: 20000 }); await page.waitForTimeout(800);
  let m = await lesen(page); const basisHoehe = m.kopfHoehe;
  ok("Vor der Analyse bleibt die Kopfzeile ohne Zusatz", !m.sichtbar);
  // 2) Firmendaten da, kein Logo: Name in Markenfarbe
  db.prepare("UPDATE customers SET company='Channoine Mayr', website='channoine-mayr.at', industry='Kosmetik', accent_color='#a36629', gradient_color2='#56441a', gradient_enabled=1 WHERE id=?").run(id);
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector("#marke-kunde:not([hidden])", { timeout: 20000 }); await page.waitForTimeout(800);
  m = await lesen(page);
  ok("Ohne Logo steht der Firmenname da", m.alsName && m.text === "Channoine Mayr" && !m.alsBild, m.text);
  ok("... in der Markenfarbe", m.farbe === "rgb(163, 102, 41)", m.farbe);
  ok("Die Kopfzeile bleibt gleich hoch", Math.abs(m.kopfHoehe - basisHoehe) <= 2, `${m.kopfHoehe} gegen ${basisHoehe}`);
  await page.screenshot({ path: `docs/easy-onboarding/entwuerfe/kopf-name-${breite}.png`, clip: { x: 0, y: 0, width: breite, height: 260 } });
  // 3) Sehr langer Name: gekappt, nichts laeuft aus dem Fenster, Kopfzeile bleibt gleich hoch
  db.prepare("UPDATE customers SET company='Mayr Kosmetik und Hautpflege Handelsgesellschaft mbH' WHERE id=?").run(id);
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector("#marke-kunde:not([hidden])", { timeout: 20000 }); await page.waitForTimeout(800);
  m = await lesen(page);
  ok("Ein langer Name wird gekappt statt umzubrechen", m.abgeschnitten && m.kopfHoehe - basisHoehe <= 2, `${m.nameBreite} px breit, Kopf ${m.kopfHoehe}`);
  ok("Nichts laeuft aus dem Fenster", m.rechts <= m.fenster, `${m.rechts} von ${m.fenster}`);
  await page.screenshot({ path: `docs/easy-onboarding/entwuerfe/kopf-lang-${breite}.png`, clip: { x: 0, y: 0, width: breite, height: 260 } });
  // 4) Uebersicht: kein Firmenname mehr unter der Ueberschrift
  db.prepare("UPDATE customers SET company='Channoine Mayr', tour_done_at=? WHERE id=?").run(new Date().toISOString(), id);
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" }); await page.waitForSelector("h1", { timeout: 20000 }); await page.waitForTimeout(800);
  m = await lesen(page);
  ok("Unter der Ueberschrift steht der Firmenname nicht mehr", !m.ledeFirma);
  await ctx.close();
}
await browser.close();
await fetch(`${BASE}${MOUNT}/api/start/test/end`, { method: "POST", headers: { cookie: ck } });
console.log(fehler ? `\n${fehler} Problem(e)` : "\nalles gruen"); process.exit(fehler ? 1 : 0);
