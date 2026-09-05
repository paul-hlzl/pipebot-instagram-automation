import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "./config.js";

const LAST_POST_PATH = path.join(PACKAGE_ROOT, "last_post.json");
const DUPLICATE_WINDOW_MS = 60 * 60 * 1000;

export interface LastPost {
  timestamp: string;
  postId: string;
  caption: string;
}

function readLastPost(): LastPost | undefined {
  try {
    const raw = fs.readFileSync(LAST_POST_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<LastPost>;
    if (typeof parsed.timestamp === "string" && typeof parsed.postId === "string") {
      return parsed as LastPost;
    }
  } catch {
    // No previous post recorded yet, or the file is missing/corrupt - treat as "no recent post".
  }
  return undefined;
}

/** Best-effort; a write failure must never block an otherwise-successful publish. */
export function writeLastPost(entry: LastPost): void {
  try {
    fs.writeFileSync(LAST_POST_PATH, JSON.stringify(entry, null, 2), "utf8");
  } catch (error) {
    console.error("dedupe: failed to write last_post.json:", error);
  }
}

/**
 * Soft duplicate-protection: if the last successful publish was less than 60
 * minutes ago, return a warning string to surface in the tool result. This
 * never blocks the publish itself - the caller (Claude, in an automated
 * routine or a manual chat) decides whether to proceed.
 */
export function checkRecentDuplicate(): string | undefined {
  const last = readLastPost();
  if (!last) {
    return undefined;
  }

  const lastTime = Date.parse(last.timestamp);
  if (Number.isNaN(lastTime)) {
    return undefined;
  }

  const ageMs = Date.now() - lastTime;
  if (ageMs >= DUPLICATE_WINDOW_MS) {
    return undefined;
  }

  const ageMinutes = Math.max(0, Math.round(ageMs / 60_000));
  return (
    `Ein Post wurde bereits vor ${ageMinutes} Minute(n) veröffentlicht (postId: ${last.postId}). ` +
    "Trotzdem fortfahren? Falls dies ein Retry nach einem vermeintlich fehlgeschlagenen Publish-Call ist, " +
    "war der vorherige Versuch wahrscheinlich bereits erfolgreich - nicht einfach automatisch erneut posten."
  );
}
