/**
 * Markenfarben aus der Website des Kunden uebernehmen (Easy Onboarding, Auftrag Abschnitt 6).
 *
 * Ziel: der Kunde tippt seine Domain, und die erzeugten Beitragsbilder sehen sofort nach seiner
 * Marke aus, ohne dass er eine Farbe gewaehlt hat. Das Ergebnis geht in die BESTEHENDEN Felder
 * accent_color / gradient_color2 / gradient_direction - es gibt kein zweites Farbsystem, und der
 * Farbverlaufs-Picker im Panel bleibt die letzte Instanz.
 *
 * Warum so und nicht naiv: die haeufigste Farbe einer Website ist fast immer Weiss, die
 * zweithaeufigste ein Grau, die dritte das Blau eines Facebook-Icons. Deshalb drei Stufen:
 *   1. SAMMELN aus mehreren Quellen mit unterschiedlichem Vertrauen (theme-color > CSS-Variable >
 *      sonstige CSS-Farbe > Logo/Favicon).
 *   2. WEGWERFEN: Weiss, Schwarz, Grautoene, und die bekannten Hausfarben fremder Dienste
 *      (Social-Icons, Cookie-Banner-Gruen, Zahlungslogos) - sonst ist die "Markenfarbe" der
 *      meisten Seiten das Blau von Facebook.
 *   3. TAUGLICH MACHEN: auf dem Beitragsbild steht WEISSE Schlagzeile. Eine Marke mit hellem
 *      Gelb ist als Hintergrund unbrauchbar - die Farbe wird deshalb so weit abgedunkelt, bis der
 *      Kontrast zu Weiss reicht (WCAG AA, 4.5:1). Lesbarkeit geht vor Treue.
 *
 * Kein Screenshot, kein Headless-Browser: HTML + bis zu drei Stylesheets + ein Icon reichen in
 * der Praxis (siehe docs/EASY_ONBOARDING_REPORT.md, fuenf echte Websites). Ein Browser waere pro
 * Aufruf mehrere Sekunden und ein weiterer Dienst im Betrieb - beides ist es nicht wert.
 */
import sharp from "sharp";
import { fetchBinarySafely, fetchTextSafely } from "../ssrf-safe-fetch.js";

export type GradientDirection = "horizontal" | "vertical" | "diagonal";

export interface BrandColorResult {
  /** Hintergrundfarbe der Beitragsbilder - garantiert dunkel genug fuer weisse Schrift. */
  accentColor: string;
  /** Zweite Farbe des Verlaufs. */
  gradientColor2: string;
  gradientDirection: GradientDirection;
  /** Woher die tragende Farbe kam - fuer den Report und die Erklaerung im Panel. */
  source: "theme-color" | "css-variable" | "css" | "logo";
  /** Wurde die Farbe fuer die Lesbarkeit veraendert? */
  adjustedForContrast: boolean;
  /** Die Farbe, wie sie auf der Website stand (vor der Kontrast-Korrektur). */
  originalColor: string;
  /** Nur fuer Report/Diagnose - die besten Kandidaten mit Herkunft und Punktzahl. */
  candidates: { hex: string; score: number; from: string }[];
}

/* ---------------------------------- Farbmathematik ---------------------------------- */

const HEX6 = /^#[0-9a-f]{6}$/i;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const r0 = r / 255;
  const g0 = g / 255;
  const b0 = b / 255;
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

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  const [r, g, b] =
    hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Relative Leuchtdichte nach WCAG 2.1. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhaeltnis zu Weiss (die Schlagzeile auf dem Beitragsbild ist immer weiss). */
export function contrastToWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/**
 * Dunkelt eine Farbe so weit ab, bis weisse Schrift darauf sicher lesbar ist (4.5:1, WCAG AA),
 * behaelt dabei Farbton und Saettigung. Gibt die Farbe unveraendert zurueck, wenn sie schon
 * dunkel genug ist.
 */
export function ensureReadableWithWhite(hex: string, ziel = 4.5): string {
  if (contrastToWhite(hex) >= ziel) return hex;
  const [h, s] = rgbToHsl(...hexToRgb(hex));
  // Saettigung leicht anheben: stark abgedunkelte Pastelltoene wirken sonst schlammig.
  const s2 = clamp(s * 1.1, 0, 1);
  for (let l = 0.5; l >= 0.05; l -= 0.02) {
    const kandidat = hslToHex(h, s2, l);
    if (contrastToWhite(kandidat) >= ziel) return kandidat;
  }
  return hslToHex(h, s2, 0.08);
}

/* ------------------------------- Kandidaten einsammeln ------------------------------ */

