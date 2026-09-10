// src/linkedin-oauth-route.ts – einmaliger OAuth-Callback für LinkedIn
//
// WICHTIG: Diese Route nur temporär aktiv lassen (oder mit Basic-Auth
// schützen), da sie Tokens im Klartext im Browser anzeigt.

import express, { type Request, type Response } from "express";

const REDIRECT_URI = "https://mcp.pipebot.at/linkedin/callback";

interface LinkedInAccessTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface LinkedInUserInfoResponse {
  sub?: string;
}

export const linkedinOAuthRouter = express.Router();

linkedinOAuthRouter.get("/linkedin/callback", async (req: Request, res: Response) => {
  const { code, error, error_description } = req.query;

  if (error) {
    res.status(400).send(`<h2>Fehler von LinkedIn</h2><p>${error}: ${error_description}</p>`);
    return;
  }

  if (!code) {
    res.status(400).send("<h2>Kein code-Parameter in der Anfrage.</h2>");
    return;
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    res.status(500).send("<h2>LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET fehlen in der .env.</h2>");
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const tokenData = (await tokenRes.json()) as LinkedInAccessTokenResponse;

    if (!tokenRes.ok || !tokenData.access_token) {
      res
        .status(tokenRes.ok ? 502 : tokenRes.status)
        .send(`<h2>Token-Tausch fehlgeschlagen</h2><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
      return;
    }

    // Person-URN gleich mitholen, die brauchst du für LINKEDIN_PERSON_URN
    const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = (await meRes.json()) as LinkedInUserInfoResponse;
    const personUrn = `urn:li:person:${me.sub}`;

    // Nur zur Anzeige – NICHT automatisch in Dateien schreiben,
    // damit nichts versehentlich committed wird.
    res.send(`
      <h2>Erfolgreich! Trag diese Werte in deine .env ein:</h2>
      <pre>
LINKEDIN_ACCESS_TOKEN=${tokenData.access_token}
LINKEDIN_REFRESH_TOKEN=${tokenData.refresh_token ?? "(kein Refresh Token erhalten - siehe Hinweis unten)"}
LINKEDIN_PERSON_URN=${personUrn}
      </pre>
      <p>Access Token gültig für ${tokenData.expires_in ? Math.round(tokenData.expires_in / 86400) : "?"} Tage.</p>
      <p><b>Wichtig:</b> Diese Seite danach neu laden oder Route deaktivieren,
      damit die Tokens nicht offen im Browser-Verlauf stehen bleiben.</p>
    `);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    res.status(500).send(`<h2>Unerwarteter Fehler</h2><pre>${message}</pre>`);
  }
});
