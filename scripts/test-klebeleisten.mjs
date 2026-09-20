/**
 * Klebende Leisten duerfen ueber dem Inhalt liegen - aber nichts dauerhaft verdecken (20.09.2026).
 *   node scripts/test-klebeleisten.mjs
 *
 * Der Befund, der das ausgeloest hat: auf dem Ergebnisbildschirm lag der "Passt, weiter"-Balken
 * am Handy ueber der Beitragskarte. Der bisherige Ueberlappungstest konnte das nicht finden, weil
 * er klebende Leisten ausdruecklich ausgenommen hat ("liegt gewollt ueber dem Inhalt").
 *
 * Geprueft wird deshalb am ENDE der Seite: was dort noch unter einer Leiste liegt, bekommt der
 * Kunde nie zu sehen - egal wie weit er scrollt. Kostet nichts, ruft keine KI.
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
const tag = (i) => new Date(Date.now() + i * 86400e3).toISOString().slice(0, 10);
const BILD = "https://pub-ca94c8f7d991428986a52fce66b47718.r2.dev/posts/2026-09-19T18-59-00-359Z-d74b7401-98f9-492e-b11d-eb318c63ee56.jpg";

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const jetzt = new Date().toISOString();
// tour_done_at NULL = noch nicht eingerichtet: ein Tipp auf die Marke fuehrt zum Ergebnisbildschirm.
db.prepare("UPDATE customers SET company='Mayr Kosmetik', industry='Kosmetik', email_verified=1, tour_done_at=NULL, approval_mode=0, ig_feed_enabled=1, ig_story_enabled=0, linkedin_enabled=0 WHERE id=?").run(id);
db.prepare("DELETE FROM planned_posts WHERE customer_id=?").run(id);
const KOEPFE = ["Beauty Advisor Ausbildung starten", "Starke Abwehr für jede Lebensphase", "Wissen, das Frauen verändert"];
KOEPFE.forEach((h, i) => db.prepare("INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, image_url, pillar_title, created_at, updated_at) VALUES (?,?,?,?,'planned',?,?,?,'Thema',?,?)")
  .run(`plp_k${Date.now()}_${i}`, id, "ig_feed", tag(i), h, "Ein Beitragstext, zwei Sätze lang, wie ihn Pipeflow schreibt. Mit etwas mehr Text, damit die Karte Höhe bekommt.", BILD, jetzt, jetzt));

/** Was liegt unter einer klebenden Leiste, ohne dass Scrollen es hervorholen koennte? */
const verdeckt = async (page, wo = "ende") => page.evaluate((wo) => {
  window.scrollTo(0, wo === "ende" ? document.documentElement.scrollHeight : 0);
  const sichtbar = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0" && r.width > 0 && r.height > 0; };
  const leisten = [...document.querySelectorAll("*")].filter((e) => {
    const s = getComputedStyle(e);
    return (s.position === "sticky" || s.position === "fixed") && sichtbar(e) && e.getBoundingClientRect().height > 12 && s.backgroundImage + s.backgroundColor !== "nonergba(0, 0, 0, 0)";
  });
  const inLeiste = (e) => leisten.some((l) => l === e || l.contains(e));
  const kandidaten = [...document.querySelectorAll("h1, h2, h3, p, img, button, a, article, .post, .kachel")].filter((e) => sichtbar(e) && !inLeiste(e) && !e.closest("#splash, .sheet-overlay"));
  const treffer = [];
  for (const l of leisten) {
    const rl = l.getBoundingClientRect();
    for (const e of kandidaten) {
      const re = e.getBoundingClientRect();
      if (re.bottom <= 0 || re.top >= window.innerHeight) continue; // ausserhalb des Sichtfelds
      const y = Math.min(re.bottom, rl.bottom) - Math.max(re.top, rl.top);
      const x = Math.min(re.right, rl.right) - Math.max(re.left, rl.left);
      if (x <= 2 || y <= 2) continue;
      const mitteDrin = re.top + re.height / 2 >= rl.top && re.top + re.height / 2 <= rl.bottom && re.left + re.width / 2 >= rl.left && re.left + re.width / 2 <= rl.right;
      if (mitteDrin || y > re.height * 0.6) {
        treffer.push(`${(l.className || l.tagName).toString().split(" ")[0]} verdeckt ${(e.tagName + "." + (e.className || "").toString().split(" ")[0]).slice(0, 26)}"${(e.textContent || "").trim().slice(0, 18)}"`);
      }
    }
  }
  return { leisten: leisten.map((l) => (l.className || l.tagName).toString().split(" ")[0]), treffer: [...new Set(treffer)].slice(0, 6) };
}, wo);

