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

/**
 * Own account (no customerId) keeps using last_post.json as before. Each customer gets
 * their own last_post-<customerId>.json, so one customer's post is never mistaken for a
 * duplicate of another customer's (or the owner's) post.
 */
function lastPostPath(customerId?: string): string {
  if (!customerId) return LAST_POST_PATH;
  const safe = customerId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(PACKAGE_ROOT, `last_post-${safe}.json`);
}

function readLastPost(customerId?: string): LastPost | undefined {
  try {
    const raw = fs.readFileSync(lastPostPath(customerId), "utf8");
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
export function writeLastPost(entry: LastPost, customerId?: string): void {
  try {
    fs.writeFileSync(lastPostPath(customerId), JSON.stringify(entry, null, 2), "utf8");
  } catch (error) {
    console.error(`dedupe: failed to write ${lastPostPath(customerId)}:`, error);
  }
}

/**
 * Soft duplicate-protection: if the last successful publish was less than 60
 * minutes ago, return a warning string to surface in the tool result. This
 * never blocks the publish itself - the caller (Claude, in an automated
 * routine or a manual chat) decides whether to proceed.
 */
export function checkRecentDuplicate(customerId?: string): string | undefined {
  const last = readLastPost(customerId);
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
