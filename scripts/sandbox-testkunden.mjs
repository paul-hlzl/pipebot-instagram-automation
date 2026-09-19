#!/usr/bin/env node
/**
 * Legt die beiden festen Test-Kunden der Sandbox wieder an, falls sie fehlen
 * (docs/SANDBOX.md: "Testfirma Eins" und "Testfirma Zwei (Freigabe-Modus)").
 *
 * Sie entstehen ueber den NORMALEN Weg - Konto anlegen, Einstellungen per PATCH, Zugangslink
 * ueber die Schnittstelle - also keine handgeschriebenen Datenbankzeilen. Die neuen Zugangslinks
 * werden in /root/sandbox-keys.env geschrieben (Rechte 600) und NICHT ausgegeben.
 *
 *   node scripts/sandbox-testkunden.mjs
 */
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = process.env.STAGING_URL ?? "https://mcp.pipebot.at";
const MOUNT = process.env.STAGING_MOUNT ?? "/panel/sandbox";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const KEY_DATEI = "/root/sandbox-keys.env";

const kunden = [
  { email: "test1@sandbox.invalid", firma: "Testfirma Eins", freigabe: false, zeit: "09:00", variable: "SANDBOX_KEY_A" },
  { email: "test2@sandbox.invalid", firma: "Testfirma Zwei (Freigabe-Modus)", freigabe: true, zeit: "10:00", variable: "SANDBOX_KEY_B" },
];

const cookieAus = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session="));
const ruf = (pfad, methode, koerper, cookie) =>
  fetch(`${BASE}${MOUNT}${pfad}`, {
    method: methode,
    redirect: "manual",
    headers: { ...(koerper ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: koerper ? JSON.stringify(koerper) : undefined,
  });

let datei = fs.existsSync(KEY_DATEI) ? fs.readFileSync(KEY_DATEI, "utf8") : "";

for (const k of kunden) {
  const da = db.prepare("SELECT id FROM customers WHERE email = ?").get(k.email);
  if (da) { console.log(`${k.firma}: ist da`); continue; }

  const anlegen = await ruf("/api/start/email", "POST", { email: k.email });
  const cookie = cookieAus(anlegen);
  if (!cookie) { console.error(`${k.firma}: Konto anlegen fehlgeschlagen (${anlegen.status})`); process.exit(1); }

  await ruf("/api/me", "PATCH", {
    company: k.firma, contactName: k.firma, industry: "Test", frequency: "taeglich",
    postTime: k.zeit, approvalMode: k.freigabe, igFeedEnabled: true, linkedinEnabled: true,
  }, cookie);

  const link = (await (await ruf("/api/access-link", "POST", {}, cookie)).json()).link ?? "";
  const schluessel = link.split("key=")[1] ?? "";
  if (!schluessel) { console.error(`${k.firma}: kein Zugangslink erhalten`); process.exit(1); }

  const zeile = `${k.variable}=${schluessel}`;
  datei = datei.includes(`${k.variable}=`)
    ? datei.replace(new RegExp(`^${k.variable}=.*$`, "m"), zeile)
    : `${datei.replace(/\n*$/, "\n")}${zeile}\n`;
  console.log(`${k.firma}: angelegt, Zugangsschluessel in ${KEY_DATEI} unter ${k.variable} hinterlegt`);
}

fs.writeFileSync(KEY_DATEI, datei, { mode: 0o600 });
fs.chmodSync(KEY_DATEI, 0o600);
console.log(`Fertig. Kunden in der Sandbox: ${db.prepare("SELECT COUNT(*) n FROM customers").get().n}`);
