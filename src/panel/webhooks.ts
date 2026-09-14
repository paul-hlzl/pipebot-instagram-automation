/**
 * Meta-Webhooks für Instagram (Panel v11, KI-Kommentar-Automatisierung - siehe comments.ts für den
 * Gesamtzusammenhang mit dem 45-Minuten-Cron-Fallback). Öffentlicher, unauthentifizierter
 * Endpunkt - Meta kann keinen `Authorization`-Header setzen, die Absicherung läuft stattdessen
 * über zwei getrennte Mechanismen:
 *
 * 1. GET (Verify-Handshake): Meta ruft diesen Endpunkt EINMALIG beim Einrichten/Ändern der
 *    Webhook-URL im App-Dashboard auf, mit `hub.mode=subscribe`, `hub.verify_token` (muss exakt
 *    IG_WEBHOOK_VERIFY_TOKEN entsprechen) und `hub.challenge`. Bei Übereinstimmung wird
 *    `hub.challenge` unverändert als Klartext zurückgegeben (Meta prüft das) - sonst 403.
 * 2. POST (echte Events): jede Zustellung trägt `X-Hub-Signature-256: sha256=<hex>`, ein
 *    HMAC-SHA256 über den RAW Request-Body mit dem App Secret als Key. Nur bei gültiger Signatur
 *    wird das Event überhaupt geparst - alles andere wird mit 403 verworfen, ohne die Payload
 *    anzusehen. Deshalb ist dieser Router mit `express.raw()` statt `express.json()` verkabelt
 *    und MUSS in http-server.ts vor dem globalen `express.json()` gemountet werden, sonst ist der
 *    Raw-Body für die Signaturprüfung schon konsumiert.
 *
 * Antwortet auf ein gültig signiertes POST sofort mit 200 (Meta erwartet eine schnelle Antwort
 * und wiederholt sonst die Zustellung / wertet den Endpunkt als fehlerhaft) - die eigentliche
 * Klassifizierung/Antwort läuft danach asynchron über handleWebhookComment (comments.ts), mit
 * demselben K9-Fehlerisolationsprinzip wie der Cron: ein Fehler bei einem Event darf die
 * HTTP-Antwort an Meta nie verzögern oder verhindern.
 *
 * Nur oberste Kommentare (kein `parent_id` im Event) - exakt dieselbe Einschränkung wie beim
 * Cron-Pfad (siehe instagram-comments.ts, fetchTopLevelComments).
 *
 * WICHTIG (siehe Session-Bericht 2026-09-14): dieser Endpunkt allein macht Meta noch nicht dazu
 * bereit, tatsächlich Events zu schicken - dafür braucht es zusätzlich (a) die App-weite
 * Webhook-Konfiguration im Meta-Dashboard (Callback-URL + Verify-Token + Feld `comments`
 * abonniert, Teil des App-Review-Antrags) und (b) pro Kunden-Account ein Abo über
 * subscribeToCommentWebhook (instagram-comments.ts) - beides manuell/einmalig, nicht durch reinen
 * Code-Deploy ausgelöst.
 */
import crypto from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { handleWebhookComment } from "./comments.js";

interface WebhookChangeValue {
  id?: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string };
  parent_id?: string;
}
interface WebhookChange {
  field: string;
  value: WebhookChangeValue;
}
interface WebhookEntry {
  id: string;
  time?: number;
  changes?: WebhookChange[];
}
interface WebhookPayload {
  object?: string;
  entry?: WebhookEntry[];
}

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [algo, sig] = signatureHeader.split("=");
  if (algo !== "sha256" || !sig) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(sig, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    crypto.timingSafeEqual(providedBuf, providedBuf); // konstante Zeit, kein Laengen-Leak
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export function createInstagramWebhookRouter(): Router {
  const router = express.Router();

  router.get("/instagram-comments", (req: Request, res: Response) => {
    const verifyToken = process.env.IG_WEBHOOK_VERIFY_TOKEN ?? "";
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && verifyToken && typeof token === "string" && token === verifyToken) {
      res.status(200).type("text/plain").send(typeof challenge === "string" ? challenge : "");
      return;
    }
    console.error("[webhooks] instagram-comments: Verify-Handshake fehlgeschlagen (falscher/fehlender Token).");
    res.sendStatus(403);
  });

  router.post(
    "/instagram-comments",
    express.raw({ type: "application/json", limit: "2mb" }),
    (req: Request, res: Response) => {
      const appSecret = process.env.IG_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET ?? "";
      const raw = req.body as Buffer;
      if (!Buffer.isBuffer(raw) || !verifySignature(raw, req.header("x-hub-signature-256"), appSecret)) {
        console.error("[webhooks] instagram-comments: ungültige/fehlende Signatur - Event verworfen.");
        res.sendStatus(403);
        return;
      }

      // Meta erwartet eine schnelle Antwort und wiederholt/markiert den Endpunkt sonst als
      // gestört - die eigentliche Verarbeitung läuft bewusst NACH dem res.sendStatus weiter.
      res.sendStatus(200);

      let payload: WebhookPayload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch (err) {
        console.error("[webhooks] instagram-comments: Payload ist kein gültiges JSON:", err instanceof Error ? err.message : err);
        return;
      }
      if (payload.object !== "instagram") return;

      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field !== "comments") continue;
          const v = change.value ?? {};
          if (v.parent_id) continue; // nur oberste Kommentare, wie im Cron-Pfad
          if (!v.id || !v.media?.id || typeof v.text !== "string") continue;

          handleWebhookComment({
            igAccountId: entry.id,
            mediaId: v.media.id,
            commentId: v.id,
            commentText: v.text,
            authorUsername: v.from?.username ?? null,
          }).catch((err) => {
            // K9-Prinzip: ein fehlerhaftes Event darf die anderen nie mitreissen - Meta hat
            // die 200-Antwort laengst bekommen, das hier ist reines Server-Log.
            console.error("[webhooks] instagram-comments: Verarbeitung fehlgeschlagen:", err instanceof Error ? err.message : err);
          });
        }
      }
    },
  );

  return router;
}
