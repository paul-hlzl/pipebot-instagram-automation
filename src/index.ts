#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfig } from "./config.js";
import { generateImageUrl, FAL_IMAGE_COST_USD, type ImageBranding } from "./fal.js";
import { ensureAdminPassword, ensureAuthToken, writeAccessToken, writeLinkedInTokens } from "./env-file.js";
import { toToolMessage, ToolError } from "./errors.js";
import {
  getPublishingLimit,
  publishImageToInstagram,
  publishCarouselToInstagram,
  publishStoryToInstagram,
  refreshAccessToken,
  CAROUSEL_MIN_SLIDES,
  CAROUSEL_MAX_SLIDES,
} from "./instagram.js";
import { logUsageCost } from "./panel/analytics.js";
import { uploadImageBase64 } from "./r2.js";
import { createHttpApp } from "./http-server.js";
import { startDailyPlanningSchedule } from "./panel/planning.js";
import { startTrialEndingEmailSchedule } from "./panel/trial-emails.js";
import { startDailyAnalyticsSnapshotSchedule, startWeeklyAnalyticsSummarySchedule } from "./panel/analytics.js";
import { startCommentAutomationSchedule } from "./panel/comments.js";
import {
  assertChannelEnabled,
  assertLinkedInHasImage,
  assertNoBannedWords,
  assertRequiredElements,
  getCustomerOverview,
  getPlannedPostByChannelDate,
  getStyleSamples,
  listCustomers,
  listApprovedPendingPosts,
  listOpenPostRequests,
  logPost,
  markPendingApprovalPublished,
  markPlannedPostStatus,
  markPostRequestDone,
  resolveImageBranding,
  resolveInstagramCredentials,
  resolveLinkedInCredentials,
  savePendingApproval,
  submitPlannedPostForApproval,
  startTokenRefreshSchedule,
} from "./panel/credentials.js";
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

