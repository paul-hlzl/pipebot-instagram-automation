import { promises as fs } from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "./config.js";
import { ToolError } from "./errors.js";

const API = "https://api.linkedin.com";
const VERSION = "202508"; // LinkedIn-Versions-Header, ca. quartalsweise anheben

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/**
 * Read env lazily per call (not bundled into a single required config like
 * Instagram's getConfig()) so the rest of the server keeps working while
 * LINKEDIN_* is still empty, before the one-time OAuth flow has run.
 */
function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new ToolError(`Fehlende Umgebungsvariable: ${name}. In der .env setzen (siehe .env.example).`);
  }
  return value;
}

function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
    ...extra,
  };
}

// ---------------------------------------------------------------
// Token-Handling
// ---------------------------------------------------------------

export interface RefreshResult {
  accessToken: string;
  expiresInDays: number;
  refreshToken: string;
}

interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

/**
 * Access Token erneuern. LinkedIn: Access Token 2 Monate gültig,
 * Refresh Token 1 Jahr. Rechtzeitig laufen lassen, sonst ist ein
 * manueller OAuth-Durchlauf im Browser fällig.
 */
export async function refreshLinkedInToken(): Promise<RefreshResult> {
  const refreshToken = requiredEnv("LINKEDIN_REFRESH_TOKEN");
  const clientId = requiredEnv("LINKEDIN_CLIENT_ID");
  const clientSecret = requiredEnv("LINKEDIN_CLIENT_SECRET");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${API}/oauth/v2/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new ToolError(`LinkedIn Token-Refresh fehlgeschlagen (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as AccessTokenResponse;
  if (!data.access_token) {
    throw new ToolError("LinkedIn Token-Refresh lieferte keinen access_token in der Antwort.");
  }

  return {
    accessToken: data.access_token,
    expiresInDays: data.expires_in ? Math.round(data.expires_in / 86400) : 0,
    refreshToken: data.refresh_token ?? refreshToken,
  };
}

export interface TokenCheckResult {
  valid: boolean;
  reason?: string;
  sub?: string;
  name?: string;
}

interface UserInfoResponse {
  sub?: string;
  name?: string;
}

/** Prüft, ob das Token noch lebt – für den täglichen Health-Check. */
export async function checkLinkedInToken(): Promise<TokenCheckResult> {
  const accessToken = requiredEnv("LINKEDIN_ACCESS_TOKEN");
  const res = await fetch(`${API}/v2/userinfo`, {
    headers: headers(accessToken),
  });
  if (res.status === 401) return { valid: false, reason: "Token abgelaufen oder widerrufen" };
  if (!res.ok) return { valid: false, reason: `HTTP ${res.status}: ${await res.text()}` };
  const me = (await res.json()) as UserInfoResponse;
  return { valid: true, sub: me.sub, name: me.name };
}

// ---------------------------------------------------------------
// Bild-Upload (dreistufig, anders als bei Instagram)
// ---------------------------------------------------------------

interface InitUploadResponse {
  value: { uploadUrl: string; image: string };
}

/** Accepts a Buffer, a public http(s) URL, or a local file path. */
async function resolveImageBytes(imageSource: string | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(imageSource)) {
    return imageSource;
  }
  if (/^https?:\/\//i.test(imageSource)) {
    const res = await fetch(imageSource);
    if (!res.ok) {
      throw new ToolError(`Bild-URL nicht erreichbar (${res.status}): ${imageSource}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFile(path.resolve(imageSource));
}

/**
 * 1. Upload-URL registrieren
 * 2. Bytes per PUT hochladen
 * 3. Image-URN zurückgeben, die dann im Post referenziert wird
 */
export async function uploadLinkedInImage(imageSource: string | Buffer): Promise<string> {
  const accessToken = requiredEnv("LINKEDIN_ACCESS_TOKEN");
  const owner = requiredEnv("LINKEDIN_PERSON_URN");

  // Schritt 1
  const initRes = await fetch(`${API}/rest/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });

  if (!initRes.ok) {
    throw new ToolError(`LinkedIn Image-Init fehlgeschlagen (${initRes.status}): ${await initRes.text()}`);
  }

  const { value } = (await initRes.json()) as InitUploadResponse;
  const { uploadUrl, image: imageUrn } = value;

  // Schritt 2
  const bytes = await resolveImageBytes(imageSource);

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(bytes),
  });

  if (!putRes.ok) {
    throw new ToolError(`LinkedIn Image-Upload fehlgeschlagen (${putRes.status}): ${await putRes.text()}`);
  }

  // Schritt 3
  return imageUrn;
}

// ---------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------

export interface PublishResult {
  postId: string | null;
  url: string | null;
}

/**
 * Post veröffentlichen. Ohne imageUrn wird ein reiner Textpost erzeugt.
 *
 * Achtung: @-Erwähnungen werden von der API als Plaintext gerendert,
 * also gar nicht erst versuchen. Ebenso keine Artikel (Langform) –
 * die gehen nur über das Web-Interface.
 */
export async function publishLinkedInPost({
  text,
  imageUrn = null,
  altText = "",
}: {
  text: string;
  imageUrn?: string | null;
  altText?: string;
}): Promise<PublishResult> {
  const accessToken = requiredEnv("LINKEDIN_ACCESS_TOKEN");
  const author = requiredEnv("LINKEDIN_PERSON_URN");

  const payload: Record<string, unknown> = {
    author,
    commentary: text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (imageUrn) {
    payload.content = { media: { id: imageUrn, altText } };
  }

  const res = await fetch(`${API}/rest/posts`, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    // 403 ist bei LinkedIn fast immer entweder ein fehlender Scope oder eine
    // fehlende Rolle – die Meldung selbst sagt das nicht.
    throw new ToolError(`LinkedIn Post fehlgeschlagen (${res.status}): ${detail}`);
  }

  const postId = res.headers.get("x-restli-id");
  return {
    postId,
    url: postId ? `https://www.linkedin.com/feed/update/${postId}/` : null,
  };
}

/** Kompletter Durchlauf: Bild hochladen und posten. */
export async function publishLinkedInImagePost({
  text,
  imageSource,
  altText,
}: {
  text: string;
  imageSource: string | Buffer;
  altText?: string;
}): Promise<PublishResult> {
  const imageUrn = await uploadLinkedInImage(imageSource);
  return publishLinkedInPost({ text, imageUrn, altText });
}

// ---------------------------------------------------------------
// Dubletten-Log
// ---------------------------------------------------------------

const LOG_PATH = path.join(PACKAGE_ROOT, "posted-linkedin.txt");

export async function readPostedLinkedIn(days = 30): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(LOG_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const cutoff = Date.now() - days * 86_400_000;
  return raw
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      const stamp = Date.parse(line.slice(0, 10));
      return Number.isNaN(stamp) ? true : stamp >= cutoff;
    });
}

export async function appendPostedLinkedIn(kategorie: string, hook: string): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `${stamp} | ${kategorie} | ${hook.replace(/\n/g, " ").slice(0, 120)}\n`;
  await fs.appendFile(LOG_PATH, line, "utf8");
}
