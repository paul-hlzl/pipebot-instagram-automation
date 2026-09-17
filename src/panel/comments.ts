/**
 * KI-Kommentar-Automatisierung (Panel v10, Instagram v1 - siehe Session-Bericht).
 *
 * Seit Panel v11 (Webhooks, siehe Session-Bericht 2026-09-14) ist der primäre Auslöser das
 * `comments`-Webhook-Feld von Meta (webhooks.ts -> handleWebhookComment unten) - ein neuer
 * Kommentar wird dadurch typischerweise innerhalb von Sekunden beantwortet, nicht erst beim
 * nächsten Cron-Tick. Der Cron alle COMMENT_CRON_INTERVAL_MINUTES Minuten (bewusst NICHT Teil der
 * stündlichen Posting-Routine oder der taeglichen Analytics-/Planungs-Crons) läuft unverändert
 * als Sicherheitsnetz weiter - falls ein Webhook-Event verloren geht (Meta liefert nicht
 * garantiert, ein Kundenserver war kurz down, das Abo wurde nie eingerichtet) - holt er für jeden
 * Kunden mit aktivierter Automatisierung die Kommentare der letzten COMMENT_LOOKBACK_DAYS Tage
 * veröffentlichter Beiträge nach. Beide Wege laufen über dieselbe classifyAndRespondToComment()
 * und denselben `processed_comments`-Dedupe (isCommentProcessed) - ein Kommentar, den der Webhook
 * schon beantwortet hat, wird vom Cron nie doppelt angefasst, und umgekehrt. Klassifiziert jeden
 * neuen obersten Kommentar per KI und beantwortet ihn (automatisch oder erst nach Freigabe, je
 * nach comment_automation_mode). Ein Fehler bei einem Kunden/Post bricht den Lauf für alle
 * anderen nicht ab - gleiches K9-Isolationsprinzip wie überall sonst (planUpcomingPosts,
 * runDailyAnalyticsSnapshot).
 *
 * v1 scope: Instagram only (LinkedIn siehe Session-Bericht - Community Management API erfordert
 * eine eigene Partner-Bewerbung, separat zu bewerten). Kein eigenes Retry/Dead-Letter für einen
 * Kommentar, dessen Antwort-Versand fehlschlägt - er bleibt unverarbeitet und wird vom nächsten
 * Cron-Lauf automatisch erneut versucht (IG-Fehler sind meist transient); ebenso keine Pagination
 * über die erste Seite von /{media-id}/comments hinaus (ausreichend für das erwartete
 * Kommentar-Volumen kleiner Business-Accounts - betrifft nur den Cron-Pfad, der Webhook-Pfad
 * bekommt jeden Kommentar einzeln zugestellt und braucht keine Pagination).
 */
import axios from "axios";
import { db, nowIso, type CustomerRow, type PostRow, type ProcessedCommentRow } from "./db.js";
import { resolveInstagramCredentials } from "./credentials.js";
import { clearCommentFetchFailures, mayFetchComments, recordCommentFetchFailure } from "./comment-backoff.js";
import { fetchTopLevelComments, postCommentReply, type IncomingComment } from "../instagram-comments.js";
import { classifyAndAnswerComment } from "../anthropic.js";
import { logUsageCost } from "./analytics.js";
import { randomToken } from "./crypto.js";
import type { InstagramCredentials } from "../instagram.js";

const COMMENT_LOOKBACK_DAYS = 14;
/** Jetzt nur noch Sicherheitsnetz-Intervall (siehe Dateikopf) - per Env überschreibbar, Default
 *  auf 45 Minuten entspannt (vorher 12, als der Cron noch der einzige Auslöser war). */
const COMMENT_CRON_INTERVAL_MINUTES = Number(process.env.COMMENT_CRON_FALLBACK_MINUTES) || 45;
/** Configurable constant (Punkt 4) - caps actual reply-POSTs to Instagram per customer/hour, whether auto-sent or approved-then-sent, to avoid anything that looks like spam/abuse to the platform. */
const COMMENT_AUTO_REPLY_MAX_PER_HOUR = Number(process.env.PANEL_COMMENT_REPLY_MAX_PER_HOUR) || 10;
const REQUIRED_SCOPE = "instagram_business_manage_comments";

