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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Splits a short headline into 1-2 lines for the left-of-center layout (see styleguide.md). */
function wrapHeadline(headline: string): string[] {
  const words = headline.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return [words.join(" ")];
  }
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
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
): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  const lines = wrapHeadline(headline);
  const longestLine = Math.max(...lines.map((line) => line.length));

  const zone = getHeadlineSafeZone(format);
  const safeZoneLeft = width * zone.left;
  const safeZoneRight = width * zone.right;
  const maxTextWidth = safeZoneRight - safeZoneLeft;
  const safeTop = height * zone.top;
  const safeBottom = height * zone.bottom;
  const maxTextHeight = safeBottom - safeTop;

  const avgGlyphWidthFactor = 0.56; // approximate average glyph width for this serif at 1x font-size
  let fontSize = Math.floor(maxTextWidth / (longestLine * avgGlyphWidthFactor));
  fontSize = Math.max(Math.round(height * 0.06), Math.min(fontSize, Math.round(height * 0.12)));

  const lineHeight = fontSize * 1.15;
  let totalTextHeight = lineHeight * lines.length;
  // Belt-and-suspenders for the story format's tighter vertical band (60% of height,
  // vs. the feed's unconstrained full height): shrink further if the text block would
  // still overflow the safe zone (e.g. very long single-line headline).
  if (totalTextHeight > maxTextHeight) {
    const scale = maxTextHeight / totalTextHeight;
    fontSize = Math.max(Math.round(height * 0.04), Math.floor(fontSize * scale));
    totalTextHeight = fontSize * 1.15 * lines.length;
  }
  const scaledLineHeight = fontSize * 1.15;

  const startX = Math.round(safeZoneLeft);
  const verticalCenter = (safeTop + safeBottom) / 2;
  const firstBaselineY = verticalCenter - totalTextHeight / 2 + fontSize * 0.8;

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${startX}" y="${Math.round(firstBaselineY + i * scaledLineHeight)}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text font-family="Liberation Serif, serif" font-size="${fontSize}" font-weight="normal" font-style="normal" fill="#ffffff">${tspans}</text>
  </svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
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
export async function addPipelineWatermark(imageBuffer: Buffer, format: PostFormat = "feed"): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  const fontSize = Math.round(height * 0.11);
  const marginRight = Math.round(width * (format === "story" ? 0.1 : 0.07));
  const cx = width - marginRight;
  const cy = height / 2;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text
      x="${cx}"
      y="${cy}"
      font-family="Liberation Serif, serif"
      font-size="${fontSize}"
      fill="#ffffff"
      fill-opacity="0.18"
      text-anchor="middle"
      dominant-baseline="middle"
      letter-spacing="${Math.round(fontSize * 0.06)}"
      transform="rotate(-90 ${cx} ${cy})"
    >Pipeline</text>
  </svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
