/**
 * Google-Unternehmensprofil (Google Business Profile) - OAuth-Anbindung nach demselben Muster wie
 * Instagram/LinkedIn (providers/types.ts). Der Kunde verbindet sein EIGENES Google-Konto, das
 * Panel bekommt dadurch Zugriff auf die Bewertungen seines Unternehmensprofils.
 *
 * WICHTIG - anders als Instagram/LinkedIn ist das hier NICHT self-service: die Google Business
 * Profile APIs starten in jedem neuen Google-Cloud-Projekt mit einem Kontingent von 0 Anfragen
 * pro Minute. Bis Google den Antrag ("Application for Basic API Access") freigegeben hat, liefert
 * JEDER Aufruf einen Fehler - auch mit einem völlig gültigen OAuth-Token des Kunden. Siehe
 * docs/GOOGLE_BUSINESS_PROFILE_API.md. Deshalb `hiddenUntilConfigured: true`: ohne
 * GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET taucht dieser Kanal im Panel gar nicht erst auf, statt
 * jedem Kunden einen Verbinden-Knopf zu zeigen, der nur in einen Fehler laufen kann.
 *
 * Token-Lebensdauer: Google-Access-Tokens laufen nach einer Stunde ab, der Refresh-Token dagegen
 * praktisch unbegrenzt (solange der Kunde den Zugriff nicht widerruft und die App veröffentlicht
 * ist - eine App im Test-Modus bekommt Refresh-Tokens, die nach 7 Tagen ungültig werden). Darum
 * `refreshMinTokenAgeMs: 0` + `refreshAfterExpiry: true` - beides greift nur für diesen Provider,
 * Instagram/LinkedIn behalten ihr bisheriges Verhalten exakt (siehe credentials.ts).
 */
import { type Provider, ProviderError, requestJson } from "./types.js";

/** Ein einziger Scope deckt alle Business-Profile-APIs ab (Accounts, Locations, Reviews, ...). */
const SCOPES = ["https://www.googleapis.com/auth/business.manage"];

const clientId = (): string => process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret = (): string => process.env.GOOGLE_CLIENT_SECRET ?? "";

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
type AccountsResponse = { accounts?: { name?: string; accountName?: string; type?: string }[] };

export const google: Provider = {
  id: "google",
  name: "Google-Unternehmensprofil",
  tagline: "Neue Google-Bewertungen werden automatisch beantwortet.",
  notice: "Es werden nur Bewertungen Ihres Unternehmensprofils gelesen und beantwortet - an Ihrem Profil selbst (Öffnungszeiten, Fotos, Adresse) wird nichts verändert.",
  autoRefresh: "with-refresh-token",
  // Google-Access-Tokens leben 1 Stunde; "innerhalb von 1 Tag vor Ablauf" trifft damit immer zu.
  refreshWithinDays: 1,
  refreshMinTokenAgeMs: 0,
  refreshAfterExpiry: true,
  hiddenUntilConfigured: true,
  guide: [
    {
      title: "Mit dem richtigen Google-Konto eingeloggt sein",
      text: "Verbinden Sie das Google-Konto, dem Ihr Unternehmensprofil gehört (das Konto, mit dem Sie Ihre Bewertungen auf Google verwalten).",
      link: { label: "Unternehmensprofil öffnen", url: "https://business.google.com/" },
    },
    {
      title: "Verbinden und Freigabe bestätigen",
      text: "Google fragt, ob Pipeflow Ihr Unternehmensprofil verwalten darf. Bestätigen Sie, danach landen Sie automatisch wieder hier.",
    },
    {
      title: "Antwort-Automatik einschalten",
      text: "Standardmäßig ist die automatische Beantwortung aus. In den Einstellungen unter \"Automatik\" schalten Sie sie ein und legen fest, ob Antworten sofort rausgehen oder erst zu Ihrer Freigabe.",
    },
  ],
  isConfigured: () => Boolean(clientId() && clientSecret()),

  authorizeUrl(state, redirectUri) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId(),
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(" "),
      // offline + consent: ohne beides liefert Google beim zweiten Verbinden desselben Kontos
      // KEINEN neuen Refresh-Token mehr - die Verbindung wäre dann nach einer Stunde tot.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },

  async exchangeCode(code, redirectUri) {
    const token = await requestJson<TokenResponse>(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId(),
          client_secret: clientSecret(),
        }),
      },
      "Google token",
    );
    if (token.scope && !token.scope.includes("business.manage")) {
      throw new ProviderError("missing_permission", `Google: scope ${token.scope}`);
    }
    if (!token.refresh_token) {
      // Ohne Refresh-Token wäre die Verbindung nach 60 Minuten still tot - lieber sofort ehrlich
      // scheitern lassen, als eine Verbindung anzulegen, die morgen niemand mehr erklären kann.
      throw new ProviderError("failed", "Google: kein Refresh-Token erhalten (access_type=offline/prompt=consent prüfen)");
    }

    // Das Unternehmensprofil-Konto (nicht die einzelne Filiale) ist der Anker: Bewertungen hängen
    // unter accounts/{id}/locations/{id}/reviews/{id}. Welche Filialen dazugehören, holt der
    // Bewertungs-Cron bei jedem Lauf frisch (ein Kunde kann eine Filiale hinzufügen, ohne neu zu
    // verbinden) - siehe google-business.ts.
    const accounts = await requestJson<AccountsResponse>(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      { headers: { Authorization: `Bearer ${token.access_token}` } },
      "Google accounts",
    );
    const account = (accounts.accounts ?? []).find((a) => a.name);
    if (!account?.name) {
      throw new ProviderError("personal_account", "Google: kein Unternehmensprofil-Konto gefunden");
    }

    return {
      accountId: account.name, // "accounts/123456789"
      accountName: account.accountName ?? "Google-Unternehmensprofil",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: token.scope ?? SCOPES.join(" "),
    };
  },

  async refresh(tokens) {
    if (!tokens.refreshToken) throw new ProviderError("failed", "Google: kein Refresh-Token – Kunde muss neu verbinden");
    const r = await requestJson<TokenResponse>(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: clientId(),
          client_secret: clientSecret(),
        }),
      },
      "Google refresh",
    );
    return {
      accessToken: r.access_token,
      // Google schickt beim Refresh normalerweise KEINEN neuen Refresh-Token mit - der alte gilt weiter.
      refreshToken: r.refresh_token ?? tokens.refreshToken,
      expiresAt: new Date(Date.now() + r.expires_in * 1000),
    };
  },
};
