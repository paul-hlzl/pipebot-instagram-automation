/**
 * Plattform-Sperren einzelner Verbindungen erkennen, merken und durchsetzen.
 *
 * Welche Antworten als Sperre gelten, steht in platform-blocks.ts.
 *
 * Vorher wurde beides bei jedem Routinelauf neu versucht und neu geloggt (44 bzw. 22 Zeilen in
 * einer Woche, mit steigender Tendenz). Jetzt wird die Verbindung einmal als gesperrt vermerkt,
 * einmal geloggt, im Panel angezeigt - und bis zur Klärung nicht mehr abgefragt.
 *
 * Aufgehoben wird die Sperre automatisch beim Neu-Verbinden (router.ts schreibt die Verbindung neu)
 * oder beim nächsten erfolgreichen Aufruf (clearConnectionBlock).
 */
import { db, nowIso, type ConnectionRow } from "./db.js";
import { ConnectionBlockedError, detectPlatformBlock, type PlatformBlock } from "./platform-blocks.js";

// Weiterreichen, damit Aufrufer nur ein Modul kennen muessen.
export { ConnectionBlockedError, detectPlatformBlock, type PlatformBlock };

/** Aktuelle Sperre einer Verbindung, oder null. */
export function connectionBlock(customerId: string, provider: string): PlatformBlock | null {
  const row = db
    .prepare("SELECT blocked_at, blocked_code, blocked_reason FROM connections WHERE customer_id = ? AND provider = ?")
    .get(customerId, provider) as Pick<ConnectionRow, "blocked_at" | "blocked_code" | "blocked_reason"> | undefined;
  if (!row?.blocked_at) return null;
  return { code: row.blocked_code ?? "BLOCKED", reason: row.blocked_reason ?? "Die Plattform hat diese Verbindung gesperrt." };
}

/**
 * Vermerkt die Sperre. Gibt true zurück, wenn sie neu ist - nur dann soll der Aufrufer loggen.
 * Ein erneuter Aufruf mit derselben Sperre schreibt nichts und meldet false: so bleibt es bei
 * genau einer Logzeile, egal wie oft die Plattform noch dieselbe Antwort schickt.
 */
export function markConnectionBlocked(customerId: string, provider: string, block: PlatformBlock): boolean {
  const existing = connectionBlock(customerId, provider);
  if (existing?.code === block.code) return false;

  const result = db
    .prepare("UPDATE connections SET blocked_at = ?, blocked_code = ?, blocked_reason = ?, updated_at = ? WHERE customer_id = ? AND provider = ?")
    .run(nowIso(), block.code, block.reason, nowIso(), customerId, provider);
  return result.changes > 0;
}

/** Hebt die Sperre auf - beim Neu-Verbinden und nach jedem erfolgreichen Aufruf. */
export function clearConnectionBlock(customerId: string, provider: string): void {
  db.prepare(
    "UPDATE connections SET blocked_at = NULL, blocked_code = NULL, blocked_reason = NULL WHERE customer_id = ? AND provider = ? AND blocked_at IS NOT NULL",
  ).run(customerId, provider);
}

/**
 * Einstiegspunkt für Fehlerbehandlung: prüft eine Fehlermeldung auf eine Sperre und vermerkt sie.
 * Gibt die Sperre zurück, wenn sie NEU ist (dann einmal loggen), sonst null.
 */
export function noteConnectionError(customerId: string | undefined, provider: string, error: unknown): PlatformBlock | null {
  if (!customerId) return null; // Betreiber-eigenes .env-Konto hat keine Verbindungszeile
  const block = detectPlatformBlock(error);
  if (!block) return null;
  return markConnectionBlocked(customerId, provider, block) ? block : null;
}

/** Wirft, wenn die Verbindung gesperrt ist - die zentrale Schranke vor jedem Plattform-Aufruf. */
export function assertConnectionUsable(customerId: string | undefined, provider: string): void {
  if (!customerId) return;
  const block = connectionBlock(customerId, provider);
  if (block) throw new ConnectionBlockedError(block.reason, block.code);
}
