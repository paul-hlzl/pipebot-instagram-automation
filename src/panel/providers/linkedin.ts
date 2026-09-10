import { type Provider, ProviderError, requestJson } from "./types.js";

// "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect" – beides self-service.
const SCOPES = ["openid", "profile", "email", "w_member_social"];

const clientId = (): string => process.env.LINKEDIN_CLIENT_ID ?? "";
const clientSecret = (): string => process.env.LINKEDIN_CLIENT_SECRET ?? "";

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

export const linkedin: Provider = {
  id: "linkedin",
  name: "LinkedIn",
  tagline: "Ihre Beiträge erscheinen automatisch auf Ihrem LinkedIn-Profil.",
  notice: "Gepostet wird auf Ihrem persönlichen Profil, nicht auf einer Unternehmensseite.",
  autoRefresh: "with-refresh-token",
  refreshWithinDays: 7,
  guide: [
    {
      title: "Mit dem richtigen Profil eingeloggt sein",
      text: "Die Beiträge erscheinen auf dem Profil, mit dem Sie sich gleich anmelden. Prüfen Sie kurz, ob im Browser das richtige Profil offen ist.",
      link: { label: "LinkedIn öffnen", url: "https://www.linkedin.com/feed/" },
    },
    {
      title: "Verbinden und Freigabe bestätigen",
      text: "LinkedIn fragt, ob Pipeline in Ihrem Namen Beiträge teilen darf. Bestätigen Sie, danach landen Sie automatisch wieder hier.",
    },
    {
      title: "Alle 60 Tage kurz erneuern",
      text: "LinkedIn begrenzt die Freigabe auf 60 Tage. Das Panel zeigt Ihnen rechtzeitig an, wann Sie mit einem Klick neu verbinden sollten.",
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
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },

  async exchangeCode(code, redirectUri) {
    const token = await requestJson<TokenResponse>(
      "https://www.linkedin.com/oauth/v2/accessToken",
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
      "LinkedIn token",
    );
    if (token.scope && !token.scope.includes("w_member_social")) {
      throw new ProviderError("missing_permission", `LinkedIn: scope ${token.scope}`);
    }

    const me = await requestJson<{ sub: string; name?: string; email?: string }>(
      "https://api.linkedin.com/v2/userinfo",
      { headers: { Authorization: `Bearer ${token.access_token}` } },
      "LinkedIn userinfo",
    );

    return {
      accountId: `urn:li:person:${me.sub}`,
      accountName: me.name ?? me.email ?? "LinkedIn-Profil",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: token.scope ?? SCOPES.join(" "),
    };
  },

  async refresh(tokens) {
    if (!tokens.refreshToken) throw new ProviderError("failed", "LinkedIn: kein Refresh-Token – Kunde muss neu verbinden");
    const r = await requestJson<TokenResponse>(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: clientId(),
          client_secret: clientSecret(),
        }),
      },
      "LinkedIn refresh",
    );
    return {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? tokens.refreshToken,
      expiresAt: new Date(Date.now() + r.expires_in * 1000),
    };
  },
};
