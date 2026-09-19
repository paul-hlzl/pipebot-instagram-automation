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
const vorher = JSON.parse(fs.readFileSync(`${S}/schema-vorher.json`, "utf8"));

const kind = spawn("node", ["/root/mcp-sandbox/dist/index.js"], { cwd: "/root/mcp-sandbox", env, stdio: ["ignore", "pipe", "pipe"] });
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
  ok("Nur Ergaenzungen", dazu.length > 0, dazu.join(", "));
  ok("Alle 6 Kunden sind weiterhin da, keiner ist 'test'", db.prepare("SELECT COUNT(*) n FROM customers WHERE status='active'").get().n === 6 && db.prepare("SELECT COUNT(*) n FROM customers WHERE status='test'").get().n === 0);
  ok("Alle 174 geplanten Beitraege unveraendert vorhanden", db.prepare("SELECT COUNT(*) n FROM planned_posts").get().n === 174);

  console.log("\nProduktionsverhalten der Grenzen");
  const prov = await (await fetch(`${BASE}/panel/api/providers`)).json();
  ok("Kein Sandbox-Band, Grenzen an, kein Testmodus", prov.sandbox === false && prov.previewLimitsOff === false && prov.testmodeAvailable === false, JSON.stringify({ sandbox: prov.sandbox, off: prov.previewLimitsOff, test: prov.testmodeAvailable }));

  console.log("\nJeder bestehende Kunde: Anmeldung, Zustand, Woche");
  const kunden = db.prepare("SELECT id, company, ui_mode FROM customers WHERE status='active' ORDER BY created_at").all();
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
  kind.kill("SIGTERM");
  await new Promise((x) => setTimeout(x, 800));
  for (const f of [KOPIE, `${KOPIE}-wal`, `${KOPIE}-shm`]) { try { fs.unlinkSync(f); } catch { /* weg */ } }
  console.log("\nKopie geloescht, Prozess beendet.");
  const auffaellig = log.split("\n").filter((l) => /error|fehlgeschlagen|warn/i.test(l) && !/DRY RUN|Health check/.test(l)).slice(0, 6);
  if (auffaellig.length) console.log("Auffaellige Logzeilen der Kopie:\n  " + auffaellig.join("\n  "));
}
console.log(fehler ? `\n${fehler} Problem(e)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
