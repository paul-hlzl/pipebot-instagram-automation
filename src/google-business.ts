/**
 * Google Business Profile APIs - nur die Teile, die für die Bewertungs-Automatisierung gebraucht
 * werden: Filialen eines Kontos auflisten, Bewertungen lesen, auf eine Bewertung antworten.
 *
 * ZWEI BASIS-URLS, das ist kein Versehen (Stand 2026-09-15, gegen Googles eigene Discovery-
 * Dokumente geprüft, siehe docs/GOOGLE_BUSINESS_PROFILE_API.md):
 * - Filialen/Standorte: `mybusinessbusinessinformation.googleapis.com/v1` (neue, aufgeteilte API)
 * - BEWERTUNGEN: `mybusiness.googleapis.com/v4` - die alte, nie migrierte API. Es gibt bis heute
 *   keinen v1-Nachfolger für Reviews; wer Bewertungen liest oder beantwortet, tut das über v4.
 *   (Erkennbar auch daran, dass mybusiness.googleapis.com als einzige dieser APIs kein
 *   öffentliches Discovery-Dokument ausliefert - sie ist vollständig zugangsbeschränkt.)
 *
 * JEDER Aufruf hier schlägt fehl, solange Google den API-Zugang für das Cloud-Projekt nicht
 * freigegeben hat (Kontingent 0/Minute, typischerweise HTTP 403 mit PERMISSION_DENIED bzw. 429).
 * Das ist erwartetes Verhalten vor der Freigabe und kein Fehler in diesem Code - reviews.ts
 * behandelt es wie jeden anderen API-Fehler (loggen, nächster Lauf versucht es erneut).
 */
import axios, { type AxiosInstance } from "axios";

const INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";

function client(accessToken: string): AxiosInstance {
  return axios.create({
    timeout: 20_000,
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: (status) => status >= 200 && status < 300,
  });
}

export interface BusinessLocation {
  /** "locations/12345678901234567890" (die neue API liefert den Namen OHNE accounts/-Präfix). */
  name: string;
  title: string | null;
}

export interface GoogleReviewReply {
  comment: string | null;
  updateTime: string | null;
  /**
   * Googles Moderationsstatus der eigenen Antwort. Von Google 2026 ergänzt; der genaue Wertebereich
   * ist hier bewusst NICHT als Union getippt, weil er sich in Googles Referenz noch bewegt hat -
   * `isReplyRejected()` unten wertet defensiv aus (siehe dort). Fehlt das Feld (ältere Antwort,
   * Google liefert es nicht mit), ist das kein Fehler: dann gilt die Antwort als unbeanstandet.
   */
  reviewReplyState: string | null;
  /** Begründung, falls die Antwort wegen Richtlinienverstoß abgelehnt wurde - Rohform, siehe policyViolationText(). */
  policyViolation: unknown;
}

export interface GoogleReview {
  /** Vollständiger Ressourcenname: accounts/{a}/locations/{l}/reviews/{r} - unser Dedupe-Schlüssel. */
  name: string;
  reviewId: string | null;
  reviewerName: string | null;
  /** 1-5. 0 = Google hat keinen/unbekannten Wert geliefert (STAR_RATING_UNSPECIFIED). */
  starRating: number;
  /** Kann leer sein - eine Bewertung ganz ohne Text (nur Sterne) ist auf Google völlig normal. */
  comment: string;
  createTime: string | null;
  updateTime: string | null;
  reply: GoogleReviewReply | null;
}

const STAR_WORDS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

interface RawReview {
  name?: string;
  reviewId?: string;
  reviewer?: { displayName?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string; reviewReplyState?: string; policyViolation?: unknown };
}

function toReview(raw: RawReview): GoogleReview | null {
  if (!raw.name) return null;
  return {
    name: raw.name,
    reviewId: raw.reviewId ?? null,
    reviewerName: raw.reviewer?.displayName ?? null,
    starRating: STAR_WORDS[raw.starRating ?? ""] ?? 0,
    comment: typeof raw.comment === "string" ? raw.comment.trim() : "",
    createTime: raw.createTime ?? null,
    updateTime: raw.updateTime ?? null,
    reply: raw.reviewReply
      ? {
          comment: raw.reviewReply.comment ?? null,
          updateTime: raw.reviewReply.updateTime ?? null,
          reviewReplyState: raw.reviewReply.reviewReplyState ?? null,
          policyViolation: raw.reviewReply.policyViolation ?? null,
        }
      : null,
  };
}

/**
 * Filialen/Standorte eines Unternehmensprofil-Kontos. `readMask` ist Pflicht (die API antwortet
 * sonst mit 400), deshalb hier fest auf das Minimum gesetzt, das wir brauchen. Kein Paging über
 * die erste Seite hinaus - für die Zielgruppe (ein Standort, selten eine Handvoll) reicht das;
 * bei einer Kette mit >100 Filialen müsste hier `nextPageToken` ergänzt werden.
 */
