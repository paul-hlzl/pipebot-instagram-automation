import axios from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";

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

export async function generateImageUrl(
  visualScene: string,
): Promise<{ prompt: string; imageUrl: string }> {
  const prompt = buildImagePrompt(visualScene);
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
    throw new ToolError(
      "fal.ai hat kein Bild geliefert (keine images[0].url). " +
        "Kein Fallback-Bild — bitte Prompt prüfen oder später erneut versuchen.",
    );
  }

  return { prompt, imageUrl };
}
