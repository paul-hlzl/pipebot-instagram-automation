#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfig } from "./config.js";
import { generateImageUrl, type ImageBranding } from "./fal.js";
import { ensureAuthToken, writeAccessToken, writeLinkedInTokens } from "./env-file.js";
import { toToolMessage, ToolError } from "./errors.js";
import {
  getPublishingLimit,
  publishImageToInstagram,
  publishStoryToInstagram,
  refreshAccessToken,
  type InstagramCredentials,
} from "./instagram.js";
import { uploadImageBase64 } from "./r2.js";
import { createHttpApp } from "./http-server.js";
import { getCredentials, getCustomerOverview, listCustomers, logPost, startTokenRefreshSchedule } from "./panel/credentials.js";
import {
  checkLinkedInToken,
  publishLinkedInImagePost,
  publishLinkedInPost,
  refreshLinkedInToken,
  type LinkedInCredentials,
} from "./linkedin.js";

const customerIdSchema = z
  .string()
  .optional()
  .describe(
    "Optional: customerId eines Kunden aus `list_customers`. Ohne diesen Parameter wird der eigene, " +
      "in der .env konfigurierte Account verwendet (unverändertes Verhalten). Mit customer_id werden " +
      "die Zugangsdaten dieses Kunden aus dem Kunden-Panel geladen und für diesen Aufruf verwendet - " +
      "Tokens selbst werden nie zurückgegeben.",
  );

/** Lädt die Instagram-Zugangsdaten eines Kunden. undefined = eigener .env-Account (Standardverhalten). */
async function resolveInstagramCredentials(customerId?: string): Promise<InstagramCredentials | undefined> {
  if (!customerId) return undefined;
  const cred = await getCredentials(customerId, "instagram");
  return { accessToken: cred.accessToken, igUserId: cred.accountId };
}

/** Lädt die LinkedIn-Zugangsdaten eines Kunden. undefined = eigener .env-Account (Standardverhalten). */
async function resolveLinkedInCredentials(customerId?: string): Promise<LinkedInCredentials | undefined> {
  if (!customerId) return undefined;
  const cred = await getCredentials(customerId, "linkedin");
  return { accessToken: cred.accessToken, personUrn: cred.accountId };
}

/**
 * Lädt Bild-Branding (Akzentfarbe, Wasserzeichen-Text) eines Kunden für die generate_*-Tools.
 * Ohne customer_id oder für einen unbekannten Kunden: {} -> generateImageUrl fällt auf das
 * Standard-Styleguide-Aussehen zurück (Navy, "Pipeline"-Wasserzeichen), exakt wie bisher.
 */