export interface ProcessedComment {
  id: string;
  commentId: string;
  customerId: string;
  mediaId: string;
  commentText: string;
  authorUsername: string | null;
  commentType: string;
  generatedReply: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function toProcessedComment(r: ProcessedCommentRow): ProcessedComment {
  return {
    id: r.id,
    commentId: r.comment_id,
    customerId: r.customer_id,
    mediaId: r.media_id,
    commentText: r.comment_text,
    authorUsername: r.author_username,
    commentType: r.comment_type,
    generatedReply: r.generated_reply,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function isCommentProcessed(commentId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM processed_comments WHERE comment_id = ?").get(commentId));
}

function saveProcessedComment(input: {
  commentId: string;
  customerId: string;
  mediaId: string;
  commentText: string;
  authorUsername: string | null;
  commentType: string;
  generatedReply: string | null;
  status: string;
}): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO processed_comments (id, comment_id, customer_id, media_id, comment_text, author_username, comment_type, generated_reply, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `cmt_${randomToken(9)}`,
    input.commentId,
    input.customerId,
    input.mediaId,
    input.commentText,
    input.authorUsername,
    input.commentType,
    input.generatedReply,
    input.status,
    now,
    now,
  );
}

/** Actual reply-POSTs to Instagram in the last hour for this customer, auto-sent or approved-then-sent alike (see COMMENT_AUTO_REPLY_MAX_PER_HOUR doc comment). */
function repliesSentInLastHour(customerId: string): number {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  return (
    db
      .prepare("SELECT COUNT(*) as n FROM processed_comments WHERE customer_id = ? AND status = 'answered' AND updated_at >= ?")
      .get(customerId, since) as { n: number }
  ).n;
}

/** A customer's own comment replies waiting for review ("wartet_auf_freigabe"), newest first. */
export function listPendingCommentApprovals(customerId: string): ProcessedComment[] {
  const rows = db
    .prepare("SELECT * FROM processed_comments WHERE customer_id = ? AND status = 'pending_approval' ORDER BY created_at DESC")
    .all(customerId) as ProcessedCommentRow[];
  return rows.map(toProcessedComment);
}

export class CommentRateLimitError extends Error {}

/**
 * Approves and immediately sends one pending comment reply (optionally with edited text) - scoped
 * to the given customer, so one customer can never touch another's. Returns null if not
 * found/not theirs/not pending. Throws CommentRateLimitError if this customer already hit
 * COMMENT_AUTO_REPLY_MAX_PER_HOUR this hour - the row stays 'pending_approval' so the customer can
 * simply try again later.
 */
export async function approveCommentReply(customerId: string, id: string, editedReply?: string): Promise<ProcessedComment | null> {
  const row = db
    .prepare("SELECT * FROM processed_comments WHERE id = ? AND customer_id = ? AND status = 'pending_approval'")
    .get(id, customerId) as ProcessedCommentRow | undefined;
  if (!row) return null;
  if (repliesSentInLastHour(customerId) >= COMMENT_AUTO_REPLY_MAX_PER_HOUR) {
    throw new CommentRateLimitError(`Maximale Anzahl automatischer Antworten pro Stunde (${COMMENT_AUTO_REPLY_MAX_PER_HOUR}) erreicht - bitte in Kürze erneut versuchen.`);
  }
  const replyText = (editedReply?.trim() || row.generated_reply || "").trim();
  if (!replyText) throw new Error("Kein Antworttext vorhanden.");
  const creds = await resolveInstagramCredentials(customerId);
  if (!creds) throw new Error("Instagram nicht verbunden.");
  await postCommentReply(row.comment_id, replyText, creds);
  const now = nowIso();
  db.prepare("UPDATE processed_comments SET generated_reply = ?, status = 'answered', updated_at = ? WHERE id = ?").run(replyText, now, row.id);
  return toProcessedComment(db.prepare("SELECT * FROM processed_comments WHERE id = ?").get(row.id) as ProcessedCommentRow);
}

/** Rejects one pending comment reply - it is never sent. Scoped to the given customer like approveCommentReply. */
export function rejectCommentReply(customerId: string, id: string): ProcessedComment | null {
  const now = nowIso();
  const result = db
    .prepare("UPDATE processed_comments SET status = 'rejected', updated_at = ? WHERE id = ? AND customer_id = ? AND status = 'pending_approval'")
    .run(now, id, customerId);
  if (result.changes === 0) return null;
  return toProcessedComment(db.prepare("SELECT * FROM processed_comments WHERE id = ?").get(id) as ProcessedCommentRow);
}

/** Last `days` days, grouped by status - for the customer's own settings page and the admin overview. */
export function commentStatsForCustomer(customerId: string, days = 30): { answered: number; skipped: number; pendingApproval: number; rejected: number } {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = db
    .prepare("SELECT status, COUNT(*) as n FROM processed_comments WHERE customer_id = ? AND created_at >= ? GROUP BY status")
    .all(customerId, since) as { status: string; n: number }[];
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return {
    answered: byStatus.answered ?? 0,
    skipped: byStatus.skipped ?? 0,
    pendingApproval: byStatus.pending_approval ?? 0,
    rejected: byStatus.rejected ?? 0,
  };
}

const stripAt = (s: string): string => s.replace(/^@/, "").toLowerCase();

interface CustomerCommentResult {
  answered: number;
  skipped: number;
  pendingApproval: number;
  errors: number;
}

type ClassifyOutcome = "answered" | "skipped" | "pending_approval" | "error" | "rate_limited";

/**
 * Klassifiziert einen einzelnen, noch nicht verarbeiteten obersten Kommentar per KI und
 * beantwortet ihn (oder legt ihn zur Freigabe an), je nach comment_automation_mode. Geteilte
 * Kernlogik für BEIDE Auslöser (Cron-Pfad in processCustomerComments und der Webhook-Pfad in
 * handleWebhookComment unten) - ein Kommentar bekommt exakt dieselbe Behandlung unabhängig davon,
 * wie er hereinkam. `post` ist optional: beim Webhook-Pfad kann ein Kommentar auf einem Media
 * eintreffen, das nicht (mehr) in der eigenen `posts`-Tabelle steht (z.B. ein organischer,
 * nicht über die Pipeline veröffentlichter Beitrag) - classifyAndAnswerComment kommt bewusst
 * auch ganz ohne Post-Kontext aus ("kein Text verfügbar"), statt den Kommentar deswegen zu
 * verwerfen.
 */
async function classifyAndRespondToComment(
  customer: CustomerRow,
  post: PostRow | undefined,
  mediaId: string,
  comment: IncomingComment,
  creds: InstagramCredentials,
): Promise<ClassifyOutcome> {
  let classification;
  try {
    classification = await classifyAndAnswerComment({
      commentText: comment.text,
      company: customer.company,
      industry: customer.industry ?? "",
      about: customer.about ?? "",
      tone: customer.tone ?? "sachlich",
      language: customer.language ?? "de",
      postHeadline: post?.headline ?? null,
      postCaption: post?.caption ?? null,
    });
    logUsageCost(customer.id, "comment-reply", classification.costUsd);
  } catch (err) {
    // Keine Zeile gespeichert - wird beim naechsten Cron-Lauf erneut versucht (kein Anthropic-
    // Verbrauch, wenn dieser Aufruf selbst schon fehlgeschlagen ist).
    console.error(`[comments] ${customer.id}/${comment.id}: Klassifizierung fehlgeschlagen:`, err instanceof Error ? err.message : err);
    return "error";
  }

  if (classification.type !== "question" || !classification.reply) {
    saveProcessedComment({
      commentId: comment.id,
      customerId: customer.id,
      mediaId,
      commentText: comment.text,
      authorUsername: comment.username,
      commentType: classification.type,
      generatedReply: null,
      status: "skipped",
    });
    return "skipped";
  }

  if (customer.comment_automation_mode !== "auto") {
    saveProcessedComment({
      commentId: comment.id,
      customerId: customer.id,
      mediaId,
      commentText: comment.text,
      authorUsername: comment.username,
      commentType: classification.type,
      generatedReply: classification.reply,
      status: "pending_approval",
    });
    return "pending_approval";
  }

  // Auto-Modus: sofort senden, aber nie ueber das Stunden-Limit hinaus (Punkt 4) - wird dieser
  // Kunde gerade gedrosselt, bleibt der Kommentar unverarbeitet (keine Zeile gespeichert) und
  // wird spaeter erneut versucht (naechster Webhook-Retry von Meta bzw. der Cron-Fallback).
  if (repliesSentInLastHour(customer.id) >= COMMENT_AUTO_REPLY_MAX_PER_HOUR) {
    console.error(`[comments] ${customer.id}: Stunden-Limit (${COMMENT_AUTO_REPLY_MAX_PER_HOUR}) erreicht - Kommentar ${comment.id} folgt spaeter.`);
    return "rate_limited";
  }
  try {
    await postCommentReply(comment.id, classification.reply, creds);
    saveProcessedComment({
      commentId: comment.id,
      customerId: customer.id,
      mediaId,
      commentText: comment.text,
      authorUsername: comment.username,
      commentType: classification.type,
      generatedReply: classification.reply,
      status: "answered",
    });
    return "answered";
  } catch (err) {
    console.error(`[comments] ${customer.id}/${comment.id}: Antwort-Versand fehlgeschlagen:`, err instanceof Error ? err.message : err);
    return "error";
  }
}

function tallyOutcome(result: CustomerCommentResult, outcome: ClassifyOutcome): void {
  if (outcome === "answered") result.answered++;
  else if (outcome === "skipped") result.skipped++;
  else if (outcome === "pending_approval") result.pendingApproval++;
  else if (outcome === "error") result.errors++;
  // "rate_limited" zaehlt bewusst nirgends mit - kein Fehler, nur ein spaeterer Versuch.
}

async function processCustomerComments(customer: CustomerRow): Promise<CustomerCommentResult> {
  const result: CustomerCommentResult = { answered: 0, skipped: 0, pendingApproval: 0, errors: 0 };

  const connRow = db
    .prepare("SELECT scopes, account_name FROM connections WHERE customer_id = ? AND provider = 'instagram'")
    .get(customer.id) as { scopes: string | null; account_name: string | null } | undefined;
  if (!connRow) return result; // Instagram nicht verbunden - nichts zu tun

  if (!(connRow.scopes ?? "").includes(REQUIRED_SCOPE)) {
    console.error(
      `[comments] ${customer.id}: Instagram-Verbindung hat noch nicht die Berechtigung ${REQUIRED_SCOPE} - Kunde muss Instagram im Panel einmal neu verbinden.`,
    );
    result.errors++;
    return result;
  }

  let creds;
  try {
    creds = await resolveInstagramCredentials(customer.id);
  } catch (err) {
    console.error(`[comments] ${customer.id}: Zugangsdaten nicht verfügbar (Trial/Pause/Token):`, err instanceof Error ? err.message : err);
    result.errors++;
    return result;
  }
  if (!creds) return result;

  const since = new Date(Date.now() - COMMENT_LOOKBACK_DAYS * 86_400_000).toISOString();
  const posts = db
    .prepare("SELECT * FROM posts WHERE customer_id = ? AND provider = 'instagram' AND external_post_id IS NOT NULL AND posted_at >= ?")
    .all(customer.id, since) as PostRow[];

  const ownUsername = connRow.account_name ? stripAt(connRow.account_name) : null;

  for (const post of posts) {
    const mediaId = post.external_post_id as string;

    // Medien-IDs, die die Graph-API dauerhaft ablehnt, werden zurückgehalten statt bei jedem
    // Lauf erneut abgefragt (siehe comment-backoff.ts). Ein übersprungener Versuch ist kein
    // Fehler und wird deshalb weder gezählt noch geloggt.
    if (!mayFetchComments(customer.id, mediaId)) continue;

    let comments: IncomingComment[];
    try {
      comments = await fetchTopLevelComments(mediaId, creds);
      clearCommentFetchFailures(customer.id, mediaId);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const message = err instanceof Error ? err.message : String(err);
      const outcome = recordCommentFetchFailure(customer.id, mediaId, status, message);
      if (outcome.firstPause) {
        console.error(
          `[comments] ${customer.id}/${mediaId}: Abruf ${outcome.failures}x hintereinander gescheitert (zuletzt HTTP ${status ?? "-"}) - ` +
            `diese Medien-ID pausiert jetzt ${outcome.retryIn}. Letzter Fehler: ${message}`,
        );
      } else if (outcome.shouldLog) {
        console.error(
          `[comments] ${customer.id}/${mediaId}: Kommentare konnten nicht geladen werden (Versuch ${outcome.failures}, nächster in ${outcome.retryIn}):`,
          message,
        );
      }
      result.errors++;
      continue;
    }

    for (const comment of comments) {
      if (isCommentProcessed(comment.id)) continue;
      if (comment.username && ownUsername && stripAt(comment.username) === ownUsername) continue; // eigener Kommentar/eigene Antwort

      const outcome = await classifyAndRespondToComment(customer, post, mediaId, comment, creds);
      if (outcome === "rate_limited") return result; // restliche neue Kommentare folgen im naechsten Lauf
      tallyOutcome(result, outcome);
    }
  }

  return result;
}

/**
 * Einstiegspunkt für den Webhook-Pfad (webhooks.ts) - ein einzelner `comments`-Change-Event von
 * Meta, schon auf das Nötigste geparst. Läuft dieselbe Klassifizierungs-/Antwort-Logik wie der
 * Cron (classifyAndRespondToComment), nur ohne den Umweg über /{media-id}/comments - das Webhook-
 * Event bringt den Kommentartext bereits mit. Dieselbe Berechtigungs-/Trial-/Pause-/Eigenkommentar-
 * Prüfung wie im Cron-Pfad, damit ein Kunde nie über den einen Weg beantwortet wird und über den
 * anderen nicht (oder umgekehrt inkonsistent behandelt wird). isCommentProcessed sorgt zusätzlich
 * dafür, dass ein Kommentar, der z.B. schon vom Cron-Fallback beantwortet wurde, hier nicht noch
 * einmal angefasst wird (Meta kann Events auch doppelt zustellen).
 */
export async function handleWebhookComment(input: {
  igAccountId: string;
  mediaId: string;
  commentId: string;
  commentText: string;
  authorUsername: string | null;
}): Promise<void> {
  if (isCommentProcessed(input.commentId)) return;

  const connRow = db
    .prepare("SELECT customer_id, scopes, account_name FROM connections WHERE provider = 'instagram' AND account_id = ?")
    .get(input.igAccountId) as { customer_id: string; scopes: string | null; account_name: string | null } | undefined;
  if (!connRow) {
    console.error(`[comments-webhook] unbekannte Instagram-Account-ID ${input.igAccountId} - kein Kunde zugeordnet.`);
    return;
  }

  const customer = db
    .prepare(
      "SELECT * FROM customers WHERE id = ? AND status = 'active' AND customer_paused = 0 AND email_verified = 1 AND comment_automation_enabled = 1",
    )
    .get(connRow.customer_id) as CustomerRow | undefined;
  if (!customer) return; // Automatisierung aus/Kunde nicht bereit - kein Fehler, einfach nichts zu tun

  if (!(connRow.scopes ?? "").includes(REQUIRED_SCOPE)) {
    console.error(`[comments-webhook] ${customer.id}: Instagram-Verbindung hat noch nicht die Berechtigung ${REQUIRED_SCOPE}.`);
    return;
  }

  const ownUsername = connRow.account_name ? stripAt(connRow.account_name) : null;
  if (input.authorUsername && ownUsername && stripAt(input.authorUsername) === ownUsername) return; // eigener Kommentar/eigene Antwort

  let creds;
  try {
    creds = await resolveInstagramCredentials(customer.id);
  } catch (err) {
    console.error(`[comments-webhook] ${customer.id}: Zugangsdaten nicht verfügbar (Trial/Pause/Token):`, err instanceof Error ? err.message : err);
    return;
  }
  if (!creds) return;

  const post = db
    .prepare("SELECT * FROM posts WHERE customer_id = ? AND provider = 'instagram' AND external_post_id = ?")
    .get(customer.id, input.mediaId) as PostRow | undefined;

  await classifyAndRespondToComment(
    customer,
    post,
    input.mediaId,
    { id: input.commentId, text: input.commentText, username: input.authorUsername, timestamp: null },
    creds,
  );
}

interface CommentRunSummary {
  startedAt: string;
  finishedAt: string;
  customersChecked: number;
  answered: number;
  skipped: number;
  pendingApproval: number;
  errors: number;
}

export async function runCommentAutomationPass(): Promise<CommentRunSummary> {
  const startedAt = nowIso();
  const summary: CommentRunSummary = { startedAt, finishedAt: startedAt, customersChecked: 0, answered: 0, skipped: 0, pendingApproval: 0, errors: 0 };

  const customers = db
    .prepare("SELECT * FROM customers WHERE status = 'active' AND customer_paused = 0 AND email_verified = 1 AND comment_automation_enabled = 1")
    .all() as CustomerRow[];

  for (const customer of customers) {
    summary.customersChecked++;
    try {
      const r = await processCustomerComments(customer);
      summary.answered += r.answered;
      summary.skipped += r.skipped;
      summary.pendingApproval += r.pendingApproval;
      summary.errors += r.errors;
    } catch (err) {
      summary.errors++;
      console.error(`[comments] ${customer.id}: unerwarteter Fehler:`, err instanceof Error ? err.message : err);
    }
  }

  summary.finishedAt = nowIso();
  return summary;
}

/** Eigenständiger Cron, unabhängig von der stündlichen Posting-Routine und den täglichen Analytics-/Planungs-Crons (siehe Dateikopf). */
export function startCommentAutomationSchedule(intervalMinutes = COMMENT_CRON_INTERVAL_MINUTES): NodeJS.Timeout {
  const run = () =>
    runCommentAutomationPass()
      .then((summary) => {
        if (summary.customersChecked) console.log("[panel] Kommentar-Automatisierung:", summary);
      })
      .catch((err) => console.error("[panel] Kommentar-Automatisierung unerwartet fehlgeschlagen:", err));
  setTimeout(run, 60_000);
  return setInterval(run, intervalMinutes * 60_000);
}
