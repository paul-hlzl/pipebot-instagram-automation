import axios from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";
import { withRetry } from "./retry.js";
import { addHeadlineText, addPipelineWatermark } from "./watermark.js";
import { uploadImageBase64 } from "./r2.js";

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux/schnell";

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

async function requestFalImage(prompt: string): Promise<string> {
  const { falApiKey } = getConfig();
  const { data } = await axios.post<FalResponse>(
    FAL_ENDPOINT,
    {
      prompt,
      image_size: "square_hd",
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
): Promise<{ prompt: string; imageUrl: string; imageBase64: string; mimeType: string }> {
  const trimmedHeadline = headline.trim();
  if (!trimmedHeadline) {
    throw new ToolError("headline darf nicht leer sein.");
  }

  const prompt = IMAGE_STYLE_PREFIX;
  const rawImageUrl = await withRetry(() => requestFalImage(prompt), 3, "fal.ai generate");

  const { data } = await withRetry(
    () => axios.get<ArrayBuffer>(rawImageUrl, { responseType: "arraybuffer", timeout: 30_000 }),
    3,
    "fal.ai image download",
  );

  const withHeadline = await addHeadlineText(Buffer.from(data), trimmedHeadline);
  const finished = await addPipelineWatermark(withHeadline);
  const imageBase64 = finished.toString("base64");
  const imageUrl = await withRetry(
    () => uploadImageBase64(`data:image/jpeg;base64,${imageBase64}`),
    3,
    "R2 upload of finished image",
  );

  return { prompt, imageUrl, imageBase64, mimeType: "image/jpeg" };
}
