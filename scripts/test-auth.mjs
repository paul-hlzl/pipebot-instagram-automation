#!/usr/bin/env node
/**
 * Anmeldung mit Google/Microsoft Ende zu Ende - gegen einen lokalen Attrappen-Anbieter.
 *
 * Warum so: ohne echte Client-ID/Secret (die Paul anlegt, siehe Auftrag Abschnitt 4) laesst sich
 * nicht gegen Google selbst testen. Der Code spricht aber nur OpenID Connect, und die Endpunkte
 * sind ueber Umgebungsvariablen umlenkbar (auth-providers.ts). Dieser Test stellt einen eigenen,
 * regelkonformen Anbieter hin und prueft damit ALLES ausser Googles eigenem Verhalten:
 * Weiterleitung, state-Pruefung, Code-Tausch mit Secret, Profilabruf, Kontoanlage,
 * Wiedererkennen, Verknuepfen mit einem bestehenden Konto, abgelehnte Anmeldung.
 *
 * Laeuft in einem eigenen kurzlebigen Prozess auf Port 3112 mit eigener Datenbank - Sandbox und
 * Produktion werden nicht angefasst.
 *
 *   node scripts/test-auth.mjs
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

const PANEL_PORT = 3112;
const IDP_PORT = 3113;
const dir = mkdtempSync(path.join(tmpdir(), "pf-auth-"));
const dbPath = path.join(dir, "auth-test.db");

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  ok   - ${name}`); } else { fail++; failures.push(name); console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ""}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/* ---------- Attrappen-Anbieter: verhaelt sich wie ein OpenID-Connect-Server ---------- */
let idpKonto = { sub: "sub-1", email: "neu@example.invalid", email_verified: true, name: "Neue Firma GmbH" };
let letzteAnfrage = null;
const codes = new Map();
const idp = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${IDP_PORT}`);
  if (u.pathname === "/authorize") {
    letzteAnfrage = Object.fromEntries(u.searchParams);
    const code = `code-${randomBytes(6).toString("hex")}`;
    codes.set(code, { ...idpKonto, redirect_uri: u.searchParams.get("redirect_uri") });
    res.writeHead(302, { location: `${u.searchParams.get("redirect_uri")}?code=${code}&state=${u.searchParams.get("state")}` });
    res.end();
    return;
  }
  if (u.pathname === "/token" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const p = new URLSearchParams(body);
      const eintrag = codes.get(p.get("code") ?? "");
      // Ein echter Anbieter prueft genau das: Code bekannt, Client-Secret richtig, redirect_uri gleich.
      if (!eintrag || !p.get("client_secret") || p.get("redirect_uri") !== eintrag.redirect_uri) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      codes.delete(p.get("code"));
      const claims = { sub: eintrag.sub, email: eintrag.email, email_verified: eintrag.email_verified, name: eintrag.name, preferred_username: eintrag.email };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: `at-${eintrag.sub}`, token_type: "Bearer", id_token: `x.${b64url(claims)}.y` }));
    });
    return;
  }
  if (u.pathname === "/userinfo") {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer at-")) {
      res.writeHead(401);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ sub: idpKonto.sub, email: idpKonto.email, email_verified: idpKonto.email_verified, name: idpKonto.name }));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => idp.listen(IDP_PORT, "127.0.0.1", r));

/* ---------- Panel mit umgelenkten Anbieter-Endpunkten ---------- */
const dist = new URL("../dist/index.js", import.meta.url).pathname;
const kind = spawn(process.execPath, [dist], {
  cwd: dir,
  env: {
    ...process.env,
    PORT: String(PANEL_PORT),
    PANEL_DB_PATH: dbPath,
    PANEL_MAIL_DRY_RUN: "1",
    PANEL_PUBLIC_DIR: new URL("../public/panel", import.meta.url).pathname,
    PANEL_BASE_URL: `http://127.0.0.1:${PANEL_PORT}`,
    PANEL_MOUNT_PATH: "/panel",
    PANEL_SANDBOX: "true",
    PANEL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    MCP_AUTH_TOKEN: randomBytes(16).toString("hex"),
    AUTH_GOOGLE_CLIENT_ID: "test-client",
    AUTH_GOOGLE_CLIENT_SECRET: "test-secret",
    AUTH_GOOGLE_AUTHORIZE_URL: `http://127.0.0.1:${IDP_PORT}/authorize`,
    AUTH_GOOGLE_TOKEN_URL: `http://127.0.0.1:${IDP_PORT}/token`,
    AUTH_GOOGLE_USERINFO_URL: `http://127.0.0.1:${IDP_PORT}/userinfo`,
    AUTH_MICROSOFT_CLIENT_ID: "test-client-ms",
    AUTH_MICROSOFT_CLIENT_SECRET: "test-secret-ms",
    AUTH_MICROSOFT_AUTHORIZE_URL: `http://127.0.0.1:${IDP_PORT}/authorize`,
    AUTH_MICROSOFT_TOKEN_URL: `http://127.0.0.1:${IDP_PORT}/token`,
    ANTHROPIC_API_KEY: "", FAL_API_KEY: "test", IG_USER_ID: "t", IG_ACCESS_TOKEN: "t",
    MEDIA_STORAGE_BUCKET_URL: "https://test.invalid", MEDIA_STORAGE_ENDPOINT: "https://test.invalid",
    MEDIA_STORAGE_ACCESS_KEY: "t", MEDIA_STORAGE_SECRET_KEY: "t", MEDIA_STORAGE_BUCKET_NAME: "t",
    TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
