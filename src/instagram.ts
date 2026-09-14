import axios, { type AxiosInstance } from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";
import { withRetry } from "./retry.js";
import { checkRecentDuplicate, writeLastPost } from "./dedupe.js";

const GRAPH_BASE = "https://graph.instagram.com/v21.0";
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 60_000;

/** Overrides the .env-configured account. Passed through from a tool's optional `customer_id`. */
export interface InstagramCredentials {
  accessToken: string;
  igUserId: string;
}

export interface PublishingLimit {
  quotaUsage: number;
  quotaTotal: number;
  quotaDuration: number;
  remaining: number;
}

export interface PublishResult {
  postId: string;
  containerId: string;
  hostedImageUrl: string;
  warning?: string;
}

interface GraphLimitResponse {
  data?: Array<{
    quota_usage?: number;
    config?: {
      quota_total?: number;
      quota_duration?: number;
    };
  }>;
}

interface GraphIdResponse {
  id?: string;
}

interface GraphStatusResponse {
  status_code?: string;
  status?: string;
}

interface RefreshResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

function client(): AxiosInstance {
  return axios.create({
    timeout: 30_000,
    validateStatus: (status) => status >= 200 && status < 300,
  });
}

let cachedUserId: string | undefined;

function tokenParams(creds?: InstagramCredentials): { access_token: string } {
  return { access_token: creds?.accessToken ?? getConfig().igAccessToken };
}

/**
 * Prefer the account bound to the token (`/me`) so a mistyped IG_USER_ID does not break calls.
 * For a customer account, the ig-user-id is already known from `getCredentials()` (it's the
 * `accountId` stored at connect time) - use it directly, no lookup or caching needed.
 */
