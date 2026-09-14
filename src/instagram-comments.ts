/**
 * Instagram Comments (Panel v10, KI-Kommentar-Automatisierung) - reads top-level comments on a
 * customer's own media and posts replies, via the same "Instagram API with Instagram Login"
 * (graph.instagram.com) product this codebase already uses for publishing/insights (see
 * instagram.ts/instagram-insights.ts). Requires the `instagram_business_manage_comments`
 * permission (see the session report) - only added to providers/instagram.ts's SCOPES in this
 * same session, so an existing connection needs to be reconnected once before this works for it.
 *
 * `GET /{ig-media-id}/comments` only ever returns FIRST-LEVEL comments - replies live under
 * `/{ig-comment-id}/replies` instead and are never included here, so "only top-level" (a hard
 * requirement from the task) falls out of using this endpoint at all, no extra filtering needed.
 *
 * The reply endpoint/field name (`POST /{ig-comment-id}/replies` with a `message` field) is
 * Meta's documented Instagram Platform shape - like fetchAccountInsights/fetchMediaInsights in
 * instagram-insights.ts, this could not be verified against a real access token in this session
 * (no comments exist yet on any sandbox-connected account). Treat as unverified until confirmed
 * against a real test comment - see session report.
 *
 * BESTÄTIGTE PLATTFORM-GRENZE (2026-09-14, realer Testfall auf Pauls eigenem Account,
 * cus_bW0p_HapELUZ, Post 17900047416371184): ein Kommentar, den Instagram selbst über
 * `comments_count` auf dem Media-Objekt mitzählt (Wert 1), kam über `GET /{media-id}/comments`
 * NIE zurück (`data: []`, wiederholt reproduziert, auch mit `access_token`/Scopes einwandfrei und
 * über mehrere Cron-Läufe/Direktaufrufe hinweg). Auch die Inline-Erweiterung
 * `comments.summary(true){...}` auf dem Media-Objekt lässt das `comments`-Feld komplett weg statt
 * eine leere Liste zu liefern - beides deutet auf eine serverseitige Filterung (z.B. Instagrams
 * eigene automatische Kommentar-Moderation - "Versteckte Wörter"/manueller Filter in den
 * Kommentar-Einstellungen des Accounts) hin, NICHT auf einen Bug in diesem Code. Für so gefilterte
 * Kommentare gibt es keinen bekannten API-Weg, sie trotzdem abzurufen - das ist eine
 * Plattform-Grenze, kein Fehler in fetchTopLevelComments. Nicht bei jedem ähnlichen "Kommentar X
 * wurde nicht beantwortet"-Fall erneut aufwendig neu untersuchen, sondern zuerst genau das prüfen:
 * `comments_count` > 0 auf dem Media-Objekt, aber `/comments` liefert weniger/nichts zurück.
 *
 * Der Webhook-Pfad (webhooks.ts, Panel v11) löst dieses Problem NICHT - Meta liefert über den
 * `comments`-Webhook ebenfalls keine Events für automatisch gefilterte Kommentare (gleicher Grund:
 * sie wurden serverseitig nie "öffentlich" zugestellt). Sein Mehrwert ist ausschließlich Tempo
 * (Sekunden statt bis zu COMMENT_CRON_INTERVAL_MINUTES) für ganz normale, nicht gefilterte
 * Kommentare - er macht aus dieser Grenze keinen Bug, den man beheben könnte.
 */
import axios, { type AxiosInstance } from "axios";
import type { InstagramCredentials } from "./instagram.js";

const GRAPH_BASE = "https://graph.instagram.com/v21.0";

function client(): AxiosInstance {
  return axios.create({
    timeout: 20_000,
    validateStatus: (status) => status >= 200 && status < 300,
  });
}

export interface IncomingComment {
  id: string;
  text: string;
  username: string | null;
  timestamp: string | null;
}

interface CommentsListResponse {
  data?: { id: string; text?: string; username?: string; timestamp?: string }[];
}

/** First-level comments on one piece of media, newest last (API's own order not guaranteed - callers should not assume). */
export async function fetchTopLevelComments(mediaId: string, creds: InstagramCredentials): Promise<IncomingComment[]> {
  const { data } = await client().get<CommentsListResponse>(`${GRAPH_BASE}/${mediaId}/comments`, {
    params: { access_token: creds.accessToken, fields: "id,text,username,timestamp" },
  });
  return (data.data ?? [])
    .filter((c) => typeof c.text === "string" && c.text.length > 0)
    .map((c) => ({ id: c.id, text: c.text as string, username: c.username ?? null, timestamp: c.timestamp ?? null }));
}

/**
 * Abonniert das `comments`-Webhook-Feld für einen einzelnen verbundenen IG-Account (Panel v11,
 * webhooks.ts) - macht Meta erst dazu bereit, für DIESEN Account überhaupt Echtzeit-Events zu
 * schicken. Ersetzt NICHT die App-weite Webhook-Konfiguration im Meta-Dashboard (Callback-URL +
 * Verify-Token + App Review für das Feld `comments`) - das ist ein einmaliger, manueller Schritt
 * pro App, nicht pro Kunde, und kann von hier aus nicht automatisiert werden. Wird aufgerufen (a)
 * automatisch nach jedem neuen/erneuerten Instagram-Connect (router.ts) und (b) einmalig per
 * Nachhol-Skript für bereits vor Panel v11 verbundene Kunden (scripts/subscribe-webhooks.mjs).
 * Wirft bei Fehler - Aufrufer sollten das NICHT den Connect-Flow blockieren lassen (der
 * 12-/45-Minuten-Cron deckt den Kunden bis zum nächsten erfolgreichen Abo-Versuch trotzdem ab).
 */
export async function subscribeToCommentWebhook(igUserId: string, creds: InstagramCredentials): Promise<void> {
  await client().post(`${GRAPH_BASE}/${igUserId}/subscribed_apps`, null, {
    params: { subscribed_fields: "comments", access_token: creds.accessToken },
  });
}

/** Posts a reply to one comment. Throws on failure - callers decide what that means for this comment's status. */
export async function postCommentReply(commentId: string, message: string, creds: InstagramCredentials): Promise<{ replyId: string | null }> {
  const { data } = await client().post<{ id?: string }>(
    `${GRAPH_BASE}/${commentId}/replies`,
    null,
    { params: { access_token: creds.accessToken, message } },
  );
  return { replyId: data.id ?? null };
}
