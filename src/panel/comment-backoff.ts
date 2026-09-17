/**
 * Merkt sich, welche Medien-IDs beim Kommentar-Abruf scheitern, und hält den nächsten Versuch
 * zurück (Rechenlogik in backoff.ts, Tabelle `comment_fetch_failures` in db.ts).
 *
 * Vorher: comments.ts fragte für jeden Beitrag der letzten 14 Tage bei JEDEM Cron-Lauf die
 * Kommentare ab. Antwortete die Graph-API dauerhaft mit HTTP 400 (Medium gelöscht, für die App
 * nicht mehr sichtbar, Berechtigung entzogen), wiederholte sich das alle 45 Minuten - unbegrenzt
 * und mit einer Fehlerzeile pro Versuch.
 *
 * Nachher: die ersten Fehlschläge laufen unverändert weiter (ein Aussetzer soll nichts bremsen),
 * ab dem dritten wächst der Abstand exponentiell, ab dem zehnten ruht die ID sieben Tage - und
 * genau einmal wird dazu eine Logzeile geschrieben, nicht bei jedem übersprungenen Versuch.
 */
import { db, type CommentFetchFailureRow } from "./db.js";
import { backoffDelayMs, classifyFailure, formatDelay, isPaused, mayAttempt, nextAttemptAt } from "./backoff.js";

/** Ergebnis eines aufgezeichneten Fehlschlags - steuert, ob der Aufrufer noch etwas loggen soll. */
export interface FailureOutcome {
  /** Wievielter dauerhafter Fehlschlag in Folge für diese ID. */
  failures: number;
  /** True, sobald die 7-Tage-Pause greift. */
  paused: boolean;
  /** Nur beim allerersten Eintritt in die Pause true - dann (und nur dann) lohnt eine Logzeile. */
  firstPause: boolean;
  /** Ob der Aufrufer diesen Fehlschlag überhaupt loggen soll. */
  shouldLog: boolean;
  /** Menschenlesbarer Abstand bis zum nächsten Versuch, für die Logzeile. */
  retryIn: string;
}

function findRow(customerId: string, mediaId: string): CommentFetchFailureRow | undefined {
  return db
    .prepare("SELECT * FROM comment_fetch_failures WHERE customer_id = ? AND media_id = ?")
    .get(customerId, mediaId) as CommentFetchFailureRow | undefined;
}

/**
 * Darf für diese Medien-ID jetzt abgefragt werden? Ohne Eintrag immer ja - der Normalfall kostet
 * damit genau eine indizierte Punktabfrage und ändert am bisherigen Verhalten nichts.
 */
export function mayFetchComments(customerId: string, mediaId: string, nowMs: number = Date.now()): boolean {
  const row = findRow(customerId, mediaId);
  if (!row) return true;
  return mayAttempt(row.retry_after, nowMs);
}

/**
 * Zeichnet einen fehlgeschlagenen Abruf auf und berechnet den nächsten erlaubten Versuch.
 *
 * Vorübergehende Fehler (Netz, Zeitüberschreitung, 429, 5xx) erhöhen den Zähler bewusst NICHT:
 * sie sagen nichts über die Medien-ID aus. Sie werden wie bisher normal geloggt, damit ein echter
 * Ausfall der Plattform nicht unsichtbar wird.
 */
export function recordCommentFetchFailure(
  customerId: string,
  mediaId: string,
  status: number | undefined,
  message: string,
  nowMs: number = Date.now(),
): FailureOutcome {
  const kind = classifyFailure(status);
  const now = new Date(nowMs).toISOString();

  if (kind === "voruebergehend") {
    // Nichts merken, nichts zurückhalten - aber loggen, damit echte Störungen sichtbar bleiben.
    return { failures: 0, paused: false, firstPause: false, shouldLog: true, retryIn: "nächster Lauf" };
  }

  const row = findRow(customerId, mediaId);
  const failures = (row?.failures ?? 0) + 1;
  const retryAfter = nextAttemptAt(failures, nowMs);
  const paused = isPaused(failures);
  const firstPause = paused && !row?.paused_logged_at;

  db.prepare(
    `INSERT INTO comment_fetch_failures
       (customer_id, media_id, failures, first_failed_at, last_failed_at, last_status, last_error, retry_after, paused_logged_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(customer_id, media_id) DO UPDATE SET
       failures = excluded.failures,
       last_failed_at = excluded.last_failed_at,
       last_status = excluded.last_status,
       last_error = excluded.last_error,
       retry_after = excluded.retry_after,
       paused_logged_at = COALESCE(comment_fetch_failures.paused_logged_at, excluded.paused_logged_at)`,
  ).run(
    customerId,
    mediaId,
    failures,
    row?.first_failed_at ?? now,
    now,
    status ?? null,
    message.slice(0, 300),
    retryAfter,
    paused ? now : null,
  );

  return {
    failures,
    paused,
    firstPause,
    // Solange kein Abstand greift, verhält es sich wie bisher (jeder Fehlschlag wird geloggt).
    // Sobald zurückgehalten wird, nur noch der Übergang selbst und der Eintritt in die Pause.
    shouldLog: failures <= 3 || firstPause,
    retryIn: formatDelay(backoffDelayMs(failures)),
  };
}

/** Nach einem erfolgreichen Abruf: Zähler weg, die ID ist wieder ganz normal dabei. */
export function clearCommentFetchFailures(customerId: string, mediaId: string): void {
  db.prepare("DELETE FROM comment_fetch_failures WHERE customer_id = ? AND media_id = ?").run(customerId, mediaId);
}

/** Aktuell zurückgehaltene Medien-IDs eines Kunden - für Panel-Anzeige und Fehlersuche. */
export function listHeldBackMedia(customerId: string, nowMs: number = Date.now()): CommentFetchFailureRow[] {
  const rows = db
    .prepare("SELECT * FROM comment_fetch_failures WHERE customer_id = ? ORDER BY failures DESC")
    .all(customerId) as CommentFetchFailureRow[];
  return rows.filter((r) => !mayAttempt(r.retry_after, nowMs));
}

/** Aufräumen: Einträge, deren Rückhaltezeit lange vorbei ist, sind wertlos. */
export function cleanupCommentFetchFailures(olderThanDays = 30): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  return db.prepare("DELETE FROM comment_fetch_failures WHERE last_failed_at < ?").run(cutoff).changes;
}