async function resolveIgUserId(creds?: InstagramCredentials): Promise<string> {
  if (creds) {
    return creds.igUserId;
  }

  if (cachedUserId) {
    return cachedUserId;
  }

  try {
    const { data } = await client().get<{ id?: string }>(`${GRAPH_BASE}/me`, {
      params: { ...tokenParams(), fields: "id" },
    });
    if (data.id) {
      cachedUserId = data.id;
      return cachedUserId;
    }
  } catch {
    // Fall back to IG_USER_ID from env.
  }

  cachedUserId = getConfig().igUserId;
  return cachedUserId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getPublishingLimit(creds?: InstagramCredentials): Promise<PublishingLimit> {
  const igUserId = await resolveIgUserId(creds);
  const { data } = await client().get<GraphLimitResponse>(
    `${GRAPH_BASE}/${igUserId}/content_publishing_limit`,
    {
      params: {
        ...tokenParams(creds),
        fields: "quota_usage,config",
      },
    },
  );

  const row = data.data?.[0];
  const quotaUsage = row?.quota_usage ?? 0;
  const quotaTotal = row?.config?.quota_total ?? 25;
  const quotaDuration = row?.config?.quota_duration ?? 86400;

  return {
    quotaUsage,
    quotaTotal,
    quotaDuration,
    remaining: Math.max(0, quotaTotal - quotaUsage),
  };
}

export interface MediaSample {
  caption: string | null;
  mediaType: string;
  timestamp: string;
}

interface GraphMediaResponse {
  data?: { caption?: string; media_type?: string; timestamp?: string }[];
}

/**
 * Read-only: the account's own most recent posts (caption, media type, date) via the
 * `/media` edge - only fields covered by the `instagram_business_basic` scope, nothing that
 * needs `instagram_business_content_publish`. Never publishes or modifies anything.
 */
export async function getRecentMedia(creds: InstagramCredentials, limit = 10): Promise<MediaSample[]> {
  const igUserId = await resolveIgUserId(creds);
  const { data } = await withRetry(
    () =>
      client().get<GraphMediaResponse>(`${GRAPH_BASE}/${igUserId}/media`, {
        params: { ...tokenParams(creds), fields: "caption,media_type,timestamp", limit },
      }),
    2,
    "Instagram media",
  );
  return (data.data ?? []).map((m) => ({
    caption: m.caption ?? null,
    mediaType: m.media_type ?? "IMAGE",
    timestamp: m.timestamp ?? "",
  }));
}

export async function assertPublishingQuota(creds?: InstagramCredentials): Promise<PublishingLimit> {
  const limit = await getPublishingLimit(creds);
  if (limit.remaining <= 0 || limit.quotaUsage >= limit.quotaTotal) {
    throw new ToolError(
      `Publishing-Limit erreicht: ${limit.quotaUsage}/${limit.quotaTotal} Posts im rollierenden ${Math.round(limit.quotaDuration / 3600)}h-Fenster. ` +
        "Warte, bis wieder Kapazität frei ist (max. 25 API-Posts/24h je nach Kontingent der API).",
    );
  }
  return limit;
}

async function createMediaContainer(
  imageUrl: string,
  caption: string,
  creds?: InstagramCredentials,
): Promise<string> {
  const igUserId = await resolveIgUserId(creds);
  const { data } = await client().post<GraphIdResponse>(
    `${GRAPH_BASE}/${igUserId}/media`,
    null,
    {
      params: {
        ...tokenParams(creds),
        image_url: imageUrl,
        caption,
      },
    },
  );

  if (!data.id) {
    throw new ToolError("Instagram hat keinen Container angelegt (keine ID in der Antwort).");
  }
  return data.id;
}

/**
 * Stories use the same /media container endpoint as feed posts, just with
 * media_type=STORIES and no caption param - the Graph API does not support a caption,
 * alt_text, tags, or location on a Stories container (confirmed against Meta's Content
 * Publishing docs, 2026-09). The container/poll/publish machinery below (waitForContainer,
 * publishContainer) is shared as-is: status polling and media_publish behave identically
 * regardless of media_type.
 */
async function createStoryMediaContainer(imageUrl: string, creds?: InstagramCredentials): Promise<string> {
  const igUserId = await resolveIgUserId(creds);
  const { data } = await client().post<GraphIdResponse>(
    `${GRAPH_BASE}/${igUserId}/media`,
    null,
    {
      params: {
        ...tokenParams(creds),
        media_type: "STORIES",
        image_url: imageUrl,
      },
    },
  );

  if (!data.id) {
    throw new ToolError("Instagram hat keinen Story-Container angelegt (keine ID in der Antwort).");
  }
  return data.id;
}

/**
 * Panel v14: ein einzelner Karussell-Slide-Container (Kind-Container) - `is_carousel_item: true`
 * ist der einzige Unterschied zu einem normalen Feed-Container, siehe createMediaContainer oben.
 * KEINE eigene Caption pro Slide - Instagram erlaubt Captions nur auf dem Karussell-Container
 * selbst (bestaetigt gegen die aktuelle Meta Content-Publishing-Doku, 2026-09), die inhaltliche
 * Sequenz der Slides steckt stattdessen in den ins Bild eingebrannten Text-Overlays.
 */
async function createCarouselChildContainer(imageUrl: string, creds?: InstagramCredentials): Promise<string> {
  const igUserId = await resolveIgUserId(creds);
  const { data } = await client().post<GraphIdResponse>(
    `${GRAPH_BASE}/${igUserId}/media`,
    null,
    {
      params: {
        ...tokenParams(creds),
        image_url: imageUrl,
        is_carousel_item: true,
      },
    },
  );
  if (!data.id) {
    throw new ToolError("Instagram hat keinen Karussell-Kind-Container angelegt (keine ID in der Antwort).");
  }
  return data.id;
}

/** Der eigentliche Karussell-Container, der auf die bereits erstellten Kind-Container verweist -
 *  `children` ist eine kommagetrennte Liste von Container-IDs (Meta-Doku, max. 10). */
async function createCarouselContainer(childIds: string[], caption: string, creds?: InstagramCredentials): Promise<string> {
  const igUserId = await resolveIgUserId(creds);
  const { data } = await client().post<GraphIdResponse>(
    `${GRAPH_BASE}/${igUserId}/media`,
    null,
    {
      params: {
        ...tokenParams(creds),
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption,
      },
    },
  );
  if (!data.id) {
    throw new ToolError("Instagram hat keinen Karussell-Container angelegt (keine ID in der Antwort).");
  }
  return data.id;
}

async function getContainerStatus(containerId: string, creds?: InstagramCredentials): Promise<string> {
  const { data } = await client().get<GraphStatusResponse>(`${GRAPH_BASE}/${containerId}`, {
    params: {
      ...tokenParams(creds),
      fields: "status_code",
    },
  });
  return (data.status_code ?? "").toUpperCase();
}

async function waitForContainer(containerId: string, creds?: InstagramCredentials): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const status = await getContainerStatus(containerId, creds);

    if (status === "FINISHED") {
      return;
    }
    if (status === "ERROR") {
      throw new ToolError(
        `Media-Container ${containerId} ist im Status ERROR. ` +
          "Bild-URL, Format (JPEG/PNG) und öffentliche Erreichbarkeit prüfen.",
      );
    }
    if (status === "EXPIRED") {
      throw new ToolError(
        `Media-Container ${containerId} ist EXPIRED (nicht innerhalb von 24h veröffentlicht). Neuen Container anlegen.`,
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new ToolError(
    `Timeout: Container ${containerId} wurde innerhalb von 60s nicht FINISHED. ` +
      "Später erneut versuchen oder Bild-URL prüfen.",
  );
}

async function publishContainer(containerId: string, creds?: InstagramCredentials): Promise<string> {
  const igUserId = await resolveIgUserId(creds);
  const { data } = await client().post<GraphIdResponse>(
    `${GRAPH_BASE}/${igUserId}/media_publish`,
    null,
    {
      params: {
        ...tokenParams(creds),
        creation_id: containerId,
      },
    },
  );

  if (!data.id) {
    throw new ToolError("Instagram hat den Post nicht veröffentlicht (keine Post-ID in der Antwort).");
  }
  return data.id;
}

export async function publishImageToInstagram(
  imageUrl: string,
  caption: string,
  creds?: InstagramCredentials,
  customerId?: string,
): Promise<PublishResult> {
  // Soft duplicate check: never blocks, only surfaces a warning in the result
  // so the caller (Claude) can decide whether a repeat publish is intentional.
  // Kept per customer (see dedupe.ts) so different accounts never trigger each other's warning.
  const duplicateWarning = checkRecentDuplicate(customerId);

  await assertPublishingQuota(creds);

  const result = await withRetry(
    async () => {
      const containerId = await createMediaContainer(imageUrl, caption, creds);
      await waitForContainer(containerId, creds);
      const postId = await publishContainer(containerId, creds);
      return { postId, containerId, hostedImageUrl: imageUrl };
    },
    2,
    "Instagram publish",
  );

  writeLastPost({ timestamp: new Date().toISOString(), postId: result.postId, caption }, customerId);

  return duplicateWarning ? { ...result, warning: duplicateWarning } : result;
}

export const CAROUSEL_MIN_SLIDES = 3;
export const CAROUSEL_MAX_SLIDES = 7; // Meta erlaubt bis zu 10 - 7 ist unsere eigene, engere Produktgrenze (siehe Session-Bericht)

/**
 * Publishes a carousel (multiple images swiped through in one post). Each image becomes its own
 * child container first (is_carousel_item, no caption - see createCarouselChildContainer), then
 * one carousel container referencing all of them, then that gets published like any other
 * container. Every child container is waited-for individually before the carousel container is
 * created - Meta's own examples create the carousel container immediately after the children
 * return an id, but in practice an unprocessed child can make the carousel container itself fail,
 * so this waits for each child's own FINISHED status first (same safety margin as the existing
 * single-image flow, just once per slide).
 */
export async function publishCarouselToInstagram(
  imageUrls: string[],
  caption: string,
  creds?: InstagramCredentials,
  customerId?: string,
): Promise<PublishResult & { childContainerIds: string[] }> {
  if (imageUrls.length < CAROUSEL_MIN_SLIDES || imageUrls.length > CAROUSEL_MAX_SLIDES) {
    throw new ToolError(
      `Karussell braucht ${CAROUSEL_MIN_SLIDES}-${CAROUSEL_MAX_SLIDES} Bilder, bekommen: ${imageUrls.length}.`,
    );
  }

  const duplicateWarning = checkRecentDuplicate(customerId);
  await assertPublishingQuota(creds);

  const result = await withRetry(
    async () => {
      const childContainerIds: string[] = [];
      for (const imageUrl of imageUrls) {
        const childId = await createCarouselChildContainer(imageUrl, creds);
        await waitForContainer(childId, creds);
        childContainerIds.push(childId);
      }
      const containerId = await createCarouselContainer(childContainerIds, caption, creds);
      await waitForContainer(containerId, creds);
      const postId = await publishContainer(containerId, creds);
      return { postId, containerId, hostedImageUrl: imageUrls[0], childContainerIds };
    },
    2,
    "Instagram carousel publish",
  );

  writeLastPost({ timestamp: new Date().toISOString(), postId: result.postId, caption }, customerId);

  return duplicateWarning ? { ...result, warning: duplicateWarning } : result;
}

/**
 * Publishes a single Instagram Story. Shares the same publishing-limit quota as feed
 * posts (Meta's content_publishing_limit endpoint counts all media types - Reels, images,
 * carousels, and stories - toward the same rolling 100/24h cap; there is no separate
 * Stories-only quota), so `assertPublishingQuota` is reused as-is. Unlike feed posts,
 * Stories are intentionally NOT written to last_post.json / checked by
 * `checkRecentDuplicate` - that heuristic keys off caption text, which Stories don't have,
 * and Stories are expected to closely follow (and duplicate the visual of) the feed post
 * they accompany, so the "did we just post this?" warning would just be noise here.
 */
export async function publishStoryToInstagram(
  imageUrl: string,
  creds?: InstagramCredentials,
): Promise<PublishResult> {
  await assertPublishingQuota(creds);

  return withRetry(
    async () => {
      const containerId = await createStoryMediaContainer(imageUrl, creds);
      await waitForContainer(containerId, creds);
      const postId = await publishContainer(containerId, creds);
      return { postId, containerId, hostedImageUrl: imageUrl };
    },
    2,
    "Instagram story publish",
  );
}

export async function refreshAccessToken(): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const { igAccessToken } = getConfig();
  const { data } = await client().get<RefreshResponse>("https://graph.instagram.com/refresh_access_token", {
    params: {
      grant_type: "ig_refresh_token",
      access_token: igAccessToken,
    },
  });

  if (!data.access_token) {
    throw new ToolError(
      "Token-Refresh lieferte keinen neuen access_token. " +
        "Der Token muss mindestens 24 Stunden alt und noch gültig sein.",
    );
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 0,
  };
}
