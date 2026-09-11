#!/usr/bin/env node
/**
 * Daily SQLite backup for the customer panel DB. Uses better-sqlite3's online backup() API
 * (safe to run while the server is writing - no sqlite3 CLI is installed on this host, and
 * this is functionally equivalent to `sqlite3 panel.db ".backup ..."`) rather than a plain
 * file copy, which could grab a half-written page under concurrent writes.
 *
 * Never touches PANEL_ENCRYPTION_KEY - that must be backed up separately, outside this
 * directory (see docs/PANEL_V3_REPORT.md, Aufgabe 10).
 */
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DB = process.env.PANEL_DB_PATH ?? path.join(ROOT, "data/panel.db");
const BACKUP_DIR = process.env.PANEL_BACKUP_DIR ?? "/root/backups/panel";
const KEEP = 14;

function dateStamp(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
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

  // Keep only the most recent KEEP backups (by filename, which sorts chronologically).
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
}

main().catch((err) => {
  console.error("[backup] fehlgeschlagen:", err);
  process.exit(1);
});