/**
 * Hausfarben fremder Dienste. Sie stehen im CSS praktisch jeder Website (Social-Icons im
 * Fusszeilen-Bereich, Zahlungslogos, Cookie-Banner) und waeren sonst regelmaessig die
 * "Markenfarbe" eines Tischlers. Nur exakte Treffer und ihre direkte Nachbarschaft werden
 * verworfen - eine Marke, deren echte Farbe zufaellig genau Facebook-Blau ist, verliert sie
 * hier (bewusst in Kauf genommen, im Report vermerkt).
 */
const FREMDFARBEN = [
  "#1877f2", "#4267b2", "#3b5998", // Facebook
  "#e4405f", "#c13584", "#833ab4", "#fd1d1d", // Instagram
  "#1da1f2", "#14171a", // Twitter/X
  "#ff0000", "#cc0000", // YouTube
  "#25d366", "#128c7e", // WhatsApp
  "#0a66c2", "#0077b5", "#0e76a8", // LinkedIn
  "#4285f4", "#34a853", "#fbbc05", "#ea4335", // Google
  "#ee1d52", "#69c9d0", // TikTok
  "#e60023", // Pinterest
  "#ff9900", "#232f3e", // Amazon
  "#635bff", "#6772e5", // Stripe
  "#003087", "#009cde", // PayPal
  "#7289da", "#5865f2", // Discord
  "#25d366", "#34b7f1", // WhatsApp/Telegram
];

/** Farbabstand im RGB-Raum, grob aber ausreichend. */
function abstand(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function istFremdfarbe(hex: string): boolean {
  return FREMDFARBEN.some((f) => abstand(hex, f) < 18);
}

/**
 * Taugt die Farbe ueberhaupt als Markenfarbe? Wirft Weiss, Schwarz und alles Graue weg - die
 * Entscheidung, an der sich naive Umsetzungen die Zaehne ausbeissen.
 */
export function istBrauchbareMarkenfarbe(hex: string): boolean {
  if (!HEX6.test(hex)) return false;
  const [, s, l] = rgbToHsl(...hexToRgb(hex));
  if (l > 0.93) return false; // faktisch Weiss
  if (l < 0.04) return false; // faktisch Schwarz
  if (s < 0.18) return false; // Grau, inklusive der beliebten "fast-weissen" Flaechentoene
  // Sehr helle, sehr blasse Toene (typische Hintergrund-Pastelle) sind als Bildhintergrund wertlos.
  if (l > 0.85 && s < 0.45) return false;
  if (istFremdfarbe(hex)) return false;
  return true;
}

interface Kandidat {
  hex: string;
  score: number;
  from: string;
}

function normalisiere(roh: string): string | null {
  const s = roh.trim().toLowerCase();
  const kurz = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (kurz) return `#${kurz[1]}${kurz[1]}${kurz[2]}${kurz[2]}${kurz[3]}${kurz[3]}`;
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7); // #rrggbbaa -> Alpha ignorieren
  if (HEX6.test(s)) return s;
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s);
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    if ([r, g, b].every((v) => v >= 0 && v <= 255)) return rgbToHex(r, g, b);
  }
  return null;
}

/** Alle Farbangaben eines CSS-Textes, mit hoeherem Gewicht fuer benannte Variablen. */
function farbenAusCss(css: string, quelle: string, basisGewicht: number): Kandidat[] {
  const treffer = new Map<string, { score: number; from: string }>();
  const add = (roh: string, gewicht: number, from: string) => {
    const hex = normalisiere(roh);
    if (!hex) return;
    const vorher = treffer.get(hex);
    // Wurzel statt Summe: 200x dieselbe Farbe ist nicht 200x so wichtig wie 1x, aber mehr als 1x.
    const neu = (vorher?.score ?? 0) + gewicht;
    treffer.set(hex, { score: neu, from: vorher?.from ?? from });
  };

  // 1. Custom Properties, die nach Marke klingen - das staerkste Signal, das ein Stylesheet hergibt.
  for (const m of css.matchAll(/--([a-z0-9-]*(?:brand|primary|accent|main|theme|corporate|cta|highlight)[a-z0-9-]*)\s*:\s*([^;}]+)/gi)) {
    add(m[2], basisGewicht * 6, `${quelle}: --${m[1]}`);
  }
  // 2. Alle uebrigen Custom Properties.
  for (const m of css.matchAll(/--[a-z0-9-]+\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)) {
    add(m[1], basisGewicht * 2, `${quelle}: CSS-Variable`);
  }
  // 3. Flaechenfarben (background/fill) zaehlen mehr als Rahmen- oder Textfarben.
  for (const m of css.matchAll(/(?:background(?:-color)?|fill)\s*:\s*([^;}!]+)/gi)) {
    for (const farbe of m[1].matchAll(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi)) add(farbe[0], basisGewicht * 1.5, `${quelle}: Flaeche`);
  }
  // 4. Alles Uebrige, schwach gewichtet.
  for (const m of css.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi)) {
    add(m[0], basisGewicht * 0.4, `${quelle}`);
  }
  return [...treffer].map(([hex, v]) => ({ hex, score: Math.sqrt(v.score), from: v.from }));
}