function resolveImageBranding(customerId?: string): ImageBranding {
  if (!customerId) return {};
  const customer = getCustomerOverview(customerId);
  if (!customer) return {};
  return {
    accentColor: customer.accentColor ?? undefined,
    watermarkText: customer.watermarkText || customer.company || undefined,
  };
}

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

  const headlineSchema = z
    .string()
    .min(1)
    .max(60)
    .describe(
      "The short (2-4 word) headline to display on the image, verbatim — e.g. \"Automate With Confidence\". " +
        "This is rendered deterministically in code (not by the image model) as white classic serif text " +
        "positioned left-of-center, so it is always spelled and styled exactly as given here. Do not include " +
        "quotes, styling notes, or the 'Pipeline' watermark text — just the plain headline words.",
    );

  const HEADLINE_IMAGE_GUIDANCE =
    "You MUST translate `topic` into a short (2-4 word) `headline` yourself before calling — just the plain words, " +
    "e.g. topic \"Deploy AI in Minutes\" -> headline \"Deploy AI Fast\". The headline is composited onto the " +
    "background deterministically in code (exact spelling and styling guaranteed, no image-model text rendering " +
    "involved), and the 'Pipeline' watermark is added the same way — do not mention either in any prompt text " +
    "you write; there is no visual_scene or prompt field to fill in here, the background style is fixed server-side.";

  server.registerTool(
    "generate_post_image",
    {
      description:
        "Generate a single Instagram-ready image with fal.ai FLUX schnell WITHOUT publishing it. " +
        "The headline is composited onto the background deterministically in code (see `headline` below), so " +
        "text accuracy is guaranteed — the only thing worth reviewing before publishing is the background itself " +
        "(rare visual artifacts from the image model), not the text. " +
        "Returns the image URL AND the image itself as inline content, so it can be reviewed before posting " +
        "even from a network-restricted sandbox that cannot reach the fal.media host directly (e.g. a cloud " +
        "routine behind an egress proxy) — no separate fetch of the URL is needed to view it. " +
        "Use this instead of `generate_and_publish_post` whenever the image should be checked first " +
        "(e.g. in unattended/automated routines). " +
        HEADLINE_IMAGE_GUIDANCE,
      inputSchema: {
        topic: topicSchema,
        headline: headlineSchema,
        customer_id: customerIdSchema,
      },
    },
    async ({ topic, headline, customer_id }) => {
      try {
        const generated = await generateImageUrl(headline, "feed", resolveImageBranding(customer_id));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { imageUrl: generated.imageUrl, promptUsed: generated.prompt, topic, customerId: customer_id },
                null,
                2,
              ),
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
        customer_id: customerIdSchema,
        headline: z
          .string()
          .optional()
          .describe(
            "Optional: the headline used on the image (from `generate_post_image`). Only used to label this " +
              "post in a customer's history in the panel (`logPost`, requires customer_id) - has no effect on publishing itself.",
          ),
      },
    },
    async ({ imageUrl, caption, customer_id, headline }) => {
      try {
        const creds = await resolveInstagramCredentials(customer_id);
        const result = await publishImageToInstagram(imageUrl, caption, creds, customer_id);
        if (customer_id) {
          logPost(customer_id, "instagram", { externalPostId: result.postId, headline, caption, imageUrl });
        }
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
        "followed by `publish_generated_post`. The headline text itself is guaranteed correct (composited in " +
        "code, not rendered by the image model) — the review step this tool skips only ever mattered for the " +
        "background's visual quality, not text accuracy. " +
        HEADLINE_IMAGE_GUIDANCE +
        " Does not use R2.",
      inputSchema: {
        topic: topicSchema,
        headline: headlineSchema,
        caption: z.string().min(1).max(2200).describe("Instagram caption (max 2200 characters)."),
        customer_id: customerIdSchema,
      },
    },
    async ({ topic, headline, caption, customer_id }) => {
      try {
        const creds = await resolveInstagramCredentials(customer_id);
        const generated = await generateImageUrl(headline, "feed", resolveImageBranding(customer_id));
        const published = await publishImageToInstagram(generated.imageUrl, caption, creds, customer_id);
        if (customer_id) {
          logPost(customer_id, "instagram", {
            externalPostId: published.postId,
            headline,
            caption,
            imageUrl: generated.imageUrl,
          });
        }
        return textResult({
          postId: published.postId,
          topic,
          imageUrl: generated.imageUrl,
          prompt: generated.prompt,
          warning: published.warning,
        });
      } catch (error) {
        console.error("generate_and_publish_post:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  const STORY_FORMAT_NOTE =
    "Generates a 9:16 portrait image (not the 1:1 feed square) — same background/headline/watermark " +
    "pipeline as the feed tools, just re-composited for the taller canvas (see styleguide.md's " +
    "'INSTAGRAM STORIES' section). Instagram Stories do not support captions, alt text, tags, or " +
    "location via the Graph API, so there is no caption parameter here — the headline on the image " +
    "carries the message.";

  server.registerTool(
    "generate_story_image",
    {
      description:
        "Generate a 9:16 Instagram Story-ready image with fal.ai FLUX schnell WITHOUT publishing it. " +
        STORY_FORMAT_NOTE +
        " Returns the image URL AND the image itself as inline content for review, same as " +
        "`generate_post_image`. Use this instead of `generate_and_publish_story` whenever the image " +
        "should be checked first (e.g. in unattended/automated routines). " +
        HEADLINE_IMAGE_GUIDANCE,
      inputSchema: {
        topic: topicSchema,
        headline: headlineSchema,
        customer_id: customerIdSchema,
      },
    },
    async ({ topic, headline, customer_id }) => {
      try {
        const generated = await generateImageUrl(headline, "story", resolveImageBranding(customer_id));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { imageUrl: generated.imageUrl, promptUsed: generated.prompt, topic, customerId: customer_id },
                null,
                2,
              ),
            },
            {
              type: "image" as const,
              data: generated.imageBase64,
              mimeType: generated.mimeType,
            },
          ],
        };
      } catch (error) {
        console.error("generate_story_image:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "publish_generated_story",
    {
      description:
        "Publish an Instagram Story using an already-generated image URL. Use after " +
        "`generate_story_image`, once the image has been visually reviewed and the background looks " +
        "clean (no garbled/wrong text is possible — the headline is code-rendered — but check for " +
        "background artifacts, same as the feed review step). Shares the same 24h publishing quota as " +
        "feed posts (`check_publishing_limit`) — there is no separate Stories-only quota.",
      inputSchema: {
        imageUrl: z
          .string()
          .min(1)
          .describe("Image URL, typically from `generate_story_image`. Must be publicly reachable."),
        customer_id: customerIdSchema,
        headline: z
          .string()
          .optional()
          .describe(
            "Optional: the headline used on the image (from `generate_story_image`). Only used to label this " +
              "post in a customer's history in the panel (`logPost`, requires customer_id) - has no effect on publishing itself.",
          ),
      },
    },
    async ({ imageUrl, customer_id, headline }) => {
      try {
        const creds = await resolveInstagramCredentials(customer_id);
        const result = await publishStoryToInstagram(imageUrl, creds);
        if (customer_id) {
          logPost(customer_id, "instagram", { externalPostId: result.postId, headline, imageUrl });
        }
        return textResult(result);
      } catch (error) {
        console.error("publish_generated_story:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "generate_and_publish_story",
    {
      description:
        "Convenience tool: generates a 9:16 Story image with fal.ai FLUX schnell AND immediately " +
        "publishes it as an Instagram Story, with no review step in between. Internally does the same " +
        "as calling `generate_story_image` followed by `publish_generated_story`. " +
        STORY_FORMAT_NOTE +
        " " +
        HEADLINE_IMAGE_GUIDANCE +
        " Does not use R2.",
      inputSchema: {
        topic: topicSchema,
        headline: headlineSchema,
        customer_id: customerIdSchema,
      },
    },
    async ({ topic, headline, customer_id }) => {
      try {
        const creds = await resolveInstagramCredentials(customer_id);
        const generated = await generateImageUrl(headline, "story", resolveImageBranding(customer_id));
        const published = await publishStoryToInstagram(generated.imageUrl, creds);
        if (customer_id) {
          logPost(customer_id, "instagram", {
            externalPostId: published.postId,
            headline,
            imageUrl: generated.imageUrl,
          });
        }
        return textResult({
          postId: published.postId,
          topic,
          imageUrl: generated.imageUrl,
          prompt: generated.prompt,
        });
      } catch (error) {
        console.error("generate_and_publish_story:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "check_publishing_limit",
    {
      description:
        "Return the current Instagram content publishing quota usage for the configured business account.",
      inputSchema: {
        customer_id: customerIdSchema,
      },
    },
    async ({ customer_id }) => {
      try {
        const creds = await resolveInstagramCredentials(customer_id);
        const limit = await getPublishingLimit(creds);
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

  server.registerTool(
    "publish_linkedin_post",
    {
      description:
        "Publish a plain-text LinkedIn feed post on the configured personal profile. No image. " +
        "Follow linkedin-styleguide.md for length (600-1200 characters), tone, and hashtags.",
      inputSchema: {
        text: z
          .string()
          .min(1)
          .max(3000)
          .describe("LinkedIn post text (plain commentary, hashtags at the end). Max 3000 characters."),
        customer_id: customerIdSchema,
      },
    },
    async ({ text, customer_id }) => {
      try {
        const creds = await resolveLinkedInCredentials(customer_id);
        const result = await publishLinkedInPost({ text }, creds);
        if (customer_id) {
          logPost(customer_id, "linkedin", { externalPostId: result.postId ?? undefined, caption: text });
        }
        return textResult(result);
      } catch (error) {
        console.error("publish_linkedin_post:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "publish_linkedin_image_post",
    {
      description:
        "Publish a LinkedIn feed post with a single image. Provide either a public image_url or " +
        "image_base64 (uploaded to LinkedIn's own image storage, no R2 involved). Landscape " +
        "1200x627 recommended, no text in the image (see linkedin-styleguide.md).",
      inputSchema: {
        text: z.string().min(1).max(3000).describe("LinkedIn post text. Max 3000 characters."),
        image_url: z.string().optional().describe("Publicly reachable image URL."),
        image_base64: z
          .string()
          .optional()
          .describe("JPEG or PNG as base64, optionally a data URL."),
        alt_text: z.string().optional().describe("Alt text for the image (accessibility)."),
        customer_id: customerIdSchema,
      },
    },
    async ({ text, image_url, image_base64, alt_text, customer_id }) => {
      try {
        const hasUrl = Boolean(image_url?.trim());
        const hasB64 = Boolean(image_base64?.trim());
        if (hasUrl === hasB64) {
          throw new ToolError("Genau eines von image_url oder image_base64 angeben, nicht beides und nicht keines.");
        }

        const creds = await resolveLinkedInCredentials(customer_id);
        const imageSource: string | Buffer = hasB64
          ? Buffer.from(image_base64!.trim().replace(/^data:[^;,]+;base64,/, ""), "base64")
          : image_url!.trim();

        const result = await publishLinkedInImagePost({ text, imageSource, altText: alt_text }, creds);
        if (customer_id) {
          logPost(customer_id, "linkedin", {
            externalPostId: result.postId ?? undefined,
            caption: text,
            imageUrl: hasUrl ? image_url : undefined,
          });
        }
        return textResult(result);
      } catch (error) {
        console.error("publish_linkedin_image_post:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "check_linkedin_token",
    {
      description: "Check whether the configured LinkedIn access token is still valid (daily health check).",
      inputSchema: {
        customer_id: customerIdSchema,
      },
    },
    async ({ customer_id }) => {
      try {
        const creds = await resolveLinkedInCredentials(customer_id);
        const result = await checkLinkedInToken(creds);
        return textResult(result);
      } catch (error) {
        console.error("check_linkedin_token:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "refresh_linkedin_token",
    {
      description:
        "Refresh the LinkedIn access token using the stored refresh token and write the new " +
        "access (and, if rotated, refresh) token back to .env.",
    },
    async () => {
      try {
        const refreshed = await refreshLinkedInToken();
        writeLinkedInTokens(refreshed.accessToken, refreshed.refreshToken);
        return textResult({
          ok: true,
          expires_in_days: refreshed.expiresInDays,
          message: "Neuer LinkedIn Access Token wurde in die lokale .env geschrieben.",
        });
      } catch (error) {
        console.error("refresh_linkedin_token:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_customers",
    {
      description:
        "List all active customers from the customer panel: briefing (company, industry, description, " +
        "tone, posting frequency, posting time) and connected channels with status (ok/renew-soon/expired). " +
        "Each customer also has `trialExpired` (boolean) and `trialDaysLeft` (number, or null when the " +
        "customer has no trial limit). SKIP any customer with `trialExpired: true` - do not generate or " +
        "publish a post for them; the publish tools will also refuse with an error for these customers as " +
        "a backstop, but check `trialExpired` first so you don't waste a generation call. " +
        "Never includes access tokens. Use a customer's `customerId` as the `customer_id` argument on the " +
        "publish/generate tools to act on that customer's account instead of your own.",
    },
    async () => {
      try {
        return textResult({ customers: listCustomers() });
      } catch (error) {
        console.error("list_customers:", toToolMessage(error));
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
  startTokenRefreshSchedule();
  // Bind to loopback only - Nginx (proxy_pass http://127.0.0.1:3000) is the only
  // intended entry point. Express/Node default to 0.0.0.0 (all interfaces) if no
  // host is given, which would expose this port directly to the internet.
  app.listen(port, "127.0.0.1", () => {
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
