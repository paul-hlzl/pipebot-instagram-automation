/**
 * Nachweis (19.09.2026): der bestehende Flow bekommt durch den Umbau nichts ab - gegen eine
 * KOPIE der Produktionsdaten. Startet den Sandbox-Build als eigenen Prozess auf Port 3177 mit
 * der Produktionskonfiguration (PANEL_SANDBOX nicht gesetzt, Mount /panel), aber auf einer
 * konsistenten Kopie von panel.db. Produktion selbst wird nie angefasst; die Kopie wird am
 * Ende geloescht. Es wird nichts erzeugt und nichts veroeffentlicht - nur gelesen.
 *   node scripts/test-produktionskopie.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const S = "/tmp/claude-0/-root/9d7c8207-27fd-4b05-84d9-cdef65867a28/scratchpad";
const KOPIE = `${S}/prodkopie.db`;
const PORT = 3177;
const BASE = `http://127.0.0.1:${PORT}`;
let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };

// Produktionswerte aus der .env (Verschluesselungsschluessel usw.), dann bewusste Abweichungen.
const env = { ...process.env, ...dotenv.parse(fs.readFileSync("/root/mcp-server/.env", "utf8")) };
delete env.PANEL_SANDBOX; delete env.PANEL_TEST_KEY; delete env.PANEL_APP_HOSTS;
Object.assign(env, {
  PANEL_DB_PATH: KOPIE, PORT: String(PORT), PANEL_MOUNT_PATH: "/panel",
  PANEL_PUBLIC_DIR: "/root/mcp-sandbox/public/panel", PANEL_MAIL_DRY_RUN: "1",
  PANEL_BASE_URL: BASE,
});
// Die Kopie entsteht HIER, konsistent ueber die Sicherungsschnittstelle, Quelle nur lesend -
// und das Schema davor wird ebenfalls hier festgehalten, damit der Lauf fuer sich steht.
for (const f of [KOPIE, `${KOPIE}-wal`, `${KOPIE}-shm`]) { try { fs.unlinkSync(f); } catch { /* neu */ } }
await new Database("/root/mcp-server/data/panel.db", { readonly: true }).backup(KOPIE);
const vorher = (() => { const q = new Database(KOPIE, { readonly: true }); const out = {}; for (const t of q.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)) out[t] = q.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name); q.close(); return out; })();
const kundenVorher = (() => { const q = new Database(KOPIE, { readonly: true }); const n = { k: q.prepare("SELECT COUNT(*) n FROM customers").get().n, p: q.prepare("SELECT COUNT(*) n FROM planned_posts").get().n }; q.close(); return n; })();
console.log(`Kopie angelegt: ${kundenVorher.k} Kunden, ${kundenVorher.p} geplante Beitraege`);

