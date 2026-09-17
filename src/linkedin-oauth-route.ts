// src/linkedin-oauth-route.ts – einmaliger OAuth-Callback für LinkedIn
//
// Abgesichert: die Route existiert nur, wenn LINKEDIN_OAUTH_CALLBACK_ENABLED
// in der .env auf "true" steht (Standard: aus, Route antwortet dann mit 404,
// als gäbe es sie nicht). Zum erneuten Autorisieren also kurz einschalten,
// den Ablauf einmal durchführen, danach wieder ausschalten.
//
// Tokens erscheinen NICHT mehr im Klartext im Browser: sie landen in einer
// Datei mit Rechten 600 im Datenordner, die nur root lesen kann. Der Browser
// zeigt nur eine Erfolgsmeldung.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import express, { type Request, type Response } from "express";

const REDIRECT_URI = "https://mcp.pipebot.at/linkedin/callback";
const ERGEBNIS_DATEI = join(process.cwd(), "data", ".linkedin-oauth-ergebnis.json");

interface LinkedInAccessTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface LinkedInUserInfoResponse {
  sub?: string;
}

export const linkedinOAuthRouter = express.Router();

function eingeschaltet(): boolean {
  return process.env.LINKEDIN_OAUTH_CALLBACK_ENABLED?.trim() === "true";
}

linkedinOAuthRouter.get("/linkedin/callback", async (req: Request, res: Response) => {
  // Ohne den Schalter existiert die Route nicht - 404, kein Hinweis, dass
  // es sie ueberhaupt gibt.
  if (!eingeschaltet()) {
    res.status(404).send("Not found");
    return;
  }

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
      // Auch der Fehlerfall zeigt keine Rohantwort mehr im Browser - die
      // koennte Teile des Codes oder interne Details enthalten.
      res.status(tokenRes.ok ? 502 : tokenRes.status).send("<h2>Token-Tausch fehlgeschlagen.</h2><p>Details im Server-Log.</p>");
      console.error("[linkedin-callback] Token-Tausch fehlgeschlagen:", JSON.stringify(tokenData));
      return;
    }

    // Person-URN gleich mitholen, die brauchst du für LINKEDIN_PERSON_URN
    const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = (await meRes.json()) as LinkedInUserInfoResponse;
    const personUrn = `urn:li:person:${me.sub}`;

    // Nur in eine Datei mit Rechten 600 schreiben, NICHT im Browser anzeigen
    // und NICHT automatisch in .env eintragen, damit nichts versehentlich
    // committed wird oder im Browser-Verlauf/Referrer/Proxy-Log auftaucht.
    writeFileSync(
      ERGEBNIS_DATEI,
      JSON.stringify(
        {
          hinweis: "Per SSH lesen und in die .env uebernehmen, dann diese Datei loeschen.",
          erzeugt_am: new Date().toISOString(),
          LINKEDIN_ACCESS_TOKEN: tokenData.access_token,
          LINKEDIN_REFRESH_TOKEN: tokenData.refresh_token ?? null,
          LINKEDIN_PERSON_URN: personUrn,
          gueltig_tage: tokenData.expires_in ? Math.round(tokenData.expires_in / 86400) : null,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    res.send(`
      <h2>Erfolgreich.</h2>
      <p>Die Werte stehen NICHT hier im Browser, sondern in einer Datei mit
      Rechten 600 auf dem Server:</p>
      <pre>${ERGEBNIS_DATEI}</pre>
      <p>Per SSH auslesen, in die .env uebernehmen, Datei danach loeschen
      (<code>shred -u ${ERGEBNIS_DATEI}</code>) und
      <code>LINKEDIN_OAUTH_CALLBACK_ENABLED</code> wieder auf
      <code>false</code> stellen.</p>
    `);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    console.error("[linkedin-callback] Unerwarteter Fehler:", message);
    res.status(500).send("<h2>Unerwarteter Fehler.</h2><p>Details im Server-Log.</p>");
  }
});
