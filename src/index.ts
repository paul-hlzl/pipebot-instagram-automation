#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfig } from "./config.js";
import { generateImageUrl } from "./fal.js";
import { ensureAuthToken, writeAccessToken } from "./env-file.js";
import { toToolMessage, ToolError } from "./errors.js";
import { getPublishingLimit, publishImageToInstagram, refreshAccessToken } from "./instagram.js";
import { uploadImageBase64 } from "./r2.js";
import { createHttpApp } from "./http-server.js";

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = toToolMessage(error);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "instagram",
    version: "1.0.0",
  });

  server.registerTool(
    "upload_and_publish_post",
    {
      description:
        "Publish a single Instagram feed image post. Provide either a public image_url or image_base64 (uploaded to R2 first). Caption max 2200 characters.",
      inputSchema: {
        image_url: z
          .string()
          .optional()
          .describe("Publicly reachable image URL. Instagram fetches this via HTTP."),
        image_base64: z
          .string()
          .optional()
          .describe("JPEG or PNG as base64, optionally a data URL. Uploaded to Cloudflare R2 first."),
        caption: z.string().min(1).max(2200).describe("Instagram caption (max 2200 characters)."),
      },
    },
    async ({ image_url, image_base64, caption }) => {
      try {
        const hasUrl = Boolean(image_url?.trim());
        const hasB64 = Boolean(image_base64?.trim());
        if (hasUrl === hasB64) {
          throw new ToolError("Genau eines von image_url oder image_base64 angeben, nicht beides und nicht keines.");
        }

        const hostedImageUrl = hasB64 ? await uploadImageBase64(image_base64!) : image_url!.trim();
        const result = await publishImageToInstagram(hostedImageUrl, caption);
        return textResult(result);
      } catch (error) {
        console.error("upload_and_publish_post:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  const topicSchema = z
    .string()
    .min(1)
    .describe(
      "Original theme for logging only, e.g. \"Vorteile von KI-Chatbots im Kundenservice\". Not sent to the image model.",
    );

  const visualSceneSchema = z
    .string()
    .min(1)
    .describe(
      "Must include the exact headline text to render on the image, plus layout notes. This design puts a short " +
        "headline (3-5 words) as the dominant visual element on a minimalist black background — do not avoid text. " +
        'Example: \'centered white elegant serif text reading: "Deploy AI in Minutes". Small "pipebot" text in the ' +
        "bottom right corner.'",
    );

  const HEADLINE_IMAGE_GUIDANCE =
    "You MUST translate `topic` into `visual_scene` yourself before calling: derive a short (3-5 word) headline from " +
    "the topic and describe it as centered white serif text on the image, plus the small pipebot branding text. " +
    "Example: topic Deploy AI in Minutes -> visual_scene: centered white elegant serif text reading: Deploy AI in " +
    "Minutes. Small pipebot text in the bottom right corner. " +
    "The server prepends a fixed minimalist black-background/serif-typography style prefix; it does not send the raw " +
    "topic to fal.ai. Flux schnell can occasionally garble or misspell rendered text — always review the image before " +
    "publishing and regenerate if the text is wrong, distorted, or illegible.";

  server.registerTool(
    "generate_post_image",
    {
      description:
        "Generate a single Instagram-ready image with fal.ai FLUX schnell WITHOUT publishing it. " +
        "Returns the image URL AND the image itself as inline content, so it can be reviewed before posting " +
        "even from a network-restricted sandbox that cannot reach the fal.media host directly (e.g. a cloud " +
        "routine behind an egress proxy) — no separate fetch of the URL is needed to view it. " +
        "Use this instead of `generate_and_publish_post` whenever the image should be checked first " +
        "(e.g. in unattended/automated routines) — image models occasionally render garbled or wrong text into the image. " +
        HEADLINE_IMAGE_GUIDANCE,
      inputSchema: {
        topic: topicSchema,
        visual_scene: visualSceneSchema,
      },
    },
    async ({ topic, visual_scene }) => {
      try {
        const generated = await generateImageUrl(visual_scene);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ imageUrl: generated.imageUrl, promptUsed: generated.prompt, topic }, null, 2),
            },
            {
              type: "image" as const,
              data: generated.imageBase64,
              mimeType: generated.mimeType,
            },
          ],
        };
      } catch (error) {
        console.error("generate_post_image:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "publish_generated_post",
    {
      description:
        "Publish an Instagram feed post using an already-generated image URL. " +
        "Use after `generate_post_image`, once the image has been visually reviewed and looks clean " +
        "(no garbled/wrong text, no distortion). Caption max 2200 characters.",
      inputSchema: {
        imageUrl: z
          .string()
          .min(1)
          .describe("Image URL, typically from `generate_post_image`. Must be publicly reachable."),
        caption: z.string().min(1).max(2200).describe("Instagram caption (max 2200 characters)."),
      },
    },
    async ({ imageUrl, caption }) => {
      try {
        const result = await publishImageToInstagram(imageUrl, caption);
        return textResult(result);
      } catch (error) {
        console.error("publish_generated_post:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "generate_and_publish_post",
    {
      description:
        "Convenience tool: generates an image with fal.ai FLUX schnell AND immediately publishes it, " +
        "with no review step in between. Internally does the same as calling `generate_post_image` " +
        "followed by `publish_generated_post`. " +
        "For unattended/automated routines, prefer calling `generate_post_image` and `publish_generated_post` " +
        "separately with a visual review step in between — this tool skips that safeguard. " +
        HEADLINE_IMAGE_GUIDANCE +
        " Does not use R2.",
      inputSchema: {
        topic: topicSchema,
        visual_scene: visualSceneSchema,
        caption: z.string().min(1).max(2200).describe("Instagram caption (max 2200 characters)."),
      },
    },
    async ({ topic, visual_scene, caption }) => {
      try {
        const generated = await generateImageUrl(visual_scene);
        const published = await publishImageToInstagram(generated.imageUrl, caption);
        return textResult({
          postId: published.postId,
          topic,
          imageUrl: generated.imageUrl,
          prompt: generated.prompt,
        });
      } catch (error) {
        console.error("generate_and_publish_post:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "check_publishing_limit",
    {
      description:
        "Return the current Instagram content publishing quota usage for the configured business account.",
    },
    async () => {
      try {
        const limit = await getPublishingLimit();
        return textResult({
          quota_usage: limit.quotaUsage,
          quota_total: limit.quotaTotal,
          quota_duration: limit.quotaDuration,
          remaining: limit.remaining,
        });
      } catch (error) {
        console.error("check_publishing_limit:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "refresh_access_token",
    {
      description:
        "Refresh the long-lived Instagram access token (must be at least 24 hours old) and write the new token back to .env.",
    },
    async () => {
      try {
        const refreshed = await refreshAccessToken();
        writeAccessToken(refreshed.accessToken);
        return textResult({
          ok: true,
          expires_in: refreshed.expiresIn,
          expires_in_days: refreshed.expiresIn ? Math.round(refreshed.expiresIn / 86400) : undefined,
          message: "Neuer Access Token wurde in die lokale .env geschrieben.",
        });
      } catch (error) {
        console.error("refresh_access_token:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const { token: authToken, generated } = ensureAuthToken();

  let port: number;
  try {
    port = getConfig().port;
  } catch (error) {
    console.error(toToolMessage(error));
    process.exit(1);
  }

  const app = createHttpApp(createServer);
  app.listen(port, () => {
    console.error(`Instagram MCP server listening on port ${port}`);
    console.error(`MCP endpoint: http://localhost:${port}/mcp (Authorization: Bearer <MCP_AUTH_TOKEN> required)`);
    console.error(`Health check: http://localhost:${port}/health (no auth required)`);
    if (generated) {
      console.error(`Generated new MCP_AUTH_TOKEN and saved it to .env: ${authToken}`);
    }
  });
}

main().catch((error: unknown) => {
  console.error(toToolMessage(error));
  process.exit(1);
});
