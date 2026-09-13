import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.PANEL_DB_PATH ?? path.resolve(process.cwd(), "data/panel.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db: Database.Database = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  website TEXT,
  industry TEXT,
  about TEXT,
  tone TEXT,
  frequency TEXT,
  post_time TEXT,
  accent_color TEXT,
  watermark_text TEXT,
  avoid_topics TEXT,
  cta_preference TEXT,
  trial_ends_at TEXT,
  login_key_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_login_key ON customers(login_key_hash);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at TEXT,
  scopes TEXT,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (customer_id, provider)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_post_id TEXT,
  headline TEXT,
  caption TEXT,
  image_url TEXT,
  posted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_customer ON posts(customer_id, posted_at DESC);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS style_cache (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  samples_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  topic TEXT,
  channel TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS post_requests_customer ON post_requests(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pending_approvals (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  headline TEXT,
  caption TEXT,
  image_url TEXT,
  pillar_title TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_approvals_customer ON pending_approvals(customer_id, created_at DESC);

-- Panel v5: server-side daily pre-planning (planning.ts), independent of pending_approvals -
-- a planned_posts row exists BEFORE any customer review, for every due day/channel in the next
-- 7 days. pending_approvals stays exactly as before (approvalMode's customer-review queue,
-- filed by the K1-K9 routine at publish time); the two tables serve different points in time
-- and are not merged, to avoid touching pending_approvals' existing read/write paths.
CREATE TABLE IF NOT EXISTS planned_posts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  headline TEXT,
  caption TEXT,
  image_url TEXT,
  pillar_title TEXT,
  accent_color_used TEXT,
  regenerate_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS planned_posts_customer_date ON planned_posts(customer_id, scheduled_for, channel);

-- Panel v5 task 4's safety net: one failure (for one customer/day/channel) never aborts the
-- whole daily planning run - it's skipped and recorded here instead. No foreign key on
-- customer_id on purpose - a log row should survive that customer being deleted later.
CREATE TABLE IF NOT EXISTS planning_errors (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  channel TEXT,
  scheduled_for TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS planning_errors_created ON planning_errors(created_at DESC);

CREATE TABLE IF NOT EXISTS saved_themes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  accent_color TEXT,
  watermark_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS saved_themes_customer ON saved_themes(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS content_pillars (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  weight INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS content_pillars_customer ON content_pillars(customer_id);
`);

// Migration: add columns to a table that existed before this version. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so check pragma table_info first. Reused across v3/v4 for every
// additive column change - always idempotent, always keeps existing rows' behavior unchanged
// via the DEFAULT given here (or NULL/"nullable" when a feature is opt-in).
function migrateColumns(table: string, columns: readonly (readonly [string, string])[]): void {
  const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const [column, def] of columns) {
    if (!existing.has(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  }
}

migrateColumns("pending_approvals", [
  // Exact ig_feed/ig_story/linkedin value from save_pending_approval's `channel` argument -
  // the pre-existing `provider` column collapses ig_feed/ig_story both to "instagram", which
  // loses exactly the distinction the panel UI and a later publish-approved-post run need.
  // NULL on rows written before this column existed - callers fall back to `provider` there.
  ["channel", "TEXT"],
  // Panel v7 fix (Teil 2 - Herkunft sichtbar machen): 'planning' when filed via
  // submit_planned_post_for_approval (the nightly pre-planning's own content, submitted as-is),
  // 'routine' when filed via the plain save_pending_approval tool (spontaneously generated on
  // the spot - K2 "Jetzt posten" or the K4-K8 fallback). NULL on rows written before this column
  // existed - the panel falls back to a generic "automatisch erstellt" wording for those.
  ["source", "TEXT"],
]);

const hadEmailVerifiedColumn = (db.prepare(`PRAGMA table_info(customers)`).all() as { name: string }[]).some(
  (c) => c.name === "email_verified",
);

migrateColumns("customers", [
  ["accent_color", "TEXT"],
  ["watermark_text", "TEXT"],
  ["avoid_topics", "TEXT"],
  ["cta_preference", "TEXT"],
  ["trial_ends_at", "TEXT"],
  // Channel/format toggles - default 1 (enabled) so existing customers keep posting exactly
  // as before; new customers start with everything on and switch things off deliberately.
  ["ig_feed_enabled", "INTEGER NOT NULL DEFAULT 1"],
  ["ig_story_enabled", "INTEGER NOT NULL DEFAULT 1"],
  ["linkedin_enabled", "INTEGER NOT NULL DEFAULT 1"],
  ["hashtag_pref", "TEXT NOT NULL DEFAULT 'wenige'"],
  ["emojis_enabled", "INTEGER NOT NULL DEFAULT 1"],
  ["language", "TEXT NOT NULL DEFAULT 'de'"],
  // Customer's own pause toggle (dashboard "Pausieren"/"Fortsetzen") - distinct from the
  // admin's status column: a paused customer can still log in and see their dashboard, they
  // just stop being posted for until they resume it themselves.
  ["customer_paused", "INTEGER NOT NULL DEFAULT 0"],
  // Hard-enforced, comma-separated - distinct from the existing soft avoid_topics (an AI
  // instruction the routine may or may not follow perfectly). NULL/empty = no restriction.
  ["banned_words", "TEXT"],
  // Hard-enforced, comma-separated - every element must appear somewhere across the
  // headline/caption texts of a post, or publishing is refused. NULL/empty = no requirement.
  ["required_elements", "TEXT"],
  // Granular scheduling (v4) - all nullable/opt-in. NULL active_weekdays means "derive from
  // frequency" exactly as before; NULL instagram/linkedin_weekdays means "use active_weekdays".
  ["active_weekdays", "TEXT"],
  ["instagram_weekdays", "TEXT"],
  ["linkedin_weekdays", "TEXT"],
  ["pause_from", "TEXT"],
  ["pause_until", "TEXT"],
  // Default 0 (off) - existing customers keep the current auto-publish behavior exactly.
  ["approval_mode", "INTEGER NOT NULL DEFAULT 0"],
  // NULL (default) = keep using the plain accent_color/watermark_text columns exactly as
  // before. Set only once a customer actually activates a saved theme.
  ["active_theme_id", "TEXT"],
  // Absolute local file path to an uploaded logo (task 9) - never a public URL, watermark.ts
  // reads it directly off disk. NULL = exactly the previous text-watermark-only behavior.
  ["logo_url", "TEXT"],
  // Panel v6 task 2b: no AI generation (planning.ts, post-now, improve-briefing, etc.) runs for
  // a customer until they've clicked the link in their confirmation email - closes the "sign up
  // with a throwaway address, never come back, we still pay for nightly generation" abuse hole.
  // Default 0 - the one-time backfill below immediately re-verifies every customer that already
  // existed before this column did (see comment there), so nothing breaks for them.
  ["email_verified", "INTEGER NOT NULL DEFAULT 0"],
  ["email_verify_token_hash", "TEXT"],
  // Panel v6 task 4d: fires exactly once, at this customer's first-ever successful publish -
  // NULL until then, set together with the "first post live" email so a retry/duplicate publish
  // can never send it twice.
  ["first_post_email_sent_at", "TEXT"],
  // Panel v6 task 4c: the trial-ending-soon email is one-shot, not a daily nag - NULL until sent.
  ["trial_ending_email_sent_at", "TEXT"],
  // Panel v6 task 4b: throttles the "X Beiträge warten auf Ihre Freigabe" summary mail to at
  // most once per calendar day per customer, regardless of how many pending_approvals rows
  // appear in that window.
  ["approval_email_sent_at", "TEXT"],
  // Sandbox-Bugcheck (2026-09-13): "Später verbinden" war bisher rein clientseitig (nur im
  // Speicher) - ein Reload/Tab-Wechsel zwischen den Connect-Schritten sprang deshalb wieder
  // zurueck zum ersten noch offenen Provider (firstOpenStep() kannte den Skip nicht). Comma-
  // getrennte Provider-IDs, NULL/leer = nichts uebersprungen.
  ["skipped_providers", "TEXT"],
]);

// Panel v6 task 2b: existing customers signed up before e-mail confirmation existed - treat them
// as already verified so nothing breaks for them. Must run ONLY the one time this column is
// first created (guarded by hadEmailVerifiedColumn, captured before migrateColumns runs above) -
// otherwise this would keep silently auto-verifying every future signup on every server restart,
// which defeats the entire point of task 2b.
if (!hadEmailVerifiedColumn) {
  db.prepare("UPDATE customers SET email_verified = 1 WHERE email_verified = 0").run();
}

migrateColumns("posts", [
  // Which content pillar (if any) this post was generated for - lets pickPillarForToday avoid
  // repeating the same pillar twice in a row. Nullable: posts made before pillars existed, or
  // for customers without pillars, simply have no pillar.
  ["pillar_title", "TEXT"],
]);

export interface CustomerRow {
  id: string;
  company: string;
  contact_name: string;
  email: string;
  website: string | null;
  industry: string | null;
  about: string | null;
  tone: string | null;
  frequency: string | null;
  post_time: string | null;
  accent_color: string | null;
  watermark_text: string | null;
  avoid_topics: string | null;
  cta_preference: string | null;
  trial_ends_at: string | null;
  ig_feed_enabled: number;
  ig_story_enabled: number;
  linkedin_enabled: number;
  hashtag_pref: string;
  emojis_enabled: number;
  language: string;
  customer_paused: number;
  banned_words: string | null;
  required_elements: string | null;
  active_weekdays: string | null;
  instagram_weekdays: string | null;
  linkedin_weekdays: string | null;
  pause_from: string | null;
  pause_until: string | null;
  approval_mode: number;
  active_theme_id: string | null;
  logo_url: string | null;
  email_verified: number;
  email_verify_token_hash: string | null;
  first_post_email_sent_at: string | null;
  trial_ending_email_sent_at: string | null;
  approval_email_sent_at: string | null;
  skipped_providers: string | null;
  login_key_hash: string;
  status: string;
  consent_at: string;
  created_at: string;
  updated_at: string;
}

export interface ConnectionRow {
  customer_id: string;
  provider: string;
  account_id: string;
  account_name: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  scopes: string | null;
  connected_at: string;
  updated_at: string;
}

export interface PostRow {
  id: string;
  customer_id: string;
  provider: string;
  external_post_id: string | null;
  headline: string | null;
  caption: string | null;
  image_url: string | null;
  posted_at: string;
  pillar_title: string | null;
}

export interface ContentPillarRow {
  id: string;
  customer_id: string;
  title: string;
  description: string | null;
  weight: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface SavedThemeRow {
  id: string;
  customer_id: string;
  name: string;
  accent_color: string | null;
  watermark_text: string | null;
  created_at: string;
}

export interface PendingApprovalRow {
  id: string;
  customer_id: string;
  provider: string;
  channel: string | null;
  headline: string | null;
  caption: string | null;
  image_url: string | null;
  pillar_title: string | null;
  source: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PostRequestRow {
  id: string;
  customer_id: string;
  topic: string | null;
  channel: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PlannedPostRow {
  id: string;
  customer_id: string;
  channel: string;
  scheduled_for: string;
  status: string;
  headline: string | null;
  caption: string | null;
  image_url: string | null;
  pillar_title: string | null;
  accent_color_used: string | null;
  regenerate_count: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningErrorRow {
  id: string;
  customer_id: string | null;
  channel: string | null;
  scheduled_for: string | null;
  message: string;
  created_at: string;
}

export const nowIso = (): string => new Date().toISOString();

export function cleanupExpired(): void {
  const now = nowIso();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(now);
}
