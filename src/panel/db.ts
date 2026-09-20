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

-- Panel v9: Instagram-Analytics (v1, Instagram only - siehe Session-Bericht). Ein Snapshot pro
-- Kunde/Tag statt eines laufenden Zählers, damit ein Trend über die Zeit entsteht, nicht nur der
-- jeweils aktuelle Stand. UNIQUE(customer_id, snapshot_date) macht einen erneuten Lauf am selben
-- Tag idempotent (siehe saveAccountSnapshot: INSERT OR REPLACE).
CREATE TABLE IF NOT EXISTS analytics_account_snapshots (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  follower_count INTEGER,
  reach INTEGER,
  views INTEGER,
  accounts_engaged INTEGER,
  total_interactions INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(customer_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS analytics_account_snapshots_customer_date ON analytics_account_snapshots(customer_id, snapshot_date DESC);

-- Eine Zeile pro Abruf (nicht pro Post) - Engagement wächst über Zeit, die letzte Zeile pro
-- post_id ist der aktuelle Stand (siehe listTopPosts/latestPostSnapshot: ORDER BY fetched_at DESC
-- LIMIT 1 pro Post). customer_id redundant zu posts.customer_id, aber spart einen JOIN bei jeder
-- Abfrage (dieselbe bewusste Redundanz wie schon bei pending_approvals.provider/channel).
CREATE TABLE IF NOT EXISTS analytics_post_snapshots (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  likes INTEGER,
  comments INTEGER,
  saved INTEGER,
  shares INTEGER,
  reach INTEGER,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_post_snapshots_post ON analytics_post_snapshots(post_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS analytics_post_snapshots_customer ON analytics_post_snapshots(customer_id, fetched_at DESC);

-- Panel v9 Aufgabe 3: Kosten-Sichtbarkeit für neue KI-Aufrufe (Analytics-Zusammenfassung) - diese
-- Tabelle existierte trotz Erwähnung im Auftrag NOCH NICHT im Code (siehe Session-Bericht), hier
-- als schlanke Grundlage neu angelegt statt eine nicht vorhandene Altlast vorauszusetzen.
CREATE TABLE IF NOT EXISTS usage_costs (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  estimated_cost_usd REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_costs_customer ON usage_costs(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_costs_feature ON usage_costs(feature, created_at DESC);

-- Panel v9 Aufgabe 3: zwischengespeicherte KI-Zusammenfassung pro Kunde - ein Satz Cache pro
-- Kunde (nicht historisiert), damit sowohl der "Zusammenfassung anzeigen"-Button als auch der
-- wöchentliche Hintergrund-Lauf (für den E-Mail-Bericht, Punkt 5) dieselbe aktuelle Zusammenfassung
-- lesen können, ohne bei jedem Seitenaufruf neu zu generieren (das würde unnötig Kosten erzeugen).
CREATE TABLE IF NOT EXISTS analytics_summaries (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

-- Panel v10: KI-Kommentar-Automatisierung (Instagram, siehe Session-Bericht). Eine Zeile pro
-- gesehenem obersten Kommentar - der eigenständige 10-15min-Cron (comments.ts) prueft vor jedem
-- Verarbeiten per comment_id, ob die Zeile schon existiert, damit ein Kommentar nie zweimal
-- klassifiziert/beantwortet wird. media_id redundant zu posts.external_post_id (dieselbe bewusste
-- Redundanz wie schon bei pending_approvals.channel), spart einen JOIN bei jeder Anzeige. Kein
-- Fremdschluessel auf posts - ein Kommentar-Datensatz soll ueberleben, falls der zugehoerige
-- posts-Eintrag je geloescht wird.
CREATE TABLE IF NOT EXISTS processed_comments (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  author_username TEXT,
  comment_type TEXT NOT NULL,
  generated_reply TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS processed_comments_customer ON processed_comments(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS processed_comments_status ON processed_comments(customer_id, status);

-- Panel v14: Karussell-/Video-Diashow-Posts (siehe Session-Bericht). Bisher gingen posts/
-- pending_approvals/planned_posts von genau einem Bild pro Post aus (image_url-Spalte) - das
-- bleibt für Einzelbild-Posts unveraendert (image_url = das eine Bild bzw. bei Karussell/Video
-- das erste Slide als Vorschau/Cover). Ein Mehrbild-Post (format='carousel'|'video_slideshow')
-- bekommt zusaetzlich seine vollstaendige Slide-Liste hier, generisch ueber alle drei
-- Eigentuemer-Tabellen hinweg (owner_type unterscheidet sie) statt drei fast identischer
-- Zuordnungstabellen. Kein Fremdschluessel auf eine bestimmte Eigentuemer-Tabelle - kann nicht
-- sauber ueber drei mögliche Tabellen hinweg ausgedrueckt werden, Aufraeumen bei Post-Loeschung
-- laeuft deshalb explizit im Anwendungscode (siehe credentials.ts).
CREATE TABLE IF NOT EXISTS post_media (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  overlay_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS post_media_owner ON post_media(owner_type, owner_id, position);

-- Google-Bewertungen (siehe reviews.ts). Gleiche Grundidee wie processed_comments: eine Zeile pro
-- Bewertung, der Ressourcenname von Google (accounts/*/locations/*/reviews/*) ist der Dedupe-
-- Schluessel, damit dieselbe Bewertung nie zweimal beantwortet wird. Unterschiede zu
-- processed_comments, bewusst und nicht kopiert:
--   * star_rating/reviewer_name gibt es bei Kommentaren nicht, hier steuern sie Tonfall der
--     Antwort UND das Content-Recycling (ab wie vielen Sternen ein Beitragsvorschlag entsteht).
--   * reply_state/policy_violation halten Googles MODERATIONSERGEBNIS fest: eine erfolgreich
--     abgeschickte Antwort kann von Google nachtraeglich noch abgelehnt werden. rejected_notified_at
--     sorgt dafuer, dass der Kunde darueber genau einmal eine E-Mail bekommt, nicht bei jedem Lauf.
--   * social_post_* verknuepft eine gute Bewertung mit dem daraus erzeugten Beitragsvorschlag
--     (pending_approvals.id), damit aus einer Bewertung nie zwei Beitraege entstehen.
-- Kein Fremdschluessel auf pending_approvals: der Beitrag darf geloescht werden, ohne dass die
-- Bewertungs-Historie verschwindet (gleiche Ueberlegung wie bei processed_comments/posts).
CREATE TABLE IF NOT EXISTS google_reviews (
  id TEXT PRIMARY KEY,
  review_name TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  location_name TEXT NOT NULL,
  reviewer_name TEXT,
  star_rating INTEGER NOT NULL DEFAULT 0,
  review_text TEXT NOT NULL DEFAULT '',
  review_created_at TEXT,
  generated_reply TEXT,
  status TEXT NOT NULL,
  reply_state TEXT,
  policy_violation TEXT,
  rejected_notified_at TEXT,
  social_post_status TEXT,
  social_post_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS google_reviews_customer ON google_reviews(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS google_reviews_status ON google_reviews(customer_id, status);
CREATE INDEX IF NOT EXISTS google_reviews_post_status ON google_reviews(customer_id, social_post_status);

-- Merkliste für Medien-IDs, deren Kommentar-Abruf dauerhaft scheitert (siehe backoff.ts).
-- Ohne sie hat der Cron dieselbe tote ID alle 45 Minuten erneut abgefragt und pro Versuch eine
-- Fehlerzeile geschrieben. Eine Zeile lebt nur solange, wie es Fehlschläge gibt: der erste
-- erfolgreiche Abruf löscht sie wieder (clearMediaFetchFailures).
CREATE TABLE IF NOT EXISTS comment_fetch_failures (
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT NOT NULL,
  last_failed_at TEXT NOT NULL,
  last_status INTEGER,
  last_error TEXT,
  retry_after TEXT NOT NULL,
  paused_logged_at TEXT,
  PRIMARY KEY (customer_id, media_id)
);
CREATE INDEX IF NOT EXISTS comment_fetch_failures_retry ON comment_fetch_failures(customer_id, retry_after);
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

// Ueberschreibschutz (Auftrag 19.09.2026): `origin` sagt, ob eine Zeile von Pipeflow stammt
// ('auto') oder ob der Kunde daran gearbeitet hat ('kunde'). Nichts setzt es je zurueck.
// `image_source` dasselbe fuer das Bild. Bestehende Zeilen sind 'auto' - das ist wahr.
migrateColumns("planned_posts", [
  ["origin", "TEXT NOT NULL DEFAULT 'auto'"],
  ["image_source", "TEXT NOT NULL DEFAULT 'auto'"],
]);
migrateColumns("pending_approvals", [
  // Wird beim Einreichen aus planned_posts uebernommen (credentials.ts, submit...).
  ["origin", "TEXT NOT NULL DEFAULT 'auto'"],
  // 20.09.2026: dasselbe fuer das Bild. Gebraucht fuer die Ausnahme bei LinkedIn "nur Text" -
  // ein selbst hochgeladenes Bild geht mit raus, ein von uns erzeugtes nicht. Ohne diese Spalte
  // saehe das Panel dem Eintrag in der Warteschlange nicht an, wem sein Bild gehoert.
  ["image_source", "TEXT NOT NULL DEFAULT 'auto'"],
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
  // Stillstands-Wache: Zeitpunkt der letzten Meldung an Paul, damit pro Stillstands-Phase genau
  // eine Mail rausgeht statt taeglich einer (siehe panel/standstill-watch.ts).
  ["standstill_alert_sent_at", "TEXT"],
  // 19.09.2026: das auf der Website erkannte Logo. BEWUSST getrennt von `logo_url` - das ist
  // der eigene Upload des Kunden und darf nie ueberschrieben werden. Die Kopfzeile zeigt den
  // Upload, wenn es einen gibt, sonst dieses hier.
  ["detected_logo_url", "TEXT"],
  ["detected_logo_tile", "INTEGER NOT NULL DEFAULT 0"],
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
  // Panel v8 Aufgabe 2: Opt-in, Standard aus (0) - bei true bekommt der Kunde bei JEDER
  // tatsaechlichen Veroeffentlichung sofort eine E-Mail (nicht nur beim allerersten Post wie die
  // bestehende first_post_email_sent_at-Mail, die unveraendert fuer ALLE Kunden bleibt), plus
  // einen sofortigen Hinweis, sobald bei aktivem approval_mode ein neuer Beitrag zur Freigabe
  // bereitsteht - beides ueber denselben Schalter, siehe credentials.ts.
  ["notify_on_publish", "INTEGER NOT NULL DEFAULT 0"],
  // Panel v9 Aufgabe 5: eigener Opt-in-Schalter neben notify_on_publish (nicht derselbe - ein
  // Kunde kann Veroeffentlichungs-Hinweise und/oder den woechentlichen Analytics-Bericht getrennt
  // an-/abschalten). Standard aus, wie alle Benachrichtigungs-Opt-ins hier.
  ["notify_weekly_report", "INTEGER NOT NULL DEFAULT 0"],
  // Panel v10: KI-Kommentar-Automatisierung, nur Instagram (siehe Session-Bericht). Standard aus,
  // wie approval_mode. comment_automation_mode: 'auto' postet die generierte Antwort sofort ueber
  // /{comment-id}/replies, 'approval' legt sie stattdessen wie ein Beitrags-Entwurf zur Freigabe
  // ab - gleiches Grundprinzip wie approval_mode bei Beitraegen, aber ein eigener Schalter (ein
  // Kunde kann Beitraege automatisch, Kommentare aber nur mit Freigabe wollen, oder umgekehrt).
  // 20.09.2026: LinkedIn mit Bild oder nur Text mit Hashtags. Bis dahin galt fuer Panel-Kunden
  // ausnahmslos "immer mit Bild" (Bugreport 13.09., assertLinkedInHasImage) - das war eine
  // Entscheidung fuer alle statt einer Wahl des Kunden. Standard bleibt 'bild', ein bestehender
  // Kunde merkt also nichts. Instagram hat die Wahl bewusst nicht: dort geht ohne Bild nichts.
  ["linkedin_image_mode", "TEXT NOT NULL DEFAULT 'bild'"],
  ["comment_automation_enabled", "INTEGER NOT NULL DEFAULT 0"],
  ["comment_automation_mode", "TEXT NOT NULL DEFAULT 'approval'"],
  // Panel v11: Erst-Rundgang genau einmal pro Kunde zeigen. Bewusst serverseitig und nicht im
  // Browser-Speicher - beim "Später verbinden" (skipped_providers) war genau das schon einmal die
  // Fehlerursache (Reload/anderes Geraet = Zustand weg). NULL = noch nicht gesehen/abgeschlossen.
  ["tour_done_at", "TEXT"],
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
  // Panel v14: 'single' (default, unchanged behavior) | 'carousel' | 'video_slideshow'. Every
  // pre-existing row has no value here - DEFAULT 'single' backfills them correctly (they were
  // always single-image posts), no separate UPDATE needed.
  ["format", "TEXT NOT NULL DEFAULT 'single'"],
]);

migrateColumns("pending_approvals", [["format", "TEXT NOT NULL DEFAULT 'single'"]]);
migrateColumns("planned_posts", [["format", "TEXT NOT NULL DEFAULT 'single'"]]);
// Nur fuer channel='ig_feed' relevant (Karussell/Video-Diashow gibt es nur bei Instagram Feed,
// siehe Session-Bericht Teil C) - der Kunde waehlt es trotzdem pro Anfrage, nicht global, falls
// er z.B. gleichzeitig Instagram UND LinkedIn anfragt.
migrateColumns("post_requests", [["format", "TEXT NOT NULL DEFAULT 'single'"]]);

migrateColumns("customers", [
  // Panel v14: wie viele Slides ein Karussell/eine Video-Diashow fuer diesen Kunden bekommt -
  // vom Kunden einstellbar innerhalb der technischen Grenze (3-7, siehe carousel.ts). Default 5.
  ["carousel_slide_count", "INTEGER NOT NULL DEFAULT 5"],
  // Wie oft die taegliche Routine statt eines Einzelbilds ein Karussell/eine Video-Diashow
  // waehlen soll - 'off' (Standard, nur Einzelbild, neue Formate muessen aktiv gewaehlt werden),
  // 'weekly' (einmal pro Woche) oder 'always'. Steuert nur die AUTOMATISCHE taegliche Routine -
  // manuelles "Jetzt posten" waehlt das Format ohnehin explizit pro Post.
  ["carousel_auto_frequency", "TEXT NOT NULL DEFAULT 'off'"],
]);

// Panel v15: Farbverlauf + Schriftart (siehe Session-Bericht) - Teil derselben "Aussehen"-Gruppe
// wie accent_color/watermark_text, deshalb direkte Kunden-Spalten statt einer eigenen Tabelle
// (wie schon accent_color selbst). font_choice referenziert eine id aus fonts.ts's FONT_OPTIONS,
// nicht validiert auf DB-Ebene (getFontOption() faellt bei unbekannter id auf den Standard
// zurueck statt zu werfen - alte/kaputte Werte koennen so nie einen Bild-Render blockieren).
migrateColumns("customers", [
  ["font_choice", "TEXT NOT NULL DEFAULT 'inter'"],
  ["gradient_enabled", "INTEGER NOT NULL DEFAULT 0"],
  ["gradient_color2", "TEXT"],
  ["gradient_direction", "TEXT NOT NULL DEFAULT 'diagonal'"],
]);

// Panel v19: Stale-Content-Sicherheitsnetz (siehe Session-Bericht - Andrea/Physiotherapie-Vorfall,
// cus_bW0p_HapELUZ). branding_last_changed_at wird bei jeder Aenderung von company/industry/
// about/tone aktualisiert (siehe router.ts's brandingFieldsChanged, gleiche Ausloeser-Felder wie
// das Branding-Regen-Angebot). planned_posts/pending_approvals bekommen dazu
// branding_version_at_generation - ein Zeitstempel, wann ihr TEXT zuletzt geschrieben wurde
// (Erst-Generierung, Server-Neugenerierung ODER ein Kunden-eigener Edit zaehlen alle als "frisch",
// siehe credentials.ts). Ein Beitrag ist "stale", wenn sein branding_version_at_generation aelter
// ist als branding_last_changed_at des Kunden (oder komplett fehlt, waehrend der Kunde bereits
// einen Wechsel hat) - siehe planning.ts's isBrandingStale. NULL/NULL (kein branding_change
// bekannt) gilt nie als stale, damit bestehende Kunden ohne je eine Aenderung nicht plötzlich
// alle als veraltet markiert werden.
migrateColumns("customers", [["branding_last_changed_at", "TEXT"]]);

// Google-Bewertungen (siehe reviews.ts). Alle vier Standardwerte sind bewusst "aus"/konservativ:
// eine bestehende Kundin merkt von diesem Feature nichts, bis sie es selbst einschaltet.
// google_review_mode wie comment_automation_mode ('approval' = erst zur Freigabe, 'auto' = sofort
// abschicken); Standard hier ebenfalls 'approval', weil eine oeffentliche Antwort unter dem Namen
// des Kunden steht. google_review_posts_enabled/google_review_post_min_stars steuern das
// Content-Recycling (aus einer guten Bewertung einen Beitragsvorschlag machen) - eigener Schalter,
// nicht an die Antwort-Automatik gekoppelt: viele Kunden wollen antworten lassen, aber nicht jede
// Bewertung weiterveroeffentlichen (Einverstaendnis der bewertenden Person, siehe Panel-Hinweis).
// Video-Diashow (Teil B des Karussell-Auftrags, siehe videos.ts/video.ts). Standard: aus. Die
// Video-Diashow ist bewusst KEINE blosse Format-Option neben Einzelbild/Karussell, sondern ein
// eigener Bereich mit eigenem Wochenplan - ein Kunde kann "nur montags ein Reel" wollen, waehrend
// Einzelbilder ihrem eigenen Zeitplan folgen. video_weekdays leer/NULL heisst: keine
// automatischen Videos (auch bei video_enabled=1 entsteht dann nur etwas ueber "Jetzt posten").
// video_post_time NULL faellt auf die normale post_time zurueck.
migrateColumns("customers", [
  ["video_enabled", "INTEGER NOT NULL DEFAULT 0"],
  ["video_weekdays", "TEXT"],
  ["video_post_time", "TEXT"],
  ["video_length_seconds", "INTEGER NOT NULL DEFAULT 10"],
  ["video_zoom_direction", "TEXT NOT NULL DEFAULT 'alternate'"],
  ["video_voice", "TEXT NOT NULL DEFAULT 'de-DE-Wavenet-H'"],
  ["video_voice_enabled", "INTEGER NOT NULL DEFAULT 1"],
]);
// Das fertige MP4 einer Video-Diashow. image_url bleibt daneben belegt (Standbild aus dem Video) -
// dadurch funktionieren Verlauf, Freigabe-Karten und Vorschau-Kacheln unveraendert weiter, auch wo
// sie nur ein Bild erwarten; wer ein Video abspielen will, nimmt video_url.
migrateColumns("posts", [["video_url", "TEXT"]]);
migrateColumns("pending_approvals", [["video_url", "TEXT"]]);
migrateColumns("planned_posts", [["video_url", "TEXT"]]);

migrateColumns("customers", [
  ["google_review_automation_enabled", "INTEGER NOT NULL DEFAULT 0"],
  ["google_review_mode", "TEXT NOT NULL DEFAULT 'approval'"],
  ["google_review_posts_enabled", "INTEGER NOT NULL DEFAULT 0"],
  ["google_review_post_min_stars", "INTEGER NOT NULL DEFAULT 4"],
]);
// Panel v20: Token-Ablauf-Warnung (LinkedIn hat keinen Refresh-Token, siehe providers/linkedin.ts
// - laeuft nach 60 Tagen still ab, wenn niemand rechtzeitig neu verbindet). Verhindert Mehrfach-
// Mails fuer denselben Ablauf: wird bei jedem erfolgreichen Refresh/Neu-Verbinden zurueckgesetzt
// (neues expires_at = neue Warn-Chance), siehe credentials.ts's refreshRow/router.ts's OAuth-Callback.
migrateColumns("connections", [["expiry_warning_sent_at", "TEXT"]]);

/**
 * Plattform-Sperre einer einzelnen Verbindung (siehe connection-block.ts).
 *
 * Wenn LinkedIn mit RESTRICTED_MEMBER oder Instagram mit "We restrict certain activity"
 * (code=4 subcode=2207051) antwortet, ist das KEIN vorübergehender Fehler: die Plattform hat das
 * Konto eingeschränkt, und jeder weitere Versuch scheitert identisch. Vorher wurde genau das
 * endlos wiederholt (allein 44 RESTRICTED_MEMBER-Zeilen im Log). Diese Spalten merken sich den
 * Zustand, damit die Routinen die Verbindung überspringen und das Panel dem Kunden den Grund
 * anzeigen kann. Zurückgesetzt wird beim Neu-Verbinden oder beim nächsten erfolgreichen Aufruf.
 */
migrateColumns("connections", [
  ["blocked_at", "TEXT"],
  ["blocked_code", "TEXT"],
  ["blocked_reason", "TEXT"],
]);

/**
 * Panel v20: Analytics nach Kanal getrennt (Instagram/LinkedIn) statt implizit nur Instagram -
 * siehe Session-Bericht. Nur analytics_account_snapshots braucht die neue Spalte:
 * analytics_post_snapshots ist über post_id schon an eine posts-Zeile gebunden, die ihrerseits
 * ihren provider kennt, also implizit schon kanalgetrennt - ein redundantes channel-Feld dort
 * wäre nur eine zusätzliche Fehlerquelle (könnte vom eigenen post_id abweichen).
 *
 * ALTER TABLE ADD COLUMN kann die bestehende UNIQUE(customer_id, snapshot_date) nicht auf
 * UNIQUE(customer_id, snapshot_date, channel) erweitern (SQLite unterstützt kein ALTER auf
 * Constraints) - deshalb hier einmalig die Tabelle neu aufgebaut, wenn die channel-Spalte noch
 * fehlt. Alle bestehenden Zeilen werden dabei explizit als 'instagram' markiert (der einzige
 * Kanal, den es vor diesem Feature gab), keine Daten gehen verloren. Getestet gegen eine Kopie
 * der Produktions-DB vor dem Deploy (siehe Session-Bericht).
 */
/** Same reasoning/pattern as analytics_account_snapshots above - the AI-summary cache is also
 *  one-per-customer today and needs to become one-per-customer-per-channel. Purely a cache (no
 *  historical/audit value), so the existing row is carried over unchanged as the 'instagram' entry
 *  rather than discarded - avoids an unnecessary Anthropic re-generation right after deploy. */
if (!(db.prepare(`PRAGMA table_info(analytics_summaries)`).all() as { name: string }[]).some((c) => c.name === "channel")) {
  db.exec(`
    CREATE TABLE analytics_summaries_v20 (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'instagram',
      summary TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, channel)
    );
    INSERT INTO analytics_summaries_v20 (customer_id, channel, summary, generated_at)
      SELECT customer_id, 'instagram', summary, generated_at FROM analytics_summaries;
    DROP TABLE analytics_summaries;
    ALTER TABLE analytics_summaries_v20 RENAME TO analytics_summaries;
  `);
}

if (!(db.prepare(`PRAGMA table_info(analytics_account_snapshots)`).all() as { name: string }[]).some((c) => c.name === "channel")) {
  db.exec(`
    CREATE TABLE analytics_account_snapshots_v20 (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'instagram',
      snapshot_date TEXT NOT NULL,
      follower_count INTEGER,
      reach INTEGER,
      views INTEGER,
      accounts_engaged INTEGER,
      total_interactions INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(customer_id, snapshot_date, channel)
    );
    INSERT INTO analytics_account_snapshots_v20 (id, customer_id, channel, snapshot_date, follower_count, reach, views, accounts_engaged, total_interactions, created_at)
      SELECT id, customer_id, 'instagram', snapshot_date, follower_count, reach, views, accounts_engaged, total_interactions, created_at FROM analytics_account_snapshots;
    DROP TABLE analytics_account_snapshots;
    ALTER TABLE analytics_account_snapshots_v20 RENAME TO analytics_account_snapshots;
    CREATE INDEX IF NOT EXISTS analytics_account_snapshots_customer_date ON analytics_account_snapshots(customer_id, channel, snapshot_date DESC);
  `);
}
// 15.09.2026: Klartext-Grund, warum eine "Jetzt posten"-Anfrage nicht zu einem Beitrag gefuehrt
// hat - fuer den Kunden lesbar, nicht als technischer Code. Vorher wurde eine gescheiterte
// Anfrage einfach als erledigt markiert und im Panel passierte sichtbar nichts.
// notify_email: pro Anfrage merken, ob der Kunde eine Mail will, sobald der Beitrag live ist
// (15.09.2026, Haekchen im "Jetzt posten"-Dialog). Bewusst pro ANFRAGE und nicht als
// Kundeneinstellung: wer oefter sofort postet, will nicht jedes Mal eine Mail.
migrateColumns("post_requests", [["note", "TEXT"], ["notify_email", "INTEGER NOT NULL DEFAULT 0"]]);
migrateColumns("planned_posts", [["branding_version_at_generation", "TEXT"]]);
migrateColumns("pending_approvals", [["branding_version_at_generation", "TEXT"]]);

// Panel-Feinschliff, Aufgabe 4 (18.09.2026): eigene Hashtags als Freitext, zusaetzlich zur
// bestehenden hashtag_pref-Mengensteuerung (keine/wenige/viele). NULL/leer aendert nichts am
// bisherigen Verhalten - erst wenn ein Kunde etwas eintraegt, wird es beim Erzeugen
// beruecksichtigt (siehe anthropic.ts).
migrateColumns("customers", [["custom_hashtags", "TEXT"]]);

// 15.09.2026: Zeilen aus der Zeit VOR dieser Spalte bekommen created_at nachgetragen. Fuer sie
// ist created_at exakt der Moment, in dem ihr Text geschrieben wurde - jeder Weg, der einen Text
// spaeter ersetzt, setzt die Spalte naemlich mit. Ohne diesen Nachtrag gilt "NULL" als "Alter
// unbekannt, im Zweifel veraltet": bei einem Kunden mit Profilwechsel waere damit die ganze
// Woche veraltet gewesen, auch die Beitraege, die nach dem Wechsel und damit schon korrekt
// erzeugt wurden - die haette die naechtliche Auffrischung einmal komplett neu geschrieben
// (Kosten und, schlimmer, ein grundlos anderes Wochenprogramm fuer den Kunden).
for (const tabelle of ["planned_posts", "pending_approvals"]) {
  db.prepare(`UPDATE ${tabelle} SET branding_version_at_generation = created_at WHERE branding_version_at_generation IS NULL`).run();
}

// Nachtrag 3 (18.09.2026): neue Einstellungsgruppe "Verknüpfungen" - /connect/:provider soll nach
// der Rückkehr wissen, ob der Kunde von der Einstellungsseite kam (dann zurück zur Gruppe
// "Verknüpfungen" mit Erfolgsmeldung am Eintrag) oder aus dem Erst-Onboarding (bisheriges
// Verhalten: naechster Onboarding-Schritt). NULL = altes Verhalten, unveraendert.
migrateColumns("oauth_states", [["return_to", "TEXT"]]);

// Easy Onboarding (19.09.2026, Sandbox-Auftrag) - alles additiv, NULL = bisheriges Verhalten:
//   ui_mode   'easy' = der Kunde ist ueber den neuen Ein-Feld-Flow gekommen und landet unter
//             ${mount}/start/ statt im klassischen Panel (siehe router.ts). NULL/'classic' =
//             bestehende Kunden, sehen exakt weiter das, was sie kennen.
//   plan_tier 'basic'/'pro' - nur die Struktur fuer spaetere Preisstufen (tiers.ts), keine
//             Bezahlfunktion. NULL = basic.
// start_previews: serverseitige, neustartfeste Zaehler fuer den Kostenschutz VOR der E-Mail-
// Bestaetigung (start-quota.ts). Kein Fremdschluessel auf customers - ein Zaehler muss auch
// dann noch zaehlen, wenn das unbestaetigte Konto spaeter geloescht wurde (sonst waere Loeschen
// + neu anlegen ein Weg um den Deckel herum).
migrateColumns("customers", [["ui_mode", "TEXT"], ["plan_tier", "TEXT"]]);
// Einmal-Anmeldelink fuer Bildschirm 1 des Easy Onboardings ("bekannte Adresse -> Link per Mail"):
// eigener, eine Stunde gueltiger Token statt des dauerhaften login_key_hash. Sonst koennte jeder,
// der eine fremde E-Mail-Adresse eintippt, den gespeicherten Zugangslink des Kunden entwerten
// (bei "Zugang verloren?" im klassischen Panel ist genau das das gewollte Verhalten, hier nicht).
migrateColumns("customers", [["login_link_token_hash", "TEXT"], ["login_link_expires_at", "TEXT"]]);
// Anmeldung ueber Google/Microsoft/Apple (Auftrag Abschnitt 4). auth_provider/auth_subject sind
// die dauerhafte Zuordnung zum Anbieterkonto - die E-Mail-Adresse allein reicht nicht, weil sie
// sich beim Anbieter aendern kann. NULL = Kunde kam ueber den E-Mail-Weg (alle bestehenden).
migrateColumns("customers", [["auth_provider", "TEXT"], ["auth_subject", "TEXT"]]);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS customers_auth ON customers(auth_provider, auth_subject) WHERE auth_provider IS NOT NULL`);

// Kurzlebiger Zustand eines laufenden Anmeldevorgangs. Eigene Tabelle statt oauth_states: dort
// haengt ein Pflicht-Fremdschluessel auf customers, und beim Anmelden gibt es den Kunden noch
// nicht (genau das ist der Unterschied zwischen "Kanal verbinden" und "Konto anlegen").
db.exec(`
CREATE TABLE IF NOT EXISTS auth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Kostenschutz (Auftrag Abschnitt 8): eine Domain, die schon analysiert wurde, wird eine Zeit
-- lang aus dem Zwischenspeicher bedient statt neu analysiert. Speichert NUR das Ergebnis der
-- Website-Analyse und die erkannten Markenfarben - nichts Kundenbezogenes.
CREATE TABLE IF NOT EXISTS domain_cache (
  domain TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS start_previews (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'preview',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS start_previews_ip ON start_previews(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS start_previews_domain ON start_previews(domain, created_at DESC);
CREATE INDEX IF NOT EXISTS start_previews_customer ON start_previews(customer_id, kind);
`);

export interface CustomerRow {
  standstill_alert_sent_at: string | null;
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
  custom_hashtags: string | null;
  active_weekdays: string | null;
  instagram_weekdays: string | null;
  linkedin_weekdays: string | null;
  pause_from: string | null;
  pause_until: string | null;
  approval_mode: number;
  linkedin_image_mode: string;
  active_theme_id: string | null;
  logo_url: string | null;
  email_verified: number;
  email_verify_token_hash: string | null;
  first_post_email_sent_at: string | null;
  trial_ending_email_sent_at: string | null;
  approval_email_sent_at: string | null;
  skipped_providers: string | null;
  notify_on_publish: number;
  notify_weekly_report: number;
  comment_automation_enabled: number;
  comment_automation_mode: string;
  tour_done_at: string | null;
  login_key_hash: string;
  status: string;
  consent_at: string;
  created_at: string;
  updated_at: string;
  carousel_slide_count: number;
  carousel_auto_frequency: string;
  font_choice: string;
  gradient_enabled: number;
  gradient_color2: string | null;
  gradient_direction: string;
  branding_last_changed_at: string | null;
  google_review_automation_enabled: number;
  google_review_mode: string;
  google_review_posts_enabled: number;
  google_review_post_min_stars: number;
  video_enabled: number;
  video_weekdays: string | null;
  video_post_time: string | null;
  video_length_seconds: number;
  video_zoom_direction: string;
  video_voice: string;
  video_voice_enabled: number;
  /** Easy Onboarding: 'easy' | 'classic' | NULL (= classic). */
  ui_mode: string | null;
  /** Preisstufen-Struktur (tiers.ts): 'basic' | 'pro' | NULL (= basic). */
  plan_tier: string | null;
  login_link_token_hash: string | null;
  login_link_expires_at: string | null;
  /** 'google' | 'microsoft' | 'apple' | NULL (= ueber E-Mail angelegt). */
  auth_provider: string | null;
  /** Dauerhafte Kennung des Kontos beim Anbieter ("sub"). */
  auth_subject: string | null;
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
  expiry_warning_sent_at: string | null;
  /** Gesetzt, sobald die Plattform diese Verbindung gesperrt hat - siehe connection-block.ts. */
  blocked_at: string | null;
  /** Kurzschlüssel der Sperre, z.B. "RESTRICTED_MEMBER" oder "IG_RESTRICTED_ACTIVITY". */
  blocked_code: string | null;
  /** Klartext für das Panel, ohne technische Rohdaten. */
  blocked_reason: string | null;
}

/** Eine Medien-ID, deren Kommentar-Abruf wiederholt gescheitert ist (comment-backoff.ts). */
export interface CommentFetchFailureRow {
  customer_id: string;
  media_id: string;
  failures: number;
  first_failed_at: string;
  last_failed_at: string;
  last_status: number | null;
  last_error: string | null;
  retry_after: string;
  paused_logged_at: string | null;
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
  format: string;
  video_url: string | null;
}

/** Panel v14: eine Zeile pro Slide eines Mehrbild-Posts (Karussell/Video-Diashow), siehe db.ts
 *  Schema-Kommentar bei post_media. `owner_type` ist 'post' | 'pending_approval' | 'planned_post'. */
export interface PostMediaRow {
  id: string;
  owner_type: string;
  owner_id: string;
  position: number;
  image_url: string;
  overlay_text: string | null;
  created_at: string;
}

export interface AnalyticsAccountSnapshotRow {
  id: string;
  customer_id: string;
  channel: string;
  snapshot_date: string;
  follower_count: number | null;
  reach: number | null;
  views: number | null;
  accounts_engaged: number | null;
  total_interactions: number | null;
  created_at: string;
}

export interface AnalyticsPostSnapshotRow {
  id: string;
  post_id: string;
  customer_id: string;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  reach: number | null;
  fetched_at: string;
}

export interface UsageCostRow {
  id: string;
  customer_id: string | null;
  feature: string;
  estimated_cost_usd: number | null;
  created_at: string;
}

export interface AnalyticsSummaryRow {
  customer_id: string;
  channel: string;
  summary: string;
  generated_at: string;
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
  image_source?: string;
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
  format: string;
  branding_version_at_generation: string | null;
  origin: string;
  video_url: string | null;
}

export interface PostRequestRow {
  id: string;
  customer_id: string;
  topic: string | null;
  channel: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  format: string;
  note: string | null;
  notify_email: number;
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
  format: string;
  branding_version_at_generation: string | null;
  origin: string;
  image_source: string;
  video_url: string | null;
}

export interface PlanningErrorRow {
  id: string;
  customer_id: string | null;
  channel: string | null;
  scheduled_for: string | null;
  message: string;
  created_at: string;
}

export interface ProcessedCommentRow {
  id: string;
  comment_id: string;
  customer_id: string;
  media_id: string;
  comment_text: string;
  author_username: string | null;
  comment_type: string;
  generated_reply: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface GoogleReviewRow {
  id: string;
  review_name: string;
  customer_id: string;
  location_name: string;
  reviewer_name: string | null;
  star_rating: number;
  review_text: string;
  review_created_at: string | null;
  generated_reply: string | null;
  status: string;
  reply_state: string | null;
  policy_violation: string | null;
  rejected_notified_at: string | null;
  social_post_status: string | null;
  social_post_id: string | null;
  created_at: string;
  updated_at: string;
}

export const nowIso = (): string => new Date().toISOString();

export function cleanupExpired(): void {
  const now = nowIso();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM auth_states WHERE expires_at < ?").run(now);
}
