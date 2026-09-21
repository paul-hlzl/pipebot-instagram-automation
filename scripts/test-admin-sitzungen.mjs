#!/usr/bin/env node
/**
 * Prueft "Angemeldet bleiben" und die Sitzungsliste des Adminbereichs (Auftrag 21.09.2026).
 *
 * Startet den gebauten Server als eigenen, kurzlebigen Prozess auf Port 3112 mit einer FRISCHEN
 * Datenbank in einem Temp-Verzeichnis. Beruehrt weder die Produktions-DB noch den Produktions-
 * prozess, weder /root/panel-live noch die Sandbox.
 *
 *   node scripts/test-admin-sitzungen.mjs [pfad-zum-dist]
 *
 * Geprueft wird:
 *   1. Anmeldung ohne Haken  -> Sitzung laeuft in 12 Stunden ab (Cookie und Datenbank einig)
 *   2. Anmeldung mit Haken   -> 30 Tage
 *   3. Sitzungsliste         -> beide Geraete, das eigene als solches markiert
 *   4. Einzeln abmelden      -> genau diese Sitzung ist weg, die andere arbeitet weiter
 *   5. Alle anderen abmelden -> die eigene bleibt
 *   6. Passwortwechsel       -> JEDE bestehende Sitzung ist ungueltig
 *   7. Anmeldeseite          -> der Hinweissatz ist weg, Passwortfeld/Knopf/Haken sind da
 *   8. admin.html            -> unter dem oeffentlichen Panel-Pfad nicht mehr erreichbar
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const DIST = process.argv[2] ?? new URL("../dist/index.js", import.meta.url).pathname;
const PORT = 3112;
const BASIS = `http://localhost:${PORT}/panel`;
const ADMIN = `${BASIS}/admin`;
const dir = mkdtempSync(path.join(tmpdir(), "pf-adminsitzung-"));
const dbPath = path.join(dir, "panel-test.db");
const PW_ALT = "erst-dieses-passwort";
const PW_NEU = "dann-ein-anderes";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   - ${name}`); }
  else { fail++; console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function starte(passwort) {
  const child = spawn(process.execPath, [DIST], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      PANEL_DB_PATH: dbPath,
      PANEL_ADMIN_PASSWORD: passwort,
      PANEL_ADMIN_PATH: "admin",
      PANEL_MOUNT_PATH: "/panel",
      PANEL_PUBLIC_DIR: new URL("../public/panel", import.meta.url).pathname,
      PANEL_MAIL_DRY_RUN: "1",
      PANEL_BASE_URL: "http://localhost",
      PANEL_SANDBOX: "true",
      PANEL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      MCP_AUTH_TOKEN: randomBytes(16).toString("hex"),
      ROUTINE_TRIGGER_URL: "", ROUTINE_TRIGGER_TOKEN: "",
      IG_APP_ID: "", IG_APP_SECRET: "", INSTAGRAM_APP_ID: "", INSTAGRAM_APP_SECRET: "",
      LINKEDIN_CLIENT_ID: "", LINKEDIN_CLIENT_SECRET: "",
      TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "",
      ANTHROPIC_API_KEY: "",
      FAL_API_KEY: "test-kein-echter-schluessel",
      IG_USER_ID: "test", IG_ACCESS_TOKEN: "test",
      MEDIA_STORAGE_BUCKET_URL: "https://test.invalid", MEDIA_STORAGE_ENDPOINT: "https://test.invalid",
      MEDIA_STORAGE_ACCESS_KEY: "test", MEDIA_STORAGE_SECRET_KEY: "test", MEDIA_STORAGE_BUCKET_NAME: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function warte() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASIS}/api/health`);
      if (r.ok) return true;
    } catch { /* noch nicht oben */ }
    await sleep(250);
  }
  return false;
}