const kind = spawn("node", ["/root/mcp-sandbox/dist/index.js"], { cwd: "/root/mcp-sandbox", env, stdio: ["ignore", "pipe", "pipe"] });
// Zweiter Prozess, gleiche Produktionskonfiguration, nur ohne Bot-Pruefung - fuer den
// Deckel-Nachweis weiter unten (Port 3178, dieselbe Kopie).
const envOhneBot = { ...env, PORT: "3178", PANEL_BASE_URL: "http://127.0.0.1:3178" };
// Leer setzen, nicht loeschen: der Prozess liest die .env selbst nach, und dotenv ueberschreibt
// nur, was noch gar nicht gesetzt ist.
envOhneBot.TURNSTILE_SECRET_KEY = ""; envOhneBot.TURNSTILE_SITE_KEY = "";
const kind2 = spawn("node", ["/root/mcp-sandbox/dist/index.js"], { cwd: "/root/mcp-sandbox", env: envOhneBot, stdio: ["ignore", "pipe", "pipe"] });
const BASE2 = "http://127.0.0.1:3178";
let log = "";
kind.stdout.on("data", (d) => { log += d; });
kind.stderr.on("data", (d) => { log += d; });
const bereit = async () => { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/health`); if (r.ok) return true; } catch { /* noch nicht */ } await new Promise((x) => setTimeout(x, 500)); } return false; };

try {
  ok("Der Sandbox-Build startet mit der Produktionskonfiguration auf der Kopie", await bereit());
  ok("Beim Start: keine Warnung 'Tagesgrenzen ABGESCHALTET'", !/ABGESCHALTET/.test(log));

  console.log("\nSchema: Migrationen nur additiv");
  const db = new Database(KOPIE);
  const nachher = {};
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)) nachher[t] = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  let entfernt = 0, dazu = [];
  for (const [t, spalten] of Object.entries(vorher)) {
    if (!nachher[t]) { entfernt++; continue; }
    for (const c of spalten) if (!nachher[t].includes(c)) entfernt++;
    for (const c of nachher[t]) if (!spalten.includes(c)) dazu.push(`${t}.${c}`);
  }
  ok("Keine Tabelle und keine Spalte ist verschwunden", entfernt === 0, `${entfernt} entfernt`);
  // Vor dem Deploy kamen die Spalten hier erst beim Start dazu; seit dem Deploy (19.09.2026)
  // stehen sie schon in der Kopie. Beides ist richtig - falsch waere nur, wenn eine der neuen
  // Spalten fehlt oder etwas verschwindet.
  const NEUE_SPALTEN = [["planned_posts", "origin"], ["planned_posts", "image_source"], ["pending_approvals", "origin"]];
  const fehlend = NEUE_SPALTEN.filter(([t, c]) => !(nachher[t] ?? []).includes(c)).map(([t, c]) => `${t}.${c}`);
  ok("Alle neuen Spalten sind da, nichts ersetzt", fehlend.length === 0, fehlend.length ? `fehlt: ${fehlend.join(", ")}` : `beim Start ergaenzt: ${dazu.join(", ") || "nichts mehr noetig"}`);
  ok(`Alle ${kundenVorher.k} Kunden sind weiterhin da, keiner ist 'test'`, db.prepare("SELECT COUNT(*) n FROM customers").get().n === kundenVorher.k && db.prepare("SELECT COUNT(*) n FROM customers WHERE status='test'").get().n === 0);
  ok(`Alle ${kundenVorher.p} geplanten Beitraege unveraendert vorhanden, alle als Pipeflow-Arbeit (origin auto)`, db.prepare("SELECT COUNT(*) n FROM planned_posts").get().n === kundenVorher.p && db.prepare("SELECT COUNT(*) n FROM planned_posts WHERE origin='auto'").get().n === kundenVorher.p);

  console.log("\nProduktionsverhalten der Grenzen");
  const prov = await (await fetch(`${BASE}/panel/api/providers`)).json();
  ok("Kein Sandbox-Band, Grenzen an, kein Testmodus", prov.sandbox === false && prov.previewLimitsOff === false && prov.testmodeAvailable === false, JSON.stringify({ sandbox: prov.sandbox, off: prov.previewLimitsOff, test: prov.testmodeAvailable }));

  console.log("\nKostendeckel: greifen sie hier wirklich?");
  {
    // Nicht nur die Meldung pruefen, sondern den Deckel selbst zuschlagen lassen. Kein einziger
    // KI-Aufruf: die Absage faellt VOR der Analyse, es entstehen keine Kosten.
    // Einzige Abweichung von der Produktionskonfiguration in diesem Abschnitt: die Bot-Pruefung
    // (Turnstile) ist fuer den zweiten Prozess aus, sonst kommt ein Skript gar nicht erst bis zum
    // Deckel - sie sitzt davor und ist ein eigener Schutz.
    const mail = `deckel-${Date.now()}@example.invalid`;
    const anlegen = await fetch(`${BASE2}/panel/api/start/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: mail }) });
    const ck = (anlegen.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session=")) ?? "";
    const kid = db.prepare("SELECT id FROM customers WHERE email=?").get(mail)?.id ?? "cus_deckel";
    const seed = (ip, domain, kunde) => db.prepare("INSERT INTO start_previews (id, ip, domain, email, customer_id, kind, created_at) VALUES (?,?,?,?,?, 'preview', ?)")
      .run(`prev_deckel_${Math.random().toString(36).slice(2, 11)}`, ip, domain, "seed@example.invalid", kunde, new Date(Date.now() - 60_000).toISOString());
    const vorschau = (koerper) => fetch(`${BASE2}/panel/api/start/preview`, { method: "POST", headers: { "content-type": "application/json", cookie: ck, "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify(koerper) });

    for (let i = 0; i < 6; i++) seed("203.0.113.9", "deckel-test.example", kid);
    for (let i = 0; i < 45; i++) seed(`198.51.100.${i}`, `d${i}.example`, "cus_deckel_fremd");
    const abgewiesen = await vorschau({ website: "deckel-test.example" });
    const text = await abgewiesen.text();
    ok("Die Vorschau wird abgewiesen, sobald die Zaehler ueber der Grenze stehen (429)", abgewiesen.status === 429, `${abgewiesen.status} ${text.slice(0, 90)}`);
    ok("Die Absage nennt dem Kunden einen Zeitpunkt statt einer Fehlernummer", /morgen|Stunde|Uhr|spaeter|später/i.test(text), text.slice(0, 120));
    ok("Kein einziger Analyse-Aufruf dabei bezahlt", db.prepare("SELECT COUNT(*) n FROM usage_costs WHERE customer_id=?").get(kid).n === 0);

    const testEinstieg = await fetch(`${BASE2}/panel/start/test?key=beliebig`, { redirect: "manual" });
    // 404 oder 401: die Route ist gar nicht da, der Aufruf faellt durch. Entscheidend ist, dass
    // keine Sitzung entsteht.
    const testCookie = (testEinstieg.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("pp_session="));
    ok("Der Testmodus-Einstieg gibt es hier nicht und legt keine Sitzung an", [401, 404].includes(testEinstieg.status) && !testCookie, `${testEinstieg.status}, Cookie ${testCookie}`);

    db.prepare("DELETE FROM start_previews WHERE id LIKE 'prev_deckel_%'").run();
    db.prepare("DELETE FROM customers WHERE email=?").run(mail);
  }

  console.log("\nJeder bestehende Kunde: Anmeldung, Zustand, Woche");
  const kunden = db.prepare("SELECT id, company, ui_mode FROM customers WHERE status='active' ORDER BY created_at").all();
  ok("Produktion selbst ist unangetastet (Datei nicht neuer als die Kopie)", fs.statSync("/root/mcp-server/data/panel.db").mtimeMs <= fs.statSync(KOPIE).mtimeMs + 1000);
  const sessions = {};
  for (const k of kunden) {
    const tok = "kopie" + crypto.randomBytes(8).toString("hex");
    db.prepare("INSERT INTO sessions (token_hash, customer_id, expires_at) VALUES (?,?,?)").run(crypto.createHash("sha256").update(tok).digest("hex"), k.id, new Date(Date.now() + 3600e3).toISOString());
    sessions[k.id] = tok;
    const h = { cookie: `pp_session=${tok}` };
    const me = await fetch(`${BASE}/panel/api/me`, { headers: h });
    const meJ = me.ok ? await me.json() : {};
    const st = await fetch(`${BASE}/panel/api/start/status`, { headers: h });
    const stJ = st.ok ? await st.json() : {};
    const logo = await fetch(`${BASE}/panel/api/brand-logo`, { headers: h });
    const geplant = db.prepare("SELECT COUNT(*) n FROM planned_posts WHERE customer_id=? AND scheduled_for BETWEEN date('now') AND date('now','+6 day')").get(k.id).n;
    ok(`${k.company} (${k.ui_mode || "classic"}): /api/me und /api/start/status antworten, Woche stimmt`,
      me.status === 200 && meJ.customer?.company === k.company && st.status === 200 && (stJ.posts?.length ?? -1) === geplant && (logo.status === 200 || logo.status === 404),
      `me ${me.status}, status ${st.status}, ${stJ.posts?.length ?? "?"} von ${geplant} Beitraegen, logo ${logo.status}`);
  }

  console.log("\nIm Browser, 360 und 1440, zwei Kunden");
  const browser = await chromium.launch();
  for (const k of [kunden[0], kunden[kunden.length - 1]]) {
    for (const breite of [360, 1440]) {
      const ctx = await browser.newContext({ viewport: { width: breite, height: breite === 360 ? 780 : 900 } });
      await ctx.addCookies([{ name: "pp_session", value: sessions[k.id], domain: "127.0.0.1", path: "/panel", httpOnly: true, secure: false, sameSite: "Lax" }]);
      const page = await ctx.newPage();
      const seitenfehler = [];
      page.on("pageerror", (e) => seitenfehler.push(e.message));
      const antworten = [];
      page.on("response", (r) => { if (r.status() >= 500) antworten.push(`${r.status()} ${r.url()}`); });
      const klassisch = await page.goto(`${BASE}/panel/?classic=1`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const kl = await page.evaluate(() => ({ script: [...document.scripts].some((s) => /panel\.js/.test(s.src)), text: document.body.innerText.slice(0, 80).replace(/\s+/g, " ") }));
      const neu = await page.goto(`${BASE}/panel/start/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      const nz = await page.evaluate(() => ({ h1: document.querySelector("h1")?.textContent?.trim() ?? "", band: !document.querySelector("#sandbox-banner")?.hidden ? "sichtbar" : "aus", leiste: !document.querySelector("#testleiste")?.hidden ? "sichtbar" : "aus" }));
      await page.screenshot({ path: `docs/easy-onboarding/entwuerfe/prodkopie-${k.id.replace(/[^a-z0-9]/gi, "")}-${breite}.png` });
      ok(`${k.company} @${breite}: klassisches Panel laedt, neue Oberflaeche laedt, keine Skript- oder Serverfehler`,
        klassisch.status() === 200 && kl.script && neu.status() === 200 && nz.h1.length > 0 && seitenfehler.length === 0 && antworten.length === 0 && nz.band === "aus" && nz.leiste === "aus",
        `klassisch ${klassisch.status()} panel.js=${kl.script} | neu ${neu.status()} "${nz.h1}" | Band ${nz.band}, Leiste ${nz.leiste} | Fehler ${seitenfehler.length}/${antworten.length}`);
      await ctx.close();
    }
  }
  await browser.close();
  db.close();
} finally {
  kind.kill("SIGTERM"); kind2.kill("SIGTERM");
  await new Promise((x) => setTimeout(x, 800));
  for (const f of [KOPIE, `${KOPIE}-wal`, `${KOPIE}-shm`]) { try { fs.unlinkSync(f); } catch { /* weg */ } }
  console.log("\nKopie geloescht, Prozess beendet.");
  const auffaellig = log.split("\n").filter((l) => /error|fehlgeschlagen|warn/i.test(l) && !/DRY RUN|Health check/.test(l)).slice(0, 6);
  if (auffaellig.length) console.log("Auffaellige Logzeilen der Kopie:\n  " + auffaellig.join("\n  "));
}
console.log(fehler ? `\n${fehler} Problem(e)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
