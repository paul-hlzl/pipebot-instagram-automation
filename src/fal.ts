import axios from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";
import { withRetry } from "./retry.js";

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux/schnell";

/** Fixed visual style: minimalist black/white typographic look with a subtle textured background. The headline text belongs in visual_scene. */
export const IMAGE_STYLE_PREFIX =
  "minimalist Instagram graphic, Black background with subtle elegant texture (fine linen or minimal geometric pattern). Professional, clean, AI-generated aesthetic. Elegant white classic serif typography as the dominant visual element, social media post format, square, no icons, no illustrations, no photographic elements, no neural network or circuit graphics, no robotic elements";

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
 * Generates an image and also downloads it server-side (base64), so MCP clients that run
 * in a network-restricted sandbox (e.g. cloud routines behind an egress proxy) can view the
 * image via the MCP tool result itself, without needing direct access to the fal.media domain.
 */
export async function generateImageUrl(
  visualScene: string,
): Promise<{ prompt: string; imageUrl: string; imageBase64: string; mimeType: string }> {
  const prompt = buildImagePrompt(visualScene);

  const imageUrl = await withRetry(() => requestFalImage(prompt), 3, "fal.ai generate");

  const { data, headers } = await withRetry(
    () => axios.get<ArrayBuffer>(imageUrl, { responseType: "arraybuffer", timeout: 30_000 }),
    3,
    "fal.ai image download",
  );
  const mimeType = (headers["content-type"] as string | undefined)?.split(";")[0] ?? "image/jpeg";
  const imageBase64 = Buffer.from(data).toString("base64");

  return { prompt, imageUrl, imageBase64, mimeType };
}