export async function listLocations(accountName: string, accessToken: string): Promise<BusinessLocation[]> {
  const { data } = await client(accessToken).get<{ locations?: { name?: string; title?: string }[] }>(
    `${INFO_BASE}/${accountName}/locations`,
    { params: { readMask: "name,title", pageSize: 100 } },
  );
  return (data.locations ?? [])
    .filter((l): l is { name: string; title?: string } => Boolean(l.name))
    .map((l) => ({ name: l.name, title: l.title ?? null }));
}

/**
 * Bewertungen einer Filiale, neueste zuerst. `locationName` ist der Name aus listLocations
 * ("locations/123"); die v4-Reviews-API erwartet den Pfad MIT Konto davor, deshalb wird hier
 * zusammengesetzt statt den Aufrufer raten zu lassen.
 */
export async function listReviews(
  accountName: string,
  locationName: string,
  accessToken: string,
  pageSize = 20,
): Promise<GoogleReview[]> {
  const locationId = locationName.startsWith("locations/") ? locationName.slice("locations/".length) : locationName;
  const { data } = await client(accessToken).get<{ reviews?: RawReview[] }>(
    `${REVIEWS_BASE}/${accountName}/locations/${locationId}/reviews`,
    { params: { pageSize, orderBy: "updateTime desc" } },
  );
  return (data.reviews ?? []).map(toReview).filter((r): r is GoogleReview => r !== null);
}

/** Eine einzelne Bewertung neu laden - genutzt, um nach dem Senden den Moderationsstatus der eigenen Antwort zu prüfen. */
export async function getReview(reviewName: string, accessToken: string): Promise<GoogleReview | null> {
  const { data } = await client(accessToken).get<RawReview>(`${REVIEWS_BASE}/${reviewName}`);
  return toReview(data);
}

/**
 * Antwortet auf eine Bewertung (legt die Antwort an oder überschreibt eine vorhandene - Google
 * kennt pro Bewertung genau eine Inhaber-Antwort). Wirft bei Fehler; der Aufrufer entscheidet,
 * was das für diese Bewertung bedeutet.
 *
 * Wichtig: ein Erfolg hier heißt NUR "von Google entgegengenommen", nicht "veröffentlicht" -
 * Google moderiert Inhaber-Antworten und kann sie danach noch ablehnen. Genau dafür gibt es
 * isReplyRejected() und den Nachkontroll-Lauf in reviews.ts.
 */
export async function updateReviewReply(reviewName: string, comment: string, accessToken: string): Promise<GoogleReviewReply> {
  const { data } = await client(accessToken).put<{ comment?: string; updateTime?: string; reviewReplyState?: string; policyViolation?: unknown }>(
    `${REVIEWS_BASE}/${reviewName}/reply`,
    { comment },
  );
  return {
    comment: data.comment ?? comment,
    updateTime: data.updateTime ?? null,
    reviewReplyState: data.reviewReplyState ?? null,
    policyViolation: data.policyViolation ?? null,
  };
}

/**
 * Wurde unsere Antwort von Googles Moderation abgelehnt?
 *
 * Bewusst tolerant statt auf einen exakten Enum-Wert festgenagelt: das Feld `reviewReplyState`
 * (samt `policyViolation`) hat Google erst 2026 ergänzt, und der Wertebereich ließ sich in dieser
 * Sitzung nicht gegen die offizielle Referenz gegenprüfen (developers.google.com ist aus der
 * Arbeitsumgebung nicht erreichbar, siehe Bericht). Deshalb: alles, was "REJECT" enthält, gilt als
 * abgelehnt, und ein vorhandener policyViolation-Block ebenfalls - beides sind Signale, die es bei
 * einer unbeanstandeten Antwort nicht gibt. Fehlen beide Felder, gilt die Antwort als in Ordnung
 * (fail-open), damit eine ältere/schweigsame API-Antwort nie fälschlich eine "Ihre Antwort wurde
 * abgelehnt"-Mail auslöst.
 */
export function isReplyRejected(reply: GoogleReviewReply | null): boolean {
  if (!reply) return false;
  if (reply.policyViolation && Object.keys(reply.policyViolation as object).length > 0) return true;
  return (reply.reviewReplyState ?? "").toUpperCase().includes("REJECT");
}

/** Lesbare Kurzform des policyViolation-Blocks für E-Mail/Panel - nie mehr als ein paar Zeilen. */
export function policyViolationText(reply: GoogleReviewReply | null): string | null {
  if (!reply) return null;
  const v = reply.policyViolation;
  if (!v) return reply.reviewReplyState ?? null;
  if (typeof v === "string") return v.slice(0, 500);
  try {
    return JSON.stringify(v).slice(0, 500);
  } catch {
    return reply.reviewReplyState ?? null;
  }
}
