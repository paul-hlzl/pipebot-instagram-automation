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
/**
 * 19.09.2026: ein entwerteter Token ist ebenfalls ein Zustand, der sich nie von selbst aendert.
 * Bei @pipeflow_solution blieb er zwei Tage lang unbemerkt, weil nur das Log ihn sah: die
 * Verbindung stand weiter als "ok" in der Datenbank, keine Warnung ging raus, und die Routine
 * versuchte es stuendlich neu (102 Fehlerzeilen an einem Tag). Ein Ausfall, den nur das Log
 * sieht, ist kein erkannter Ausfall.
 *
 * Erkannt wird am aufbereiteten Text aus errors.ts (isAuthFailure), der an jeder Stelle gleich
 * beginnt, sowie an den Rohmeldungen von Meta, falls ein Fehler einmal unaufbereitet ankommt.
 */
const IG_TOKEN_INVALID: PlatformBlock = {
  code: "IG_TOKEN_INVALID",
  reason:
    "Die Verbindung zu Instagram ist ungültig geworden - meist nach einer Passwortänderung oder " +
    "einer Sicherheitsabmeldung bei Instagram. Bitte im Panel einmal neu verbinden, danach geht es weiter.",
};

/**
 * Sammelt allen Text, an dem eine Sperre erkennbar sein kann.
 *
 * 20.09.2026: genau hier blieb die Erkennung haengen. `noteConnectionError` bekommt den ROHEN
 * axios-Fehler, und dessen `.message` lautet nur "Request failed with status code 403" - der
 * Subcode steckt ausschliesslich in `response.data.error`. IG_RESTRICTED_ACTIVITY gibt es seit
 * dem 17.09., ausgeloest hat die Regel deshalb nie: der Doppelpost bei @pipeflow_solution lief
 * durch, ohne dass die Verbindung vermerkt wurde.
 *
 * Darum wird der Text jetzt aus beidem gebaut: der Meldung selbst UND der Antwort darunter,
 * einmal in der normalisierten Schreibweise ("code=4 subcode=2207051", wie sie errors.ts
 * erzeugt) und einmal als roher Rumpf, damit auch LinkedIns `serviceErrorCode` trifft.
 * Bewusst ohne axios-Import - reine Logik, an der Form des Objekts erkannt, weiter testbar.
 */
function sperrText(error: unknown): string {
  const teile: string[] = [];
  if (error instanceof Error) teile.push(error.message);
  else if (error != null) teile.push(String(error));

  const rumpf = (error as { response?: { data?: unknown } } | null | undefined)?.response?.data;
  if (rumpf && typeof rumpf === "object") {
    const graph = (rumpf as { error?: unknown }).error;
    if (graph && typeof graph === "object") {
      const g = graph as { message?: unknown; code?: unknown; error_subcode?: unknown };
      if (typeof g.message === "string") teile.push(g.message);
      if (g.code != null) teile.push(`code=${String(g.code)}`);
      if (g.error_subcode != null) teile.push(`subcode=${String(g.error_subcode)}`);
    }
    try {
      teile.push(JSON.stringify(rumpf));
    } catch {
      // Zirkulaerer Rumpf: die normalisierten Felder oben genuegen.
    }
  }
  return teile.join(" ");
}

export function detectPlatformBlock(error: unknown): PlatformBlock | null {
  const text = sperrText(error);
  if (!text) return null;

  if (text.includes("RESTRICTED_MEMBER") || text.includes("65608")) return RESTRICTED_MEMBER;
  if (text.includes("subcode=2207051") || text.includes("We restrict certain activity")) return IG_RESTRICTED_ACTIVITY;
  if (
    text.includes("Instagram-Authentifizierung fehlgeschlagen") ||
    text.includes("session has been invalidated") ||
    text.includes("Error validating access token")
  ) return IG_TOKEN_INVALID;
  return null;
}
