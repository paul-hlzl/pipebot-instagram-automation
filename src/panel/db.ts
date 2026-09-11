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
`);

// Migration: add columns to a customers table that existed before this version.
// SQLite has no "ADD COLUMN IF NOT EXISTS", so check pragma table_info first.
const existingColumns = new Set(
  (db.prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map((c) => c.name),
);
for (const [column, def] of [
  ["accent_color", "TEXT"],
  ["watermark_text", "TEXT"],
  ["avoid_topics", "TEXT"],
  ["cta_preference", "TEXT"],
  ["trial_ends_at", "TEXT"],
] as const) {
  if (!existingColumns.has(column)) {
    db.exec(`ALTER TABLE customers ADD COLUMN ${column} ${def}`);
  }
}

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
}

export const nowIso = (): string => new Date().toISOString();

export function cleanupExpired(): void {
  const now = nowIso();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(now);
}