kind.stdout.on("data", (d) => { logs += d; });
kind.stderr.on("data", (d) => { logs += d; });

const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const hole = (pfad, opts = {}) => fetch(`http://127.0.0.1:${PANEL_PORT}${pfad}`, { redirect: "manual", ...opts });

/** Ein kompletter Anmeldedurchlauf wie im Browser: Panel -> Anbieter -> zurueck. */
async function anmelden(provider = "google") {
  const start = await hole(`/panel/auth/${provider}`);
  const ziel = start.headers.get("location") ?? "";
  if (!ziel.startsWith(`http://127.0.0.1:${IDP_PORT}/authorize`)) return { start, fehler: `keine Weiterleitung zum Anbieter: ${ziel}` };
  const beimAnbieter = await fetch(ziel, { redirect: "manual" });
  const zurueck = beimAnbieter.headers.get("location") ?? "";
  const callback = await hole(zurueck.replace(`http://127.0.0.1:${PANEL_PORT}`, ""));
  return { start, callback, cookie: cookieOf(callback), ziel: callback.headers.get("location") };
}

const { default: Database } = await import("better-sqlite3");
let db;
try {
  let up = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PANEL_PORT}/health`)).ok) { up = true; break; } } catch { /* startet noch */ } await sleep(200); }
  ok("Testserver mit Attrappen-Anbieter gestartet", up, logs.slice(-300));
  db = new Database(dbPath);

  console.log("\nAnmeldung mit Google (neues Konto):");
  {
    const r = await anmelden("google");
    ok("Weiterleitung zum Anbieter mit state, nonce, scope und redirect_uri", !r.fehler
      && letzteAnfrage?.state?.length > 10 && letzteAnfrage?.nonce?.length > 5
      && letzteAnfrage?.scope === "openid email profile"
      && letzteAnfrage?.redirect_uri === `http://127.0.0.1:${PANEL_PORT}/panel/auth/google/callback`, r.fehler || JSON.stringify(letzteAnfrage));
    ok("Rueckkehr meldet an (303 auf /panel/start/) und setzt Session", r.callback?.status === 303 && /\/panel\/start\/\?angemeldet=google$/.test(r.ziel || "") && r.cookie.includes("pp_session"), `${r.callback?.status} ${r.ziel}`);
    const kunde = db.prepare("SELECT * FROM customers WHERE email = ?").get(idpKonto.email);
    ok("Konto angelegt: ui_mode easy, Anbieter vermerkt, Adresse ohne zweiten Schritt bestaetigt",
      kunde && kunde.ui_mode === "easy" && kunde.auth_provider === "google" && kunde.auth_subject === "sub-1" && kunde.email_verified === 1,
      JSON.stringify(kunde && { ui: kunde.ui_mode, p: kunde.auth_provider, v: kunde.email_verified }));
    ok("Firmenname aus dem Anbieterprofil uebernommen", kunde?.company === "Neue Firma GmbH", kunde?.company);
    ok("Vorbelegt: Freigabe an, werktags, Feed und LinkedIn, Story aus",
      kunde?.approval_mode === 1 && kunde?.frequency === "werktags" && kunde?.ig_feed_enabled === 1 && kunde?.linkedin_enabled === 1 && kunde?.ig_story_enabled === 0);
    const me = await hole("/panel/api/me", { headers: { cookie: r.cookie } }).then((x) => x.json());
    ok("/api/me: angemeldet, uiMode easy, authProvider google", me.customer?.uiMode === "easy" && me.customer?.authProvider === "google");
    const wurzel = await hole("/panel/", { headers: { cookie: r.cookie } });
    ok("GET /panel/ leitet den Easy-Kunden auf /start/", wurzel.status === 302 && /\/start\/$/.test(wurzel.headers.get("location") || ""));
    ok("Kein Bestaetigungs-Token gesetzt (kein zweiter Schritt bei bestaetigter Anbieter-Adresse)", !kunde?.email_verify_token_hash);
  }

  console.log("\nZweite Anmeldung mit demselben Konto:");
  {
    const vorher = db.prepare("SELECT COUNT(*) AS n FROM customers").get().n;
    const r = await anmelden("google");
    const nachher = db.prepare("SELECT COUNT(*) AS n FROM customers").get().n;
    ok("Wird wiedererkannt, kein zweites Konto", r.callback?.status === 303 && vorher === nachher, `${vorher} -> ${nachher}`);
  }

  console.log("\nBestehendes Konto (ueber E-Mail angelegt) verknuepft sich:");
  {
    const res = await hole("/panel/api/start/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "bestand@example.invalid" }) });
    ok("E-Mail-Weg legt ein Konto an (201) und meldet an", res.status === 201, String(res.status));
    const vorher = db.prepare("SELECT * FROM customers WHERE email = ?").get("bestand@example.invalid");
    ok("Ueber E-Mail angelegtes Konto ist zunaechst unbestaetigt und hat keinen Anbieter", vorher?.email_verified === 0 && !vorher?.auth_provider);
    idpKonto = { sub: "sub-2", email: "bestand@example.invalid", email_verified: true, name: "Bestand GmbH" };
    const r = await anmelden("google");
    const nachher = db.prepare("SELECT * FROM customers WHERE email = ?").get("bestand@example.invalid");
    ok("Anmeldung mit derselben Adresse verknuepft das bestehende Konto statt ein zweites anzulegen",
      r.callback?.status === 303 && nachher?.id === vorher?.id && nachher?.auth_provider === "google" && nachher?.email_verified === 1);
    ok("Der bestehende Zugangslink bleibt unveraendert gueltig", nachher?.login_key_hash === vorher?.login_key_hash);
    ok("Firmenname des bestehenden Kontos wird NICHT ueberschrieben", nachher?.company === vorher?.company, `${vorher?.company} -> ${nachher?.company}`);
  }

  console.log("\nMicrosoft (derselbe Baustein, andere Endpunkte):");
  {
    idpKonto = { sub: "ms-1", email: "ms@example.invalid", email_verified: true, name: "MS Firma" };
    const r = await anmelden("microsoft");
    const kunde = db.prepare("SELECT * FROM customers WHERE email = ?").get("ms@example.invalid");
    ok("Anmeldung mit Microsoft legt ein Konto an", r.callback?.status === 303 && kunde?.auth_provider === "microsoft", r.fehler || String(r.callback?.status));
  }

  console.log("\nAbgewiesene Faelle:");
  {
    const ohneState = await hole("/panel/auth/google/callback?code=irgendwas&state=gibtsnicht");
    ok("Callback ohne gueltigen state -> zurueck mit Fehler, keine Anmeldung", ohneState.status === 303 && /autherror=state/.test(ohneState.headers.get("location") || "") && !cookieOf(ohneState).includes("pp_session"));
    const abgebrochen = await hole("/panel/auth/google/callback?error=access_denied");
    ok("Nutzer bricht beim Anbieter ab -> freundliche Rueckkehr", abgebrochen.status === 303 && /autherror=cancelled/.test(abgebrochen.headers.get("location") || ""));
    const zweimal = await hole("/panel/auth/google");
    const ziel = new URL(zweimal.headers.get("location"));
    const state = ziel.searchParams.get("state");
    const beim = await fetch(ziel.toString(), { redirect: "manual" });
    const rueck = beim.headers.get("location").replace(`http://127.0.0.1:${PANEL_PORT}`, "");
    await hole(rueck);
    const nochmal = await hole(rueck);
    ok("Derselbe Rueckweg ein zweites Mal -> abgelehnt (state ist verbraucht)", nochmal.status === 303 && /autherror=state/.test(nochmal.headers.get("location") || ""), String(state?.length));
    const apple = await hole("/panel/auth/apple");
    ok("Apple ist ehrlich als nicht eingerichtet gekennzeichnet", apple.status === 303 && /autherror=not_configured/.test(apple.headers.get("location") || ""));
    const cfg = await hole("/panel/api/start/config").then((x) => x.json());
    const appleCfg = cfg.authProviders.find((p) => p.id === "apple");
    ok("Apple im Panel: available false, mit Begruendung", appleCfg?.available === false && /Developer Program/.test(appleCfg?.note || ""), JSON.stringify(appleCfg));
  }
} catch (err) {
  fail++;
  failures.push(`Abbruch: ${err.message}`);
  console.error(err);
} finally {
  db?.close();
  kind.kill("SIGTERM");
  idp.close();
  await sleep(200);
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFehlgeschlagen:"); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
