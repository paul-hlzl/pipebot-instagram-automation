#!/usr/bin/env node
/**
 * Loescht Kundenkonten samt allem, was an ihnen haengt. Fuer den Neuanfang am 19.09.2026
 * beauftragt: alle bisher registrierten Konten von Produktion entfernen.
 *
 * NICHT umkehrbar. Ohne --wirklich wird nur gezeigt, was passieren wuerde. Eine Sicherung der
 * Datenbank legt der Aufrufer an (siehe --sicherung), sie gehoert VOR den Lauf.
 *
 *   node scripts/kunden-loeschen.mjs --db <pfad> --alle                 (zeigt nur)
 *   node scripts/kunden-loeschen.mjs --db <pfad> --alle --wirklich      (loescht)
 *   node scripts/kunden-loeschen.mjs --db <pfad> --alle --sicherung <pfad> --wirklich
 */
import Database from "better-sqlite3";
import fs from "node:fs";

const args = process.argv.slice(2);
const wert = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dbPfad = wert("--db") ?? "/root/mcp-server/data/panel-staging.db";
const wirklich = args.includes("--wirklich");
const alle = args.includes("--alle");
const sicherung = wert("--sicherung");

if (!alle) { console.error("Ohne --alle passiert nichts. Absichtlich."); process.exit(2); }

const db = new Database(dbPfad);
const kunden = db.prepare("SELECT id, company, email FROM customers ORDER BY created_at").all();

console.log(`Datenbank: ${dbPfad}`);
console.log(`Betroffen: ${kunden.length} Konto/Konten`);
for (const k of kunden) {
  const v = db.prepare("SELECT provider, account_name FROM connections WHERE customer_id=?").all(k.id);
  const p = db.prepare("SELECT COUNT(*) n FROM planned_posts WHERE customer_id=?").get(k.id).n;
  console.log(`  ${k.company} <${k.email}> - ${p} Beitraege, Verbindungen: ${v.map((x) => x.account_name).join(", ") || "keine"}`);
}

if (!wirklich) { console.log("\nProbelauf - nichts geloescht. Mit --wirklich ausfuehren."); process.exit(0); }

if (sicherung) {
  await db.backup(sicherung);
  fs.chmodSync(sicherung, 0o600);
  console.log(`\nSicherung geschrieben: ${sicherung}`);
}

// Alles, was auf einen Kunden zeigt. Tabellen, die es in dieser Datenbank nicht gibt, werden
// stillschweigend uebersprungen - die Liste deckt beide Staende ab.
const tabellen = [
  "planned_posts", "pending_approvals", "comment_approvals", "review_approvals", "post_requests",
  "sessions", "start_previews", "connections", "usage_costs", "content_pillars", "style_samples",
  "analytics_snapshots", "analytics_account_snapshots", "planned_post_undo", "customer_events",
];

let entfernt = 0;
const tx = db.transaction(() => {
  for (const k of kunden) {
    for (const t of tabellen) {
      try { db.prepare(`DELETE FROM ${t} WHERE customer_id = ?`).run(k.id); } catch { /* Tabelle oder Spalte gibt es hier nicht */ }
    }
    // Rueckgaengig-Schnappschuesse haengen am Beitrag, nicht am Kunden.
    try { db.prepare("DELETE FROM planned_post_undo WHERE post_id NOT IN (SELECT id FROM planned_posts)").run(); } catch { /* egal */ }
    db.prepare("DELETE FROM customers WHERE id = ?").run(k.id);
    entfernt++;
  }
});
tx();

// Verwaiste Logodateien mitnehmen - aber NUR im ausdruecklich genannten Ordner. Ohne diese
// Angabe bleiben Dateien liegen: bei einem Probelauf auf einer KOPIE haette die Aufraeumrunde
// sonst die Logos der echten Kunden geloescht (am 19.09.2026 genau so passiert).
let logos = 0;
for (const ordner of [wert("--logos")].filter(Boolean)) {
  if (!fs.existsSync(ordner)) continue;
  const bleibt = new Set(db.prepare("SELECT id FROM customers").all().map((r) => r.id));
  for (const datei of fs.readdirSync(ordner)) {
    const m = /^auto-(.+)\.png$/.exec(datei);
    if (m && !bleibt.has(m[1])) { fs.unlinkSync(`${ordner}/${datei}`); logos++; }
  }
}

console.log(`\nEntfernt: ${entfernt} Konto/Konten, ${logos} Logodatei(en).`);
console.log(`Kunden jetzt: ${db.prepare("SELECT COUNT(*) n FROM customers").get().n}`);
for (const t of ["planned_posts", "connections", "sessions"]) {
  try { console.log(`  ${t}: ${db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n} Zeilen`); } catch { /* egal */ }
}
