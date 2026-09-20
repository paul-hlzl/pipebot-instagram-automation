import axios, { type AxiosInstance } from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";
import { withRetry } from "./retry.js";
import { checkRecentDuplicate, writeLastPost } from "./dedupe.js";

const GRAPH_BASE = "https://graph.instagram.com/v21.0";
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 60_000;
/** Video braucht mehr Geduld als ein Bild - Instagram transkodiert jedes Reel erst (siehe createReelContainer). */
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_POLL_TIMEOUT_MS = 300_000;

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

export interface TokenCheckResult {
  valid: boolean;
  reason?: string;
  username?: string;
}

/**
 * Nachtrag 3 (18.09.2026, Einstellungsgruppe "Verknüpfungen"): echter Live-Check gegen Instagram
 * selbst, statt sich nur auf den gespeicherten Ablaufzeitpunkt zu verlassen (der sagt nichts
 * darüber, ob der Kunde die Freigabe zwischenzeitlich bei Instagram selbst entzogen hat). Gleiche
 * Form wie checkLinkedInToken (linkedin.ts) - dort ist es der bereits bestehende tägliche
 * Health-Check, hier neu ergänzt, weil es bisher kein Instagram-Äquivalent gab.
 */
export async function checkInstagramToken(creds: InstagramCredentials): Promise<TokenCheckResult> {
  try {
    const { data } = await client().get<{ username?: string }>(`${GRAPH_BASE}/me`, {
      params: { access_token: creds.accessToken, fields: "username" },
    });
    return { valid: true, username: data.username };
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status === 401 || status === 400) return { valid: false, reason: "Token abgelaufen oder widerrufen" };
    return { valid: false, reason: err instanceof Error ? err.message : String(err) };
  }
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
  /** Beitrags-ID bei Instagram - gebraucht, um nach einer Fehlerantwort nachzusehen (siehe
   *  veroeffentlicheEinmal). Aeltere Aufrufer benutzen nur caption/timestamp. */
  id: string | null;
  caption: string | null;
  mediaType: string;
  timestamp: string;
}

interface GraphMediaResponse {
  data?: { id?: string; caption?: string; media_type?: string; timestamp?: string }[];
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
        params: { ...tokenParams(creds), fields: "id,caption,media_type,timestamp", limit },
      }),
    2,
    "Instagram media",
  );
  return (data.data ?? []).map((m) => ({
    id: m.id ?? null,
    caption: m.caption ?? null,
    mediaType: m.media_type ?? "IMAGE",
    timestamp: m.timestamp ?? "",
  }));
}

/**
 * Veroeffentlicht genau EINMAL - und sieht bei einer Fehlerantwort nach, ob es trotzdem
 * draussen ist (20.09.2026).
 *
 * Der Vorfall: `publishImageToInstagram` hatte Container anlegen, warten UND veroeffentlichen
 * zusammen in `withRetry(..., 2)`. Instagram antwortete auf `media_publish` mit 403
 * ("We restrict certain activity to protect our community", code 4/2207051), hatte den Beitrag
 * aber veroeffentlicht. Der Wiederholungsversuch legte einen ZWEITEN Container an und postete
 * ein zweites Mal - zwei identische Beitraege im Feed eines echten Kunden, und weil beide
 * Versuche fuer uns wie ein Fehlschlag aussahen, wurde nichts protokolliert und die Freigabe
 * blieb offen (der naechste Lauf haette einen dritten gepostet).
 *
 * Daraus zwei Regeln, die hier zusammenkommen:
 *   1. Wiederholt wird nur, was wiederholbar IST - Container anlegen und auf ihn warten. Ein
 *      unveroeffentlichter Container verfaellt von selbst, er kostet nichts.
 *   2. `media_publish` laeuft genau einmal. Geht es schief, wird nicht noch einmal gepostet,
 *      sondern NACHGESEHEN: steht der Beitrag mit genau diesem Text in den letzten Beitraegen
 *      des Kontos, war die Fehlerantwort gelogen und wir melden Erfolg (samt ID, damit er
 *      protokolliert wird). Nur wenn wirklich nichts da ist, fliegt der Fehler weiter.
 */