const pillarTitleSchema = z
  .string()
  .optional()
  .describe(
    "Optional: exact `title` of the content pillar (from `list_customers`' `contentPillars`/`suggestedPillar`) this " +
      "post covers, if the customer uses content pillars. Only stored in the post history so future " +
      "`suggestedPillar` picks avoid repeating the same pillar twice in a row - has no effect on publishing itself. " +
      "Omit if the customer has no content pillars configured.",
  );

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
        pillar_title: pillarTitleSchema,
      },
    },
    async ({ imageUrl, caption, customer_id, headline, pillar_title }) => {
      try {
        assertChannelEnabled(customer_id, "ig_feed");
        assertNoBannedWords(customer_id, headline, caption);
        assertRequiredElements(customer_id, headline, caption);
        const creds = await resolveInstagramCredentials(customer_id);
        const result = await publishImageToInstagram(imageUrl, caption, creds, customer_id);
        if (customer_id) {
          logPost(customer_id, "instagram", { externalPostId: result.postId, headline, caption, imageUrl, pillarTitle: pillar_title, channel: "ig_feed" });
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
        pillar_title: pillarTitleSchema,
      },
    },
    async ({ topic, headline, caption, customer_id, pillar_title }) => {
      try {
        assertChannelEnabled(customer_id, "ig_feed");
        assertNoBannedWords(customer_id, headline, caption);
        assertRequiredElements(customer_id, headline, caption);
        const creds = await resolveInstagramCredentials(customer_id);
        const generated = await generateImageUrl(headline, "feed", resolveImageBranding(customer_id));
        const published = await publishImageToInstagram(generated.imageUrl, caption, creds, customer_id);
        if (customer_id) {
          logPost(customer_id, "instagram", {
            externalPostId: published.postId,
            headline,
            caption,
            imageUrl: generated.imageUrl,
            pillarTitle: pillar_title,
            channel: "ig_feed",
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

  /**
   * Panel v14: Karussell-Posts (siehe Session-Bericht). Jeder Slide bekommt sein eigenes
   * fal.ai-Bild mit demselben Branding wie ein Einzelbild-Post (resolveImageBranding), damit das
   * Karussell wie aus einem Guss wirkt statt wie zufaellig aneinandergereihte Einzelbilder -
   * dieselbe generateImageUrl()-Funktion, nur einmal pro Slide statt einmal pro Post. `headline`
   * pro Slide ist die inhaltliche Sequenz (Hook -> Kernpunkte -> Call-to-Action) - die Caption
   * bleibt EINE einzelne Caption fuer den ganzen Post (Instagram erlaubt keine Caption pro Slide,
   * siehe publishCarouselToInstagram in instagram.ts).
   */
  const carouselSlidesSchema = z
    .array(
      z.object({
        headline: z
          .string()
          .min(1)
          .max(60)
          .describe("Short headline for this slide's image, same rules as generate_post_image's `headline` (code-composited, exact spelling guaranteed)."),
      }),
    )
    .min(CAROUSEL_MIN_SLIDES)
    .max(CAROUSEL_MAX_SLIDES)
    .describe(
      `${CAROUSEL_MIN_SLIDES}-${CAROUSEL_MAX_SLIDES} slides, in display order. Write these as a real sequence - ` +
        'a hook slide, then 2-4 slides each making one concrete point, then a call-to-action slide - not ' +
        "unrelated headlines. Use `list_customers`' `carouselSlideCount` for how many slides this customer prefers " +
        "(clamp your own slide count to it unless the caller explicitly asked for a different count).",
    );

  const CAROUSEL_COST_NOTE =
    `Costs ${CAROUSEL_MIN_SLIDES}-${CAROUSEL_MAX_SLIDES}x a single post's fal.ai image cost (one generation per ` +
    "slide) - logged under usage_costs feature \"carousel-post\", separate from single-image posts so the admin " +
    "cost estimate stays accurate.";

  server.registerTool(
    "generate_and_publish_carousel_post",
    {
      description:
        "Generates one branded image per slide with fal.ai FLUX schnell and immediately publishes them as an " +
        "Instagram carousel (swipeable multi-image post) - no review step in between. Use " +
        "`save_carousel_pending_approval` instead whenever this customer has `approvalMode: true`. " +
        HEADLINE_IMAGE_GUIDANCE +
        " " +
        CAROUSEL_COST_NOTE,
      inputSchema: {
        topic: topicSchema,
        slides: carouselSlidesSchema,
        caption: z.string().min(1).max(2200).describe("The single Instagram caption for the whole carousel (Instagram has no per-slide caption)."),
        customer_id: customerIdSchema,
        pillar_title: pillarTitleSchema,
      },
    },
    async ({ topic, slides, caption, customer_id, pillar_title }) => {
      try {
        assertChannelEnabled(customer_id, "ig_feed");
        const headlines = slides.map((s) => s.headline);
        assertNoBannedWords(customer_id, caption, ...headlines);
        assertRequiredElements(customer_id, caption, ...headlines);
        const creds = await resolveInstagramCredentials(customer_id);
        const branding = resolveImageBranding(customer_id);
        const generated = [];
        for (const slide of slides) {
          generated.push(await generateImageUrl(slide.headline, "feed", branding));
        }
        if (customer_id) logUsageCost(customer_id, "carousel-post", generated.length * FAL_IMAGE_COST_USD);
        const imageUrls = generated.map((g) => g.imageUrl);
        const published = await publishCarouselToInstagram(imageUrls, caption, creds, customer_id);
        if (customer_id) {
          logPost(customer_id, "instagram", {
            externalPostId: published.postId,
            headline: slides[0]?.headline,
            caption,
            imageUrl: imageUrls[0],
            pillarTitle: pillar_title,
            channel: "ig_feed",
            format: "carousel",
            slides: slides.map((s, i) => ({ imageUrl: imageUrls[i], overlayText: s.headline })),
          });
        }
        return textResult({ postId: published.postId, topic, imageUrls, warning: published.warning });
      } catch (error) {
        console.error("generate_and_publish_carousel_post:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "save_carousel_pending_approval",
    {
      description:
        "Generates one branded image per slide AND files the whole carousel away for the customer to review, " +
        "INSTEAD of publishing it. Use this - never `generate_and_publish_carousel_post` - whenever " +
        "`list_customers` shows `approvalMode: true` for this customer. Once approved, it shows up in " +
        "`list_approved_pending_posts` with `format: \"carousel\"` and a full `slides` array - publish it with " +
        "`publish_approved_carousel_post`, not `publish_generated_post`. " +
        CAROUSEL_COST_NOTE,
      inputSchema: {
        customer_id: z.string().describe("customerId - required, this tool only makes sense for a specific approval_mode customer."),
        slides: carouselSlidesSchema,
        caption: z.string().min(1).max(2200).describe("The single Instagram caption for the whole carousel."),
        pillar_title: pillarTitleSchema,
      },
    },
    async ({ customer_id, slides, caption, pillar_title }) => {
      try {
        assertChannelEnabled(customer_id, "ig_feed");
        const headlines = slides.map((s) => s.headline);
        assertNoBannedWords(customer_id, caption, ...headlines);
        assertRequiredElements(customer_id, caption, ...headlines);
        const branding = resolveImageBranding(customer_id);
        const generated = [];
        for (const slide of slides) {
          generated.push(await generateImageUrl(slide.headline, "feed", branding));
        }
        logUsageCost(customer_id, "carousel-post", generated.length * FAL_IMAGE_COST_USD);
        const imageUrls = generated.map((g) => g.imageUrl);
        const approval = savePendingApproval({
          customerId: customer_id,
          provider: "instagram",
          channel: "ig_feed",
          headline: slides[0]?.headline,
          caption,
          imageUrl: imageUrls[0],
          pillarTitle: pillar_title,
          format: "carousel",
          slides: slides.map((s, i) => ({ imageUrl: imageUrls[i], overlayText: s.headline })),
        });
        return textResult(approval ?? { skipped: "already has an open ig_feed slot today" });
      } catch (error) {
        console.error("save_carousel_pending_approval:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "publish_approved_carousel_post",
    {
      description:
        "Publishes an already-approved carousel from `list_approved_pending_posts` (an entry with " +
        "`format: \"carousel\"`) - pass its `slides` array (each entry's `imageUrl`) and `caption` verbatim, no " +
        "new image generation, no additional fal.ai cost. After a successful publish, call " +
        "`mark_pending_approval_published` with the entry's `id`, same as for a single-image approval.",
      inputSchema: {
        image_urls: z.array(z.string().min(1)).min(CAROUSEL_MIN_SLIDES).max(CAROUSEL_MAX_SLIDES).describe("Each slide's `imageUrl`, from the approved entry's `slides` array, in order."),
        caption: z.string().min(1).max(2200).describe("The approved entry's `caption`, verbatim."),
        customer_id: customerIdSchema,
        headline: z.string().optional().describe("Optional: the first slide's headline, for the customer's post history label only."),
        pillar_title: pillarTitleSchema,
      },
    },
    async ({ image_urls, caption, customer_id, headline, pillar_title }) => {
      try {
        assertChannelEnabled(customer_id, "ig_feed");
        assertNoBannedWords(customer_id, headline, caption);
        assertRequiredElements(customer_id, headline, caption);
        const creds = await resolveInstagramCredentials(customer_id);
        const published = await publishCarouselToInstagram(image_urls, caption, creds, customer_id);
        if (customer_id) {
          logPost(customer_id, "instagram", {
            externalPostId: published.postId,
            headline,
            caption,
            imageUrl: image_urls[0],
            pillarTitle: pillar_title,
            channel: "ig_feed",
            format: "carousel",
            slides: image_urls.map((url) => ({ imageUrl: url })),
          });
        }
        return textResult(published);
      } catch (error) {
        console.error("publish_approved_carousel_post:", toToolMessage(error));
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
        pillar_title: pillarTitleSchema,
      },
    },
    async ({ imageUrl, customer_id, headline, pillar_title }) => {
      try {
        assertChannelEnabled(customer_id, "ig_story");
        assertNoBannedWords(customer_id, headline);
        assertRequiredElements(customer_id, headline);
        const creds = await resolveInstagramCredentials(customer_id);
        const result = await publishStoryToInstagram(imageUrl, creds);
        if (customer_id) {
          logPost(customer_id, "instagram", { externalPostId: result.postId, headline, imageUrl, pillarTitle: pillar_title, channel: "ig_story" });
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
        pillar_title: pillarTitleSchema,
      },
    },
    async ({ topic, headline, customer_id, pillar_title }) => {
      try {
        assertChannelEnabled(customer_id, "ig_story");
        assertNoBannedWords(customer_id, headline);
        assertRequiredElements(customer_id, headline);
        const creds = await resolveInstagramCredentials(customer_id);
        const generated = await generateImageUrl(headline, "story", resolveImageBranding(customer_id));
        const published = await publishStoryToInstagram(generated.imageUrl, creds);
        if (customer_id) {
          logPost(customer_id, "instagram", {
            externalPostId: published.postId,
            headline,
            imageUrl: generated.imageUrl,
            pillarTitle: pillar_title,
            channel: "ig_story",
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
        pillar_title: pillarTitleSchema,
      },
    },
    async ({ text, customer_id, pillar_title }) => {
      try {
        if (customer_id) {
          // Bugreport 2026-09-13: panel customers got an inconsistent mix of image and plain-text
          // LinkedIn posts. Decision: panel customers always get an image (see
          // assertLinkedInHasImage) - this plain-text tool stays available ONLY for the operator's
          // own account (no customer_id), which deliberately posts text-only some days per
          // linkedin-styleguide.md. Panel customers must use publish_linkedin_image_post instead.
          throw new Error(
            "Für Panel-Kunden (customer_id gesetzt) immer publish_linkedin_image_post verwenden, nie " +
              "publish_linkedin_post - LinkedIn-Beiträge brauchen für Kunden immer ein Bild.",
          );
        }
        assertChannelEnabled(customer_id, "linkedin");
        assertNoBannedWords(customer_id, text);
        assertRequiredElements(customer_id, text);
        const creds = await resolveLinkedInCredentials(customer_id);
        const result = await publishLinkedInPost({ text }, creds);
        if (customer_id) {
          logPost(customer_id, "linkedin", { externalPostId: result.postId ?? undefined, caption: text, pillarTitle: pillar_title, channel: "linkedin" });
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
        pillar_title: pillarTitleSchema,
      },
    },
    async ({ text, image_url, image_base64, alt_text, customer_id, pillar_title }) => {
      try {
        const hasUrl = Boolean(image_url?.trim());
        const hasB64 = Boolean(image_base64?.trim());
        if (hasUrl === hasB64) {
          throw new ToolError("Genau eines von image_url oder image_base64 angeben, nicht beides und nicht keines.");
        }

        assertChannelEnabled(customer_id, "linkedin");
        assertNoBannedWords(customer_id, text);
        assertRequiredElements(customer_id, text);
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
            pillarTitle: pillar_title,
            channel: "linkedin",
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
    "get_customer_style_samples",
    {
      description:
        "Fetch up to 10 of a customer's most recent OWN Instagram posts (caption, media type, date) via the " +
        "Instagram Graph API. Read-only - publishes or changes nothing. Call this BEFORE writing a caption or " +
        "headline for a customer, so you can match their existing tone of voice, emoji usage, hashtag style, " +
        "and recurring topics instead of guessing from the briefing alone. Results are cached for 24h per " +
        "customer (repeated calls the same day return instantly, no extra API usage). Returns an empty list " +
        "if the customer has no Instagram connected or has no posts yet - fall back to the briefing in that case.",
      inputSchema: { customer_id: z.string().describe("customerId eines Kunden aus `list_customers`.") },
    },
    async ({ customer_id }) => {
      try {
        return textResult(await getStyleSamples(customer_id));
      } catch (error) {
        console.error("get_customer_style_samples:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_post_requests",
    {
      description:
        "List all still-pending \"post now\" requests customers queued themselves from their panel dashboard " +
        "(topic, customerId, channel, createdAt). Call this and work through every entry BEFORE the regular " +
        "list_customers/dueNow loop in each routine run - a customer who explicitly asked for a post right now " +
        "should not wait behind the scheduled queue. Each entry's `channel` (ig_feed/ig_story/linkedin) tells " +
        "you EXACTLY which single format to generate/publish for THAT entry - a customer selecting multiple " +
        "channels in their panel produces one separate entry per channel (same topic, different channel), so " +
        "never guess or cover more than one channel per entry. A null `channel` only occurs on an old, " +
        "pre-existing row - pick whichever of that customer's enabled channels is due, same as before this " +
        "field existed. For each entry, generate and publish a post for that customerId using its `topic` " +
        "(fall back to the customer's usual briefing/content pillars if `topic` is empty), respecting that " +
        "customer's usual rules (bannedWords, requiredElements, approval_mode if set, channel toggles). After " +
        "successfully handling one (published, or filed into pending_approvals under approval_mode), call " +
        "`mark_post_request_done` with its id - never leave a handled request pending, and never call a " +
        "publish tool twice for the same request. Each entry's `format` ('single', the default, or 'carousel' - " +
        "only ever set when `channel` is 'ig_feed') tells you which tool family to use: 'carousel' means write " +
        "`carouselSlideCount` (see `list_customers`) slides yourself and call " +
        "`generate_and_publish_carousel_post`/`save_carousel_pending_approval` instead of the single-image tools.",
    },
    async () => {
      try {
        return textResult({ requests: listOpenPostRequests() });
      } catch (error) {
        console.error("list_post_requests:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "mark_post_request_done",
    {
      description:
        "Marks one \"post now\" request (from `list_post_requests`) as done, after you've published (or queued " +
        "for approval) a post for it. Idempotent-safe to call once per request - has no effect on publishing " +
        "itself, purely bookkeeping so the panel can show the customer their request was handled.",
      inputSchema: { request_id: z.string().describe("The `id` of the request, from `list_post_requests`.") },
    },
    async ({ request_id }) => {
      try {
        const ok = markPostRequestDone(request_id);
        return textResult({ ok });
      } catch (error) {
        console.error("mark_post_request_done:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "save_pending_approval",
    {
      description:
        "Files a generated post away for the customer to review and approve in their panel, INSTEAD of publishing " +
        "it. Use this - never a publish_* tool - whenever `list_customers` shows `approvalMode: true` for this " +
        "customer; that check is the routine's own responsibility, nothing on the server redirects a publish " +
        "call automatically. Still runs the same banned-word/required-element checks as the publish tools (fails " +
        "fast instead of showing the customer a caption that could never actually go out). The customer approves " +
        "or rejects it in their dashboard; once approved, it shows up in `list_approved_pending_posts` for you " +
        "to actually publish on a later run.",
      inputSchema: {
        customer_id: z.string().describe("customerId - required, this tool only makes sense for a specific approval_mode customer."),
        channel: z.enum(["ig_feed", "ig_story", "linkedin"]).describe("Which format/channel this post is intended for."),
        headline: z.string().optional().describe("The headline used on the image, if any."),
        caption: z.string().optional().describe("The caption/post text the customer will review."),
        image_url: z.string().optional().describe("The generated image URL, if any (e.g. from generate_post_image)."),
        pillar_title: pillarTitleSchema,
      },
    },
    async ({ customer_id, channel, headline, caption, image_url, pillar_title }) => {
      try {
        assertChannelEnabled(customer_id, channel);
        // ig_story is published via publish_generated_story, which has no caption parameter at
        // all (Instagram Stories don't have a caption) and so only ever checks the headline -
        // checking headline+caption here too would let a post through review that then fails
        // every single publish attempt once approved (the required element/banned word only
        // present in the discarded caption), stuck retrying forever. Match exactly what will
        // actually be checked at publish time for each channel.
        const checkTexts = channel === "ig_story" ? [headline] : [headline, caption];
        assertNoBannedWords(customer_id, ...checkTexts);
        assertRequiredElements(customer_id, ...checkTexts);
        assertLinkedInHasImage(channel, image_url);
        const provider = channel === "linkedin" ? "linkedin" : "instagram";
        const approval = savePendingApproval({
          customerId: customer_id,
          provider,
          channel,
          headline,
          caption,
          imageUrl: image_url,
          pillarTitle: pillar_title,
        });
        if (!approval) {
          return errorResult(new Error(
            `Für ${customer_id}/${channel} liegt heute bereits ein Entwurf in der Warteschlange (pending oder ` +
            "approved) - kein weiterer wird erstellt. Nicht erneut versuchen; einfach mit dem nächsten fälligen " +
            "Kunden/Kanal weitermachen, wie bei jedem anderen K9-Skip.",
          ));
        }
        return textResult(approval);
      } catch (error) {
        console.error("save_pending_approval:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_approved_pending_posts",
    {
      description:
        "Lists posts across all customers that were saved via `save_pending_approval`/`save_carousel_pending_approval` " +
        "and have since been approved by the customer in their panel (status 'approved') - these are ready to " +
        "actually publish. Check each entry's `format` field first: `carousel` (or `video_slideshow`, once that " +
        "format exists) means call `publish_approved_carousel_post` with its `slides` array's `imageUrl`s and its " +
        "`caption` - never `publish_generated_post` for these, a single-image publish would drop every slide but " +
        "the first. For `format: \"single\"` (the default, unset on older rows), check `channel` (ig_feed / " +
        "ig_story / linkedin) and call the matching publish tool (`publish_generated_post` for ig_feed, " +
        "`publish_generated_story` for ig_story, the LinkedIn tools for linkedin) using its `imageUrl`/`caption`/" +
        "`headline`, with that entry's `customerId` as `customer_id` and `pillarTitle` as `pillar_title`. After a " +
        "successful publish, call `mark_pending_approval_published` with its `id` so it isn't published again " +
        "next run. Process these before the regular `list_customers`/`dueNow` loop, same priority as " +
        "`list_post_requests`.",
    },
    async () => {
      try {
        return textResult({ approvals: listApprovedPendingPosts() });
      } catch (error) {
        console.error("list_approved_pending_posts:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "mark_pending_approval_published",
    {
      description:
        "Marks one approved pending post (from `list_approved_pending_posts`) as published, after you've " +
        "actually published it. Has no effect on publishing itself - purely bookkeeping so it isn't published " +
        "again on a later run.",
      inputSchema: { id: z.string().describe("The `id` of the approval, from `list_approved_pending_posts`.") },
    },
    async ({ id }) => {
      try {
        const ok = markPendingApprovalPublished(id);
        return textResult({ ok });
      } catch (error) {
        console.error("mark_pending_approval_published:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_planned_post",
    {
      description:
        "Checks whether the server's own daily pre-planning already prepared a post for one customer/channel/day " +
        "(headline, caption, image already generated - see the panel's \"Vorschau\" tab, where the customer may " +
        "have reviewed or edited it). Call this FIRST for every due customer/channel, before generating anything " +
        "yourself. Returns null if nothing was prepared (pre-planning hasn't run yet for that day, generation " +
        "failed for that customer, or the customer has no content pillars/isn't otherwise eligible) - in that " +
        "case, fall back to generating on the spot exactly as before. If it returns a post: " +
        "status 'rejected' means the customer explicitly skipped this one - do NOT generate a replacement, just " +
        "skip this customer/channel/day entirely. status 'planned' or 'edited' means it's ready to use as-is " +
        "(the image already exists - do not call generate_post_image/generate_story_image again). status " +
        "'approved' is also ready to use (the customer pre-approved it in the panel, ahead of the usual " +
        "approval-mode review). status 'published' should not normally appear here (already handled), skip it " +
        "if it does.",
      inputSchema: {
        customer_id: z.string().describe("customerId eines Kunden aus `list_customers`."),
        channel: z.enum(["ig_feed", "ig_story", "linkedin"]).describe("Which channel/format to check."),
        date: z.string().describe("The calendar date to check, YYYY-MM-DD - normally today's date."),
      },
    },
    async ({ customer_id, channel, date }) => {
      try {
        return textResult({ post: getPlannedPostByChannelDate(customer_id, channel, date) });
      } catch (error) {
        console.error("get_planned_post:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "mark_planned_post_published",
    {
      description:
        "Marks one pre-planned post (from `get_planned_post`) as published, after you've actually published it " +
        "using its existing image/headline/caption. Has no effect on publishing itself - purely bookkeeping, and " +
        "distinct from `logPost` (which still happens automatically inside the publish_* tools you called).",
      inputSchema: { id: z.string().describe("The `id` of the planned post, from `get_planned_post`.") },
    },
    async ({ id }) => {
      try {
        const post = markPlannedPostStatus(id, "published");
        return textResult({ ok: Boolean(post) });
      } catch (error) {
        console.error("mark_planned_post_published:", toToolMessage(error));
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "submit_planned_post_for_approval",
    {
      description:
        "For an approvalMode customer whose `get_planned_post` returned status 'planned' or 'edited': files that " +
        "ALREADY-PREPARED post (its existing headline/caption/image, exactly as the customer saw or edited it in " +
        "their panel's \"Vorschau\" tab) into the customer's approval queue - like `save_pending_approval`, but " +
        "WITHOUT generating anything new. Use this INSTEAD of generate_post_image/generate_story_image + " +
        "save_pending_approval whenever `get_planned_post` already returned a usable post for an approvalMode " +
        "customer - do NOT discard it and generate a fresh one, that would show the customer a different post " +
        "than the one they already reviewed and double the generation cost for the same slot. Returns an error " +
        "if the planned post doesn't exist or was already submitted/approved/rejected/published (safe to treat " +
        "as a K9-style skip, not a real failure). The customer then reviews/approves it in their panel exactly " +
        "like any other `save_pending_approval` entry - a later run's `list_approved_pending_posts` (K1) is what " +
        "actually publishes it once approved.",
      inputSchema: { id: z.string().describe("The `id` of the planned post, from `get_planned_post`.") },
    },
    async ({ id }) => {
      try {
        const approval = submitPlannedPostForApproval(id);
        if (!approval) {
          return errorResult(new Error("Planned post not found, or already submitted/approved/rejected/published - do not retry, skip like any other K9 case."));
        }
        return textResult(approval);
      } catch (error) {
        console.error("submit_planned_post_for_approval:", toToolMessage(error));
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
        "Each customer also has `dueNow` (boolean, Europe/Vienna time: true only when today is one of " +
        "their posting days per `frequency`, their `postTime` has passed, and nothing has been posted for " +
        "them yet today) and `nextPostAt` (ISO timestamp of their next planned slot). Only generate/publish " +
        "for a customer when `dueNow` is true - do not post for customers where it is false, even if you " +
        "are running anyway; that is what makes each customer's own posting rhythm actually work. " +
        "Each customer also has `igFeedEnabled`/`igStoryEnabled`/`linkedinEnabled` (booleans - skip a " +
        "format/channel that is false; the publish tools refuse it anyway, but check first to avoid a wasted " +
        "generation) and caption style preferences `hashtagPreference` (keine/wenige/viele), `emojisEnabled` " +
        "(boolean), and `language` (de/en) - write the caption to match these. " +
        "Each customer also has `contentPillars` (array of {title, description, weight} - recurring content " +
        "themes the customer defined, e.g. \"Tipps\", \"Hinter den Kulissen\") and `suggestedPillar` (one pillar " +
        "from that array, or null): if `suggestedPillar` is not null, base this post's topic/headline/caption on " +
        "that pillar's title+description instead of guessing from `about`; pass its exact `title` as the " +
        "`pillar_title` argument on the publish tool so future picks keep rotating pillars instead of repeating. " +
        "If `suggestedPillar` is null (customer has no pillars configured), fall back to `about` as before and " +
        "omit `pillar_title`. " +
        "Each customer also has `bannedWords` (comma-separated string, or null) - words that are HARD-blocked: " +
        "the publish tools will refuse (with a clear error naming the word) any caption/headline containing one " +
        "of them, even if this looks fine to you. Check `bannedWords` yourself before writing the caption so you " +
        "avoid them proactively; if a publish call still fails with a banned-word error, rewrite the caption " +
        "without that word and retry once rather than giving up on the customer for this run. This is separate " +
        "from `avoidTopics`, which is only a soft style hint. " +
        "Each customer also has `requiredElements` (comma-separated string, or null) - elements that MUST appear " +
        "somewhere across the headline+caption combined (e.g. a mandatory hashtag or handle), or the publish " +
        "tools refuse with a clear error naming what's missing. Include every required element yourself before " +
        "publishing; on a missing-element error, add it and retry once rather than giving up. " +
        "Each customer also has `approvalMode` (boolean) - when true, NEVER call a publish_* tool for them " +
        "directly; call `save_pending_approval` instead so they can review it first (see that tool's " +
        "description), and separately check `list_approved_pending_posts` each run for posts they already " +
        "approved that are ready to actually publish. " +
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
  const { generated: adminPasswordGenerated } = ensureAdminPassword();

  let port: number;
  try {
    port = getConfig().port;
  } catch (error) {
    console.error(toToolMessage(error));
    process.exit(1);
  }

  const app = createHttpApp(createServer);
  startTokenRefreshSchedule();
  startDailyPlanningSchedule();
  startTrialEndingEmailSchedule();
  startDailyAnalyticsSnapshotSchedule();
  startWeeklyAnalyticsSummarySchedule();
  // Panel v10: eigenständiger Cron, bewusst nicht Teil der stündlichen Posting-Routine (siehe
  // comments.ts).
  startCommentAutomationSchedule();
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
    if (adminPasswordGenerated) {
      // Deliberately not logging the password value itself - check .env for it.
      console.error("Generated new PANEL_ADMIN_PASSWORD and saved it to .env (value not logged - check .env).");
    }
  });
}

main().catch((error: unknown) => {
  console.error(toToolMessage(error));
  process.exit(1);
});