const browser = await chromium.launch();
for (const breite of [360, 1440]) {
  console.log(`\n@${breite}`);
  // Vor jeder Breite zurueck auf "noch nicht eingerichtet" - nur dann fuehrt die Marke auf den
  // Ergebnisbildschirm (der spaetere Teil setzt tour_done_at, um aufs Dashboard zu kommen).
  db.prepare("UPDATE customers SET tour_done_at=NULL WHERE id=?").run(id);
  const ctx = await browser.newContext({ viewport: { width: breite, height: breite === 360 ? 780 : 900 } });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#splash", { state: "detached", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  // Ueber die Marke auf den Ergebnisbildschirm (ein Konto ohne abgeschlossene Einrichtung)
  await page.click(".marke");
  await page.waitForSelector(".sticky-actions", { timeout: 15000 });
  await page.waitForTimeout(700);
  const e = await verdeckt(page, "ende");
  console.log(`  klebende Leisten: ${e.leisten.join(", ") || "keine"}`);
  ok("Ergebnisbildschirm: am Seitenende verdeckt keine Leiste Inhalt", e.treffer.length === 0, e.treffer.join(" | "));
  // Der Fall, der am 20.09. durchgerutscht ist: die Seite ist LAENGER als das Sichtfeld, und die
  // Leiste sitzt beim Ankommen auf der Beitragskarte. Sie darf darueber liegen - aber die Karte
  // muss sich darunter hervorscrollen lassen, und dafuer muss sie ueberhaupt Platz dahinter haben.
  const anfang = await verdeckt(page, "anfang");
  const scrollbar = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight > 4);
  ok("Ergebnisbildschirm: beim Ankommen nichts unter einer Leiste, das nicht wegscrollbar waere",
    anfang.treffer.length === 0 || scrollbar, `${anfang.treffer.join(" | ")} (scrollbar: ${scrollbar})`);

  // Bildschirm mit klebender Leiste im Blatt: Bearbeiten oeffnen, dort klebt die Knopfzeile unten
  db.prepare("UPDATE customers SET tour_done_at=? WHERE id=?").run(jetzt, id);
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#woche .post", { timeout: 20000 });
  await page.waitForTimeout(500);
  const karte = page.locator("#woche .post [data-bearbeiten]").first();
  if (await karte.count()) {
    await karte.click();
    await page.waitForSelector(".sheet", { timeout: 8000 });
    await page.waitForTimeout(600);
    const imBlatt = await page.evaluate(() => {
      const blatt = document.querySelector(".sheet");
      blatt.scrollTop = blatt.scrollHeight;
      const leisten = [...blatt.querySelectorAll("*")].filter((e) => ["sticky", "fixed"].includes(getComputedStyle(e).position) && e.getBoundingClientRect().height > 12);
      const treffer = [];
      for (const l of leisten) {
        const rl = l.getBoundingClientRect();
        for (const e of blatt.querySelectorAll("input, textarea, button, label, p, img")) {
          if (l === e || l.contains(e)) continue;
          const re = e.getBoundingClientRect();
          if (re.width < 2 || re.height < 2) continue;
          const y = Math.min(re.bottom, rl.bottom) - Math.max(re.top, rl.top);
          const x = Math.min(re.right, rl.right) - Math.max(re.left, rl.left);
          const mitte = re.top + re.height / 2;
          if (x > 2 && y > 2 && mitte >= rl.top && mitte <= rl.bottom) treffer.push(`${(e.tagName + (e.id ? "#" + e.id : "")).slice(0, 20)}`);
        }
      }
      return { leisten: leisten.length, treffer: [...new Set(treffer)].slice(0, 5) };
    });
    ok("Blatt 'Bearbeiten': die klebende Knopfzeile verdeckt kein Feld", imBlatt.treffer.length === 0, `${imBlatt.leisten} Leiste(n), ${imBlatt.treffer.join(", ")}`);
    await page.keyboard.press("Escape").catch(() => {});
  } else {
    console.log("  (kein Bearbeiten-Knopf auf diesem Bildschirm)");
  }
  await ctx.close();
}
await browser.close();
console.log(fehler ? `\n${fehler} Bruchstelle(n)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
