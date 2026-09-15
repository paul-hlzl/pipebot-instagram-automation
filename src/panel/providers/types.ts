export interface GuideStep {
  title: string;
  text: string;
  link?: { label: string; url: string };
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface ConnectResult extends TokenSet {
  accountId: string;
  accountName: string;
  scopes?: string;
}

/** Fehlercodes, die das Panel in verständliche Texte übersetzt. */
export type ErrorCode = "failed" | "personal_account" | "missing_permission" | "not_configured";

export class ProviderError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, detail: string) {
    super(detail);
    this.code = code;
  }
}

/**
 * Neue Plattform = neue Datei, die dieses Interface erfüllt, und Eintrag in providers/index.ts.
 * Das Panel baut Schritte, Anleitung und Buttons automatisch daraus.
 */
export interface Provider {
  id: string;
  name: string;
  tagline: string;
  notice?: string;
  guide: GuideStep[];
  /** always = Token kann immer verlängert werden, with-refresh-token = nur wenn ein Refresh-Token vorliegt */
  autoRefresh: "always" | "with-refresh-token" | "never";
  refreshWithinDays: number;
  /**
   * Mindestalter des aktuellen Tokens, bevor er überhaupt verlängert werden darf. Default (nicht
   * gesetzt) sind 24 Stunden - das ist Instagrams eigene Regel (ein Long-Lived-Token lässt sich
   * erst verlängern, wenn er mindestens einen Tag alt ist), die bisher fest in credentials.ts's
   * shouldRefresh stand. Google-Access-Tokens leben nur eine Stunde und müssen deshalb 0 setzen,
   * sonst wäre ein Google-Token per Definition nie verlängerbar.
   */
  refreshMinTokenAgeMs?: number;
  /**
   * true = ein bereits ABGELAUFENER Zugangstoken lässt sich mit dem gespeicherten Refresh-Token
   * trotzdem noch erneuern (Google: der Refresh-Token ist der eigentliche, langlebige Zugang, der
   * Access-Token nur ein Stundenticket). Bei Instagram/LinkedIn bleibt es beim Gegenteil: dort ist
   * ein abgelaufener Token endgültig, der Kunde muss neu verbinden.
   */
  refreshAfterExpiry?: boolean;
  /**
   * true = diese Plattform taucht im Panel nur auf, wenn sie auch konfiguriert ist (isConfigured()).
   * Für Instagram/LinkedIn (nicht gesetzt) bleibt es beim bisherigen Verhalten: der Schritt wird
   * immer angezeigt, ein fehlender App-Schlüssel führt nur zu einem Hinweistext. Google-
   * Unternehmensprofil ist so lange unsichtbar, bis der API-Zugang von Google freigeschaltet und
   * eingetragen ist - sonst würde jeder Kunde einen Kanal sehen, den niemand verbinden kann.
   */
  hiddenUntilConfigured?: boolean;
  isConfigured(): boolean;
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<ConnectResult>;
  refresh?(tokens: TokenSet): Promise<TokenSet>;
}

export async function requestJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new ProviderError("failed", `${label} HTTP ${res.status}: ${text.slice(0, 500)}`);
  return data as T;
}
