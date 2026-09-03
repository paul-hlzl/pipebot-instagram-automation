import sharp from "sharp";

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