export async function veroeffentlicheEinmal(schritte: {
  vorbereiten: () => Promise<string>;
  posten: (containerId: string) => Promise<string>;
  nachsehen: () => Promise<string | null>;
  label: string;
}): Promise<{ postId: string; containerId: string; nachtraeglichGefunden: boolean }> {
  const containerId = await withRetry(schritte.vorbereiten, 2, `${schritte.label} (Container)`);
  try {
    const postId = await schritte.posten(containerId);
    return { postId, containerId, nachtraeglichGefunden: false };
  } catch (fehler) {
    let gefunden: string | null = null;
    try {
      gefunden = await schritte.nachsehen();
    } catch (nachschauFehler) {
      console.error(`${schritte.label}: Nachsehen nach dem Fehlschlag nicht moeglich:`, nachschauFehler instanceof Error ? nachschauFehler.message : nachschauFehler);
    }
    if (gefunden) {
      console.error(`${schritte.label}: Fehlerantwort beim Veroeffentlichen, der Beitrag ist aber draussen (${gefunden}) - KEIN zweiter Versuch.`);
      return { postId: gefunden, containerId, nachtraeglichGefunden: true };
    }
    throw fehler;
  }
}

/** Steht ein Beitrag mit genau diesem Text in den letzten Beitraegen des Kontos? */
async function findeVeroeffentlichten(caption: string, creds: InstagramCredentials | undefined, seitMs: number): Promise<string | null> {
  if (!creds) return null;
  const letzte = await getRecentMedia(creds, 5);
  const treffer = letzte.find((m) => (m.caption ?? "") === caption && Date.parse(m.timestamp || "") >= seitMs - 120_000);
  return treffer?.id ?? null;
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

  const begonnen = Date.now();
  const einmal = await veroeffentlicheEinmal({
    vorbereiten: async () => {
      const containerId = await createMediaContainer(imageUrl, caption, creds);
      await waitForContainer(containerId, creds);
      return containerId;
    },
    posten: (containerId) => publishContainer(containerId, creds),
    nachsehen: () => findeVeroeffentlichten(caption, creds, begonnen),
    label: "Instagram publish",
  });
  const result = { postId: einmal.postId, containerId: einmal.containerId, hostedImageUrl: imageUrl };

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

  const begonnen = Date.now();
  let childContainerIds: string[] = [];
  const einmal = await veroeffentlicheEinmal({
    vorbereiten: async () => {
      childContainerIds = [];
      for (const imageUrl of imageUrls) {
        const childId = await createCarouselChildContainer(imageUrl, creds);
        await waitForContainer(childId, creds);
        childContainerIds.push(childId);
      }
      const containerId = await createCarouselContainer(childContainerIds, caption, creds);
      await waitForContainer(containerId, creds);
      return containerId;
    },
    posten: (containerId) => publishContainer(containerId, creds),
    nachsehen: () => findeVeroeffentlichten(caption, creds, begonnen),
    label: "Instagram carousel publish",
  });
  const result = { postId: einmal.postId, containerId: einmal.containerId, hostedImageUrl: imageUrls[0], childContainerIds };

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
/**
 * Reels-Container (Video-Diashow). Drei Unterschiede zu Bildern, die alle aus Metas
 * Content-Publishing-Doku stammen und hier bewusst ausgeschrieben sind:
 *   - `media_type: REELS` + `video_url` statt `image_url`; Reels sind der einzige Weg, ein Video
 *     in den Feed zu bekommen (ein eigener "VIDEO"-Typ existiert für den Feed nicht mehr).
 *   - Die Verarbeitung dauert deutlich länger als bei einem Bild (Instagram transkodiert das
 *     Video), deshalb das großzügigere Polling unten statt der 60-Sekunden-Grenze für Bilder.
 *   - `share_to_feed` sorgt dafür, dass das Reel auch im normalen Feed/Profilraster auftaucht
 *     und nicht nur im Reels-Tab - für einen Unternehmensaccount ist das der Normalfall.
 */
async function createReelContainer(videoUrl: string, caption: string, creds?: InstagramCredentials): Promise<string> {
  const igUserId = await resolveIgUserId(creds);
  const { data } = await client().post<GraphIdResponse>(
    `${GRAPH_BASE}/${igUserId}/media`,
    null,
    {
      params: {
        ...tokenParams(creds),
        media_type: "REELS",
        video_url: videoUrl,
        caption,
        share_to_feed: true,
      },
    },
  );
  if (!data.id) {
    throw new ToolError("Instagram hat keinen Reels-Container angelegt (keine ID in der Antwort).");
  }
  return data.id;
}

/** Wie waitForContainer, nur mit einem Zeitfenster, das zur Video-Transkodierung passt (siehe
 *  createReelContainer). Eigene Funktion statt eines Parameters an waitForContainer, damit der
 *  Bild-Pfad unveraendert bleibt und niemand versehentlich 5 Minuten auf ein kaputtes Bild wartet. */
async function waitForVideoContainer(containerId: string, creds?: InstagramCredentials): Promise<void> {
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await getContainerStatus(containerId, creds);
    if (status === "FINISHED") return;
    if (status === "ERROR") {
      throw new ToolError(
        `Reels-Container ${containerId} ist im Status ERROR. Video-URL, Format (MP4/H.264/AAC, 9:16) und oeffentliche Erreichbarkeit pruefen.`,
      );
    }
    if (status === "EXPIRED") {
      throw new ToolError(`Reels-Container ${containerId} ist EXPIRED (nicht innerhalb von 24h veroeffentlicht).`);
    }
    await sleep(VIDEO_POLL_INTERVAL_MS);
  }
  throw new ToolError(
    `Timeout: Reels-Container ${containerId} wurde innerhalb von ${VIDEO_POLL_TIMEOUT_MS / 1000}s nicht FINISHED - Instagram verarbeitet das Video noch oder es ist etwas schiefgelaufen.`,
  );
}