/** Die am haeufigsten vorkommende brauchbare Farbe eines Bildes (Logo, Favicon). */
async function farbeAusBild(bytes: Buffer): Promise<{ hex: string; anteil: number } | null> {
  try {
    const { data, info } = await sharp(bytes, { density: 96 })
      .resize(48, 48, { fit: "inside", withoutEnlargement: false })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const zaehler = new Map<string, number>();
    let sichtbar = 0;
    for (let i = 0; i + 3 < data.length; i += info.channels) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 128) continue; // durchsichtige Bereiche zaehlen nicht
      sichtbar++;
      // Auf 5 Bit je Kanal quantisieren, damit Antialiasing-Saeume nicht als eigene Farben zaehlen.
      const hex = rgbToHex(r & 0xf8, g & 0xf8, b & 0xf8);
      if (!istBrauchbareMarkenfarbe(hex)) continue;
      zaehler.set(hex, (zaehler.get(hex) ?? 0) + 1);
    }
    if (!sichtbar || !zaehler.size) return null;
    const [hex, n] = [...zaehler].sort((a, b) => b[1] - a[1])[0];
    return { hex, anteil: n / sichtbar };
  } catch {
    return null; // kein lesbares Bildformat (z. B. .ico) - kein Fehler, nur keine Farbe
  }
}

