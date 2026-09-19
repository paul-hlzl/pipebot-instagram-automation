#!/usr/bin/env node
/**
 * Beweislauf fuer die Markenfarben-Uebernahme (Auftrag Abschnitt 6 / Abnahme 4): liest fuenf
 * echte Websites, leitet Akzentfarbe und Verlaufspartner ab und rendert damit ein ECHTES
 * Beitragsbild durch dieselbe Pipeline, die auch der Kunde bekommt.
 *
 * Kostet nichts: bei aktiviertem Farbverlauf rendert die Pipeline den Hintergrund deterministisch
 * (gradient.ts) statt ihn bei fal.ai zu bestellen. Es wird auch nichts hochgeladen - die Bilder
 * landen direkt im Zielordner.
 *
 *   node scripts/brand-colors-proof.mjs [ziel-ordner] [website ...]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractBrandColors } from "../dist/panel/brand-colors.js";
import { renderGradientBackground } from "../dist/gradient.js";
import { addHeadlineText, addPipelineWatermark } from "../dist/watermark.js";
import { getFontOption } from "../dist/fonts.js";

const outDir = process.argv[2] || "docs/easy-onboarding/farben";
const sites = process.argv.slice(3);
const SITES = sites.length ? sites : ["pipeflow.at", "hittaro.com", "orf.at", "apple.com", "oebb.at"];
const STANDARD = { accentColor: "#0a0e1a", gradientColor2: "#1a1a2e" };
const HEADLINE = "So sieht deine Woche aus";
mkdirSync(outDir, { recursive: true });

const font = getFontOption("inter");
const zeile = (s) => `| ${s[0].padEnd(16)} | ${s[1].padEnd(9)} | ${s[2].padEnd(9)} | ${s[3].padEnd(14)} | ${s[4]} |`;
const tabelle = [["Website", "Akzent", "Partner", "Quelle", "Anmerkung"]];

for (const site of SITES) {
  const t0 = Date.now();
  let r = null;
  try {
    r = await extractBrandColors(site, 9000);
  } catch (err) {
    console.log(`${site}: Fehler ${err.message}`);
  }
  const farben = r ?? STANDARD;
  const ms = Date.now() - t0;
  // Exakt derselbe Weg wie generateImageUrl() in fal.ts, nur ohne R2-Upload.
  const hintergrund = await renderGradientBackground(farben.accentColor, farben.gradientColor2, "diagonal", 1080, 1350);
  const mitText = await addHeadlineText(hintergrund, HEADLINE, "feed", { family: font.cssFamily, weight: font.weight, glyphWidthFactor: font.glyphWidthFactor });
  const fertig = await addPipelineWatermark(mitText, "feed", site.replace(/^www\./, ""), undefined, { family: font.cssFamily, weight: font.weight, glyphWidthFactor: font.glyphWidthFactor });
  const datei = path.join(outDir, `${site.replace(/[^a-z0-9]+/gi, "-")}.jpg`);
  writeFileSync(datei, fertig);

  const anmerkung = !r
    ? "nichts Brauchbares -> stilles Standardthema"
    : r.adjustedForContrast
      ? `aus ${r.originalColor} abgedunkelt (Kontrast)`
      : "unveraendert uebernommen";
  tabelle.push([site, farben.accentColor, farben.gradientColor2, r ? r.source : "Fallback", anmerkung]);
  console.log(`${site.padEnd(16)} ${farben.accentColor} + ${farben.gradientColor2}  ${r ? r.source : "FALLBACK"}  ${ms}ms  -> ${datei}`);
  if (r) console.log(`${" ".repeat(16)} Kandidaten: ${r.candidates.map((c) => `${c.hex} [${c.from}]`).join("  ")}`);
}

console.log("\nFuer den Report:\n");
console.log(zeile(tabelle[0]));
console.log(`|${"-".repeat(18)}|${"-".repeat(11)}|${"-".repeat(11)}|${"-".repeat(16)}|${"-".repeat(20)}|`);
for (const r of tabelle.slice(1)) console.log(zeile(r));
