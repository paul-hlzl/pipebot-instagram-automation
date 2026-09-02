import axios from "axios";

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
}

function isAuthFailure(error: GraphErrorBody, combined: string): boolean {
  const code = error.code;
  const text = combined.toLowerCase();

  // Do not treat every OAuthException as auth failure — Meta uses that type for many errors.
  if (code === 190 || code === 102) {
    return true;
  }

  return (
    text.includes("session key invalid") ||
    text.includes("session has expired") ||
    text.includes("invalid oauth") ||
    text.includes("error validating access token") ||
    text.includes("access token has expired") ||
    (text.includes("access token") &&
      (text.includes("expired") || text.includes("invalid") || text.includes("malformed")))
  );
}

function mapGraphError(error: GraphErrorBody): string {
  const message = error.error_user_msg || error.message || "Unbekannter Instagram-API-Fehler";
  const combined = [error.message, error.error_user_msg, error.error_user_title]
    .filter(Boolean)
    .join(" ");
  const subcode = error.error_subcode;

  if (isAuthFailure(error, combined)) {
    return (
      "Instagram-Authentifizierung fehlgeschlagen (Session/Token ungültig oder abgelaufen). " +
      "Falls der Token älter als 24 Stunden ist, Tool `refresh_access_token` ausführen. " +
      "Sonst im Meta Dashboard einen neuen Long-Lived Token erzeugen und in der .env als IG_ACCESS_TOKEN setzen. " +
      `Details: ${message}`
    );
  }

  if (error.code === 2) {
    return (
      "Vorübergehender Instagram-API-Fehler (bitte später erneut versuchen). " +
      "Falls das anhält: IG_USER_ID gegen GET /me prüfen. " +
      `Details: ${message}`
    );
  }

  if (subcode === 2207042 || /maximum number of posts|publishing limit|rate limit/i.test(combined)) {
    return (
      "Das 24-Stunden-Publishing-Limit ist erreicht. Warte, bis das rollierende Fenster wieder frei ist, " +
      "und prüfe den Stand mit `check_publishing_limit`. " +
      `Details: ${message}`
    );
  }

  if (
    subcode === 2207004 ||
    subcode === 2207052 ||
    /invalid image|image format|aspect ratio|download.*image|unable to fetch|not a valid image/i.test(
      combined,
    )
  ) {
    return (
      "Das Bild wurde von Instagram abgelehnt (Format, Größe, Seitenverhältnis oder nicht öffentlich erreichbare URL). " +
      "JPEG/PNG verwenden, URL öffentlich halten (R2 r2.dev). " +
      `Details: ${message}`
    );
  }

  if (subcode === 2207027 || /not ready for publishing/i.test(combined)) {
    return (
      "Der Media-Container ist noch nicht bereit. Status pollen, bis status_code=FINISHED, dann erneut veröffentlichen. " +
      `Details: ${message}`
    );
  }

  if (/has not been used long enough|at least 24 hours/i.test(combined)) {
    return (
      "Token-Refresh ist erst möglich, wenn der aktuelle Token mindestens 24 Stunden alt ist. " +
      "Später erneut `refresh_access_token` aufrufen. " +
      `Details: ${message}`
    );
  }

  const parts = [`Instagram Graph API Fehler: ${message}`];
  if (error.code !== undefined) parts.push(`code=${error.code}`);
  if (subcode !== undefined) parts.push(`subcode=${subcode}`);
  return parts.join(" ");
}

export function toToolMessage(error: unknown): string {
  if (error instanceof ToolError) {
    return error.message;
  }

  if (axios.isAxiosError(error)) {
    return mapFalOrHttpError(error);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unbekannter Fehler.";
}

function falDetail(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }
  const body = data as Record<string, unknown>;
  if (typeof body.detail === "string") {
    return body.detail;
  }
  if (Array.isArray(body.detail)) {
    return body.detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item && typeof item.msg === "string") {
          return item.msg;
        }
        return "";
      })
      .filter(Boolean)
      .join("; ");
  }
  if (typeof body.message === "string") {
    return body.message;
  }
  if (body.error && typeof body.error === "object") {
    const inner = body.error as Record<string, unknown>;
    if (typeof inner.message === "string") {
      return inner.message;
    }
  }
  return "";
}

function mapFalError(status: number | undefined, detail: string, fallback: string): string {
  const extra = detail ? ` Details: ${detail}` : "";

  if (status === 401 || status === 403) {
    return `fal.ai-Authentifizierung fehlgeschlagen. FAL_API_KEY in der .env prüfen.${extra}`;
  }
  if (status === 429) {
    return `fal.ai Rate Limit erreicht. Später erneut versuchen.${extra}`;
  }
  if (status === 402) {
    return (
      "fal.ai-Guthaben ist aufgebraucht. Credits unter https://fal.ai/dashboard/settings/credits aufladen." +
      extra
    );
  }
  if (
    status === 422 ||
    /content.?policy|nsfw|moderation|safety|not allowed|prohibited/i.test(detail)
  ) {
    return `fal.ai hat den Prompt abgelehnt (Content-Policy). Anderes Thema wählen.${extra}`;
  }

  return `fal.ai-Fehler${status ? ` (${status})` : ""}: ${detail || fallback}`;
}

function isFalRequest(url: string | undefined): boolean {
  return Boolean(url && (url.includes("fal.run") || url.includes("fal.ai")));
}

function mapFalOrHttpError(error: import("axios").AxiosError): string {
  const url = error.config?.url;
  const status = error.response?.status;
  const detail = falDetail(error.response?.data);

  if (isFalRequest(url)) {
    return mapFalError(status, detail, error.message);
  }

  const data = error.response?.data as { error?: GraphErrorBody } | undefined;
  if (data?.error) {
    return mapGraphError(data.error);
  }

  if (status === 401 || status === 403) {
    return (
      "Instagram-Authentifizierung fehlgeschlagen. Token prüfen: `refresh_access_token` " +
      "(falls älter als 24h) oder neuen Token im Meta Dashboard erzeugen."
    );
  }

  return `HTTP-Fehler bei der Instagram/R2-Anfrage${status ? ` (${status})` : ""}: ${error.message}`;
}
