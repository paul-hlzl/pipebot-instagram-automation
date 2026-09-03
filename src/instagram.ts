import axios, { type AxiosInstance } from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";
import { withRetry } from "./retry.js";

const GRAPH_BASE = "https://graph.instagram.com/v21.0";
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 60_000;

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

function tokenParams(): { access_token: string } {
  return { access_token: getConfig().igAccessToken };
}

/** Prefer the account bound to the token (`/me`) so a mistyped IG_USER_ID does not break calls. */
async function resolveIgUserId(): Promise<string> {
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

export async function getPublishingLimit(): Promise<PublishingLimit> {
  const igUserId = await resolveIgUserId();
  const { data } = await client().get<GraphLimitResponse>(
    `${GRAPH_BASE}/${igUserId}/content_publishing_limit`,
    {
      params: {
        ...tokenParams(),
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

export async function assertPublishingQuota(): Promise<PublishingLimit> {
  const limit = await getPublishingLimit();
  if (limit.remaining <= 0 || limit.quotaUsage >= limit.quotaTotal) {
    throw new ToolError(
      `Publishing-Limit erreicht: ${limit.quotaUsage}/${limit.quotaTotal} Posts im rollierenden ${Math.round(limit.quotaDuration / 3600)}h-Fenster. ` +
        "Warte, bis wieder Kapazität frei ist (max. 25 API-Posts/24h je nach Kontingent der API).",
    );
  }
  return limit;
}

async function createMediaContainer(imageUrl: string, caption: string): Promise<string> {
  const igUserId = await resolveIgUserId();
  const { data } = await client().post<GraphIdResponse>(
    `${GRAPH_BASE}/${igUserId}/media`,
    null,
    {
      params: {
        ...tokenParams(),
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

async function getContainerStatus(containerId: string): Promise<string> {
  const { data } = await client().get<GraphStatusResponse>(`${GRAPH_BASE}/${containerId}`, {
    params: {
      ...tokenParams(),
      fields: "status_code",
    },
  });
  return (data.status_code ?? "").toUpperCase();
}

async function waitForContainer(containerId: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const status = await getContainerStatus(containerId);

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

async function publishContainer(containerId: string): Promise<string> {
  const igUserId = await resolveIgUserId();
  const { data } = await client().post<GraphIdResponse>(
    `${GRAPH_BASE}/${igUserId}/media_publish`,
    null,
    {
      params: {
        ...tokenParams(),
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
): Promise<PublishResult> {
  await assertPublishingQuota();

  return withRetry(
    async () => {
      const containerId = await createMediaContainer(imageUrl, caption);
      await waitForContainer(containerId);
      const postId = await publishContainer(containerId);
      return { postId, containerId, hostedImageUrl: imageUrl };
    },
    2,
    "Instagram publish",
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
