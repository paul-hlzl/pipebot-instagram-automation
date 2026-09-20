/**
 * Das Freigabefenster (20.09.2026): eine ruhige Zeile, die sich aufklappt; faellige Beitraege als
 * ganze Karte; geplante als Zeilen mit Vorschaubild, die sich an Ort und Stelle oeffnen; und bei
 * einem nicht verbundenen Kanal der Weg zum Verbinden statt eines Freigeben-Knopfes.
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

/** Ein echtes, quadratisches Beitragsbild - fuer Vorschaubild und grosse Ansicht. */
const BILD = "https://pub-ca94c8f7d991428986a52fce66b47718.r2.dev/posts/2026-09-19T18-59-00-359Z-d74b7401-98f9-492e-b11d-eb318c63ee56.jpg";
const LANGER_TEXT = "Pipeline AI Solutions unterstützt kleine und mittlere Unternehmen dabei, online sichtbar zu werden. 🚀 Von der Strategie über das Design bis zur technischen Umsetzung arbeiten wir direkt mit dir zusammen.\n\nMehr über uns im Link in der Bio. 🔗\n\n#webdesign #automatisierung";

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const jetzt = new Date().toISOString();
db.prepare("UPDATE customers SET company='Channoine Mayr', email_verified=1, tour_done_at=?, approval_mode=1, ig_feed_enabled=1, ig_story_enabled=0, linkedin_enabled=1, linkedin_image_mode='bild' WHERE id=?").run(jetzt, id);
// Instagram verbunden, LinkedIn NICHT - genau Pauls Lage am 20.09.2026. Der Eintrag wird vom
// Panel nur gelesen (Status), nie entschluesselt.
db.prepare("DELETE FROM connections WHERE customer_id=?").run(id);
db.prepare("INSERT INTO connections (customer_id, provider, account_id, account_name, access_token_enc, expires_at, connected_at, updated_at) VALUES (?,?,?,?,?,NULL,?,?)")
  .run(id, "instagram", "ig_test", "@testkonto", "x", jetzt, jetzt);

