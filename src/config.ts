import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Package root whether this file runs from `src/` (tsx) or `dist/` (compiled). */
export const PACKAGE_ROOT = path.resolve(here, "..");
export const ENV_PATH = path.join(PACKAGE_ROOT, ".env");

loadDotenv({ path: ENV_PATH, quiet: true });

export interface AppConfig {
  igUserId: string;
  igAccessToken: string;
  igAppId: string;
  igAppSecret: string;
  mediaBucketUrl: string;
  mediaEndpoint: string;
  mediaAccessKey: string;
  mediaSecretKey: string;
  mediaBucketName: string;
  falApiKey: string;
  port: number;
  mcpAuthToken: string;
}

function parsePort(): number {
  const raw = process.env.PORT?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3000;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Read config from process.env on every call so a refreshed token is picked up.
 * Access-key whitespace is stripped (the provided R2 key contained a space).
 */
export function getConfig(): AppConfig {
  return {
    igUserId: required("IG_USER_ID"),
    igAccessToken: required("IG_ACCESS_TOKEN"),
    igAppId: process.env.IG_APP_ID?.trim() ?? "",
    igAppSecret: process.env.IG_APP_SECRET?.trim() ?? "",
    mediaBucketUrl: required("MEDIA_STORAGE_BUCKET_URL").replace(/\/$/, ""),
    mediaEndpoint: required("MEDIA_STORAGE_ENDPOINT").replace(/\/$/, ""),
    mediaAccessKey: required("MEDIA_STORAGE_ACCESS_KEY").replace(/\s+/g, ""),
    mediaSecretKey: required("MEDIA_STORAGE_SECRET_KEY").replace(/\s+/g, ""),
    mediaBucketName: required("MEDIA_STORAGE_BUCKET_NAME"),
    falApiKey: required("FAL_API_KEY"),
    port: parsePort(),
    mcpAuthToken: required("MCP_AUTH_TOKEN"),
  };
}
