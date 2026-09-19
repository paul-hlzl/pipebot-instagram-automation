/**
 * Anmeldung mit Google / Microsoft / Apple (Easy Onboarding, Auftrag Abschnitt 4).
 *
 * Bewusst als eigener, austauschbarer Baustein: ein Anbieter ist hier eine Datenstruktur mit
 * vier Feldern, mehr braucht der Rest des Systems nicht zu wissen. Kommt spaeter Apple dazu,
 * ist das ein Eintrag in dieser Datei und zwei Umgebungsvariablen - keine Aenderung an Routen,
 * Panel oder Datenbank.
 *
 * Ablauf (Authorization Code Flow mit vertraulichem Client):
 *   1. /auth/<anbieter>            -> Weiterleitung zum Anbieter, `state` liegt in auth_states
 *   2. /auth/<anbieter>/callback   -> Code gegen Token tauschen (Server zu Server, mit Secret)
 *   3. userinfo-Endpunkt abfragen  -> E-Mail, Name, dauerhafte Kennung ("sub")
 *
 * Warum userinfo statt das id_token selbst zu pruefen: der Token kommt aus einer direkten
 * TLS-Verbindung zum Token-Endpunkt des Anbieters, authentifiziert mit unserem Client-Secret -
 * eine zusaetzliche Signaturpruefung mit JWKS-Abruf und Schluesselrotation braeuchte eine
 * weitere Abhaengigkeit und schuetzt an dieser Stelle vor nichts, was nicht schon TLS abdeckt.
 * (Anders waere es bei einem Implicit Flow, bei dem das Token durch den Browser laeuft.)
 *
 * Ohne hinterlegte Zugangsdaten ist ein Anbieter schlicht `available: false`. Das Panel zeigt
 * den Knopf dann als "kommt noch" statt in einen Fehler zu laufen - dasselbe Muster wie bei
 * Instagram/LinkedIn in providers/index.ts.
 *
 * Die Endpunkte sind ueber Umgebungsvariablen umlenkbar (AUTH_<ANBIETER>_AUTHORIZE_URL etc.),
 * damit sich der komplette Ablauf gegen einen lokalen Attrappen-Anbieter testen laesst, ohne
 * echte Zugangsdaten - genau dasselbe Muster wie ANTHROPIC_ENDPOINT_OVERRIDE in anthropic.ts.
 */
import { ToolError } from "../errors.js";

export interface AuthIdentity {
  /** Dauerhafte Kennung des Kontos beim Anbieter. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface AuthProvider {
  id: "google" | "microsoft" | "apple";
  name: string;
  /** Kurzer Satz fuer den Report/das Panel, wenn der Anbieter noch nicht eingerichtet ist. */
  pendingNote: string;
  isConfigured(): boolean;
  authorizeUrl(state: string, nonce: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<AuthIdentity>;
}

const env = (name: string): string => process.env[name]?.trim() ?? "";

/**
 * Wird geworfen, wenn der Anbieter unsere EIGENEN Zugangsdaten ablehnt (falsches oder
 * abgelaufenes Client-Secret). Das ist kein Fehler des Nutzers und keine vorübergehende
 * Stoerung - es muss jemand die Zugangsdaten richtigstellen. Deshalb ein eigener Typ: der
 * Callback zeigt dann "noch nicht eingerichtet" statt "versuch es noch einmal", was den
 * Nutzer sonst endlos im Kreis schickt.
 *
 * Anlass (19.09.2026): In Entra heisst das Feld, das man sieht, "Geheime Client-ID"; der
 * Wert, den man braucht, steht in der Spalte "Wert" und ist nur direkt nach dem Anlegen
 * sichtbar. Die Verwechslung ist der haeufigste Einrichtungsfehler ueberhaupt, Microsoft
 * schreibt sie sogar in den Fehlertext (AADSTS7000215).
 */
export class AuthNotConfiguredError extends ToolError {}

async function postForm<T>(url: string, body: Record<string, string>, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    // Der Fehlertext des Anbieters nennt im Zweifel unseren Client-Namen, nie das Secret -
    // trotzdem nur geloggt, nie an den Browser weitergereicht.
    const text = (await res.text()).slice(0, 500);
    console.error(`[auth] Token-Tausch fehlgeschlagen (${url}): HTTP ${res.status} ${text}`);
    if (/invalid_client|AADSTS7000215|AADSTS7000222|unauthorized_client/.test(text)) {
      throw new AuthNotConfiguredError("Dieser Anmeldeweg ist noch nicht fertig eingerichtet.");
    }
    throw new ToolError("Die Anmeldung hat nicht geklappt. Bitte versuche es noch einmal.");
  }
  return (await res.json()) as T;
}