/** Veroeffentlicht ein fertig gerendertes Video als Reel. `videoUrl` muss oeffentlich erreichbar
 *  sein (R2-Bucket, siehe r2.ts's uploadVideoBuffer). */
export async function publishReelToInstagram(
  videoUrl: string,
  caption: string,
  creds?: InstagramCredentials,
  customerId?: string,
): Promise<PublishResult> {
  const duplicateWarning = checkRecentDuplicate(customerId);
  await assertPublishingQuota(creds);

  const begonnen = Date.now();
  const einmal = await veroeffentlicheEinmal({
    vorbereiten: async () => {
      const containerId = await createReelContainer(videoUrl, caption, creds);
      await waitForVideoContainer(containerId, creds);
      return containerId;
    },
    posten: (containerId) => publishContainer(containerId, creds),
    nachsehen: () => findeVeroeffentlichten(caption, creds, begonnen),
    label: "Instagram Reel publish",
  });
  const result = { postId: einmal.postId, containerId: einmal.containerId, hostedImageUrl: videoUrl };

  writeLastPost({ timestamp: new Date().toISOString(), postId: result.postId, caption }, customerId);
  return duplicateWarning ? { ...result, warning: duplicateWarning } : result;
}

export async function publishStoryToInstagram(
  imageUrl: string,
  creds?: InstagramCredentials,
): Promise<PublishResult> {
  await assertPublishingQuota(creds);

  // Stories stehen nicht in der /media-Liste, hier laesst sich nichts nachsehen. Der zweite
  // Versuch entfaellt trotzdem: lieber eine Story zu wenig als zwei identische im Kanal.
  const einmal = await veroeffentlicheEinmal({
    vorbereiten: async () => {
      const containerId = await createStoryMediaContainer(imageUrl, creds);
      await waitForContainer(containerId, creds);
      return containerId;
    },
    posten: (containerId) => publishContainer(containerId, creds),
    nachsehen: async () => null,
    label: "Instagram story publish",
  });
  return { postId: einmal.postId, containerId: einmal.containerId, hostedImageUrl: imageUrl };
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