function absolut(href: string, basis: string): string | null {
  try {
    const u = new URL(href, basis);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/* ---------------------------------- Hauptfunktion ----------------------------------- */

const MAX_STYLESHEETS = 3;

/**
 * Liest die Website und leitet Akzentfarbe + Verlaufspartner ab. Gibt `null` zurueck, wenn nichts
 * Brauchbares gefunden wurde - der Aufrufer nimmt dann still das Standardthema (Auftrag: "kein
 * Fehler, keine Meldung, kein leeres Feld"). Wirft nie.
 */
export async function extractBrandColors(rawUrl: string, timeoutMs = 8000): Promise<BrandColorResult | null> {
  const url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  let html: string;
  try {
    html = await fetchTextSafely(url, timeoutMs);
  } catch {
    return null;
  }
  return extractBrandColorsFromHtml(html, url, timeoutMs);
}

/** Der reine Auswerte-Teil - ohne den ersten Abruf, damit Aufrufer ein bereits geladenes HTML
 *  weiterverwenden koennen (die Website-Analyse laedt dieselbe Seite ohnehin) und damit er sich
 *  in Tests mit festem HTML pruefen laesst. */
export async function extractBrandColorsFromHtml(html: string, basisUrl: string, timeoutMs = 8000): Promise<BrandColorResult | null> {
  const kandidaten: Kandidat[] = [];
  const quelleVon = new Map<string, BrandColorResult["source"]>();

  const merke = (k: Kandidat, quelle: BrandColorResult["source"]) => {
    kandidaten.push(k);
    if (!quelleVon.has(k.hex)) quelleVon.set(k.hex, quelle);
  };

  // 1. <meta name="theme-color"> - die einzige Stelle, an der eine Website ihre Farbe ausdruecklich benennt.
  for (const m of html.matchAll(/<meta[^>]+name=["']theme-color["'][^>]*>/gi)) {
    const inhalt = /content=["']([^"']+)["']/i.exec(m[0]);
    const hex = inhalt ? normalisiere(inhalt[1]) : null;
    if (hex) merke({ hex, score: 10, from: "meta theme-color" }, "theme-color");
  }
  // Auch das seltenere <meta name="msapplication-TileColor">.
  for (const m of html.matchAll(/<meta[^>]+name=["']msapplication-TileColor["'][^>]*>/gi)) {
    const inhalt = /content=["']([^"']+)["']/i.exec(m[0]);
    const hex = inhalt ? normalisiere(inhalt[1]) : null;
    if (hex) merke({ hex, score: 7, from: "meta TileColor" }, "theme-color");
  }

  // 2. Inline-<style>-Bloecke.
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const k of farbenAusCss(m[1], "Inline-CSS", 1)) merke(k, k.from.includes("--") ? "css-variable" : "css");
  }
  // Inline-style-Attribute (viele Baukasten-Seiten setzen ihre Farben nur dort).
  for (const m of html.matchAll(/\sstyle=["']([^"']{4,400})["']/gi)) {
    for (const k of farbenAusCss(m[1], "style-Attribut", 0.6)) merke(k, "css");
  }

  // 3. Externe Stylesheets (hoechstens drei, gleiche Herkunft bevorzugt).
  const sheetUrls: string[] = [];
  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    const tag = m[0];
    if (!/rel=["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag);
    const abs = href ? absolut(href[1], basisUrl) : null;
    if (abs && !sheetUrls.includes(abs)) sheetUrls.push(abs);
  }
  const eigeneHerkunft = (u: string) => {
    try {
      return new URL(u).host === new URL(basisUrl).host;
    } catch {
      return false;
    }
  };
  const ausgewaehlt = [...sheetUrls.filter(eigeneHerkunft), ...sheetUrls.filter((u) => !eigeneHerkunft(u))].slice(0, MAX_STYLESHEETS);
  const sheets = await Promise.all(
    ausgewaehlt.map(async (u) => {
      try {
        return await fetchTextSafely(u, timeoutMs);
      } catch {
        return "";
      }
    }),
  );
  sheets.forEach((css, i) => {
    if (!css) return;
    // Das erste Stylesheet ist meistens das Haupt-Theme; spaetere zaehlen weniger.
    for (const k of farbenAusCss(css, `Stylesheet ${i + 1}`, i === 0 ? 1.2 : 0.7)) {
      merke(k, k.from.includes("--") ? "css-variable" : "css");
    }
  });

  // 4. Logo/Favicon - oft die einzige Stelle, an der die Marke wirklich farbig ist.
  const iconKandidaten: string[] = [];
  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    const tag = m[0];
    if (!/rel=["']?[^"'>]*(apple-touch-icon|icon)/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag);
    const abs = href ? absolut(href[1], basisUrl) : null;
    if (!abs || /\.ico(\?|$)/i.test(abs)) continue; // .ico kann sharp nicht lesen
    iconKandidaten.push(abs);
  }
  const og = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html);
  if (og) {
    const abs = absolut(og[1], basisUrl);
    if (abs) iconKandidaten.push(abs);
  }
  for (const iconUrl of iconKandidaten.slice(0, 2)) {
    try {
      const { bytes } = await fetchBinarySafely(iconUrl, timeoutMs, 1_500_000);
      const farbe = await farbeAusBild(bytes);
      // Ein Logo, dessen Hauptfarbe nur wenige Prozent der Flaeche ausmacht, ist kein Signal.
      if (farbe && farbe.anteil > 0.04) merke({ hex: farbe.hex, score: 4 + farbe.anteil * 6, from: "Logo/Favicon" }, "logo");
    } catch {
      /* Icon nicht abrufbar - kein Problem */
    }
  }

  // 5. Zusammenfassen, filtern, bewerten.
  const zusammen = new Map<string, Kandidat>();
  for (const k of kandidaten) {
    if (!istBrauchbareMarkenfarbe(k.hex)) continue;
    const [, s] = rgbToHsl(...hexToRgb(k.hex));
    // Saettigung als Multiplikator: zwischen zwei gleich haeufigen Farben gewinnt die kraeftigere.
    const punkte = k.score * (0.6 + s);
    const vorher = zusammen.get(k.hex);
    if (!vorher || punkte > vorher.score) zusammen.set(k.hex, { hex: k.hex, score: punkte, from: k.from });
    else vorher.score += punkte * 0.25;
  }
  // Sehr aehnliche Toene verschmelzen (ein Theme hat oft #c8102e, #c9112f, #c70f2d).
  const sortiert = [...zusammen.values()].sort((a, b) => b.score - a.score);
  const gruppen: Kandidat[] = [];
  for (const k of sortiert) {
    const nah = gruppen.find((g) => abstand(g.hex, k.hex) < 30);
    if (nah) nah.score += k.score * 0.5;
    else gruppen.push({ ...k });
  }
  gruppen.sort((a, b) => b.score - a.score);
  if (!gruppen.length) return null;

  const beste = gruppen[0];
  const source = quelleVon.get(beste.hex) ?? "css";
  const accentColor = ensureReadableWithWhite(beste.hex);

  // Verlaufspartner: die naechstbeste Farbe mit deutlich anderem Farbton, sonst aus der
  // Hauptfarbe abgeleitet (gleicher Farbton, dunkler) - passt zum bestehenden Verlaufssystem.
  const [h1] = rgbToHsl(...hexToRgb(accentColor));
  // Nur eine Farbe nehmen, die selbst tragend ist: ein einzelner Fund aus einem style-Attribut
  // (Apple: ein olivgruener Kachelhintergrund) wuerde sonst neben dem Markenblau landen. Unter
  // 40 % der Punktzahl der Hauptfarbe wird stattdessen aus ihr selbst abgeleitet.
  const zweite = gruppen.slice(1).find((g) => {
    if (g.score < beste.score * 0.4) return false;
    const [h2] = rgbToHsl(...hexToRgb(g.hex));
    const d = Math.abs(h1 - h2);
    return Math.min(d, 360 - d) > 25;
  });
  const [, s1, l1] = rgbToHsl(...hexToRgb(accentColor));
  const gradientColor2 = zweite
    ? ensureReadableWithWhite(zweite.hex)
    : hslToHex(h1 + 12, clamp(s1 * 0.9, 0.15, 1), clamp(l1 * 0.55, 0.05, 0.4));

  return {
    accentColor,
    gradientColor2,
    gradientDirection: "diagonal",
    source,
    adjustedForContrast: accentColor.toLowerCase() !== beste.hex.toLowerCase(),
    originalColor: beste.hex,
    candidates: gruppen.slice(0, 6).map((g) => ({ hex: g.hex, score: Math.round(g.score * 100) / 100, from: g.from })),
  };
}

/* ------------------------- Abwechslung innerhalb der Markenfarbe -------------------------
 * Auftrag vom 19.09.2026: eine Woche in zehnmal exakt demselben Braun wirkt wie ein
 * Druckfehler, nicht wie eine Handschrift. Echte Marken variieren innerhalb ihrer Palette.
 *
 * Aus der EINEN erkannten Markenfarbe werden vier Abstufungen abgeleitet - unterschiedlich in
 * Helligkeit und Saettigung, gleicher Farbton - dazu wechselnde Verlaufsrichtungen. Die Marke
 * bleibt in jedem Bild erkennbar, aber keine zwei Tage sehen gleich aus. Kostet nichts, weil
 * die Verlaeufe ohnehin lokal gerendert werden (siehe gradient.ts).
 *
 * Die Variante wird NICHT gewuerfelt, sondern aus Datum und Kanal abgeleitet. Damit bekommt
 * derselbe Beitrag beim Neurendern (Farbwechsel im Plan, backfillMissingImages) wieder genau
 * seine Farbe, ohne dass irgendwo ein Index gespeichert werden muesste.
 */
export type VerlaufsRichtung = "diagonal" | "horizontal" | "vertical";

/** Helligkeit/Saettigung je Stufe, relativ zur erkannten Markenfarbe. */
const STUFEN: { dl: number; ds: number; richtung: VerlaufsRichtung }[] = [
  { dl: 0.0, ds: 0.0, richtung: "diagonal" },
  { dl: -0.07, ds: 0.06, richtung: "vertical" },
  { dl: 0.06, ds: -0.05, richtung: "diagonal" },
  { dl: -0.13, ds: -0.03, richtung: "horizontal" },
];

function verschieben(hex: string, dl: number, ds: number): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return hslToHex(h, Math.min(0.95, Math.max(0.12, s + ds)), Math.min(0.72, Math.max(0.12, l + dl)));
}

/** Stabile kleine Zahl aus einem Text - kein Zufall, damit dasselbe Bild dieselbe Farbe behaelt. */
function streuwert(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export interface Wochenfarbe {
  accentColor: string;
  color2: string;
  direction: VerlaufsRichtung;
  stufe: number;
}

/**
 * Die Farbstufe fuer einen bestimmten Beitrag. `schluessel` ist alles, was den Beitrag
 * eindeutig macht und sich nicht mehr aendert - in der Praxis Datum + Kanal.
 */
export function wochenfarbe(accentColor: string, color2: string, schluessel: string): Wochenfarbe {
  const stufe = streuwert(schluessel) % STUFEN.length;
  const { dl, ds, richtung } = STUFEN[stufe];
  // Der Kontrast zu weisser Schrift muss in JEDER Stufe halten - eine aufgehellte Variante
  // koennte sonst unter 4,5:1 rutschen und die Headline unlesbar machen.
  const accent = ensureReadableWithWhite(verschieben(accentColor, dl, ds));
  const partner = ensureReadableWithWhite(verschieben(color2, dl, ds));
  return { accentColor: accent, color2: partner, direction: richtung, stufe };
}
