#!/usr/bin/env node
/**
 * Liefert das Panel-Frontend bewusst aus - statt es direkt aus der Arbeitskopie zu servieren.
 *
 * Vorgeschichte (15.09.2026): die Produktion hatte PANEL_PUBLIC_DIR auf das Arbeitsverzeichnis
 * /root/mcp-live/public/panel zeigen. Eine gespeicherte panel.js war damit in derselben Sekunde
 * live - ohne Neustart, ohne Sandbox-Stufe, ohne Ruecksicht auf das Routine-Fenster. Fuer die
 * Server-Seite galt die Regel "erst Sandbox, dann Produktion", fuers Frontend faktisch nicht.
 * Seitdem serviert die Produktion aus einem eigenen Verzeichnis, das nur dieses Skript fuellt.
 *
 *   node scripts/deploy-panel.mjs sandbox         -> /root/panel-work   (Port 3100)
 *   node scripts/deploy-panel.mjs produktion      -> /root/panel-live   (Port 3000)
 *   node scripts/deploy-panel.mjs <ziel> --pruefen  zeigt nur, was sich aendern wuerde
 *
 * Absichtlich ohne Automatik: kein Watcher, kein Hook. Ausliefern ist eine Entscheidung.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ZIELE = {
  sandbox: { dir: "/root/panel-work", prozess: "instagram-mcp-staging", fenster: false },
  produktion: { dir: "/root/panel-live", prozess: "instagram-mcp", fenster: true },
};

const [zielName, ...rest] = process.argv.slice(2);
const nurPruefen = rest.includes("--pruefen");
const ziel = ZIELE[zielName];
if (!ziel) {
  console.error(`Ziel fehlt oder unbekannt. Erlaubt: ${Object.keys(ZIELE).join(", ")}`);
  process.exit(2);
}

// Das Routine-Fenster gilt fuers Ausliefern genauso wie fuer einen Neustart: waehrend die
// stuendliche Routine laeuft, soll sich das Panel unter ihr nicht veraendern.
if (ziel.fenster && !nurPruefen) {
  const minute = new Date().getMinutes();
  if (minute >= 38 && minute <= 48) {
    console.error(`Routine-Fenster (:38-:48), gerade ist :${String(minute).padStart(2, "0")} - nicht ausliefern. Spaeter erneut versuchen.`);
    process.exit(3);
  }
}

const quelle = new URL("../public/panel/", import.meta.url).pathname;
const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);

/** Alle Dateien der Quelle, rekursiv, als relative Pfade. */
function dateien(basis, praefix = "") {
  const raus = [];
  for (const name of readdirSync(path.join(basis, praefix))) {
    const rel = path.join(praefix, name);
    if (statSync(path.join(basis, rel)).isDirectory()) raus.push(...dateien(basis, rel));
    else raus.push(rel);
  }
  return raus;
}

mkdirSync(ziel.dir, { recursive: true });
const liste = dateien(quelle);
const neu = [];
const geaendert = [];
for (const rel of liste) {
  const von = path.join(quelle, rel);
  const nach = path.join(ziel.dir, rel);
  if (!existsSync(nach)) neu.push(rel);
  else if (hash(von) !== hash(nach)) geaendert.push(rel);
}
// Was im Ziel liegt, aber nicht mehr in der Quelle - nur melden, nie automatisch loeschen.
const verwaist = existsSync(ziel.dir) ? dateien(ziel.dir).filter((r) => !liste.includes(r)) : [];

console.log(`Quelle: ${quelle}`);
console.log(`Ziel:   ${ziel.dir} (${zielName})`);
if (!neu.length && !geaendert.length) {
  console.log("\nKeine Unterschiede - nichts auszuliefern.");
} else {
  console.log("");
  for (const r of neu) console.log(`  neu       ${r}`);
  for (const r of geaendert) console.log(`  geaendert ${r}`);
}
if (verwaist.length) {
  console.log("\nIm Ziel, aber nicht mehr in der Quelle (bleibt liegen, bitte selbst pruefen):");
  for (const r of verwaist) console.log(`  ${r}`);
}

if (nurPruefen) {
  console.log("\n(Probelauf - nichts kopiert.)");
  process.exit(0);
}

for (const rel of [...neu, ...geaendert]) {
  const nach = path.join(ziel.dir, rel);
  mkdirSync(path.dirname(nach), { recursive: true });
  copyFileSync(path.join(quelle, rel), nach);
}
console.log(`\n${neu.length + geaendert.length} Datei(en) ausgeliefert.`);
console.log(`Der Prozess ${ziel.prozess} liest sie bei der naechsten Anfrage - ein Neustart ist nur noetig, wenn sich auch die Server-Seite geaendert hat.`);
