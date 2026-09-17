/**
 * Erkennung von Plattform-Sperren - reine Logik, ohne Datenbank, Netz oder Dateizugriff.
 *
 * Bewusst getrennt von connection-block.ts (das die Sperre speichert und durchsetzt), damit diese
 * Erkennung ohne laufenden Server und ohne Kundendaten getestet werden kann - dieselbe Aufteilung
 * wie backoff.ts (Rechnen) gegenueber comment-backoff.ts (Speichern).
 *
 * Zwei Antworten der Plattformen sind keine voruebergehenden Fehler, sondern Zustaende, die sich
 * ohne Zutun des Kunden nie von selbst aendern:
 *
 *  - LinkedIn `401 RESTRICTED_MEMBER` (serviceErrorCode 65608) - das Mitgliedskonto ist
 *    eingeschraenkt, LinkedIn nimmt von ihm keine Beitraege mehr an.
 *  - Instagram `code=4 subcode=2207051` ("We restrict certain activity to protect our community")
 *    - Meta hat die Veroeffentlichung fuer dieses Konto gesperrt.
 */

export interface PlatformBlock {
  /** Kurzschlüssel, stabil genug zum Auswerten. */
  code: string;
  /** Klartext für den Kunden im Panel - ohne technische Rohdaten. */
  reason: string;
}

/** Wird geworfen, wenn eine gesperrte Verbindung benutzt werden soll. */
export class ConnectionBlockedError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ConnectionBlockedError";
    this.code = code;
  }
}

const RESTRICTED_MEMBER: PlatformBlock = {
  code: "RESTRICTED_MEMBER",
  reason:
    "LinkedIn hat dieses Konto eingeschränkt und nimmt derzeit keine Beiträge von ihm an. " +
    "Das lässt sich nur direkt bei LinkedIn klären (Hilfebereich, „Kontoeinschränkung“). " +
    "Danach im Panel einmal neu verbinden.",
};

const IG_RESTRICTED_ACTIVITY: PlatformBlock = {
  code: "IG_RESTRICTED_ACTIVITY",
  reason:
    "Instagram hat das Veröffentlichen für dieses Konto eingeschränkt " +
    "(„We restrict certain activity to protect our community“). " +
    "Das lässt sich nur direkt in der Instagram-App klären. Danach im Panel einmal neu verbinden.",
};

/**
 * Erkennt an einer Fehlermeldung, ob die Plattform die Verbindung gesperrt hat.
 * Bewusst textbasiert: die Meldungen laufen an sehr unterschiedlichen Stellen zusammen
 * (axios-Fehler, ToolError, aufbereiteter Graph-Text aus errors.ts), und alle Wege enthalten am
 * Ende dieselben eindeutigen Kennungen. Reine Funktion - ohne Datenbank, damit testbar.
 */
export function detectPlatformBlock(error: unknown): PlatformBlock | null {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (!text) return null;

  if (text.includes("RESTRICTED_MEMBER") || text.includes("65608")) return RESTRICTED_MEMBER;
  if (text.includes("subcode=2207051") || text.includes("We restrict certain activity")) return IG_RESTRICTED_ACTIVITY;
  return null;
}
