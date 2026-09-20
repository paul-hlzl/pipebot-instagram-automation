/**
 * Kopfzeile: Bilder von "Pipeflow ✕ Kundenlogo" bei 360 und 1440, mit zwei Sorten Logo
 * (breite Wortmarke, quadratisches Zeichen). Fuer den Vorher-Nachher-Vergleich.
 *   node scripts/kopfzeile-bilder.mjs vorher|nachher
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import Database from "better-sqlite3";
import fs from "node:fs";

const STAND = process.argv[2] === "nachher" ? "nachher" : "vorher";
const BASE = "https://mcp.pipebot.at", MOUNT = "/panel/sandbox";
const ZIEL = "docs/easy-onboarding/kopfzeile";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const KEY = (() => { const j = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8")); return (Array.isArray(j.apps) ? j.apps[0] : j).env.PANEL_TEST_KEY; })();
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session="));

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const jetzt = new Date().toISOString();
db.prepare("UPDATE customers SET company='Mayr Kosmetik', industry='Kosmetik', website='mayr-kosmetik.at', accent_color='#0f7d63', gradient_color2='#355cf0', gradient_enabled=1, email_verified=1, tour_done_at=? WHERE id=?").run(jetzt, id);
fs.mkdirSync(ZIEL, { recursive: true });

const LOGOS = [
  { name: "wort", datei: "/root/testlogos/wortmarke.png", kachel: 0 },
  { name: "quadrat", datei: "/root/testlogos/quadrat.png", kachel: 1 },
  { name: "einzeilig", datei: "/root/testlogos/einzeilig.png", kachel: 0 },
];

const browser = await chromium.launch();
for (const logo of LOGOS) {
  db.prepare("UPDATE customers SET logo_url=NULL, detected_logo_url=?, detected_logo_tile=? WHERE id=?").run(logo.datei, logo.kachel, id);
  for (const breite of [360, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: breite, height: 520 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
    const page = await ctx.newPage();
    // "vorher" = der Stand vom 19.09.2026, hier als Stylesheet zurueckgespielt statt die
    // Sandbox hin- und herzuschieben: Logo 32 px (Kachel 28), ohne eigene Hoehe, 2 px nach
    // unten versetzt - genau die Regeln, die vorher in start.css standen.
    const altStil = `
        .marke-kunde { margin: 2px auto 0 14px !important; height: auto !important; }
        .marke-kunde img { height: 32px !important; max-width: 168px !important; }
        .marke-kunde.kachel-logo img { height: 28px !important; max-width: 28px !important; border-radius: 7px !important; }
        @media (max-width: 420px) {
          .marke-kunde { margin: 2px 0 0 !important; }
          .marke-kunde img { height: 26px !important; max-width: 160px !important; }
          .marke-kunde.kachel-logo img { height: 26px !important; max-width: 26px !important; }
        }`;
    await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#marke-kunde:not([hidden]) img", { timeout: 20000 });
    if (STAND === "vorher") await page.addStyleTag({ content: altStil });
    // Der Eroeffnungs-Vorhang liegt ueber der Seite und wuerde die Kopfzeile schwarz machen.
    await page.waitForSelector("#splash", { state: "detached", timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(900); // Einblend-Animation des Logos zu Ende
    const datei = `${ZIEL}/${STAND}-${breite}-${logo.name}.png`;
    await page.locator("#top").screenshot({ path: datei });
    const box = await page.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { oben: Math.round(b.top), hoehe: Math.round(b.height), mitte: Math.round(b.top + b.height / 2), breite: Math.round(b.width) }; };
      return { name: r(".marke-name"), logo: r("#marke-kunde-bild"), huelle: r("#marke-kunde") };
    });
    console.log(`${STAND} ${breite} ${logo.name}: Wortmarke Mitte ${box.name?.mitte}, Logo Mitte ${box.logo?.mitte}, Logo ${box.logo?.breite}x${box.logo?.hoehe}`);
    await ctx.close();
  }
}
await browser.close();
console.log(`Bilder unter ${ZIEL}/${STAND}-*.png`);
