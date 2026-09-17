/**
 * Rückzugs-Logik (Backoff) für Plattform-Abrufe, die wiederholt fehlschlagen.
 *
 * Hintergrund: der Kommentar-Abruf (comments.ts) lief für eine Medien-ID, die die Graph-API
 * dauerhaft mit HTTP 400 ablehnt, bei JEDEM Cron-Lauf erneut - alle 45 Minuten, unbegrenzt, mit
 * einer Fehlerzeile pro Versuch. Ein einzelner Kunde hat so über 2.300 Logzeilen erzeugt und die
 * echten Fehler darin unsichtbar gemacht.
 *
 * Diese Datei enthält bewusst NUR Rechenlogik - kein Datenbank-, Datei- oder Netzzugriff. Dadurch
 * ist sie ohne laufenden Server, ohne .env und ohne Kundendaten testbar (siehe
 * scripts/backoff.test.ts). Die Persistenz liegt daneben in comment-backoff.ts.
 */

/**
 * "dauerhaft" = der Aufruf wird auch beim 100. Versuch genauso scheitern (Medium gelöscht,
 * Berechtigung fehlt, ID ungültig) - hier lohnt Zurückhalten.
 * "voruebergehend" = Netzfehler, Zeitüberschreitung, Drosselung, Serverfehler auf Plattformseite -
 * hier wäre Zurückhalten falsch, der nächste Lauf kann problemlos klappen.
 */
export type FailureKind = "dauerhaft" | "voruebergehend";

/** Die ersten Fehlschläge laufen ohne Verzögerung - ein einzelner Aussetzer soll nichts bremsen. */
export const BACKOFF_FREE_ATTEMPTS = 3;
/** Grundabstand, ab dem verdoppelt wird. */
export const BACKOFF_BASE_MS = 3_600_000; // 1 Stunde
/** Obergrenze für einen einzelnen Abstand, damit er nicht ins Absurde wächst. */
export const BACKOFF_MAX_MS = 24 * 3_600_000; // 24 Stunden
/** Ab so vielen dauerhaften Fehlschlägen wird die ID ganz pausiert. */
export const PAUSE_AFTER_FAILURES = 10;
/** Dauer dieser Pause. */
export const PAUSE_MS = 7 * 86_400_000; // 7 Tage

/**
 * Ordnet einen HTTP-Status einer der beiden Fehlerarten zu.
 * `undefined` steht für "keine Antwort erhalten" (Netzfehler/Zeitüberschreitung).
 *
 * 429 (Drosselung) und 5xx gelten bewusst als vorübergehend: sie sagen nichts über die Medien-ID
 * aus, sondern über den Moment. Nur 4xx (außer 429) zählt als dauerhaft.
 */
export function classifyFailure(status: number | undefined): FailureKind {
  if (status === undefined) return "voruebergehend";
  if (status === 429) return "voruebergehend";
  if (status >= 400 && status < 500) return "dauerhaft";
  return "voruebergehend";
}

/** True, sobald so viele dauerhafte Fehlschläge aufgelaufen sind, dass pausiert wird. */
export function isPaused(failures: number): boolean {
  return failures >= PAUSE_AFTER_FAILURES;
}

/**
 * Abstand bis zum nächsten Versuch, in Millisekunden.
 *
 * - bis einschließlich 2 Fehlschläge: 0 (nächster Lauf versucht es normal wieder)
 * - ab dem 3.: 1h, 2h, 4h, 8h, 16h, dann gedeckelt auf 24h
 * - ab dem 10.: 7 Tage Pause
 */
export function backoffDelayMs(failures: number): number {
  if (failures < BACKOFF_FREE_ATTEMPTS) return 0;
  if (isPaused(failures)) return PAUSE_MS;
  const doublings = failures - BACKOFF_FREE_ATTEMPTS;
  return Math.min(BACKOFF_BASE_MS * 2 ** doublings, BACKOFF_MAX_MS);
}

/** Zeitpunkt des nächsten erlaubten Versuchs als ISO-String. */
export function nextAttemptAt(failures: number, nowMs: number = Date.now()): string {
  return new Date(nowMs + backoffDelayMs(failures)).toISOString();
}

/**
 * Darf jetzt wieder versucht werden? `retryAfter` ist der gespeicherte ISO-Zeitpunkt
 * (null/leer = noch nie fehlgeschlagen, also ja). Ein unlesbarer Wert gilt als "ja", damit ein
 * kaputter Datensatz niemals einen Kunden dauerhaft aussperrt.
 */
export function mayAttempt(retryAfter: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!retryAfter) return true;
  const due = new Date(retryAfter).getTime();
  if (Number.isNaN(due)) return true;
  return nowMs >= due;
}

/** Menschenlesbarer Abstand für Logzeilen ("45 Min", "8 Std", "7 Tage"). */
export function formatDelay(ms: number): string {
  if (ms <= 0) return "sofort";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} Min`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} Std`;
  return `${Math.round(ms / 86_400_000)} Tage`;
}
