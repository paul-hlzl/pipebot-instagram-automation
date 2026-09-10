import fs from "node:fs";
import crypto from "node:crypto";
import { ENV_PATH } from "./config.js";

/** Replace or append IG_ACCESS_TOKEN in the local .env and update process.env. */
export function writeAccessToken(newToken: string): void {
  let contents: string;
  try {
    contents = fs.readFileSync(ENV_PATH, "utf8");
  } catch {
    throw new Error(`Die .env-Datei konnte nicht gelesen werden: ${ENV_PATH}`);
  }

  const line = `IG_ACCESS_TOKEN=${newToken}`;
  if (/^IG_ACCESS_TOKEN=/m.test(contents)) {
    contents = contents.replace(/^IG_ACCESS_TOKEN=[^\r\n]*/m, line);
  } else {
    contents = `${contents.trimEnd()}\n${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, contents, "utf8");
  process.env.IG_ACCESS_TOKEN = newToken;
}

function setEnvLine(contents: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=[^\\r\\n]*`, "m");
  return pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
}

/** Replace or append LINKEDIN_ACCESS_TOKEN / LINKEDIN_REFRESH_TOKEN in the local .env and update process.env. */
export function writeLinkedInTokens(accessToken: string, refreshToken: string): void {
  let contents: string;
  try {
    contents = fs.readFileSync(ENV_PATH, "utf8");
  } catch {
    throw new Error(`Die .env-Datei konnte nicht gelesen werden: ${ENV_PATH}`);
  }

  contents = setEnvLine(contents, "LINKEDIN_ACCESS_TOKEN", accessToken);
  contents = setEnvLine(contents, "LINKEDIN_REFRESH_TOKEN", refreshToken);

  fs.writeFileSync(ENV_PATH, contents, "utf8");
  process.env.LINKEDIN_ACCESS_TOKEN = accessToken;
  process.env.LINKEDIN_REFRESH_TOKEN = refreshToken;
}

/**
 * Return the configured MCP_AUTH_TOKEN, generating and persisting a new random
 * one to the local .env if none is set yet.
 */
export function ensureAuthToken(): { token: string; generated: boolean } {
  const existing = process.env.MCP_AUTH_TOKEN?.trim();
  if (existing) {
    return { token: existing, generated: false };
  }

  const token = crypto.randomBytes(32).toString("hex");
  const line = `MCP_AUTH_TOKEN=${token}`;

  let contents: string;
  try {
    contents = fs.readFileSync(ENV_PATH, "utf8");
  } catch {
    contents = "";
  }

  if (/^MCP_AUTH_TOKEN=/m.test(contents)) {
    contents = contents.replace(/^MCP_AUTH_TOKEN=[^\r\n]*/m, line);
  } else {
    contents = `${contents.trimEnd()}\n${line}\n`.trimStart();
  }

  fs.writeFileSync(ENV_PATH, contents, "utf8");
  process.env.MCP_AUTH_TOKEN = token;
  return { token, generated: true };
}
