/**
 * Panel v15: Farbverlauf-Hintergruende (siehe Session-Bericht). Bewusst NICHT ueber den fal.ai-
 * Bildprompt gelöst (wie es die einfarbige Variante seit jeher tut, siehe buildImageStylePrompt
 * in fal.ts) - ein Text-zu-Bild-Modell setzt einen als Text beschriebenen Zwei-Farben-Verlauf
 * unzuverlaessig um (ungleichmaessige Uebergaenge, falsche Richtung, dritte Farbe mischt sich
 * ein), genau dieselbe Unzuverlaessigkeits-Kategorie, wegen der Headline-Text schon seit Panel
 * v1 deterministisch in Code gerendert wird statt vom Modell (siehe watermark.ts Dateikopf).
 * Ein Farbverlauf ist geometrisch exakt beschreibbar - deshalb hier stattdessen ein echtes
 * SVG-linearGradient, pixelgenau, jedes Mal identisch reproduzierbar. Ersetzt bei aktivierten
 * Farbverlauf-Kunden den fal.ai-Aufruf komplett (kein KI-Hintergrund mehr fuer diese Kunden) -
 * Headline/Wasserzeichen-Kompositierung danach unveraendert dieselbe Pipeline wie bisher.
 */
import sharp from "sharp";

export type GradientDirection = "horizontal" | "vertical" | "diagonal";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexToHsl(hex: string): [h: number, s: number, l: number] {
  const [r0, g0, b0] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r0) h = ((g0 - b0) / d) % 6;
    else if (max === g0) h = (b0 - r0) / d + 2;
    else h = (r0 - g0) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 3-4 zur ersten Farbe passende zweite Farben, fuer Kunden, die selbst keine zweite Farbe waehlen
 * wollen (siehe Panel-Aufruf "auch farblich weniger erfahrene Kunden"). Reine HSL-Rotation/
 * -Verschiebung, kein KI-Aufruf noetig, deterministisch und kostenlos: ein analoger Ton
 * (+35° Farbton), ein komplementaerer Ton (+180°), eine hellere Auspraegung derselben Farbe, eine
 * dunklere Auspraegung derselben Farbe. Ungueltige Eingabe -> leeres Array, Aufrufer entscheidet.
 *
 * Bei sehr dunklen (oder sehr hellen) Ausgangsfarben - z. B. genau die Standard-Bild-Hintergrund-
 * farbe #0a0e1a dieses Projekts (fast schwarz) - wuerden reine Farbton-Rotationen bei GLEICHER
 * Helligkeit trotzdem alle fast schwarz aussehen und als Verlauf-Partner wenig hermachen (per
 * echtem Testbild entdeckt, nicht nur theoretisch - siehe Session-Bericht). `hueRotatedLightness`
 * zieht die Helligkeit fuer die beiden farbton-rotierten Vorschlaege deshalb ein Stueck Richtung
 * mittleres Grau, damit sie tatsaechlich sichtbar verschieden vom fast-schwarzen/fast-weissen
 * Ausgangston wirken - die "heller"/"dunkler"-Vorschlaege behalten bewusst die ORIGINAL-Helligkeit
 * als Basis, das ist ja gerade ihr Sinn.
 */
export function suggestGradientPartners(hex: string): string[] {
  if (!HEX_COLOR.test(hex)) return [];
  const [h, s, l] = hexToHsl(hex);
  const clampedS = Math.max(s, 0.35); // sonst wirken die Vorschlaege bei fast-grauen Ausgangsfarben blass
  const hueRotatedLightness = l + (0.5 - l) * 0.45;
  return [
    hslToHex(h + 35, clampedS, hueRotatedLightness),
    hslToHex(h + 180, clampedS, hueRotatedLightness),
    hslToHex(h, clampedS, Math.min(0.92, l + 0.28)),
    hslToHex(h, clampedS, Math.max(0.08, l - 0.28)),
  ];
}

/** Rendert einen reinen Zwei-Farben-Verlauf als Bitmap in der gewuenschten Zielgroesse - direkter
 *  Ersatz fuer das fal.ai-Hintergrundbild, wenn ein Kunde Farbverlauf statt Einzelfarbe gewaehlt
 *  hat. Wirft bei ungueltigen Hex-Farben (Aufrufer validiert vorher, das hier ist der letzte
 *  Schutz). */
export async function renderGradientBackground(
  color1: string,
  color2: string,
  direction: GradientDirection,
  width: number,
  height: number,
): Promise<Buffer> {
  if (!HEX_COLOR.test(color1) || !HEX_COLOR.test(color2)) {
    throw new Error(`Ungültige Verlauf-Farbe: ${color1} / ${color2}`);
  }
  const coords: Record<GradientDirection, [number, number, number, number]> = {
    horizontal: [0, 0, 1, 0],
    vertical: [0, 0, 0, 1],
    diagonal: [0, 0, 1, 1],
  };
  const [x1, y1, x2, y2] = coords[direction] ?? coords.diagonal;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
        <stop offset="0%" stop-color="${color1}"/>
        <stop offset="100%" stop-color="${color2}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
