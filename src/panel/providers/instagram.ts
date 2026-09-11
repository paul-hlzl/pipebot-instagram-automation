import { type Provider, ProviderError, requestJson } from "./types.js";

// Instagram API with Instagram Login – keine Facebook-Seite nötig.
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

const graph = (p: string): string => {
  const v = process.env.INSTAGRAM_GRAPH_VERSION;
  return `https://graph.instagram.com/${v ? `${v}/` : ""}${p}`;
};

const appId = (): string => process.env.INSTAGRAM_APP_ID ?? "";
const appSecret = (): string => process.env.INSTAGRAM_APP_SECRET ?? "";

export const instagram: Provider = {
  id: "instagram",
  name: "Instagram",
  tagline: "Ihre Beiträge erscheinen automatisch in Ihrem Instagram-Feed.",
  autoRefresh: "always",
  refreshWithinDays: 10,
  guide: [
    {
      title: "Professionelles Konto einrichten",
      text: "Automatisches Posten funktioniert nur mit einem Business- oder Creator-Konto. Das Umstellen ist kostenlos und dauert rund zwei Minuten. Haben Sie schon eines, können Sie diesen Punkt überspringen.",
      link: { label: "Anleitung von Instagram öffnen", url: "https://help.instagram.com/502981923235522" },
    },
    {
      title: "Zugangsdaten bereithalten",
      text: "Sie melden sich gleich direkt bei Instagram an. Ihr Passwort geben Sie nur dort ein, nie bei uns.",
      link: { label: "Passwort vergessen?", url: "https://www.instagram.com/accounts/password/reset/" },
    },
    {
      title: "Verbinden und Freigabe bestätigen",
      text: "Instagram zeigt Ihnen, welche Rechte Pipeflow bekommt: Profil lesen und Beiträge veröffentlichen. Bestätigen Sie, danach landen Sie automatisch wieder hier.",
    },
  ],
  isConfigured: () => Boolean(appId() && appSecret()),

  authorizeUrl(state, redirectUri) {
    const q = new URLSearchParams({
      enable_fb_login: "0",
      force_reauth: "true", // verhindert, dass versehentlich ein anderes eingeloggtes Konto verbunden wird
      client_id: appId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${q}`;
  },

  async exchangeCode(code, redirectUri) {
    type ShortToken = { access_token?: string; permissions?: string | string[]; data?: { access_token: string; permissions?: string | string[] }[] };
    const short = await requestJson<ShortToken>(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: appId(),
          client_secret: appSecret(),
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code: code.replace(/#_$/, ""),
        }),
      },
      "Instagram token",
    );
    const entry = short.data?.[0] ?? short;
    if (!entry.access_token) throw new ProviderError("failed", `Instagram: kein access_token – ${JSON.stringify(short)}`);

    const granted = Array.isArray(entry.permissions) ? entry.permissions.join(",") : entry.permissions ?? "";
    if (granted && !granted.includes("instagram_business_content_publish")) {
      throw new ProviderError("missing_permission", `Instagram: Berechtigungen ${granted}`);
    }

    const long = await requestJson<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: appSecret(),
        access_token: entry.access_token,
      })}`,
      {},
      "Instagram long-lived token",
    );

    const me = await requestJson<{ id: string; user_id?: string; username: string; account_type?: string }>(
      `${graph("me")}?${new URLSearchParams({ fields: "user_id,username,account_type", access_token: long.access_token })}`,
      {},
      "Instagram me",
    );
    if (me.account_type && !["BUSINESS", "MEDIA_CREATOR"].includes(me.account_type)) {
      throw new ProviderError("personal_account", `Instagram: account_type ${me.account_type}`);
    }

    return {
      accountId: me.user_id ?? me.id, // ig-user-id für /{ig-user-id}/media
      accountName: `@${me.username}`,
      accessToken: long.access_token,
      expiresAt: new Date(Date.now() + long.expires_in * 1000),
      scopes: granted || SCOPES.join(","),
    };
  },

  async refresh(tokens) {
    const r = await requestJson<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: tokens.accessToken,
      })}`,
      {},
      "Instagram refresh",
    );
    return { accessToken: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000) };
  },
};
