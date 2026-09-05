import sharp from "sharp";

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
 */
export async function addHeadlineText(imageBuffer: Buffer, headline: string): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  const lines = wrapHeadline(headline);
  const longestLine = Math.max(...lines.map((line) => line.length));

  // Fit the widest line within ~78% of the canvas width, scaling font size to length.
  const maxTextWidth = width * 0.78;
  const avgGlyphWidthFactor = 0.56; // approximate average glyph width for this serif at 1x font-size
  let fontSize = Math.floor(maxTextWidth / (longestLine * avgGlyphWidthFactor));
  fontSize = Math.max(Math.round(height * 0.06), Math.min(fontSize, Math.round(height * 0.12)));

  const lineHeight = fontSize * 1.15;
  const startX = Math.round(width * 0.1);
  const totalTextHeight = lineHeight * lines.length;
  const firstBaselineY = height / 2 - totalTextHeight / 2 + fontSize * 0.8;

  const tspans = lines
    .map((line, i) => `<tspan x="${startX}" y="${Math.round(firstBaselineY + i * lineHeight)}">${escapeXml(line)}</tspan>`)
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
 */
export async function addPipelineWatermark(imageBuffer: Buffer): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  const fontSize = Math.round(height * 0.11);
  const marginRight = Math.round(width * 0.07);
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
