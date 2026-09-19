#!/usr/bin/env node
/**
 * Abnahmekriterium 6, zweiter Teil: der neue Code gegen eine KOPIE der Produktions-Datenbank.
 * Startet den Sandbox-Build als eigenen, kurzlebigen Prozess (Port 3111, Mail-Dry-Run, eigener
 * Schluessel) auf einer frischen Kopie der aktuellsten Produktions-Sicherung und prueft, dass
 * bestehende Kunden unveraendert funktionieren: Zugangslink, Einstellungen (/api/me), Freigaben,
 * geplante Beitraege, und dass die Migration nur Spalten/Tabellen hinzufuegt.
 *
 * Beruehrt NIE die echte Produktions-DB, den Produktionsprozess oder /root/panel-live.
 *
 *   node scripts/test-prod-copy.mjs [pfad-zur-sicherung]
 */
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

const BACKUP_DIR = "/root/backups/panel";
const sourceArg = process.argv[2];
const source = sourceArg ?? path.join(BACKUP_DIR, readdirSync(BACKUP_DIR).filter((f) => /^panel-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().at(-1));
const PORT = 3111;
const dir = mkdtempSync(path.join(tmpdir(), "pf-prodcopy-"));
const dbPath = path.join(dir, "panel-kopie.db");
copyFileSync(source, dbPath);
console.log(`Kopie von ${source} -> ${dbPath}\n`);

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  ok   - ${name}`); } else { fail++; failures.push(name); console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ""}`); } };
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { default: Database } = await import("better-sqlite3");
const before = new Database(dbPath, { readonly: true });
const schemaBefore = Object.fromEntries(["customers", "planned_posts", "pending_approvals", "sessions", "connections"].map((t) => [t, before.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)]));
const countsBefore = Object.fromEntries(["customers", "planned_posts", "pending_approvals", "posts", "connections", "content_pillars"].map((t) => [t, before.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
const customers = before.prepare("SELECT id, company, email, approval_mode, email_verified, frequency, ig_feed_enabled, ig_story_enabled, linkedin_enabled FROM customers WHERE status = 'active'").all();
before.close();
console.log("Kunden in der Kopie:", customers.map((c) => `${c.company} (${c.id})`).join(", "));

const dist = new URL("../dist/index.js", import.meta.url).pathname;
const child = spawn(process.execPath, [dist], {
  cwd: dir,
  env: {
    ...process.env,
    PORT: String(PORT),
    PANEL_DB_PATH: dbPath,
    PANEL_MAIL_DRY_RUN: "1",
    PANEL_PUBLIC_DIR: new URL("../public/panel", import.meta.url).pathname,
    PANEL_BASE_URL: "https://mcp.pipebot.at",
    PANEL_MOUNT_PATH: "/panel",
    PANEL_SANDBOX: "true",
    PANEL_ENCRYPTION_KEY: randomBytes(32).toString("hex"), // Tokens der Kopie sind damit absichtlich NICHT entschluesselbar
    MCP_AUTH_TOKEN: randomBytes(16).toString("hex"),
    ROUTINE_TRIGGER_URL: "", ROUTINE_TRIGGER_TOKEN: "",
    IG_APP_ID: "", IG_APP_SECRET: "", INSTAGRAM_APP_ID: "", INSTAGRAM_APP_SECRET: "", LINKEDIN_CLIENT_ID: "", LINKEDIN_CLIENT_SECRET: "",
    TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "",
    // Pflichtwerte aus config.ts - hier Attrappen, damit der Prozess startet. Es wird nichts
    // davon benutzt: keine KI-Aufrufe (ANTHROPIC_API_KEY leer), kein Bild, kein Upload.
    ANTHROPIC_API_KEY: "",
    FAL_API_KEY: "kopie-test-kein-echter-schluessel",
    IG_USER_ID: "kopie-test", IG_ACCESS_TOKEN: "kopie-test",
    MEDIA_STORAGE_BUCKET_URL: "https://kopie-test.invalid", MEDIA_STORAGE_ENDPOINT: "https://kopie-test.invalid",
    MEDIA_STORAGE_ACCESS_KEY: "kopie-test", MEDIA_STORAGE_SECRET_KEY: "kopie-test", MEDIA_STORAGE_BUCKET_NAME: "kopie-test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (d) => { logs += d; });
child.stderr.on("data", (d) => { logs += d; });

try {
  let up = false;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) { up = true; break; } } catch { /* noch nicht */ } await sleep(200); }
  ok("Sandbox-Build startet auf der Produktionskopie", up, logs.slice(-300));

  const after = new Database(dbPath, { readonly: true });
  const schemaAfter = Object.fromEntries(Object.keys(schemaBefore).map((t) => [t, after.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)]));
  for (const t of Object.keys(schemaBefore)) {
    const removed = schemaBefore[t].filter((c) => !schemaAfter[t].includes(c));
    ok(`Migration ${t}: keine Spalte entfernt`, removed.length === 0, removed.join(","));
  }
  const added = schemaAfter.customers.filter((c) => !schemaBefore.customers.includes(c));
  const erwartet = ["auth_provider", "auth_subject", "login_link_expires_at", "login_link_token_hash", "plan_tier", "ui_mode"];
  ok(`Migration customers: nur die ${erwartet.length} neuen Spalten hinzugefuegt, alle NULL-bar`, added.sort().join(",") === erwartet.join(","), added.join(","));
  ok("Tabelle start_previews angelegt", Boolean(after.prepare("SELECT name FROM sqlite_master WHERE name = 'start_previews'").get()));
  const countsAfter = Object.fromEntries(Object.keys(countsBefore).map((t) => [t, after.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  ok("Keine Zeile verloren (customers, planned_posts, pending_approvals, posts, connections, content_pillars)", JSON.stringify(countsBefore) === JSON.stringify(countsAfter), `${JSON.stringify(countsBefore)} -> ${JSON.stringify(countsAfter)}`);
  ok("Bestehende Kunden: ui_mode NULL (klassisch), plan_tier NULL (basic)", after.prepare("SELECT COUNT(*) AS n FROM customers WHERE ui_mode IS NOT NULL OR plan_tier IS NOT NULL").get().n === 0);
  after.close();

  const rw = new Database(dbPath);
  for (const c of customers) {
    console.log(`\nKunde ${c.company} (${c.id}):`);
    // Zugangslink: neuen Schluessel NUR in der Kopie setzen, dann wie der Kunde einloggen.
    const key = `kopie-${randomBytes(12).toString("base64url")}`;
    rw.prepare("UPDATE customers SET login_key_hash = ? WHERE id = ?").run(sha256(key), c.id);
    const login = await fetch(`http://127.0.0.1:${PORT}/panel/login?key=${key}`, { redirect: "manual" });
    const cookie = (login.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).join("; ");
    ok("Zugangslink meldet an (303 auf /panel/) und setzt Session", login.status === 303 && cookie.includes("pp_session"), String(login.status));
    const root = await fetch(`http://127.0.0.1:${PORT}/panel/`, { headers: { cookie }, redirect: "manual" });
    ok("Landet im klassischen Panel (200, keine Umleitung nach /start/)", root.status === 200, String(root.status));
    const me = await fetch(`http://127.0.0.1:${PORT}/panel/api/me`, { headers: { cookie } }).then((r) => r.json());
    ok("/api/me liefert Einstellungen unveraendert (Firma, Freigabe-Modus, Kanaele, Rhythmus)",
      me.customer?.company === c.company && me.customer?.approvalMode === Boolean(c.approval_mode) && me.customer?.igFeedEnabled === Boolean(c.ig_feed_enabled) && me.customer?.linkedinEnabled === Boolean(c.linkedin_enabled) && me.customer?.frequency === c.frequency,
      JSON.stringify({ company: me.customer?.company, approvalMode: me.customer?.approvalMode, frequency: me.customer?.frequency }));
    ok("/api/me: uiMode classic, features vorhanden", me.customer?.uiMode === "classic" && typeof me.customer?.features === "object");
    const expectedPlanned = rw.prepare("SELECT COUNT(*) AS n FROM planned_posts WHERE customer_id = ? AND scheduled_for >= date('now') AND scheduled_for <= date('now', '+6 days')").get(c.id).n;
    const planned = await fetch(`http://127.0.0.1:${PORT}/panel/api/planned-posts`, { headers: { cookie } }).then((r) => r.json());
    ok(`Geplante Beitraege der naechsten 7 Tage lesbar (${planned.posts?.length ?? "?"}, DB: ${expectedPlanned})`, Array.isArray(planned.posts) && planned.posts.length === expectedPlanned);
    const approvals = await fetch(`http://127.0.0.1:${PORT}/panel/api/approvals`, { headers: { cookie } }).then((r) => r.json());
    const expectedApprovals = rw.prepare("SELECT COUNT(*) AS n FROM pending_approvals WHERE customer_id = ? AND status = 'pending'").get(c.id).n;
    ok(`Freigabe-Warteschlange lesbar (${approvals.approvals?.length ?? "?"} offen, DB: ${expectedApprovals})`, Array.isArray(approvals.approvals) && approvals.approvals.length === expectedApprovals);
    const posts = await fetch(`http://127.0.0.1:${PORT}/panel/api/posts`, { headers: { cookie } }).then((r) => r.json());
    ok("Verlauf lesbar", Array.isArray(posts.posts));
    const start = await fetch(`http://127.0.0.1:${PORT}/panel/api/start/status`, { headers: { cookie } }).then((r) => r.json());
    ok("Neue Status-Route funktioniert auch fuer Bestandskunden (Job idle, Woche = dieselben Beitraege)", start.job?.phase === "idle" && start.posts?.length === expectedPlanned, JSON.stringify(start.job));
    const patch = await fetch(`http://127.0.0.1:${PORT}/panel/api/me`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: "{}" }).then((r) => r.json());
    ok("Leeres PATCH aendert nichts (Regression 15.09.)", patch.customer?.company === c.company && patch.customer?.approvalMode === Boolean(c.approval_mode));
  }
  rw.close();
} catch (err) {
  fail++;
  failures.push(`Abbruch: ${err.message}`);
  console.error(err);
} finally {
  child.kill("SIGTERM");
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n(Kopie ${dir} geloescht)`);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFehlgeschlagen:"); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
