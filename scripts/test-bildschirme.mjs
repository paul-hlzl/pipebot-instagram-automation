/**
 * Entwurf A1 (Kanäle verbinden) und B1 (Übersicht), freigegeben am 19.09.2026.
 *
 * Geprueft wird nicht nur "ist da", sondern ob die Proportionen stimmen: gleiche Abstaende,
 * saubere Fluchtlinien, und nichts das schwerer wirkt als seine Bedeutung. Ohne KI-Aufruf -
 * die Woche wird direkt in die Datenbank gesetzt.
 *
 *   node scripts/test-bildschirme.mjs
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
const gleich = (werte, spiel = 1) => Math.max(...werte) - Math.min(...werte) <= spiel;

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const jetzt = new Date().toISOString();
db.prepare(`UPDATE customers SET company='Channoine Mayr', website='channoine-mayr.at', accent_color='#a36629',
  gradient_color2='#56441a', gradient_enabled=1, email_verified=0 WHERE id=?`).run(id);
const KOEPFE = ["Beauty Advisor Ausbildung starten", "Starke Abwehr für jede Lebensphase", "Wissen, das Frauen verändert", "Hautpflege allein reicht nicht aus", "Winterfit mit Pflanzenkraft", "Richtige Reihenfolge für Glow", "Energie tanken statt ausbrennen", "Schönheit mit Herz für Tiere", "Dein Weg zu mehr Balance", "Strahlend von innen heraus"];
for (let i = 0; i < 10; i++) {
  const tag = new Date(Date.now() + Math.floor(i / 2) * 86400000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, created_at, updated_at)
    VALUES (?,?,?,?,'planned',?,?,?,?)`).run(`plp_${Date.now()}_${i}`, id, i % 2 ? "linkedin" : "ig_feed", tag, KOEPFE[i], "Ein Beitragstext, der die Überschrift ausführt und zwei Sätze lang ist.", jetzt, jetzt);
}

const browser = await chromium.launch();
for (const [breite, hoehe] of [[360, 780], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe } });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  console.log(`\n=== Kanäle verbinden @${breite}`);
  db.prepare("UPDATE customers SET tour_done_at = NULL WHERE id = ?").run(id);
  await page.goto(`${BASE}${MOUNT}/start/?connected=instagram&provider=instagram`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kanal-liste", { timeout: 20000 });
  await page.waitForTimeout(800);
  const a = await page.evaluate(() => {
    const zeilen = [...document.querySelectorAll(".kanal")];
    const kn = [...document.querySelectorAll(".kanal-knopf")];
    const zeichen = [...document.querySelectorAll(".kanal-zeichen")];
    const w = document.querySelector(".weiter-link");
    const g = (e) => e.getBoundingClientRect();
    return {
      zeilen: zeilen.length,
      hoehen: zeilen.map((e) => Math.round(g(e).height)),
      zeichenLinks: zeichen.map((e) => Math.round(g(e).left)),
      zeichenMass: zeichen.map((e) => `${Math.round(g(e).width)}x${Math.round(g(e).height)}`),
      knopfRechts: kn.map((e) => Math.round(g(e).right)),
      knopfHoehen: kn.map((e) => Math.round(g(e).height)),
      knopfFarben: kn.map((e) => getComputedStyle(e).backgroundColor || getComputedStyle(e).backgroundImage.slice(0, 30)),
      weiterGewicht: w ? getComputedStyle(w).fontWeight : null,
      weiterFarbe: w ? getComputedStyle(w).color : null,
      knopfGewicht: kn[0] ? getComputedStyle(kn[0]).fontWeight : null,
      rahmen: zeilen.filter((e) => getComputedStyle(e).borderTopWidth !== "0px" || getComputedStyle(e).borderLeftWidth !== "0px").length,
    };
  });
  console.log("  " + JSON.stringify(a));
  ok(`@${breite}: Alle Kanalzeilen sind gleich hoch`, gleich(a.hoehen, 2), a.hoehen.join(", "));
  ok(`@${breite}: Die Zeichen stehen auf einer Fluchtlinie`, gleich(a.zeichenLinks), a.zeichenLinks.join(", "));
  ok(`@${breite}: Die Zeichen sind quadratisch und gleich gross`, new Set(a.zeichenMass).size === 1, a.zeichenMass.join(" "));
  ok(`@${breite}: Die Knöpfe enden auf einer Kante`, gleich(a.knopfRechts), a.knopfRechts.join(", "));
  ok(`@${breite}: Die Knöpfe sind gleich hoch und mindestens 44 px`, gleich(a.knopfHoehen) && Math.min(...a.knopfHoehen) >= 44, a.knopfHoehen.join(", "));
  ok(`@${breite}: Jeder Kanal hat seine eigene Farbe, keine schwarzen Balken`, new Set(a.knopfFarben).size === a.knopfFarben.length && !a.knopfFarben.some((f) => /rgb\(13, 13, 13\)|rgb\(0, 0, 0\)/.test(f)), a.knopfFarben.join(" | "));
  ok(`@${breite}: Der Weiter-Weg wiegt weniger als die Verbinden-Knöpfe`, Number(a.weiterGewicht) < Number(a.knopfGewicht), `${a.weiterGewicht} gegen ${a.knopfGewicht}`);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `docs/easy-onboarding/entwuerfe/gebaut-kanaele-${breite}.png` });

  console.log(`\n=== Übersicht @${breite}`);
  db.prepare("UPDATE customers SET tour_done_at = ? WHERE id = ?").run(jetzt, id);
  // Eigener Parameter, damit der Browser wirklich neu laedt: die App raeumt die Adresszeile
  // nach dem ersten Laden auf, danach unterscheidet sich /start/#dashboard nur im Anker und
  // der Browser springt nur, statt die Seite neu zu starten.
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".woche", { timeout: 20000 });
  await page.waitForTimeout(900);
  const b = await page.evaluate(() => {
    const zeile = document.querySelector(".offen");
    const woche = document.querySelector(".woche");
    const kaesten = document.querySelectorAll(".notice");
    return {
      hinweisZeilen: zeile ? zeile.getBoundingClientRect().height : 0,
      punkte: zeile ? zeile.querySelectorAll("a, .link").length : 0,
      texte: zeile ? [...zeile.querySelectorAll("a, .link")].map((e) => e.textContent.trim()) : [],
      kaesten: kaesten.length,
      wocheOben: woche ? Math.round(woche.getBoundingClientRect().top + scrollY) : null,
      // Wie weit oben die Woche beim ECHTEN Kunden beginnt: ohne Testversion-Band und
      // Testleiste, die zusammen 158 px kosten und in Produktion nicht existieren.
      bandHoehe: (document.querySelector("#sandbox-banner")?.offsetHeight || 0) + (document.querySelector("#testleiste")?.offsetHeight || 0),
      seite: document.documentElement.scrollHeight,
      erklaertext: document.body.innerText.includes("dort kann noch nichts veröffentlicht werden"),
      // Die Hauptsache muss das Groesste sein: der Zusatzweg "Jetzt posten" darf nicht
      // schwerer wirken als die Beitraege.
      postenGewicht: Number(getComputedStyle(document.querySelector("#btn-jetzt-posten")).fontWeight),
      postenGefuellt: getComputedStyle(document.querySelector("#btn-jetzt-posten")).backgroundColor,
      titelOben: Math.round(document.querySelector("h1").getBoundingClientRect().top),
      postenOben: Math.round(document.querySelector("#btn-jetzt-posten").getBoundingClientRect().top),
    };
  });
  console.log("  " + JSON.stringify(b));
  ok(`@${breite}: Statt Kästen genau eine Hinweiszeile`, b.kaesten === 0 && b.punkte >= 2, `${b.kaesten} Kästen, ${b.punkte} Links`);
  ok(`@${breite}: Kurze Beschriftungen ohne Erklärsatz`, !b.erklaertext && b.texte.every((t) => t.length <= 22), b.texte.join(" | "));
  ok(`@${breite}: "Jetzt posten" tritt zurück statt als Knopf zu dominieren`, b.postenGewicht <= 500 && /rgba\(0, 0, 0, 0\)|transparent/.test(b.postenGefuellt), `${b.postenGewicht}, ${b.postenGefuellt}`);
  ok(`@${breite}: Titel und "Jetzt posten" stehen auf einer Linie`, Math.abs(b.titelOben - b.postenOben) <= 24, `${b.titelOben} gegen ${b.postenOben}`);
  const kundensicht = b.wocheOben - b.bandHoehe;
  ok(`@${breite}: Die Woche beginnt beim Kunden in der oberen Bildschirmhälfte`, kundensicht <= (breite === 360 ? 390 : 420), `${kundensicht} px von ${breite === 360 ? 780 : 900} (in der Sandbox ${b.wocheOben}, davon ${b.bandHoehe} Testbänder)`);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `docs/easy-onboarding/entwuerfe/gebaut-uebersicht-${breite}.png` });
  await ctx.close();
}
await browser.close();
await fetch(`${BASE}${MOUNT}/api/start/test/end`, { method: "POST", headers: { cookie: ck } });
console.log(fehler ? `\n${fehler} Problem(e)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
