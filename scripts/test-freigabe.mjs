/**
 * Das Freigabefenster (20.09.2026): feste Stelle, faellige zuerst, geplante mit Datum, beide
 * freigebbar, eine Zeile wenn nichts offen ist. Im echten Browser, bei 360 und 1440.
 *   node scripts/test-freigabe.mjs
 *
 * Kostet nichts: alle Beitraege werden direkt in die Sandbox-Datenbank gelegt, keine KI.
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

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const jetzt = new Date().toISOString();
db.prepare("UPDATE customers SET company='Channoine Mayr', email_verified=1, tour_done_at=?, approval_mode=1, ig_feed_enabled=1, ig_story_enabled=0, linkedin_enabled=1 WHERE id=?").run(jetzt, id);

const KOEPFE = ["Beauty Advisor Ausbildung starten", "Starke Abwehr für jede Lebensphase", "Wissen, das Frauen verändert"];
function aufbauen() {
  db.prepare("DELETE FROM planned_posts WHERE customer_id=?").run(id);
  db.prepare("DELETE FROM pending_approvals WHERE customer_id=?").run(id);
  const geplant = KOEPFE.map((h, i) => {
    const pid = `plp_f${Date.now()}_${i}`;
    db.prepare("INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, pillar_title, created_at, updated_at) VALUES (?,?,?,?,'planned',?,?,'Thema',?,?)")
      .run(pid, id, i % 2 ? "linkedin" : "ig_feed", tag(i + 1), h, "Ein Beitragstext, zwei Sätze lang.", jetzt, jetzt);
    return pid;
  });
  const aid = `appr_f${Date.now()}`;
  db.prepare("INSERT INTO pending_approvals (id, customer_id, provider, channel, headline, caption, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'pending',?,?)")
    .run(aid, id, "instagram", "ig_feed", "Jetzt fällig: Wer wir sind", "Dieser wartet schon in der Warteschlange.", jetzt, jetzt);
  return { geplant, aid };
}

const browser = await chromium.launch();
for (const breite of [360, 1440]) {
  console.log(`\n@${breite}`);
  const { geplant, aid } = aufbauen();
  const ctx = await browser.newContext({ viewport: { width: breite, height: breite === 360 ? 780 : 900 } });
  await ctx.addCookies([{ name: "pp_session", value: ck.split("=").slice(1).join("="), domain: "mcp.pipebot.at", path: MOUNT, httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const seitenfehler = []; page.on("pageerror", (e) => seitenfehler.push(e.message));
  // Erst wenn die Wochenansicht steht, sind BEIDE Quellen geladen (Warteschlange und geplante
  // Beitraege kommen aus zwei getrennten Abfragen - sonst misst man einen Zwischenstand).
  const lade = async () => {
    await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#freigaben-abschnitt h2", { timeout: 20000 });
    await page.waitForSelector("#woche .post", { timeout: 20000 });
    await page.waitForTimeout(500);
  };
  await lade();

  // 1) Feste Stelle: der Abschnitt steht vor der Wochenansicht
  const stelle = await page.evaluate(() => {
    const a = document.querySelector("#freigaben-abschnitt");
    const w = document.querySelector("#woche");
    return { da: Boolean(a), vorDerWoche: Boolean(a && w && (a.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING)), kopf: a?.querySelector("h2")?.textContent.trim(), zahl: a?.querySelector(".abschnitt-kopf .small")?.textContent.trim() };
  });
  ok("Abschnitt steht an fester Stelle über der Woche", stelle.da && stelle.vorDerWoche && stelle.kopf === "Wartet auf deine Freigabe", JSON.stringify(stelle));
  ok("Zählt fällige und geplante zusammen", stelle.zahl === "4", stelle.zahl);

  // 2) Reihenfolge: fällige Karte zuerst, darunter die geplanten Zeilen mit Datum
  const inhalt = await page.evaluate(() => {
    const a = document.querySelector("#freigaben-abschnitt");
    const karte = a.querySelector(".post[data-approval]");
    const zeilen = [...a.querySelectorAll(".zeile")].map((z) => ({ wann: z.querySelector(".zeile-k")?.textContent.trim(), kopf: z.querySelector(".zeile-v")?.textContent.trim(), knopf: Math.round(z.querySelector("[data-freigeben-plan]")?.getBoundingClientRect().height ?? 0) }));
    const karteVorZeile = Boolean(karte && zeilen.length && (karte.compareDocumentPosition(a.querySelector(".zeile")) & Node.DOCUMENT_POSITION_FOLLOWING));
    return { karteKopf: karte?.querySelector(".post-h")?.textContent.trim(), karteVorZeile, zeilen };
  });
  ok("Fällige zuerst, geplante darunter", inhalt.karteKopf === "Jetzt fällig: Wer wir sind" && inhalt.karteVorZeile, JSON.stringify({ k: inhalt.karteKopf, v: inhalt.karteVorZeile }));
  ok("Jede geplante Zeile nennt Datum und Kanal", inhalt.zeilen.length === 3 && inhalt.zeilen.every((z) => /\d/.test(z.wann) && /(Instagram|LinkedIn)/.test(z.wann)), JSON.stringify(inhalt.zeilen.map((z) => z.wann)));
  ok("Freigabe-Knöpfe mindestens 44 px", inhalt.zeilen.every((z) => z.knopf >= 44), inhalt.zeilen.map((z) => z.knopf).join(","));

  // 3) Kein seitliches Überlaufen
  const ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok("Keine Querscrollleiste", ueberlauf <= 0, `${ueberlauf}px`);

  // 4) Freigeben wirkt - geplanter Beitrag
  await page.locator(`#freigaben-abschnitt [data-freigeben-plan="${geplant[0]}"]`).click();
  await page.waitForTimeout(900);
  const z0 = db.prepare("SELECT status FROM planned_posts WHERE id=?").get(geplant[0]);
  const nochDa = await page.locator(`#freigaben-abschnitt [data-freigeben-plan="${geplant[0]}"]`).count();
  ok("Geplanten freigegeben: Zustand approved, Zeile verschwindet", z0.status === "approved" && nochDa === 0, `${z0.status}/${nochDa}`);

  // 5) Freigeben wirkt - fälliger Beitrag aus der Warteschlange
  await page.locator(`#freigaben-abschnitt [data-freigeben="${aid}"]`).click();
  await page.waitForTimeout(1200);
  const a0 = db.prepare("SELECT status FROM pending_approvals WHERE id=?").get(aid);
  ok("Fälligen freigegeben: Warteschlangen-Eintrag approved", a0.status === "approved", a0.status);

  // 6) Nichts offen: genau eine Zeile, Abschnitt bleibt stehen
  db.prepare("UPDATE planned_posts SET status='approved' WHERE customer_id=?").run(id);
  await lade();
  const leer = await page.evaluate(() => {
    const a = document.querySelector("#freigaben-abschnitt");
    return { kopf: Boolean(a?.querySelector("h2")), text: a?.querySelector(".leer")?.textContent.trim(), karten: a?.querySelectorAll(".post, .zeile").length };
  });
  ok("Nichts offen: der Abschnitt bleibt, mit einer Zeile", leer.kopf && leer.text === "Gerade wartet nichts auf dich." && leer.karten === 0, JSON.stringify(leer));

  // 7) Freigabe aus: kein Abschnitt
  db.prepare("UPDATE customers SET approval_mode=0 WHERE id=?").run(id);
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#woche", { timeout: 20000 });
  await page.waitForTimeout(400);
  ok("Freigabe aus: der Abschnitt bleibt weg", (await page.locator("#freigaben-abschnitt h2").count()) === 0);
  db.prepare("UPDATE customers SET approval_mode=1 WHERE id=?").run(id);

  ok(`@${breite}: Keine Skriptfehler`, seitenfehler.length === 0, seitenfehler.join(" | "));
  await ctx.close();
}
await browser.close();
console.log(fehler ? `\n${fehler} Bruchstelle(n)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
