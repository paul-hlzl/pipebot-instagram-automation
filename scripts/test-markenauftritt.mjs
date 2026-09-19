/**
 * Marke in der Oberflaeche (Auftrag 19.09.2026): Logo in der Kopfzeile, Markenfarben im
 * Lichtschein. Die Bedingungen des Auftrags sind hier die Pruefungen:
 *   - Lesbarkeit und Kontraste bleiben wie gemessen (Text >= 16:1, Karte zu Grund >= 11)
 *   - die Beitragsvorschauen bleiben das Auffaelligste, sie verschwimmen nicht mit dem Grund
 *   - ohne Logo oder Farben greift still das Standardaussehen
 *
 *   node scripts/test-markenauftritt.mjs
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = process.env.SANDBOX_URL ?? "https://mcp.pipebot.at";
const MOUNT = "/panel/sandbox";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const KEY = (() => { const j = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8")); return (Array.isArray(j.apps) ? j.apps[0] : j).env.PANEL_TEST_KEY; })();
let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session="));

/** Relative Helligkeit nach WCAG. */
function leuchte([r, g, b]) {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const kontrast = (a, b) => { const l1 = leuchte(a), l2 = leuchte(b); const [h, d] = l1 > l2 ? [l1, l2] : [l2, l1]; return (h + 0.05) / (d + 0.05); };
const zahl = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const cookie = ck;
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
// Erst der Zustand VOR der Analyse: keine Marke bekannt, also muss die Oberflaeche still
// beim Standardaussehen bleiben (Bedingung aus dem Auftrag).
{
  const browser0 = await chromium.launch();
  const ctx0 = await browser0.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx0.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const p0 = await ctx0.newPage();
  await p0.goto(`${BASE}${MOUNT}/start/`, { waitUntil: "domcontentloaded" });
  await p0.waitForSelector("#website", { timeout: 20000 });
  await p0.waitForTimeout(1200);
  const v = await p0.evaluate(() => ({
    logo: !document.querySelector("#marke-kunde").hidden,
    licht: getComputedStyle(document.documentElement).getPropertyValue("--licht-1").trim(),
  }));
  ok("Ohne erkannte Marke: kein Logo in der Kopfzeile", v.logo === false);
  ok("Ohne erkannte Marke: das Licht bleibt neutrales Grau", /13, 13, 13/.test(v.licht), v.licht);
  await browser0.close();
}

await fetch(`${BASE}${MOUNT}/api/start/preview`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ website: "channoine-mayr.at" }) });
for (let i = 0; i < 100; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const st = await (await fetch(`${BASE}${MOUNT}/api/start/status`, { headers: { cookie } })).json();
  if (["done", "error", "idle"].includes(st.job?.phase ?? "idle") && (st.posts || []).length) break;
}

const c = db.prepare("SELECT detected_logo_url, detected_logo_tile, accent_color FROM customers WHERE id=?").get(id);
ok("Ein Logo wurde von der Website geholt", Boolean(c.detected_logo_url) && fs.existsSync(c.detected_logo_url), String(c.detected_logo_url).split("/").pop());
if (c.detected_logo_url) {
  const sharp = (await import("sharp")).default;
  const m = await sharp(c.detected_logo_url).metadata();
  ok("Es ist gross genug fuer die Kopfzeile (mind. 3-fache Anzeigehoehe)", (m.height ?? 0) >= 72, `${m.width}x${m.height}`);
}

const browser = await chromium.launch();
for (const breite of [360, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: breite === 360 ? 780 : 900 } });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${MOUNT}/start/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".streifen", { timeout: 25000 });
  await page.waitForTimeout(2000);
  const m = await page.evaluate(() => {
    const el = (s) => document.querySelector(s);
    const stil = (s, p) => (el(s) ? getComputedStyle(el(s))[p] : null);
    const logo = el("#marke-kunde");
    const bild = el("#marke-kunde-bild");
    const karte = el(".tagdetail .post");
    const h1 = el("h1");
    return {
      logoSichtbar: Boolean(logo && !logo.hidden && bild?.complete && bild.naturalWidth > 0),
      logoHoehe: bild ? Math.round(bild.getBoundingClientRect().height) : 0,
      logoBreite: bild ? Math.round(bild.getBoundingClientRect().width) : 0,
      grundOben: stil("body", "backgroundColor"),
      licht1: getComputedStyle(document.documentElement).getPropertyValue("--licht-1").trim(),
      textFarbe: stil("h1", "color"),
      karteFarbe: karte ? getComputedStyle(karte).backgroundColor : null,
      h1Oben: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
    };
  });
  // Echte Pixel statt berechneter Werte: so sieht es der Kunde wirklich.
  const schuss = await page.screenshot({ clip: { x: 0, y: 0, width: breite, height: 400 } });
  const sharp = (await import("sharp")).default;
  const pix = async (x, y) => { const { data } = await sharp(schuss).extract({ left: x, top: y, width: 2, height: 2 }).raw().toBuffer({ resolveWithObject: true }); return [data[0], data[1], data[2]]; };
  const grund = await pix(Math.round(breite * 0.5), 300);
  const text = zahl(m.textFarbe);
  const karte = zahl(m.karteFarbe || "rgb(255,255,255)");

  console.log(`@${breite}`, JSON.stringify({ ...m, grundGemessen: `rgb(${grund.join(",")})` }));
  ok(`@${breite}: Logo ist in der Kopfzeile zu sehen`, m.logoSichtbar, `${m.logoBreite}x${m.logoHoehe}`);
  // Zwischen "zu klein zum Erkennen" und "lauter als der Produktname": 24 bis 34 px.
  ok(`@${breite}: Logo ist lesbar und bleibt dezent (24 bis 34 px)`, m.logoHoehe >= 24 && m.logoHoehe <= 34, `${m.logoHoehe} px`);
  ok(`@${breite}: Der Lichtschein traegt die Markenfarbe`, /^rgba\((?!13, 13, 13)/.test(m.licht1), m.licht1);
  const kText = kontrast(text, grund);
  ok(`@${breite}: Textkontrast bleibt wie gemessen (>= 16:1)`, kText >= 16, `${kText.toFixed(1)}:1`);
  const dKarte = Math.abs(karte.reduce((a, b) => a + b, 0) / 3 - grund.reduce((a, b) => a + b, 0) / 3);
  ok(`@${breite}: Karte hebt sich weiterhin ab (>= 11 Stufen)`, dKarte >= 11, `Delta ${dKarte.toFixed(0)}`);
  await page.screenshot({ path: `docs/easy-onboarding/layout/marke-${breite}.png` });
  await ctx.close();
}
await browser.close();
console.log(fehler ? `${fehler} Problem(e)` : "alles gruen");
process.exit(fehler ? 1 : 0);
