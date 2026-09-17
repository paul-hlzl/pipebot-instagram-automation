#!/usr/bin/env node
/**
 * Daily SQLite backup for the customer panel DB. Uses better-sqlite3's online backup() API
 * (safe to run while the server is writing - no sqlite3 CLI is installed on this host, and
 * this is functionally equivalent to `sqlite3 panel.db ".backup ..."`) rather than a plain
 * file copy, which could grab a half-written page under concurrent writes.
 *
 * Never touches PANEL_ENCRYPTION_KEY - that must be backed up separately, outside this
 * directory (see docs/PANEL_V3_REPORT.md, Aufgabe 10).
 *
 * Nach dem Backup: PRAGMA integrity_check auf der Sicherungsdatei selbst (nicht der Quelle -
 * die Quelle koennte durch einen fehlerhaften Kopiervorgang unbemerkt kaputt geschrieben worden
 * sein, das faellt nur bei der Pruefung der Kopie auf). Bei Fehlschlag: Logzeile UND Mail, aber
 * kein Abbruch mit Exit-Code ungleich 0 fuer die Aufraeumlogik - die soll trotzdem laufen, damit
 * alte Bestaende nicht endlos anwachsen, nur weil ein einzelner Tag fehlschlug.
 */
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DB = process.env.PANEL_DB_PATH ?? path.join(ROOT, "data/panel.db");
const BACKUP_DIR = process.env.PANEL_BACKUP_DIR ?? "/root/backups/panel";
const KEEP = 14;
const KEEP_MANUAL = 10;
const BREVO_MAIL = "/root/scripts/brevo-mail.sh";
const ALERT_TO = "office@pipeline-solutions.at";

function dateStamp(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** Prueft eine SQLite-Datei mit PRAGMA integrity_check. Gibt "ok" oder den Befund zurueck. */
function integrityCheck(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.pragma("integrity_check");
    return rows.map((r) => r.integrity_check).join("; ");
  } finally {
    db.close();
  }
}

function alertMail(subject, body) {
  try {
    execFileSync(BREVO_MAIL, [subject, ALERT_TO], { input: body, timeout: 30_000 });
    console.log("[backup] Alarm-Mail verschickt");
  } catch (err) {
    console.error("[backup] Alarm-Mail konnte nicht verschickt werden:", err.message);
  }
}

/** Loescht alle bis auf die KEEP_MANUAL neuesten Dateien, die zu einem Muster passen. */
function aufraeumenManuelleDumps(muster, beschreibung) {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => muster.test(f))
    .map((f) => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  const toDelete = files.slice(0, Math.max(0, files.length - KEEP_MANUAL));
  for (const { f } of toDelete) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
    console.log(`[backup] ${beschreibung}, alt, geloescht: ${f}`);
  }
  if (files.length) {
    console.log(`[backup] ${beschreibung}: ${files.length - toDelete.length} von ${files.length} behalten (max ${KEEP_MANUAL}).`);
  }
}

async function main() {
  if (!fs.existsSync(SRC_DB)) {
    throw new Error(`Quelldatenbank nicht gefunden: ${SRC_DB}`);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const dest = path.join(BACKUP_DIR, `panel-${dateStamp()}.db`);
  const src = new Database(SRC_DB, { readonly: true });
  await src.backup(dest);
  src.close();
  console.log(`[backup] ${SRC_DB} -> ${dest}`);

  // In einem eigenen try/catch: eine stark beschaedigte Kopie laesst better-sqlite3 schon beim
  // Oeffnen scheitern (nicht erst bei integrity_check selbst). Ohne dieses try/catch wuerde die
  // Ausnahme main() sofort beenden und die Aufraeumlogik weiter unten nie erreichen.
  let befund;
  try {
    befund = integrityCheck(dest);
  } catch (err) {
    befund = `Datei liess sich nicht oeffnen: ${err.message}`;
  }
  if (befund === "ok") {
    console.log("[backup] integrity_check der Sicherung: ok");
  } else {
    console.error(`[backup] FEHLER: integrity_check der Sicherung meldet: ${befund}`);
    alertMail(
      "Pipeflow: Sicherung fehlgeschlagen (integrity_check)",
      `Die heutige Sicherung der Panel-Datenbank hat die Integritaetspruefung nicht bestanden.\n\n` +
        `Datei: ${dest}\nBefund: ${befund}\n\n` +
        `Die Quelldatenbank ${SRC_DB} ist davon nicht notwendigerweise betroffen - moeglich ist ` +
        `auch ein fehlerhafter Kopiervorgang. Bitte pruefen und ggf. eine neue Sicherung anstossen.\n\n` +
        `Erstellt ${new Date().toISOString()} von backup-db.mjs.`,
    );
  }

  // Taegliche Bestaende: Keep only the most recent KEEP backups (by filename, which sorts
  // chronologically).
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^panel-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  const toDelete = files.slice(0, Math.max(0, files.length - KEEP));
  for (const f of toDelete) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
    console.log(`[backup] alt, geloescht: ${f}`);
  }
  console.log(`[backup] ${files.length - toDelete.length} Backups vorhanden (max ${KEEP}).`);

  // Manuelle Vor-Deploy-Sicherungen raeumen sich nie von selbst auf und wachsen sonst unbegrenzt.
  aufraeumenManuelleDumps(/^panel-pre-deploy-.*\.db$/, "pre-deploy-Sicherungen");
  aufraeumenManuelleDumps(/^panel-\d{4}-vor-.*\.db$/, "vor-*-Sicherungen");
}

main().catch((err) => {
  console.error("[backup] fehlgeschlagen:", err);
  alertMail(
    "Pipeflow: Sicherung fehlgeschlagen",
    `Der taegliche Sicherungslauf ist mit einem Fehler abgebrochen:\n\n${err.stack ?? err.message}\n\n` +
      `Erstellt ${new Date().toISOString()} von backup-db.mjs.`,
  );
  process.exit(1);
});
