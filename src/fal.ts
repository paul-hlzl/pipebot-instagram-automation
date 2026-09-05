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
export const IMAGE_STYLE_PREFIX =
  "minimalist background for a social media graphic, dark navy-black (near #0a0e1a) with a subtle fine linen texture, barely visible. Professional, clean, AI-generated aesthetic. Plain and uncluttered. Absolutely no text, no letters, no numbers, no words, no typography of any kind. No icons, no illustrations, no photographic elements, no neural network or circuit graphics, no robotic elements, no geometric shapes, no triangles, no abstract decorative graphics, no borders, no frames, no additional graphic elements of any kind — just the plain dark textured background, nothing else";

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
export async function generateImageUrl(
  headline: string,
  format: PostFormat = "feed",
): Promise<{ prompt: string; imageUrl: string; imageBase64: string; mimeType: string }> {
  const trimmedHeadline = headline.trim();
  if (!trimmedHeadline) {
    throw new ToolError("headline darf nicht leer sein.");
  }

  const prompt = IMAGE_STYLE_PREFIX;
  const rawImageUrl = await withRetry(() => requestFalImage(prompt, format), 3, "fal.ai generate");

  const { data } = await withRetry(
    () => axios.get<ArrayBuffer>(rawImageUrl, { responseType: "arraybuffer", timeout: 30_000 }),
    3,
    "fal.ai image download",
  );

  const withHeadline = await addHeadlineText(Buffer.from(data), trimmedHeadline, format);
  const finished = await addPipelineWatermark(withHeadline, format);
  const imageBase64 = finished.toString("base64");
  const imageUrl = await withRetry(
    () => uploadImageBase64(`data:image/jpeg;base64,${imageBase64}`),
    3,
    "R2 upload of finished image",
  );

  return { prompt, imageUrl, imageBase64, mimeType: "image/jpeg" };
}