const KOEPFE = ["Beauty Advisor Ausbildung starten", "Starke Abwehr für jede Lebensphase", "Wissen, das Frauen verändert"];
const KANAELE = ["ig_feed", "linkedin", "ig_feed"];
function aufbauen({ faellig = true } = {}) {
  db.prepare("DELETE FROM planned_posts WHERE customer_id=?").run(id);
  db.prepare("DELETE FROM pending_approvals WHERE customer_id=?").run(id);
  const geplant = KOEPFE.map((h, i) => {
    const pid = `plp_f${Date.now()}_${i}`;
    db.prepare("INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, image_url, pillar_title, created_at, updated_at) VALUES (?,?,?,?,'planned',?,?,?,'Thema',?,?)")
      .run(pid, id, KANAELE[i], tag(i + 1), h, LANGER_TEXT, BILD, jetzt, jetzt);
    return pid;
  });
  let aid = null;
  if (faellig) {
    aid = `appr_f${Date.now()}`;
    db.prepare("INSERT INTO pending_approvals (id, customer_id, provider, channel, headline, caption, image_url, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)")
      .run(aid, id, "instagram", "ig_feed", "Jetzt fällig: Wer wir sind", LANGER_TEXT, BILD, jetzt, jetzt);
  }
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
  const lade = async () => {
    await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#freigaben-abschnitt .frei-kopf, #freigaben-abschnitt .leer", { timeout: 20000 });
    await page.waitForSelector("#woche .post", { timeout: 20000 });
    await page.waitForTimeout(500);
  };
  await lade();

  // 1) Kopfzeile: feste Stelle, Zahl, und offen, weil etwas faellig ist
  const kopf = await page.evaluate(() => {
    const a = document.querySelector("#freigaben-abschnitt");
    const w = document.querySelector("#woche");
    const k = a.querySelector(".frei-kopf");
    return {
      vorDerWoche: Boolean(a && w && (a.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING)),
      text: k?.textContent.replace(/\s+/g, " ").trim(),
      offen: k?.getAttribute("aria-expanded"),
      hoehe: Math.round(k?.getBoundingClientRect().height ?? 0),
    };
  });
  ok("Kopfzeile steht an fester Stelle über der Woche", kopf.vorDerWoche);
  ok("Sie nennt die Zahl in einem Satz", kopf.text === "4 Beiträge warten auf deine Freigabe ⌄", kopf.text);
  ok("Auch mit einem fälligen Beitrag startet der Block zugeklappt", kopf.offen === "false" && (await page.locator("#freigaben-abschnitt .post[data-approval], #freigaben-abschnitt .frei-zeile").count()) === 0);
  ok("Die Kopfzeile ist eine Tippfläche von mindestens 44 px", kopf.hoehe >= 44, `${kopf.hoehe}px`);

  // Ab hier aufgeklappt - der Kunde tippt einmal.
  await page.locator("#freigaben-abschnitt .frei-kopf").click();
  await page.waitForTimeout(300);
  ok("Ein Tipp klappt auf: fällige Karte und geplante Zeilen stehen da", (await page.locator("#freigaben-abschnitt .post[data-approval]").count()) === 1 && (await page.locator("#freigaben-abschnitt .frei-zeile").count()) === 3);

  // 2) Faellige Karte oben, geplante Zeilen darunter, mit Vorschaubild
  const inhalt = await page.evaluate(() => {
    const a = document.querySelector("#freigaben-abschnitt");
    const karte = a.querySelector(".post[data-approval]");
    const zeilen = [...a.querySelectorAll(".frei-zeile")].map((z) => ({
      wann: z.querySelector(".zeile-k")?.textContent.trim(),
      bild: Boolean(z.querySelector("img.bild-klein")),
      frei: Boolean(z.querySelector("[data-freigeben-plan]")),
      verbinden: z.querySelector("a.link")?.textContent.trim() || null,
    }));
    return { karteVorZeile: Boolean(karte && (karte.compareDocumentPosition(a.querySelector(".frei-zeile")) & Node.DOCUMENT_POSITION_FOLLOWING)), zeilen };
  });
  ok("Fällige zuerst, geplante darunter", inhalt.karteVorZeile);
  ok("Jede geplante Zeile hat ein Vorschaubild", inhalt.zeilen.length === 3 && inhalt.zeilen.every((z) => z.bild), JSON.stringify(inhalt.zeilen.map((z) => z.bild)));
  ok("Verbundener Kanal: Freigeben", inhalt.zeilen.filter((z) => z.frei).length === 2, JSON.stringify(inhalt.zeilen.map((z) => z.frei)));
  ok("Nicht verbundener Kanal: 'LinkedIn verbinden' statt Freigeben", inhalt.zeilen.some((z) => !z.frei && z.verbinden === "LinkedIn verbinden"), JSON.stringify(inhalt.zeilen.map((z) => z.verbinden)));

  // 3) Zeile klappt an Ort und Stelle zum ganzen Beitrag auf
  await page.locator(`#freigaben-abschnitt [data-plan-auf="${geplant[0]}"]`).click();
  await page.waitForTimeout(300);
  const voll = await page.evaluate(() => {
    const z = document.querySelector("#freigaben-abschnitt .frei-zeile .frei-voll");
    const t = z?.querySelector(".post-c");
    const b = z?.querySelector("img.frei-bild");
    return { da: Boolean(z), hashtags: Boolean(t && t.textContent.includes("#webdesign")), ganzerText: t ? t.scrollHeight - t.clientHeight <= 1 : false, bildBreit: b ? Math.round(b.getBoundingClientRect().width) : 0 };
  });
  ok("Der ganze Beitrag steht in der Zeile, mit Hashtags", voll.da && voll.hashtags && voll.ganzerText, JSON.stringify(voll));
  ok("Das Bild ist groß, nicht das Vorschaubildchen", voll.bildBreit > 100, `${voll.bildBreit}px`);
  await page.locator(`#freigaben-abschnitt [data-plan-auf="${geplant[0]}"]`).click();
  await page.waitForTimeout(300);
  ok("Noch ein Tipp schließt sie wieder", (await page.locator("#freigaben-abschnitt .frei-voll").count()) === 0);

  // 4) Kein Querscrollen, offen wie zu
  let ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok("Kein Querscrollen mit offenem Block", ueberlauf <= 0, `${ueberlauf}px`);
  await page.locator("#freigaben-abschnitt .frei-kopf").click();
  await page.waitForTimeout(300);
  const zu = await page.evaluate(() => {
    const a = document.querySelector("#freigaben-abschnitt");
    return { zeilen: a.querySelectorAll(".frei-zeile, .post[data-approval]").length, text: a.querySelector(".frei-kopf")?.textContent.replace(/\s+/g, " ").trim(), offen: a.querySelector(".frei-kopf")?.getAttribute("aria-expanded") };
  });
  ok("Zugeklappt bleibt genau die eine Zeile stehen", zu.zeilen === 0 && zu.offen === "false" && zu.text.startsWith("4 Beiträge"), JSON.stringify(zu));

  // 5) Freigeben wirkt - geplant und fällig
  await page.locator("#freigaben-abschnitt .frei-kopf").click();
  await page.waitForTimeout(300);
  await page.locator(`#freigaben-abschnitt [data-freigeben-plan="${geplant[0]}"]`).click();
  await page.waitForTimeout(900);
  ok("Geplanten freigegeben: Zustand approved, Zeile verschwindet", db.prepare("SELECT status FROM planned_posts WHERE id=?").get(geplant[0]).status === "approved" && (await page.locator(`#freigaben-abschnitt [data-freigeben-plan="${geplant[0]}"]`).count()) === 0);
  await page.locator(`#freigaben-abschnitt [data-freigeben="${aid}"]`).click();
  await page.waitForTimeout(1200);
  ok("Fälligen freigegeben: Warteschlangen-Eintrag approved", db.prepare("SELECT status FROM pending_approvals WHERE id=?").get(aid).status === "approved");

  // 6) Ohne faelligen Beitrag genauso zugeklappt
  aufbauen({ faellig: false });
  await lade();
  const ohneFaellig = await page.evaluate(() => {
    const a = document.querySelector("#freigaben-abschnitt");
    return { offen: a.querySelector(".frei-kopf")?.getAttribute("aria-expanded"), sichtbar: a.querySelectorAll(".frei-zeile").length, text: a.querySelector(".frei-kopf")?.textContent.replace(/\s+/g, " ").trim() };
  });
  ok("Ohne fälligen Beitrag: nur die Zeile, nichts weiter", ohneFaellig.offen === "false" && ohneFaellig.sichtbar === 0 && ohneFaellig.text === "3 Beiträge warten auf deine Freigabe ⌄", JSON.stringify(ohneFaellig));

  // 7) Die Woche zeigt bei einem unverbundenen Kanal denselben Weg
  const wocheLinkedIn = await page.evaluate(() => {
    const k = [...document.querySelectorAll("#woche .post")].find((el) => el.querySelector(".chan")?.textContent.trim() === "LinkedIn");
    return { frei: Boolean(k?.querySelector("[data-freigeben-plan]")), verbinden: k?.querySelector("a.link")?.textContent.trim() || null };
  });
  ok("In der Woche steht bei LinkedIn 'LinkedIn verbinden' statt 'Freigeben'", !wocheLinkedIn.frei && wocheLinkedIn.verbinden === "LinkedIn verbinden", JSON.stringify(wocheLinkedIn));

  // 8) Nichts offen und Freigabe aus
  db.prepare("UPDATE planned_posts SET status='approved' WHERE customer_id=?").run(id);
  await lade();
  const leer = await page.evaluate(() => {
    const a = document.querySelector("#freigaben-abschnitt");
    return { kopf: Boolean(a?.querySelector("h2")), text: a?.querySelector(".leer")?.textContent.trim(), rest: a?.querySelectorAll(".frei-zeile, .post").length };
  });
  ok("Nichts offen: der Abschnitt bleibt, mit einer Zeile", leer.kopf && leer.text === "Gerade wartet nichts auf dich." && leer.rest === 0, JSON.stringify(leer));

  db.prepare("UPDATE customers SET approval_mode=0 WHERE id=?").run(id);
  await page.goto(`${BASE}${MOUNT}/start/?t=${Date.now()}#dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#woche", { timeout: 20000 });
  await page.waitForTimeout(400);
  ok("Freigabe aus: der Abschnitt bleibt weg", (await page.locator("#freigaben-abschnitt .frei-kopf, #freigaben-abschnitt h2").count()) === 0);
  db.prepare("UPDATE customers SET approval_mode=1 WHERE id=?").run(id);

  ok(`@${breite}: Keine Skriptfehler`, seitenfehler.length === 0, seitenfehler.join(" | "));
  await ctx.close();
}
await browser.close();
db.prepare("DELETE FROM connections WHERE customer_id=?").run(id);
console.log(fehler ? `\n${fehler} Bruchstelle(n)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
