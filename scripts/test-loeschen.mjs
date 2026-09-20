/**
 * Vollstaendige Kontoloeschung (20.09.2026) - die Luecke im Selbstbedienungs-Weg.
 *   npm run test:loeschen
 *
 * Bis zum 20.09. loeschte `DELETE /api/me` nur die Zeile in `customers` und vertraute auf
 * ON DELETE CASCADE. Zwei Tabellen deklarieren keinen: `start_previews` (mit IP- UND
 * E-Mail-Adresse) und `planning_errors`. Genau dieser Weg ist der, den Meta fuer die
 * Instagram-Freigabe verlangt. Hier wird auf einer KOPIE der Produktionssicherung bewiesen,
 * dass nach dem Loeschen in KEINER Tabelle mehr eine Zeile dieses Kunden steht.
 *
 * Laeuft rein lokal: keine Netzaufrufe, keine Produktionsdatenbank.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { entferneKunde, kundenTabellen, sammleKundenDateien, r2SchluesselAus } from "../dist/panel/kunde-entfernen.js";

const QUELLE = "/root/backups/panel/panel-vor-neuanfang-20260920-1422.db";
const BUCKET = "https://pub-ca94c8f7d991428986a52fce66b47718.r2.dev";

function kopie() {
  const ziel = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "loeschtest-")), "panel.db");
  fs.copyFileSync(QUELLE, ziel);
  const db = new Database(ziel);
  db.pragma("foreign_keys = ON");
  return db;
}

test("nach dem Loeschen steht in KEINER Tabelle noch eine Zeile des Kunden", () => {
  const db = kopie();
  const kunde = db.prepare("SELECT id FROM customers").get().id;
  const tabellen = kundenTabellen(db);
  assert.ok(tabellen.length >= 19, `erwartet mindestens 19 Tabellen mit Kundenbezug, gefunden ${tabellen.length}`);

  const vorher = Object.fromEntries(
    tabellen.map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE customer_id = ?`).get(kunde).n]),
  );
  assert.ok(Object.values(vorher).some((n) => n > 0), "Testdaten sind leer - Sicherung pruefen");

  entferneKunde(db, kunde);

  const uebrig = tabellen
    .map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE customer_id = ?`).get(kunde).n])
    .filter(([, n]) => n > 0);
  assert.deepEqual(uebrig, [], `diese Tabellen halten noch Zeilen: ${JSON.stringify(uebrig)}`);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM customers WHERE id = ?").get(kunde).n, 0);
});

test("DIE ALTE LUECKE: start_previews und planning_errors sind mit abgedeckt", () => {
  const db = kopie();
  const tabellen = kundenTabellen(db);
  for (const t of ["start_previews", "planning_errors"]) {
    assert.ok(tabellen.includes(t), `${t} fehlt in der Liste - genau das war die Luecke`);
  }
});

test("Dateien werden eingesammelt, bevor die Zeilen verschwinden", () => {
  const db = kopie();
  const kunde = db.prepare("SELECT id FROM customers").get().id;
  const dateien = sammleKundenDateien(db, kunde, BUCKET);
  assert.ok(Array.isArray(dateien.r2Schluessel) && Array.isArray(dateien.lokaleDateien));
  for (const k of dateien.r2Schluessel) {
    assert.match(k, /^(posts|videos|voice-tmp)\//, `kein eigener Ablagepfad: ${k}`);
    assert.ok(!k.startsWith("http"), "Schluessel, nicht Adresse");
  }
  for (const f of dateien.lokaleDateien) assert.ok(f.startsWith("/"), `kein absoluter Pfad: ${f}`);
  // Nach dem Loeschen ist nichts mehr zu finden - darum VORHER einsammeln.
  entferneKunde(db, kunde);
  assert.deepEqual(sammleKundenDateien(db, kunde, BUCKET), { r2Schluessel: [], lokaleDateien: [] });
});

test("fremde Adressen werden nie angefasst", () => {
  assert.equal(r2SchluesselAus(`${BUCKET}/posts/bild.png`, BUCKET), "posts/bild.png");
  assert.equal(r2SchluesselAus(`${BUCKET}/videos/f.mp4`, BUCKET), "videos/f.mp4");
  assert.equal(r2SchluesselAus("https://example.com/posts/fremd.png", BUCKET), null, "fremder Wirt");
  assert.equal(r2SchluesselAus(`${BUCKET}/anderes/x.png`, BUCKET), null, "fremde Ablage im selben Eimer");
  assert.equal(r2SchluesselAus("/root/mcp-live/data/logos/auto-x.png", BUCKET), null, "lokaler Pfad");
  assert.equal(r2SchluesselAus(null, BUCKET), null);
});
