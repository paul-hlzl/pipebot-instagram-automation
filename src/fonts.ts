/**
 * Panel v15: kuratierte Schriftarten fuer Text-Overlays (Headline, Wasserzeichen, Karussell-
 * Slides - siehe Session-Bericht). Alle acht sind Google Fonts unter der SIL Open Font License
 * 1.1 (Lizenztext je Font unter assets/fonts/<Name>.OFL.txt, von github.com/google/fonts
 * heruntergeladen) - die OFL erlaubt kommerzielle Nutzung, Einbetten in eigene Produkte und
 * Weiterverbreiten ausdruecklich, keine Namensnennungspflicht am Endprodukt (nur wenn man die
 * Schrift selbst als Schrift weitergibt). Rechtlich unbedenklich fuer diesen Zweck.
 *
 * Rendering-Weg: sharp/libvips nutzt librsvg fuer die SVG->Bitmap-Kompositierung (siehe
 * watermark.ts) - `font-family="X"` in einem SVG-<text> loest ueber das System-Fontconfig auf,
 * nicht ueber eine im SVG eingebettete Datei. Deshalb installFontsOnce() unten: kopiert die
 * TTF-Dateien aus assets/fonts/ einmalig nach /usr/local/share/fonts/pipeflow-brand/ und ruft
 * fc-cache auf, damit ein frischer Server (Redeploy, neue Maschine) automatisch dieselben
 * Schriften bekommt, statt sich auf einen einmaligen manuellen Schritt waehrend dieser Sitzung
 * zu verlassen.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PACKAGE_ROOT } from "./config.js";

const execFileAsync = promisify(execFile);

export interface FontOption {
  id: string;
  label: string;
  /** Exact fontconfig family name, as installed by installFontsOnce(). */
  cssFamily: string;
  /** Sinnvolles Standard-Gewicht fuer Headline-Groesse - manche der Fonts (Bebas Neue, Anton,
   *  Caveat, Pacifico) haben nur eine sinnvolle Auspraegung, die anderen (Inter/Poppins/
   *  Playfair Display/Merriweather) sind Variable Fonts mit mehreren Schnitten. */
  weight: number;
  /** Kurze, laienverstaendliche Stil-Einordnung fuers Panel (Dropdown-Beschreibung). */
  styleNote: string;
  /** Grob geschaetzte mittlere Glyphenbreite (Vielfaches der Schriftgroesse) - dieselbe Rolle wie
   *  AVG_GLYPH_WIDTH_FACTOR in watermark.ts, nur pro Schriftart statt eines einzigen fest
   *  codierten Werts (0.56, urspruenglich nur fuer Liberation Serif kalibriert). Grobe Schaetzung
   *  reicht - die harte textLength-Sicherung beim Rendern faengt jede Abweichung ohnehin ab,
   *  das hier nur fuer eine vernuenftige Zeilenumbruch-Entscheidung VOR dem Rendern. */
  glyphWidthFactor: number;
}

/** Reihenfolge = Reihenfolge im Panel-Dropdown, bewusst von "neutral/modern" zu "verspielt". */
export const FONT_OPTIONS: FontOption[] = [
  { id: "inter", label: "Inter", cssFamily: "Inter", weight: 700, styleNote: "Modern, klar, serifenlos", glyphWidthFactor: 0.56 },
  { id: "poppins", label: "Poppins", cssFamily: "Poppins", weight: 700, styleNote: "Rund, freundlich, serifenlos", glyphWidthFactor: 0.58 },
  { id: "playfair", label: "Playfair Display", cssFamily: "Playfair Display", weight: 700, styleNote: "Elegant, klassische Serifenschrift", glyphWidthFactor: 0.56 },
  { id: "merriweather", label: "Merriweather", cssFamily: "Merriweather", weight: 700, styleNote: "Ruhig, gut lesbare Serifenschrift", glyphWidthFactor: 0.58 },
  { id: "bebas", label: "Bebas Neue", cssFamily: "Bebas Neue", weight: 400, styleNote: "Schmal, kraftvoll, in Großbuchstaben", glyphWidthFactor: 0.38 },
  { id: "anton", label: "Anton", cssFamily: "Anton", weight: 400, styleNote: "Sehr kräftige Display-Schrift", glyphWidthFactor: 0.48 },
  { id: "caveat", label: "Caveat", cssFamily: "Caveat", weight: 700, styleNote: "Dezente Handschrift-Optik", glyphWidthFactor: 0.42 },
  { id: "pacifico", label: "Pacifico", cssFamily: "Pacifico", weight: 400, styleNote: "Verspielte Schreibschrift", glyphWidthFactor: 0.52 },
];

export const DEFAULT_FONT_ID = "inter";

export function getFontOption(id: string | null | undefined): FontOption {
  return FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS.find((f) => f.id === DEFAULT_FONT_ID)!;
}

const FONT_INSTALL_DIR = "/usr/local/share/fonts/pipeflow-brand";
let installPromise: Promise<void> | null = null;

/**
 * Kopiert die Font-Dateien aus assets/fonts/ nach FONT_INSTALL_DIR und aktualisiert den
 * Fontconfig-Cache - idempotent (ueberschreibt einfach dieselben Dateien erneut) und guenstig
 * genug, um bei JEDEM Serverstart zu laufen statt einen fragilen "nur beim ersten Mal"-Marker zu
 * pflegen. Wirft nie - eine fehlgeschlagene Font-Installation darf den Server nicht am Start
 * hindern, nur die betroffenen Fonts fallen dann auf die System-Standardschrift zurueck (wie
 * bisher "Liberation Serif").
 */
export async function installFontsOnce(): Promise<void> {
  if (!installPromise) {
    installPromise = (async () => {
      const sourceDir = path.join(PACKAGE_ROOT, "assets/fonts");
      try {
        fs.mkdirSync(FONT_INSTALL_DIR, { recursive: true });
        const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".ttf"));
        for (const file of files) {
          fs.copyFileSync(path.join(sourceDir, file), path.join(FONT_INSTALL_DIR, file));
        }
        await execFileAsync("fc-cache", ["-f", FONT_INSTALL_DIR]);
        console.log(`[fonts] ${files.length} Schriftdateien installiert/aktualisiert (${FONT_INSTALL_DIR}).`);
      } catch (err) {
        console.error("[fonts] Installation fehlgeschlagen - Text-Overlays fallen auf die Standardschrift zurück:", err);
      }
    })();
  }
  return installPromise;
}
