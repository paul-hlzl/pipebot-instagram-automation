/**
 * KI-Kommentar-Automatisierung (Panel v10, Instagram v1 - siehe Session-Bericht). Eigenständiger
 * Cron alle COMMENT_CRON_INTERVAL_MINUTES Minuten (bewusst NICHT Teil der stündlichen
 * Posting-Routine oder der taeglichen Analytics-/Planungs-Crons) - holt für jeden Kunden mit
 * aktivierter Automatisierung die Kommentare der letzten COMMENT_LOOKBACK_DAYS Tage veröffentlichter
 * Beiträge, klassifiziert jeden neuen obersten Kommentar per KI und beantwortet ihn (automatisch
 * oder erst nach Freigabe, je nach comment_automation_mode). Ein Fehler bei einem Kunden/Post
 * bricht den Lauf für alle anderen nicht ab - gleiches K9-Isolationsprinzip wie überall sonst
 * (planUpcomingPosts, runDailyAnalyticsSnapshot).
 *
 * v1 scope: Instagram only (LinkedIn siehe Session-Bericht - Community Management API erfordert
 * eine eigene Partner-Bewerbung, separat zu bewerten). Kein eigenes Retry/Dead-Letter für einen
 * Kommentar, dessen Antwort-Versand fehlschlägt - er bleibt unverarbeitet und wird beim nächsten
 * Lauf automatisch erneut versucht (IG-Fehler sind meist transient); ebenso keine Pagination über
 * die erste Seite von /{media-id}/comments hinaus (ausreichend für das erwartete Kommentar-Volumen
 * kleiner Business-Accounts).
 */
import { db, nowIso, type CustomerRow, type PostRow, type ProcessedCommentRow } from "./db.js";
import { resolveInstagramCredentials } from "./credentials.js";
import { fetchTopLevelComments, postCommentReply, type IncomingComment } from "../instagram-comments.js";
import { classifyAndAnswerComment } from "../anthropic.js";
import { logUsageCost } from "./analytics.js";
import { randomToken } from "./crypto.js";

const COMMENT_LOOKBACK_DAYS = 14;
const COMMENT_CRON_INTERVAL_MINUTES = 12;
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
    let comments: IncomingComment[];
    try {
      comments = await fetchTopLevelComments(post.external_post_id as string, creds);
    } catch (err) {
      console.error(`[comments] ${customer.id}/${post.external_post_id}: Kommentare konnten nicht geladen werden:`, err instanceof Error ? err.message : err);
      result.errors++;
      continue;
    }

    for (const comment of comments) {
      if (isCommentProcessed(comment.id)) continue;
      if (comment.username && ownUsername && stripAt(comment.username) === ownUsername) continue; // eigener Kommentar/eigene Antwort

      let classification;
      try {
        classification = await classifyAndAnswerComment({
          commentText: comment.text,
          company: customer.company,
          industry: customer.industry ?? "",
          about: customer.about ?? "",
          tone: customer.tone ?? "sachlich",
          language: customer.language ?? "de",
          postHeadline: post.headline,
          postCaption: post.caption,
        });
        logUsageCost(customer.id, "comment-reply", classification.costUsd);
      } catch (err) {
        // Keine Zeile gespeichert - wird beim naechsten Lauf erneut versucht (kein Anthropic-
        // Verbrauch, wenn dieser Aufruf selbst schon fehlgeschlagen ist).
        console.error(`[comments] ${customer.id}/${comment.id}: Klassifizierung fehlgeschlagen:`, err instanceof Error ? err.message : err);
        result.errors++;
        continue;
      }

      if (classification.type !== "question" || !classification.reply) {
        saveProcessedComment({
          commentId: comment.id,
          customerId: customer.id,
          mediaId: post.external_post_id as string,
          commentText: comment.text,
          authorUsername: comment.username,
          commentType: classification.type,
          generatedReply: null,
          status: "skipped",
        });
        result.skipped++;
        continue;
      }

      if (customer.comment_automation_mode !== "auto") {
        saveProcessedComment({
          commentId: comment.id,
          customerId: customer.id,
          mediaId: post.external_post_id as string,
          commentText: comment.text,
          authorUsername: comment.username,
          commentType: classification.type,
          generatedReply: classification.reply,
          status: "pending_approval",
        });
        result.pendingApproval++;
        continue;
      }

      // Auto-Modus: sofort senden, aber nie ueber das Stunden-Limit hinaus (Punkt 4) - wird
      // dieser Kunde in diesem Lauf schon gedrosselt, bleiben die restlichen neuen Kommentare
      // unverarbeitet (keine Zeile gespeichert) und werden beim naechsten Lauf erneut versucht.
      if (repliesSentInLastHour(customer.id) >= COMMENT_AUTO_REPLY_MAX_PER_HOUR) {
        console.error(`[comments] ${customer.id}: Stunden-Limit (${COMMENT_AUTO_REPLY_MAX_PER_HOUR}) erreicht, restliche neue Kommentare folgen im nächsten Lauf.`);
        return result;
      }
      try {
        await postCommentReply(comment.id, classification.reply, creds);
        saveProcessedComment({
          commentId: comment.id,
          customerId: customer.id,
          mediaId: post.external_post_id as string,
          commentText: comment.text,
          authorUsername: comment.username,
          commentType: classification.type,
          generatedReply: classification.reply,
          status: "answered",
        });
        result.answered++;
      } catch (err) {
        console.error(`[comments] ${customer.id}/${comment.id}: Antwort-Versand fehlgeschlagen:`, err instanceof Error ? err.message : err);
        result.errors++;
      }
    }
  }

  return result;
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
