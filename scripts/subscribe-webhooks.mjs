#!/usr/bin/env node
/**
 * One-off backfill (Panel v11, Webhooks): subscribes every ALREADY-connected Instagram account to
 * the app's `comments` webhook field, so existing customers (not just newly-connecting ones -
 * router.ts's OAuth callback already does this automatically going forward) start getting
 * real-time comment events too. Safe to re-run any time (Meta's subscribed_apps endpoint is
 * idempotent) - e.g. after adding a new customer manually to the DB, or if a subscription was
 * ever lost (token rotated outside the normal refresh flow, app-level webhook config changed).
 *
 * Only touches connections that already have the required `instagram_business_manage_comments`
 * scope - a connection still missing it (pre-Panel-v10 reconnect) needs the customer to reconnect
 * in the panel first, same precondition as the comment-automation cron itself.
 *
 * One customer's failure never stops the others (same K9 isolation principle as everywhere else
 * in this codebase).
 *
 * Usage: node scripts/subscribe-webhooks.mjs   (defaults to the production DB/.env)
 *        PANEL_DB_PATH=data/panel-staging.db node scripts/subscribe-webhooks.mjs   (staging -
 *        pointless in practice, staging has no real IG_APP_SECRET/tokens, listed only for
 *        symmetry with the other scripts in this directory)
 */
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import axios from "axios";

const ROOT = path.resolve(import.meta.dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const DB_PATH = process.env.PANEL_DB_PATH ?? path.join(ROOT, "data/panel.db");
const REQUIRED_SCOPE = "instagram_business_manage_comments";
const GRAPH_BASE = "https://graph.instagram.com/v21.0";

function decrypt(payload) {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unbekanntes Token-Format");
  const key = Buffer.from(process.env.PANEL_ENCRYPTION_KEY ?? "", "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare("SELECT customer_id, account_id, account_name, scopes, access_token_enc FROM connections WHERE provider = 'instagram'")
    .all();
  db.close();

  const eligible = rows.filter((r) => (r.scopes ?? "").includes(REQUIRED_SCOPE));
  console.log(`[subscribe-webhooks] ${eligible.length}/${rows.length} Instagram-Verbindungen mit ${REQUIRED_SCOPE} gefunden.`);

  let ok = 0;
  let failed = 0;
  for (const row of eligible) {
    try {
      const accessToken = decrypt(row.access_token_enc);
      await axios.post(`${GRAPH_BASE}/${row.account_id}/subscribed_apps`, null, {
        params: { subscribed_fields: "comments", access_token: accessToken },
      });
      console.log(`[subscribe-webhooks] OK  ${row.customer_id} (${row.account_name ?? row.account_id})`);
      ok++;
    } catch (err) {
      const detail = err?.response?.data ? JSON.stringify(err.response.data) : err instanceof Error ? err.message : String(err);
      console.error(`[subscribe-webhooks] FEHLER ${row.customer_id} (${row.account_name ?? row.account_id}):`, detail);
      failed++;
    }
  }

  const skipped = rows.length - eligible.length;
  console.log(`[subscribe-webhooks] fertig: ${ok} ok, ${failed} fehlgeschlagen, ${skipped} uebersprungen (fehlende Berechtigung - Kunde muss neu verbinden).`);
}

main().catch((err) => {
  console.error("[subscribe-webhooks] unerwarteter Fehler:", err);
  process.exit(1);
});
