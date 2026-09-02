import axios from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux/schnell";

/** Fixed visual style. Repeated no-text constraints — Flux schnell has no negative_prompt. */
export const IMAGE_STYLE_PREFIX =
  "modern abstract technology illustration, AI and chatbot theme, glowing neural network patterns, circuit board details, robotic elements, dark background with vibrant blue and purple accent colors, clean professional digital art style, social media post format, purely visual and symbolic, absolutely no text, no words, no letters, no numbers, no typography, no writing of any kind, no captions embedded in image, image must contain zero readable characters";

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
