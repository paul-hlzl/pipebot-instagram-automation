import axios from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";
import { withRetry } from "./retry.js";
import { addPipelineWatermark } from "./watermark.js";
import { uploadImageBase64 } from "./r2.js";

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux/schnell";

/**
 * Fixed visual style: minimalist typographic look with a subtle textured background.
 * The headline text belongs in visual_scene. The "Pipeline" watermark is NOT part of this
 * prompt — it's composited in code afterward (addPipelineWatermark) because text-to-image
 * models render rotated text and precise opacity unreliably.
 */
export const IMAGE_STYLE_PREFIX =
  "minimalist Instagram graphic, dark navy-black background (near #0a0e1a) with a subtle fine linen texture, barely visible. Professional, clean, AI-generated aesthetic. Elegant white classic serif typography as the dominant visual element — a traditional serif typeface only, NOT sans-serif, NOT bold, NOT script, NOT a decorative or stylized font. Social media post format, square. Absolutely no icons, no illustrations, no photographic elements, no neural network or circuit graphics, no robotic elements, no geometric shapes, no triangles, no abstract decorative graphics, no borders, no frames, no additional graphic elements of any kind — nothing in the image except the plain textured background and the headline text. No extra text, numbers, dates, labels, or stray punctuation marks anywhere besides the one exact headline. The headline text must be rendered exactly as written, letter for letter, with no missing, extra, or altered characters";

interface FalImage {
  url?: string;
}

interface FalResponse {
  images?: FalImage[];
}

export function buildImagePrompt(visualScene: string): string {
  const trimmed = visualScene.trim();
  if (!trimmed) {
    throw new ToolError("visual_scene darf nicht leer sein.");
  }
  return `${IMAGE_STYLE_PREFIX}, ${trimmed}`;
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
 * Generates an image, composites the "Pipeline" watermark onto it in code, and uploads the
 * result to R2 (the returned imageUrl points at the watermarked version, not the raw fal.ai
 * output). Also returns the watermarked image as base64 so MCP clients that run in a
 * network-restricted sandbox (e.g. cloud routines behind an egress proxy) can view the final
 * image via the MCP tool result itself, without needing direct access to fal.media or R2.
 */
export async function generateImageUrl(
  visualScene: string,
): Promise<{ prompt: string; imageUrl: string; imageBase64: string; mimeType: string }> {
  const prompt = buildImagePrompt(visualScene);

  const rawImageUrl = await withRetry(() => requestFalImage(prompt), 3, "fal.ai generate");

  const { data } = await withRetry(
    () => axios.get<ArrayBuffer>(rawImageUrl, { responseType: "arraybuffer", timeout: 30_000 }),
    3,
    "fal.ai image download",
  );

  const watermarked = await addPipelineWatermark(Buffer.from(data));
  const imageBase64 = watermarked.toString("base64");
  const imageUrl = await withRetry(
    () => uploadImageBase64(`data:image/jpeg;base64,${imageBase64}`),
    3,
    "R2 upload of watermarked image",
  );

  return { prompt, imageUrl, imageBase64, mimeType: "image/jpeg" };
}