async function getJson<T>(url: string, accessToken: string, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    console.error(`[auth] Profilabruf fehlgeschlagen (${url}): HTTP ${res.status}`);
    throw new ToolError("Die Anmeldung hat nicht geklappt. Bitte versuche es noch einmal.");
  }
  return (await res.json()) as T;
}

interface TokenAntwort {
  access_token?: string;
  id_token?: string;
  error?: string;
}

/** Liest E-Mail/Name/sub aus einem id_token, ohne Signaturpruefung - siehe Dateikopf: das Token
 *  stammt aus der direkten Server-zu-Server-Antwort des Anbieters. Nur als Ergaenzung zu
 *  userinfo (Microsoft liefert die verifizierte Adresse teils nur hier). */
function claimsAusIdToken(idToken: string | undefined): Record<string, unknown> {
  if (!idToken) return {};
  const teil = idToken.split(".")[1];
  if (!teil) return {};
  try {
    return JSON.parse(Buffer.from(teil.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export const google: AuthProvider = {
  id: "google",
  name: "Google",
  pendingNote: "Braucht einen OAuth-Client in der Google Cloud Console (kostenlos).",
  isConfigured: () => Boolean(env("AUTH_GOOGLE_CLIENT_ID") && env("AUTH_GOOGLE_CLIENT_SECRET")),
  authorizeUrl(state, nonce, redirectUri) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: env("AUTH_GOOGLE_CLIENT_ID"),
      redirect_uri: redirectUri,
      scope: "openid email profile",
      state,
      nonce,
      // Nur Anmeldung, kein Dauerzugriff: wir brauchen weder Refresh-Token noch offline-Zugriff.
      prompt: "select_account",
    });
    return `${env("AUTH_GOOGLE_AUTHORIZE_URL") || "https://accounts.google.com/o/oauth2/v2/auth"}?${q}`;
  },
  async exchangeCode(code, redirectUri) {
    const token = await postForm<TokenAntwort>(env("AUTH_GOOGLE_TOKEN_URL") || "https://oauth2.googleapis.com/token", {
      code,
      client_id: env("AUTH_GOOGLE_CLIENT_ID"),
      client_secret: env("AUTH_GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const claims = claimsAusIdToken(token.id_token);
    let profil: Record<string, unknown> = {};
    if (token.access_token) {
      profil = await getJson<Record<string, unknown>>(env("AUTH_GOOGLE_USERINFO_URL") || "https://openidconnect.googleapis.com/v1/userinfo", token.access_token);
    }
    const email = str(profil.email) || str(claims.email);
    const subject = str(profil.sub) || str(claims.sub);
    if (!email || !subject) throw new ToolError("Google hat keine E-Mail-Adresse zurückgegeben. Bitte versuche es mit einem anderen Weg.");
    return {
      subject,
      email: email.toLowerCase(),
      emailVerified: profil.email_verified === true || claims.email_verified === true,
      name: str(profil.name) || str(claims.name) || email.split("@")[0],
    };
  },
};

export const microsoft: AuthProvider = {
  id: "microsoft",
  name: "Microsoft",
  pendingNote: "Braucht eine App-Registrierung in Microsoft Entra (kostenlos).",
  isConfigured: () => Boolean(env("AUTH_MICROSOFT_CLIENT_ID") && env("AUTH_MICROSOFT_CLIENT_SECRET")),
  authorizeUrl(state, nonce, redirectUri) {
    const mandant = env("AUTH_MICROSOFT_TENANT") || "common";
    const q = new URLSearchParams({
      response_type: "code",
      client_id: env("AUTH_MICROSOFT_CLIENT_ID"),
      redirect_uri: redirectUri,
      scope: "openid email profile",
      state,
      nonce,
      response_mode: "query",
    });
    return `${env("AUTH_MICROSOFT_AUTHORIZE_URL") || `https://login.microsoftonline.com/${mandant}/oauth2/v2.0/authorize`}?${q}`;
  },
  async exchangeCode(code, redirectUri) {
    const mandant = env("AUTH_MICROSOFT_TENANT") || "common";
    const token = await postForm<TokenAntwort>(env("AUTH_MICROSOFT_TOKEN_URL") || `https://login.microsoftonline.com/${mandant}/oauth2/v2.0/token`, {
      code,
      client_id: env("AUTH_MICROSOFT_CLIENT_ID"),
      client_secret: env("AUTH_MICROSOFT_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const claims = claimsAusIdToken(token.id_token);
    // Microsoft liefert die Adresse je nach Kontotyp als email, preferred_username oder upn.
    const email = str(claims.email) || str(claims.preferred_username) || str(claims.upn);
    const subject = str(claims.sub) || str(claims.oid);
    if (!email || !subject) throw new ToolError("Microsoft hat keine E-Mail-Adresse zurückgegeben. Bitte versuche es mit einem anderen Weg.");
    return {
      subject,
      email: email.toLowerCase(),
      // Ein Microsoft-Konto ist beim Anbieter bestaetigt; ein Gastkonto mit fremder Adresse nicht
      // zwingend - deshalb nur dann als bestaetigt fuehren, wenn die Adresse zum Mandanten passt.
      emailVerified: claims.email_verified === true || Boolean(str(claims.upn)) || Boolean(str(claims.preferred_username)),
      name: str(claims.name) || email.split("@")[0],
    };
  },
};

/**
 * Apple ist bewusst NICHT implementiert, sondern nur benannt: "Anmelden mit Apple" verlangt ein
 * kostenpflichtiges Apple Developer Program (rund 99 USD im Jahr), das es hier nicht gibt.
 * Zusaetzlich braucht Apple ein aus einem privaten Schluessel signiertes, alle sechs Monate
 * ablaufendes Client-Secret (ES256-JWT) und schickt Name und Adresse nur beim allerersten
 * Anmelden mit - siehe Report. Der Knopf erscheint im Panel als "kommt noch", nichts wird
 * nachgebaut, was so aussieht wie ein Apple-Login.
 */
export const apple: AuthProvider = {
  id: "apple",
  name: "Apple",
  pendingNote: "Braucht ein Apple Developer Program (rund 99 USD im Jahr) - noch nicht vorhanden.",
  isConfigured: () => false,
  authorizeUrl() {
    throw new ToolError("Anmelden mit Apple ist noch nicht eingerichtet.");
  },
  async exchangeCode() {
    throw new ToolError("Anmelden mit Apple ist noch nicht eingerichtet.");
  },
};

/** Reihenfolge = Reihenfolge der Knoepfe auf Bildschirm 1. */
export const authProviders: AuthProvider[] = [google, microsoft, apple];

export function getAuthProvider(id: string): AuthProvider | undefined {
  return authProviders.find((p) => p.id === id);
}

export function authProvidersPublic(): { id: string; name: string; available: boolean; note: string | null }[] {
  return authProviders.map((p) => ({ id: p.id, name: p.name, available: p.isConfigured(), note: p.isConfigured() ? null : p.pendingNote }));
}
