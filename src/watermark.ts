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
  return { left: 0.18, right: 0.82, top: 0, bottom: 1 };
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
export function wrapHeadline(headline: string, fontSize: number, maxWidth: number, glyphWidthFactor: number): string[] {
  const words = headline.trim().split(/\s+/).filter(Boolean);
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

  const MAX_FONT_SIZE = Math.round(height * 0.12);
  const MIN_FONT_SIZE = Math.round(height * 0.035);
  const MAX_LINES = 4; // beyond this, keep shrinking the font instead of adding still more lines

  // Panel v7 fix (Teil 6): the original code guessed a font size from ONE assumed "longest
  // line" BEFORE wrapping, wrapped headlines longer than 2 words into a blind 50/50 word-count
  // split, and only ever re-checked the TOTAL block HEIGHT afterwards - never each line's actual
  // WIDTH. A longer, unevenly-split headline (content pillars now produce these more often than
  // the original short 2-4-word case, e.g. "Rückenschmerzen? Beweglichkeit zurückgewinnen") could
  // therefore still render past the right edge with no fallback catching it - screenshot-
  // confirmed by a customer (Andrea Hölzl). Fixed by iterating: wrap at the current font size,
  // check the actual widest resulting line (not a pre-wrap guess) AND the total block height,
  // shrink and re-wrap if either is still too big, down to a sane minimum font size.
  const glyphWidthFactor = font.glyphWidthFactor ?? DEFAULT_GLYPH_WIDTH_FACTOR;
  let fontSize = MAX_FONT_SIZE;
  let lines = wrapHeadline(headline, fontSize, maxTextWidth, glyphWidthFactor);
  for (;;) {
    const lineHeight = fontSize * 1.15;
    const totalTextHeight = lineHeight * lines.length;
    const widestLine = Math.max(...lines.map((line) => estimateTextWidth(line, fontSize, glyphWidthFactor)));
    const fits = widestLine <= maxTextWidth && totalTextHeight <= maxTextHeight && lines.length <= MAX_LINES;
    if (fits || fontSize <= MIN_FONT_SIZE) break;
    fontSize = Math.max(MIN_FONT_SIZE, fontSize - Math.max(1, Math.round(fontSize * 0.08)));
    lines = wrapHeadline(headline, fontSize, maxTextWidth, glyphWidthFactor);
  }

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
  font: { family: string; weight: number } = { family: "Liberation Serif, serif", weight: 400 },
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

  const fontSize = Math.round(height * 0.11);
  const marginRight = Math.round(width * (format === "story" ? 0.1 : 0.07));
  const cx = width - marginRight;
  const cy = height / 2;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text
      x="${cx}"
      y="${cy}"
      font-family="${escapeXml(font.family)}"
      font-weight="${font.weight}"
      font-size="${fontSize}"
      fill="#ffffff"
      fill-opacity="0.18"
      text-anchor="middle"
      dominant-baseline="middle"
      letter-spacing="${Math.round(fontSize * 0.06)}"
      transform="rotate(-90 ${cx} ${cy})"
    >${escapeXml(watermarkText)}</text>
  </svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
