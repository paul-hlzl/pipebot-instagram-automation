import sharp from "sharp";

export type PostFormat = "feed" | "story";

interface SafeZone {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Headline safe zone as a fraction of image width/height, per format.
 * - feed: horizontal-only margin against Instagram's square-grid-view crop (see
 *   GRID-SICHERHEITSZONE in styleguide.md) - the full vertical range is safe since
 *   square feed posts are never cropped top/bottom.
 * - story: Stories overlay UI chrome at both the top (profile photo/username/progress
 *   bar) and bottom (reply field / CTA bar) of a 1080x1920 canvas - roughly the top and
 *   bottom ~20% per Meta's Stories safe-zone guidance. No grid-crop risk horizontally
 *   (Stories are never tiled into the profile grid), so a smaller side margin than the
 *   feed's grid-crop zone is fine.
 */
function getHeadlineSafeZone(format: PostFormat): SafeZone {
  if (format === "story") {
    return { left: 0.1, right: 0.9, top: 0.2, bottom: 0.8 };
  }
  // Unten bleiben 14 % frei: dort steht seit 19.09.2026 der Firmenname (siehe
  // addPipelineWatermark). Vorher lief die Headline ueber die volle Hoehe und haette ihn bei
  // sehr langen Texten ueberschrieben.
  return { left: 0.18, right: 0.82, top: 0, bottom: 0.86 };
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Panel v7 fix (Teil 6): approximate average glyph width at 1x font-size - used both to decide
// where to wrap and, as a last-resort safety net, as the `textLength` clamp on each rendered
// line (see addHeadlineText). Panel v15: now per-font (fonts.ts glyphWidthFactor) instead of one
// constant calibrated only for Liberation Serif - a condensed font like Bebas Neue or a script
// font like Caveat has a very different average glyph width, and the estimate feeds directly
// into how many lines a headline wraps onto.
export const DEFAULT_GLYPH_WIDTH_FACTOR = 0.56;

export function estimateTextWidth(text: string, fontSize: number, glyphWidthFactor: number = DEFAULT_GLYPH_WIDTH_FACTOR): number {
  return text.length * fontSize * glyphWidthFactor;
}

/**
 * Zerlegt ein einzelnes Wort, das breiter als die ganze Zeile ist, in Stuecke mit Bindestrich -
 * "KI-Content-Partner" wird zu "KI-Content-" + "Partner".
 *
 * Genau solche Woerter waren die eigentliche Ursache der uneinheitlichen Schriftgroessen: ein
 * unteilbares Wort zwang die alte Schleife zum Verkleinern, bis es passte, und die Groesse des
 * ganzen Bildes hing damit am laengsten Wort der Ueberschrift (gemessen: 63px bei
 * "KI-Content-Partner" gegen 113px bei "Konsistenz schlaegt Zufall - jeden Tag."). Wird zuerst an
 * vorhandenen Bindestrichen getrennt (liest sich natuerlich), erst danach hart.
 */
function splitOverlongWord(word: string, fontSize: number, maxWidth: number, glyphWidthFactor: number): string[] {
  if (estimateTextWidth(word, fontSize, glyphWidthFactor) <= maxWidth) return [word];
  const maxChars = Math.max(2, Math.floor(maxWidth / (fontSize * glyphWidthFactor)));

  // Erst an eigenen Bindestrichen: die Trennstelle steht dann dort, wo sie ohnehin hingehoert.
  if (word.includes("-")) {
    const teile: string[] = [];
    let aktuell = "";
    for (const stueck of word.split("-").filter(Boolean)) {
      const kandidat = aktuell ? `${aktuell}-${stueck}` : stueck;
      if (aktuell && kandidat.length > maxChars) {
        teile.push(`${aktuell}-`);
        aktuell = stueck;
      } else {
        aktuell = kandidat;
      }
    }
    if (aktuell) teile.push(aktuell);
    if (teile.every((t) => t.length <= maxChars)) return teile;
  }

  // Sonst hart trennen, mit Bindestrich als Umbruchzeichen.
  const teile: string[] = [];
  let rest = word;
  while (rest.length > maxChars) {
    teile.push(`${rest.slice(0, maxChars - 1)}-`);
    rest = rest.slice(maxChars - 1);
  }
  if (rest) teile.push(rest);
  return teile;
}

/**
 * Greedily wraps a headline into as many lines as actually needed at the given font size, based
 * on estimated rendered width (not a blind word-count split) - a headline with more/longer words
 * than the original short "2-4 words" case (increasingly common with content-pillar-driven
 * headlines, e.g. "Rückenschmerzen? Beweglichkeit zurückgewinnen") now wraps onto as many lines
 * as its actual length requires instead of forcing an uneven 2-line split that could still run a
 * single long line past the image edge (the original bug, screenshot-confirmed by a customer).
 * A single word longer than maxWidth on its own is kept on its own line regardless (nothing left
 * to break it on) - the render-time `textLength` safety net in addHeadlineText still keeps it
 * from actually overflowing the image.
 */
export function wrapHeadline(
  headline: string,
  fontSize: number,
  maxWidth: number,
  glyphWidthFactor: number,
  /** Trennt ein Wort, das allein schon breiter als die Zeile ist, mit Bindestrich statt es
   *  ueberstehen zu lassen. Standard aus, damit die Video-Textkarten (video.ts) ihr bisheriges
   *  Verhalten behalten; addHeadlineText schaltet es ein - siehe headlineLayout. */
  breakLongWords = false,
): string[] {
  const words = breakLongWords
    ? headline.trim().split(/\s+/).filter(Boolean).flatMap((w) => splitOverlongWord(w, fontSize, maxWidth, glyphWidthFactor))
    : headline.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && estimateTextWidth(candidate, fontSize, glyphWidthFactor) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/* ================= Einheitliche Headline-Groesse (15.09.2026) =================
 *
 * Vorher startete die Komposition bei der GROESSTMOEGLICHEN Schrift und verkleinerte, bis der
 * Text passte. Damit hing die Schriftgroesse an der Ueberschrift - genauer: an ihrem laengsten
 * unteilbaren Wort, denn ein Wort, das allein zu breit ist, zwingt die Schleife immer weiter
 * herunter. Gemessen an echten Beitraegen desselben Kunden und Formats (1024x1024):
 *
 *   "Jetzt starten"                            123px
 *   "Konsistenz schlaegt Zufall - jeden Tag."  113px
 *   "#Pipeflow: Dein KI-Content-Partner"        63px   <- laengstes Wort 18 Zeichen
 *
 * Fast Faktor zwei im selben Format, und ausgerechnet die kuerzeste Ueberschrift wurde am
 * kleinsten gesetzt. Jetzt umgekehrt: eine feste Zielgroesse je Format, Umbruch (notfalls mitten
 * im Wort) statt Verkleinern, und Verkleinern nur noch als eng begrenzter Notfall.
 */

/** Zielgroesse, ausgedrueckt als "so viele Zeichen passen in eine Zeile". Nicht als fester
 *  Pixelwert, denn die Textspalte ist je Format unterschiedlich breit (Feed 655px, Story 614px)
 *  und eine schmale Schrift passt bei gleicher Pixelgroesse deutlich mehr Zeichen unter. Ueber
 *  diese Zahl ergibt sich fuer JEDE Kombination aus Format und Schriftart dieselbe optische
 *  Wirkung: eine volle Zeile fuellt die Textspalte. 13 ergibt Feed ~90px und Story ~84px - eine
 *  uebliche Ueberschrift (Median 35 Zeichen, laengste gemessene 48) braucht damit hoechstens
 *  fuenf Zeilen und bleibt in jedem Fall innerhalb der Sicherheitszone. */
export const HEADLINE_TARGET_CHARS_PER_LINE = 13;

/** Untergrenze der Notfall-Verkleinerung, relativ zur Zielgroesse. 0.85 heisst: im schlimmsten
 *  Fall 15% kleiner, nicht mehr - vorher konnte die Schrift auf ein Drittel der Ausgangsgroesse
 *  fallen. Diese Spanne faengt Ueberschriften bis rund 60 Zeichen ab; alles darueber gilt als zu
 *  lang und wird beim Erzeugen abgefangen (assertHeadlineRenderable in planning.ts), statt es
 *  durch immer kleinere Schrift zu kaschieren. Von den 95 Ueberschriften in der Produktion
 *  braucht keine einzige diesen Notfall. */
export const HEADLINE_MIN_FONT_RATIO = 0.85;

/** Ab hier wird (im Rahmen der Untergrenze) verkleinert statt weiter umbrochen.
 *
 *  5 statt 4, empirisch gewaehlt: gegen alle 95 echten Ueberschriften aus der Produktion
 *  gerechnet, setzt jede einzelne davon bei 5 Zeilen in der Zielgroesse - bei 4 Zeilen waeren 13
 *  kleiner gesetzt und 6 als zu lang zurueckgewiesen worden, obwohl mit ihnen inhaltlich nichts
 *  falsch ist. Der Notfallpfad bleibt damit das, was er sein soll: ein Pfad fuer Ausreisser, der
 *  im Alltag nie betreten wird. Fuenf Zeilen bei 90px fuellen rund die halbe Bildhoehe - genau
 *  so viel wie die bisher groesste gesetzte Ueberschrift auch. */
export const HEADLINE_MAX_LINES = 5;

/** Nennmasse je Format - dieselben Werte, die fal.ts anfordert. Nur fuer die Vorabpruefung
 *  gedacht, ob eine Ueberschrift ueberhaupt setzbar ist; addHeadlineText selbst liest die
 *  tatsaechlichen Masse aus dem erzeugten Bild. */
export const HEADLINE_NOMINAL_SIZE: Record<PostFormat, { width: number; height: number }> = {
  feed: { width: 1024, height: 1024 },
  story: { width: 768, height: 1344 },
};

export interface HeadlineLayout {
  fontSize: number;
  lines: string[];
  /** Zielgroesse je Format - das, was alle Beitraege gemeinsam haben sollen. */
  targetFontSize: number;
  /** false = der Notfall hat gegriffen und diese Ueberschrift wird kleiner gesetzt als die anderen. */
  atTargetSize: boolean;
  /** true = passt selbst an der Untergrenze nicht in vier Zeilen; die Ueberschrift ist schlicht
   *  zu lang und gehoert neu geschrieben, nicht kleiner gesetzt. */
  tooLong: boolean;
}

/**
 * Entscheidet Schriftgroesse und Umbruch - rein rechnerisch, ohne sharp, damit dieselbe
 * Entscheidung auch vor dem (bezahlten) Bilderzeugen geprueft werden kann.
 */
export function headlineLayout(
  headline: string,
  opts: { width: number; height: number; format: PostFormat; font?: { glyphWidthFactor?: number } },
): HeadlineLayout {
  const zone = getHeadlineSafeZone(opts.format);
  const maxTextWidth = opts.width * (zone.right - zone.left);
  const maxTextHeight = opts.height * (zone.bottom - zone.top);
  const glyphWidthFactor = opts.font?.glyphWidthFactor ?? DEFAULT_GLYPH_WIDTH_FACTOR;

  const targetFontSize = Math.round(maxTextWidth / (HEADLINE_TARGET_CHARS_PER_LINE * glyphWidthFactor));
  const minFontSize = Math.max(1, Math.round(targetFontSize * HEADLINE_MIN_FONT_RATIO));

  const passt = (fontSize: number, lines: string[]): boolean =>
    lines.length <= HEADLINE_MAX_LINES && fontSize * 1.15 * lines.length <= maxTextHeight;

  // Die Breite muss hier nicht mehr geprueft werden: wrapHeadline trennt mit breakLongWords=true
  // auch ein einzelnes zu breites Wort, es kann also keine zu breite Zeile mehr entstehen.
  let fontSize = targetFontSize;
  let lines = wrapHeadline(headline, fontSize, maxTextWidth, glyphWidthFactor, true);
  while (!passt(fontSize, lines) && fontSize > minFontSize) {
    fontSize = Math.max(minFontSize, fontSize - Math.max(1, Math.round(fontSize * 0.04)));
    lines = wrapHeadline(headline, fontSize, maxTextWidth, glyphWidthFactor, true);
  }

  return {
    fontSize,
    lines,
    targetFontSize,
    atTargetSize: fontSize === targetFontSize,
    tooLong: !passt(fontSize, lines),
  };
}

/** Passt diese Ueberschrift in diesem Format ohne Notfall-Verkleinerung? Fuer die Pruefung beim
 *  Erzeugen, bevor ein Bild bezahlt wird. */
export function headlineLayoutForFormat(
  headline: string,
  format: PostFormat,
  font?: { glyphWidthFactor?: number },
): HeadlineLayout {
  return headlineLayout(headline, { ...HEADLINE_NOMINAL_SIZE[format], format, font });
}

/**
 * Composites the headline text onto the (text-free) generated background, in code rather
 * than via the fal.ai prompt — text-to-image models render short headlines correctly only
 * some of the time (garbled letters, dropped/added words, inconsistent font weight, stray
 * punctuation, or hallucinated unrelated text). Rendering the headline deterministically here
 * guarantees exact, correctly-styled text every time; see styleguide.md's "BILDGENERIERUNG"
 * section for the specification this implements (font, size, color, position).
 *
 * `format` selects the safe zone: "feed" (default, square post, grid-crop-safe horizontal
 * margin) or "story" (9:16, vertical margin clear of the Stories UI chrome instead).
 */
export async function addHeadlineText(
  imageBuffer: Buffer,
  headline: string,
  format: PostFormat = "feed",
  /** Panel v15: fontconfig-Familienname + Gewicht + Breiten-Schaetzfaktor (siehe fonts.ts) -
   *  Standard bleibt die bisherige "Liberation Serif, serif"/normal-Kombination fuer Aufrufer,
   *  die noch keine Kundenwahl mitgeben (unveraendertes Verhalten). */
  font: { family: string; weight: number; glyphWidthFactor?: number } = { family: "Liberation Serif, serif", weight: 400 },
): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  const zone = getHeadlineSafeZone(format);
  const safeZoneLeft = width * zone.left;
  const safeZoneRight = width * zone.right;
  const maxTextWidth = safeZoneRight - safeZoneLeft;
  const safeTop = height * zone.top;
  const safeBottom = height * zone.bottom;
  const maxTextHeight = safeBottom - safeTop;

  const glyphWidthFactor = font.glyphWidthFactor ?? DEFAULT_GLYPH_WIDTH_FACTOR;
  const { fontSize, lines } = headlineLayout(headline, { width, height, format, font });

  const lineHeight = fontSize * 1.15;
  const totalTextHeight = lineHeight * lines.length;
  const startX = Math.round(safeZoneLeft);
  const verticalCenter = (safeTop + safeBottom) / 2;
  const firstBaselineY = verticalCenter - totalTextHeight / 2 + fontSize * 0.8;

  const tspans = lines
    .map((line, i) => {
      // Hard safety net, last resort: even if the estimate above is still off for this exact
      // text/font (real glyph widths vary per character, this is only an average), `textLength`
      // + `lengthAdjust="spacingAndGlyphs"` tells the SVG renderer to compress or stretch the
      // glyphs so the line is rendered at EXACTLY this width - never wider than the safe zone,
      // no matter what the estimate got wrong. Clamped to maxTextWidth even in the (should be
      // unreachable after the loop above, except at the MIN_FONT_SIZE floor) worst case.
      const clampedWidth = Math.min(estimateTextWidth(line, fontSize, glyphWidthFactor), maxTextWidth);
      return `<tspan x="${startX}" y="${Math.round(firstBaselineY + i * lineHeight)}" textLength="${Math.round(clampedWidth)}" lengthAdjust="spacingAndGlyphs">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text font-family="${escapeXml(font.family)}" font-size="${fontSize}" font-weight="${font.weight}" font-style="normal" fill="#ffffff">${tspans}</text>
  </svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/**
 * Composites a customer's own uploaded logo, small, in the bottom-right corner - used
 * INSTEAD of the text watermark when a customer has one (see addPipelineWatermark). Kept
 * deliberately small and corner-only per the panel's own copy ("kein Vollbild-Logo").
 */
async function compositeLogoWatermark(imageBuffer: Buffer, logoPath: string, width: number, height: number): Promise<Buffer> {
  const maxLogoSize = Math.round(Math.min(width, height) * 0.16);
  const margin = Math.round(Math.min(width, height) * 0.05);
  const logoBuffer = await sharp(logoPath)
    .resize(maxLogoSize, maxLogoSize, { fit: "inside", withoutEnlargement: true })
    .toBuffer();
  const logoMeta = await sharp(logoBuffer).metadata();
  const logoW = logoMeta.width ?? maxLogoSize;
  const logoH = logoMeta.height ?? maxLogoSize;

  return sharp(imageBuffer)
    .composite([{ input: logoBuffer, left: Math.max(0, width - margin - logoW), top: Math.max(0, height - margin - logoH) }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Composites a large, rotated, translucent "Pipeline" watermark along the right edge
 * of the image. Done in code rather than via the image-generation prompt because
 * text-to-image models render rotated text and precise opacity unreliably
 * (mirrored/garbled letterforms, hallucinated extra text nearby).
 *
 * Both `fontSize` and `cy` are computed as fractions of height/width, so the watermark
 * stays proportionally centered and correctly sized on the 9:16 story canvas as well as
 * the square feed canvas without needing separate story-specific logic.
 */
export async function addPipelineWatermark(
  imageBuffer: Buffer,
  format: PostFormat = "feed",
  watermarkText: string = "Pipeline",
  logoPath?: string | null,
  /** Panel v15: dieselbe Kundenschrift wie die Headline (siehe fonts.ts) - Standard unveraendert
   *  "Liberation Serif, serif" fuer Aufrufer ohne Kundenwahl. */
  font: { family: string; weight: number; glyphWidthFactor?: number } = { family: "Liberation Serif, serif", weight: 400 },
): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  if (logoPath) {
    try {
      return await compositeLogoWatermark(imageBuffer, logoPath, width, height);
    } catch (err) {
      // Bad/missing/corrupt logo file must never break image generation - fall back to the
      // text watermark below exactly as if no logo were configured.
      console.error(`[watermark] Logo ${logoPath} konnte nicht eingefügt werden, falle auf Text-Wasserzeichen zurück:`, err);
    }
  }

  // Firmenname: lesbar, waagrecht, immer an derselben Stelle (Auftrag vom 19.09.2026).
  //
  // Vorher stand er als 11 % hohe, um 90 Grad gedrehte Schrift mit 18 % Deckkraft am rechten
  // Rand. Zwei Dinge gingen damit schief. Erstens war er Dekoration, keine Marke - bei 18 %
  // Deckkraft liest ihn niemand. Zweitens wird das 1:1-Bild in der Wochenvorschau in einem
  // 4:5-Rahmen gezeigt (start.css, .media.feed), also werden links und rechts je 10 % der
  // Breite abgeschnitten - genau die Zone, in der er stand. Vom Namen blieb ein senkrechter
  // Streifen uebrig.
  //
  // Jetzt: unten links, auf derselben Fluchtlinie wie die Headline, in der Kundenschrift, mit
  // genug Deckkraft zum Lesen. Die x-Spanne liegt zwischen 18 % und 82 % der Breite und
  // ueberlebt damit jeden mittigen 4:5-Beschnitt. `textLength` deckelt die Breite hart, damit
  // auch ein langer Firmenname nie in den beschnittenen Rand laeuft.
  const zone = getHeadlineSafeZone(format);
  const linkeKante = Math.round(width * zone.left);
  const maxBreite = Math.round(width * (zone.right - zone.left));
  // Schriftgrad: so gross wie moeglich, aber nie breiter als die sichere Zone. Lieber kleiner
  // setzen als die Glyphen stauchen - ein gequetschter Firmenname sieht falsch aus. Erst wenn
  // auch der kleinste Grad nicht reicht, deckelt `textLength` hart (Notnagel, siehe unten).
  const glyphFaktor = font.glyphWidthFactor ?? DEFAULT_GLYPH_WIDTH_FACTOR;
  const maxGrad = Math.round(height * 0.042);
  // Untergrenze: darunter ist der Name in der kleinen Wochenvorschau nicht mehr zu entziffern.
  // Ein sehr langer Firmenname wird ab hier von `textLength` leicht gestaucht statt weiter
  // verkleinert - lieber etwas schmaler als unlesbar. Namen bis rund 30 Zeichen bleiben
  // unberuehrt bei voller Groesse.
  const minGrad = Math.round(height * 0.032);
  let fontSize = maxGrad;
  while (fontSize > minGrad && estimateTextWidth(watermarkText, fontSize, glyphFaktor) > maxBreite) fontSize -= 1;
  // Reicht auch der kleinste Grad nicht, wird gekuerzt statt gestaucht. `textLength` waere der
  // naheliegende Weg, aber librsvg setzt es bei diesem Text nachweislich NICHT um (gemessen mit
  // scripts/test-firmenname.mjs: der Name lief trotz textLength bis x=995 statt 840). Auf eine
  // Zusicherung, die der Renderer ignoriert, darf hier nichts aufbauen - sonst steht der Name
  // wieder im abgeschnittenen Rand, also genau der Fehler, der behoben werden sollte.
  let anzeige = watermarkText;
  if (estimateTextWidth(anzeige, fontSize, glyphFaktor) > maxBreite) {
    while (anzeige.length > 4 && estimateTextWidth(`${anzeige}…`, fontSize, glyphFaktor) > maxBreite) {
      anzeige = anzeige.slice(0, -1);
    }
    anzeige = `${anzeige.trimEnd()}…`;
  }
  const grundlinie = Math.round(height * 0.935);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="nameSchatten" x="-20%" y="-40%" width="140%" height="220%">
        <feDropShadow dx="0" dy="${Math.round(fontSize * 0.05)}" stdDeviation="${Math.round(fontSize * 0.12)}" flood-color="#000000" flood-opacity="0.28"/>
      </filter>
    </defs>
    <text
      x="${linkeKante}"
      y="${grundlinie}"
      font-family="${escapeXml(font.family)}"
      font-weight="${font.weight}"
      font-size="${fontSize}"
      fill="#ffffff"
      fill-opacity="0.92"
      filter="url(#nameSchatten)"
    >${escapeXml(anzeige)}</text>
  </svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