/** Anmelden und das Sitzungs-Cookie zurueckgeben - samt Max-Age, das die Antwort mitschickt. */
async function anmelden(passwort, remember) {
  const res = await fetch(`${ADMIN}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": remember ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130" : "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605" },
    body: JSON.stringify({ password: passwort, remember }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = /pp_admin=([^;]*)/.exec(setCookie)?.[1] ?? "";
  const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1] ?? NaN);
  return { status: res.status, token, maxAge };
}

const mit = (token) => ({ headers: { Cookie: `pp_admin=${token}` } });

let child = starte(PW_ALT);
let code = 1;
try {
  if (!(await warte())) throw new Error("Server kam nicht hoch");
  console.log(`Testinstanz auf Port ${PORT}, Datenbank ${dbPath}\n`);

  console.log("1./2. Ablauf der Sitzung");
  const kurz = await anmelden(PW_ALT, false);
  const lang = await anmelden(PW_ALT, true);
  ok("Anmeldung ohne Haken gelingt", kurz.status === 200 && kurz.token.length > 0, `status ${kurz.status}`);
  ok("ohne Haken: Cookie 12 Stunden", kurz.maxAge === 12 * 3600, `Max-Age ${kurz.maxAge}`);
  ok("mit Haken: Cookie 30 Tage", lang.maxAge === 30 * 86400, `Max-Age ${lang.maxAge}`);
  const falsch = await anmelden("falsch-falsch-falsch", false);
  ok("falsches Passwort wird abgewiesen", falsch.status === 401 && !falsch.token, `status ${falsch.status}`);

  console.log("\n3. Sitzungsliste");
  const liste = await (await fetch(`${ADMIN}/api/sessions`, mit(lang.token))).json();
  ok("beide Sitzungen sind gelistet", liste.sessions?.length === 2, JSON.stringify(liste).slice(0, 160));
  const eigene = liste.sessions.find((s) => s.current);
  const fremde = liste.sessions.find((s) => !s.current);
  ok("genau eine ist als 'dieses Gerät' markiert", liste.sessions.filter((s) => s.current).length === 1);
  ok("Ablauf der eigenen ist 30 Tage", eigene && Math.abs(new Date(eigene.expiresAt) - Date.now() - 30 * 86400000) < 60000, eigene?.expiresAt);
  ok("Ablauf der anderen ist 12 Stunden", fremde && Math.abs(new Date(fremde.expiresAt) - Date.now() - 12 * 3600000) < 60000, fremde?.expiresAt);
  ok("Geräte werden lesbar benannt", eigene?.device === "Chrome auf macOS" && fremde?.device === "Safari auf iPhone", `${eigene?.device} / ${fremde?.device}`);
  ok("kein Token-Hash in der Antwort", !JSON.stringify(liste).includes("token"), JSON.stringify(liste).slice(0, 120));

  console.log("\n4. Einzeln abmelden");
  const weg = await fetch(`${ADMIN}/api/sessions/${fremde.id}`, { method: "DELETE", ...mit(lang.token) });
  ok("Abmelden der anderen Sitzung gelingt", weg.status === 200, `status ${weg.status}`);
  ok("die abgemeldete Sitzung ist ungültig", (await fetch(`${ADMIN}/api/me`, mit(kurz.token))).status === 401);
  ok("die eigene Sitzung arbeitet weiter", (await fetch(`${ADMIN}/api/me`, mit(lang.token))).status === 200);

  console.log("\n5. Alle anderen abmelden");
  const zweit = await anmelden(PW_ALT, false);
  const dritt = await anmelden(PW_ALT, false);
  const andere = await (await fetch(`${ADMIN}/api/sessions/others`, { method: "DELETE", ...mit(lang.token) })).json();
  ok("zwei andere abgemeldet", andere.abgemeldet === 2, JSON.stringify(andere));
  ok("die eigene bleibt angemeldet", (await fetch(`${ADMIN}/api/me`, mit(lang.token))).status === 200);
  ok("die anderen sind draußen", (await fetch(`${ADMIN}/api/me`, mit(zweit.token))).status === 401 && (await fetch(`${ADMIN}/api/me`, mit(dritt.token))).status === 401);

  console.log("\n7./8. Anmeldeseite und öffentlicher Pfad");
  const seite = await (await fetch(`${ADMIN}/`)).text();
  ok("kein Hinweis auf den Inhaber oder die .env", !/Nur für Paul/.test(seite) && !/Passwort aus der \.env/.test(seite), "Satz noch vorhanden");
  ok("Passwortfeld vorhanden", /id="pw"[^>]*type="password"|type="password"[^>]*id="pw"/.test(seite));
  ok("Haken 'Angemeldet bleiben' vorhanden", /id="remember"/.test(seite) && /Angemeldet bleiben/.test(seite));
  ok("Wortmarke wie im Kundenpanel", /class="brand"/.test(seite) && /<span>Pipeflow<\/span>/.test(seite));
  const oeffentlich = await fetch(`${BASIS}/admin.html`, { redirect: "manual" });
  ok("admin.html ist öffentlich nicht mehr erreichbar", oeffentlich.status === 401, `status ${oeffentlich.status}`);
  ok("der Adminbereich selbst liefert die Seite weiter aus", seite.includes("<!doctype html>"));

  console.log("\n6. Passwortwechsel meldet überall ab");
  const vorher = await fetch(`${ADMIN}/api/me`, mit(lang.token));
  ok("vor dem Wechsel noch angemeldet", vorher.status === 200);
  child.kill("SIGTERM");
  await sleep(700);
  child = starte(PW_NEU);
  if (!(await warte())) throw new Error("Server kam mit neuem Passwort nicht hoch");
  ok("nach dem Wechsel ist die 30-Tage-Sitzung ungültig", (await fetch(`${ADMIN}/api/me`, mit(lang.token))).status === 401);
  const neuAn = await anmelden(PW_NEU, true);
  ok("Anmeldung mit dem neuen Passwort gelingt", neuAn.status === 200);
  ok("das alte Passwort wird nicht mehr angenommen", (await anmelden(PW_ALT, true)).status === 401);
  const listeNeu = await (await fetch(`${ADMIN}/api/sessions`, mit(neuAn.token))).json();
  ok("die alten Sitzungen sind auch aus der Liste verschwunden", listeNeu.sessions?.length === 1, JSON.stringify(listeNeu).slice(0, 160));

  console.log(`\n${pass} ok, ${fail} Fehler`);
  code = fail === 0 ? 0 : 1;
} catch (err) {
  console.error("\nAbbruch:", err.message);
  code = 2;
} finally {
  child.kill("SIGTERM");
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
