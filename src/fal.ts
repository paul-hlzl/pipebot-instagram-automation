import axios from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";
import { withRetry } from "./retry.js";
import { addHeadlineText, addPipelineWatermark, type PostFormat } from "./watermark.js";
import { uploadImageBase64 } from "./r2.js";

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux/schnell";

/**
 * fal.ai `image_size` per format. "square_hd" for the feed (1:1) is 1024x1024.
 *
 * For stories, two options were tested and rejected before landing on 768x1344 (2026-09-05):
 * - preset "portrait_16_9" -> only 576x1024, below Instagram's recommended 720x1280 minimum
 *   and visibly softer than the feed image.
 * - custom {width:1088, height:1920} (as close to the "ideal" 1080x1920 as flux's
 *   multiple-of-32 constraint allows) -> produced a consistent horizontal seam/banding
 *   artifact near the bottom of the background in 3/3 test generations. Likely a tiled-
 *   diffusion seam from generating well outside flux schnell's typical trained resolution
 *   range, not a random fluke a retry would fix.
 * 768x1344 (also multiples of 32, ~1.03MP - close to square_hd's ~1.05MP) generated cleanly
 * in 2/2 tests and clears the 720x1280 floor, at the cost of a slightly less extreme aspect
 * ratio (0.571 vs. the "ideal" 0.5625) - not worth trading reliability for.
 * addHeadlineText/addPipelineWatermark read the actual width/height back from the generated
 * image (sharp metadata) rather than assuming a fixed canvas, so positioning/sizing is correct
 * regardless of the exact pixel dimensions here.
 */
const FAL_IMAGE_SIZE: Record<PostFormat, string | { width: number; height: number }> = {
  feed: "square_hd",
  story: { width: 768, height: 1344 },
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Hand-written descriptions for the panel's 6 predefined accent-color swatches (see
 * PALETTE in public/panel/index.html). Written by hand rather than derived algorithmically
 * so each of the 6 gets a precise, distinct phrase - an automatic hue/lightness bucketing
 * pass previously mapped both #0a0e1a and #1a1a2e to the same generic "very dark deep blue",
 * losing the distinction between two different swatches.
 */
const PALETTE_DESCRIPTIONS: Record<string, string> = {
  "#0a0e1a": "deep navy blue, near black",
  "#1a2e1a": "deep forest green, near black",
  "#2e1a1a": "deep brick red / maroon, near black",
  "#1a1a2e": "deep indigo blue-violet, near black",
  "#2e2410": "deep olive bronze brown, near black",
  "#111111": "near-black charcoal gray",
};

/**
 * ~25 common color names (hex + name) used as a nearest-match reference for accent colors
 * that don't match one of the 6 hand-written palette swatches above (e.g. a customer's own
 * brand hex entered via the color picker).
 */
const NAMED_COLORS: [hex: string, name: string][] = [
  ["#000000", "black"],
  ["#1a1a1a", "near-black charcoal"],
  ["#333333", "dark charcoal gray"],
  ["#666666", "medium gray"],
  ["#999999", "light gray"],
  ["#cccccc", "pale gray"],
  ["#ffffff", "white"],
  ["#003366", "navy blue"],
  ["#1e3a5f", "steel blue"],
  ["#4a90d9", "sky blue"],
  ["#008080", "teal"],
  ["#0f4c3a", "deep forest green"],
  ["#228b22", "forest green"],
  ["#6b8e23", "olive green"],
  ["#8b7500", "dark gold, mustard"],
  ["#b8860b", "amber gold"],
  ["#ffd700", "gold"],
  ["#ff8c00", "burnt orange"],
  ["#a0522d", "rust brown"],
  ["#5c3a21", "dark brown"],
  ["#d2b48c", "tan, beige"],
  ["#800020", "burgundy, wine red"],
  ["#8b0000", "dark red, brick red"],
  ["#dc143c", "crimson red"],
  ["#c71585", "magenta, deep pink"],
  ["#4b0082", "indigo"],
  ["#6a0dad", "royal purple"],
  ["#301934", "deep plum purple, near black"],
];

function nearestNamedColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  let best = NAMED_COLORS[0];
  let bestDist = Infinity;
  for (const entry of NAMED_COLORS) {
    const [er, eg, eb] = hexToRgb(entry[0]);
    const dist = (r - er) ** 2 + (g - eg) ** 2 + (b - eb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best[1];
}

/**
 * fal.ai's FLUX schnell does not reliably follow a raw hex code as a color instruction
 * (verified 2026-09-10: "#7a2e2e" in the prompt produced a near-white background, not the
 * requested dark brick red) - hex codes aren't meaningfully represented in an image model's
 * training captions, unlike natural-language color names. This converts a hex color to a
 * human color description, which the raw hex is then appended to as a secondary hint for
 * models that do parse it: an exact hand-written description for one of the panel's 6
 * predefined swatches, otherwise the nearest match (by RGB distance) among ~25 common
 * color names.
 */
function hexToColorDescription(hex: string): string {
  const normalized = hex.toLowerCase();
  return PALETTE_DESCRIPTIONS[normalized] ?? nearestNamedColor(normalized);
}

/**
 * Fixed background prompt — deliberately contains NO mention of text, headlines, or
 * typography. The image model previously had to render the headline itself, which was
 * unreliable even after extensive prompt tightening (garbled/dropped words, inconsistent
 * font weight, stray punctuation, hallucinated unrelated text — see styleguide.md's
 * BILDGENERIERUNG section for the 2026-09-05 test history). The headline is now composited
 * deterministically in code instead (addHeadlineText in watermark.ts, same approach already
 * used for the "Pipeline" watermark), so the model only ever has to generate a plain textured
 * background — a much easier, lower-risk task with no text-accuracy failure mode at all.
 */

/**
 * Builds the background prompt, swapping in a customer's accentColor when given (validated
 * hex, e.g. from CustomerOverview.accentColor) instead of the default dark navy tone. Only
 * the color phrase changes - texture, minimalism, and the "no graphics/text" constraints
 * are identical either way, per styleguide.md's BILDSTIL section.
 */
export function buildImageStylePrompt(accentColorHex?: string): string {
  const colorPhrase =
    accentColorHex && HEX_COLOR.test(accentColorHex)
      ? `a solid ${hexToColorDescription(accentColorHex)} background color (hex ${accentColorHex})`
      : "dark navy-black (near #0a0e1a)";
  return (
    `minimalist background for a social media graphic, ${colorPhrase} with a subtle fine linen texture, barely visible. ` +
    "Professional, clean, AI-generated aesthetic. Plain and uncluttered. Absolutely no text, no letters, no numbers, no words, no typography of any kind. " +
    "No icons, no illustrations, no photographic elements, no neural network or circuit graphics, no robotic elements, no geometric shapes, no triangles, " +
    "no abstract decorative graphics, no borders, no frames, no additional graphic elements of any kind — just the plain textured background, nothing else"
  );
}

export const IMAGE_STYLE_PREFIX = buildImageStylePrompt();

interface FalImage {
  url?: string;
}

interface FalResponse {
  images?: FalImage[];
}

async function requestFalImage(prompt: string, format: PostFormat): Promise<string> {
  const { falApiKey } = getConfig();
  const { data } = await axios.post<FalResponse>(
    FAL_ENDPOINT,
    {
      prompt,
      image_size: FAL_IMAGE_SIZE[format],
      num_images: 1,
    },
    {
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60_000,
    },
  );

  const imageUrl = data.images?.[0]?.url?.trim();
  if (!imageUrl) {
    throw new ToolError("fal.ai hat kein Bild geliefert (keine images[0].url).");
  }
  return imageUrl;
}

/**
 * Generates the background image, composites the headline and the "Pipeline" watermark onto
 * it in code, and uploads the result to R2 (the returned imageUrl points at the finished
 * version, not the raw fal.ai output). Also returns the finished image as base64 so MCP
 * clients that run in a network-restricted sandbox (e.g. cloud routines behind an egress
 * proxy) can view it via the MCP tool result itself, without needing direct access to
 * fal.media or R2.
 */
export interface ImageBranding {
  /** Validated hex color, e.g. from a customer's accentColor. Falls back to the default navy tone when absent. */
  accentColor?: string;
  /** Text stamped as the watermark instead of "Pipeline". Ignored when logoPath is set. */
  watermarkText?: string;
  /** Local file path to a customer's uploaded logo - shown small in the corner instead of the text watermark. */
  logoPath?: string | null;
}

export async function generateImageUrl(
  headline: string,
  format: PostFormat = "feed",
  branding?: ImageBranding,
): Promise<{ prompt: string; imageUrl: string; imageBase64: string; mimeType: string }> {
  const trimmedHeadline = headline.trim();
  if (!trimmedHeadline) {
    throw new ToolError("headline darf nicht leer sein.");
  }

  const prompt = buildImageStylePrompt(branding?.accentColor);
  const rawImageUrl = await withRetry(() => requestFalImage(prompt, format), 3, "fal.ai generate");

  const { data } = await withRetry(
    () => axios.get<ArrayBuffer>(rawImageUrl, { responseType: "arraybuffer", timeout: 30_000 }),
    3,
    "fal.ai image download",
  );

  const withHeadline = await addHeadlineText(Buffer.from(data), trimmedHeadline, format);
  const finished = await addPipelineWatermark(withHeadline, format, branding?.watermarkText || "Pipeline", branding?.logoPath);
  const imageBase64 = finished.toString("base64");
  const imageUrl = await withRetry(
    () => uploadImageBase64(`data:image/jpeg;base64,${imageBase64}`),
    3,
    "R2 upload of finished image",
  );

  return { prompt, imageUrl, imageBase64, mimeType: "image/jpeg" };
}
