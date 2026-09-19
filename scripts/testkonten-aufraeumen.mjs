#!/usr/bin/env node
/**
 * Raeumt die Konten weg, die AUTOMATISCHE Testlaeufe angelegt haben - und nur die.
 *
 * Erkennungsmerkmal ist die Adresse: die Testlaeufe verwenden ausschliesslich die Endung
 * @sandbox.invalid oder @example.invalid (beides reservierte Endungen, die es real nicht gibt).
 * Ein echtes Kundenkonto kann darum nie getroffen werden. Zusaetzlich verschwinden Testkonten
 * aus dem Testmodus (status = 'test') und verwaiste Logodateien.
 *
 *   node scripts/testkonten-aufraeumen.mjs                 (Sandbox-Datenbank)
 *   node scripts/testkonten-aufraeumen.mjs --db <pfad>     (andere Datenbank)
 *   node scripts/testkonten-aufraeumen.mjs --zeigen        (nur auflisten, nichts loeschen)
 */
import Database from "better-sqlite3";
import fs from "node:fs";

const args = process.argv.slice(2);
const dbPfad = args.includes("--db") ? args[args.indexOf("--db") + 1] : "/root/mcp-server/data/panel-staging.db";
const nurZeigen = args.includes("--zeigen");
const db = new Database(dbPfad);

// Die beiden festen Test-Kunden aus docs/SANDBOX.md bleiben stehen: test-start.mjs braucht
// "Testfirma Eins" als bekannte Adresse, und ihre Zugangslinks stehen in /root/sandbox-keys.env.
const GESCHUETZT = ["test1@sandbox.invalid", "test2@sandbox.invalid"];

const treffer = db.prepare(`
  SELECT id, email, company, status, created_at FROM customers
   WHERE (email LIKE '%@sandbox.invalid' OR email LIKE '%@example.invalid' OR status = 'test')
     AND email NOT IN (${GESCHUETZT.map(() => "?").join(",")})
   ORDER BY created_at
`).all(...GESCHUETZT);

console.log(`Datenbank: ${dbPfad}`);
console.log(`Gefunden: ${treffer.length} Testkonto/-konten`);
for (const k of treffer) console.log(`  ${k.created_at}  ${k.email}  (${k.status})`);

if (!nurZeigen && treffer.length) {
  const tabellen = ["planned_posts", "pending_approvals", "sessions", "start_previews", "connections", "usage_costs", "content_pillars"];
  for (const k of treffer) {
    for (const t of tabellen) {
      try { db.prepare(`DELETE FROM ${t} WHERE customer_id = ?`).run(k.id); } catch { /* Tabelle gibt es hier nicht */ }
    }
    db.prepare("DELETE FROM customers WHERE id = ?").run(k.id);
  }
  console.log(`Entfernt: ${treffer.length} Konto/Konten samt Beitraegen, Sitzungen und Zaehlern.`);
}

const bleibt = new Set(db.prepare("SELECT id FROM customers").all().map((r) => r.id));
let logos = 0;
for (const ordner of ["data/logos", "/root/mcp-live/data/logos"]) {
  if (!fs.existsSync(ordner)) continue;
  for (const datei of fs.readdirSync(ordner)) {
    const m = /^auto-(.+)\.png$/.exec(datei);
    if (m && !bleibt.has(m[1])) { if (!nurZeigen) fs.unlinkSync(`${ordner}/${datei}`); logos++; }
  }
}
console.log(`Verwaiste Logodateien: ${logos}${nurZeigen ? " (nicht geloescht)" : " entfernt"}`);
console.log(`Kunden jetzt: ${db.prepare("SELECT COUNT(*) n FROM customers").get().n}`);
