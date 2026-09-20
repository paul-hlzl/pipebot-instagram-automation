/**
 * Google-Bewertungen: automatisch beantworten + Content-Recycling (siehe Session-Bericht und
 * docs/GOOGLE_BUSINESS_PROFILE_API.md).
 *
 * BEWUSST NICHT 1:1 DIE KOMMENTAR-LOGIK (comments.ts). Die drei Unterschiede, die das ganze
 * Modul prägen:
 *   1. JEDE Bewertung ist eine Antwort wert - anders als bei Instagram-Kommentaren, wo nur echte
 *      Fragen beantwortet und Lob/Spam/Hass bewusst übersprungen werden. Es gibt hier also keine
 *      Klassifizierung in "beantworten/überspringen", sondern nur unterschiedliche Tonfälle
 *      (siehe generateReviewReply in anthropic.ts).
 *   2. Eine sehr schlechte Bewertung wird NICHT wie ein Hass-Kommentar ignoriert, sondern
 *      empathisch und lösungsorientiert beantwortet.
 *   3. "Abgeschickt" heißt bei Google nicht "veröffentlicht": Google moderiert Inhaber-Antworten
 *      und kann eine Antwort nachträglich ablehnen. Deshalb gibt es einen Nachkontroll-Schritt
 *      (checkPendingModeration) und eine E-Mail an den Kunden, statt still zu scheitern - dasselbe
 *      Prinzip wie bei versteckten Instagram-Kommentaren.
 *
 * AUSLÖSER: ein eigener Cron (Default alle 60 Minuten), unabhängig von der stündlichen
 * Posting-Routine und vom Kommentar-Cron. Googles Notifications API könnte neue Bewertungen per
 * Push liefern (NEW_REVIEW/UPDATED_REVIEW) - allerdings NUR über ein Google-Cloud-Pub/Sub-Thema,
 * nicht über einen gewöhnlichen HTTPS-Webhook wie bei Meta, und mit genau einer
 * Benachrichtigungs-Einstellung pro Unternehmensprofil-Konto. Das ist eigene Infrastruktur
 * (Pub/Sub-Thema, Push-Subscription, Berechtigung für Googles Service-Konto) und erst sinnvoll,
 * wenn der API-Zugang überhaupt freigeschaltet ist - deshalb v1 bewusst Polling, siehe
 * docs/GOOGLE_BUSINESS_PROFILE_API.md ("Später: Push statt Polling").
 *
 * Ein Fehler bei einem Kunden/einer Filiale bricht den Lauf für alle anderen nicht ab - gleiches
 * Isolationsprinzip wie in comments.ts/planning.ts.
 */
import { db, nowIso, type CustomerRow, type GoogleReviewRow } from "./db.js";
import { kennungsFormen, vergissAbgelaufeneKennungen, vergissPersonendaten } from "./fremddaten.js";
import {
  assertNoBannedWords,
  assertRequiredElements,
  CHANNEL_IMAGE_FORMAT,
  hasPendingOrApprovedToday,
  resolveGoogleCredentials,
  resolveImageBranding,
  savePendingApproval,
  splitCommaList,
  splitHashtagList,
} from "./credentials.js";
import {
  getReview,
  isReplyRejected,
  listLocations,
  listReviews,
  policyViolationText,
  updateReviewReply,
  type GoogleReview,
} from "../google-business.js";
import { generateReviewReply, generateReviewSocialPost } from "../anthropic.js";
import { FAL_IMAGE_COST_USD, generateImageUrl } from "../fal.js";
import { logUsageCost } from "./analytics.js";
import { randomToken } from "./crypto.js";
import { sendMailBestEffort } from "./mailer.js";
import { reviewReplyRejectedEmail } from "./emails.js";

/** Sicherheitsnetz-Intervall des Polling-Crons (siehe Dateikopf), per Env überschreibbar. */
const REVIEW_CRON_INTERVAL_MINUTES = Number(process.env.PANEL_REVIEW_CRON_MINUTES) || 60;
/** Wie viele Antworten pro Kunde und Stunde tatsächlich an Google gehen - gleiche Schutzidee wie
 *  COMMENT_AUTO_REPLY_MAX_PER_HOUR: nichts tun, was für die Plattform nach Spam aussieht. */
const REVIEW_REPLY_MAX_PER_HOUR = Number(process.env.PANEL_REVIEW_REPLY_MAX_PER_HOUR) || 10;
/** Nur Bewertungen aus diesem Zeitfenster werden überhaupt angefasst - eine drei Jahre alte
 *  unbeantwortete Bewertung soll beim Einschalten nicht plötzlich eine Antwort bekommen. */
const REVIEW_LOOKBACK_DAYS = Number(process.env.PANEL_REVIEW_LOOKBACK_DAYS) || 30;
/** Ab wie vielen Zeichen eine Bewertung für einen Beitragsvorschlag taugt (ein "Top!" gibt keinen Beitrag her). */
const REVIEW_POST_MIN_TEXT_LENGTH = 40;
/** Wie lange nach dem Absenden der Moderationsstatus einer Antwort nachkontrolliert wird. Ohne
 *  diese Grenze wuerde jede je gesendete Antwort bis in alle Ewigkeit stuendlich neu abgefragt -
 *  Googles Prüfung ist nach Stunden bis wenigen Tagen durch. */
const REVIEW_MODERATION_CHECK_DAYS = 7;
/** Wie alt ein Bewertungs-Datensatz hoechstens sein darf, damit daraus noch ein Beitragsvorschlag
 *  entsteht. Verhindert vor allem, dass das spaetere EINSCHALTEN des Content-Recyclings rueckwirkend
 *  Beitraege aus laengst vergangenen Bewertungen erzeugt. */
const REVIEW_POST_MAX_AGE_DAYS = 14;

export interface ReviewEntry {
  id: string;
  reviewName: string;
  customerId: string;
  locationName: string;
  reviewerName: string | null;
  starRating: number;
  reviewText: string;
  reviewCreatedAt: string | null;
  generatedReply: string | null;
  status: string;
  replyState: string | null;
  policyViolation: string | null;
  socialPostStatus: string | null;
  socialPostId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toReviewEntry(r: GoogleReviewRow): ReviewEntry {
  return {
    id: r.id,
    reviewName: r.review_name,
    customerId: r.customer_id,
    locationName: r.location_name,
    reviewerName: r.reviewer_name,
    starRating: r.star_rating,
    reviewText: r.review_text,
    reviewCreatedAt: r.review_created_at,
    generatedReply: r.generated_reply,
    status: r.status,
    replyState: r.reply_state,
    policyViolation: r.policy_violation,
    socialPostStatus: r.social_post_status,
    socialPostId: r.social_post_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function findReviewRow(reviewName: string): GoogleReviewRow | undefined {
  // Klartext UND Hash: nach dem Moderationsfenster steht hier nur noch der Hash, und ohne ihn
  // waere eine laengst beantwortete Rezension wieder "neu".
  const [klar, hash] = kennungsFormen(reviewName);
  return db.prepare("SELECT * FROM google_reviews WHERE review_name IN (?, ?)").get(klar, hash) as GoogleReviewRow | undefined;
}

function insertReviewRow(input: {
  reviewName: string;
  customerId: string;
  locationName: string;
  reviewerName: string | null;
  starRating: number;
  reviewText: string;
  reviewCreatedAt: string | null;
  generatedReply: string | null;
  status: string;
  replyState: string | null;
  socialPostStatus: string | null;
}): GoogleReviewRow {
  const now = nowIso();
  const id = `grev_${randomToken(9)}`;
  db.prepare(
    `INSERT INTO google_reviews (id, review_name, customer_id, location_name, reviewer_name, star_rating, review_text,
       review_created_at, generated_reply, status, reply_state, policy_violation, rejected_notified_at,
       social_post_status, social_post_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
  ).run(
    id,
    input.reviewName,
    input.customerId,
    input.locationName,
    input.reviewerName,
    input.starRating,
    input.reviewText,
    input.reviewCreatedAt,
    input.generatedReply,
    input.status,
    input.replyState,
    input.socialPostStatus,
    now,
    now,
  );
  return db.prepare("SELECT * FROM google_reviews WHERE id = ?").get(id) as GoogleReviewRow;
}

/** Tatsächlich an Google geschickte Antworten dieser Stunde (automatisch ODER nach Freigabe). */
function repliesSentInLastHour(customerId: string): number {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  return (
    db
      .prepare("SELECT COUNT(*) as n FROM google_reviews WHERE customer_id = ? AND status = 'answered' AND updated_at >= ?")
      .get(customerId, since) as { n: number }
  ).n;
}

/** Wartende Antwort-Entwürfe dieses Kunden, neueste zuerst. */
export function listPendingReviewApprovals(customerId: string): ReviewEntry[] {
  const rows = db
    .prepare("SELECT * FROM google_reviews WHERE customer_id = ? AND status = 'pending_approval' ORDER BY created_at DESC")
    .all(customerId) as GoogleReviewRow[];
  return rows.map(toReviewEntry);
}

/** Letzte `days` Tage nach Status gruppiert - für die Einstellungsseite und die Admin-Übersicht. */
export function reviewStatsForCustomer(
  customerId: string,
  days = 30,
): { answered: number; pendingApproval: number; rejected: number; replyRejected: number; posts: number } {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = db
    .prepare("SELECT status, COUNT(*) as n FROM google_reviews WHERE customer_id = ? AND created_at >= ? GROUP BY status")
    .all(customerId, since) as { status: string; n: number }[];
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const posts = (
    db
      .prepare("SELECT COUNT(*) as n FROM google_reviews WHERE customer_id = ? AND created_at >= ? AND social_post_status = 'created'")
      .get(customerId, since) as { n: number }
  ).n;
  return {
    answered: byStatus.answered ?? 0,
    pendingApproval: byStatus.pending_approval ?? 0,
    rejected: byStatus.rejected ?? 0,
    replyRejected: byStatus.reply_rejected ?? 0,
    posts,
  };
}

export class ReviewRateLimitError extends Error {}

/**
 * Gibt einen wartenden Antwort-Entwurf frei und schickt ihn sofort an Google (optional mit vom
 * Kunden geändertem Text) - auf den Kunden eingegrenzt, niemand kann fremde Bewertungen anfassen.
 * null = nicht gefunden/nicht seine/nicht mehr offen.
 */
export async function approveReviewReply(customerId: string, id: string, editedReply?: string): Promise<ReviewEntry | null> {
  const row = db
    .prepare("SELECT * FROM google_reviews WHERE id = ? AND customer_id = ? AND status = 'pending_approval'")
    .get(id, customerId) as GoogleReviewRow | undefined;
  if (!row) return null;
  if (repliesSentInLastHour(customerId) >= REVIEW_REPLY_MAX_PER_HOUR) {
    throw new ReviewRateLimitError(
      `Maximale Anzahl automatischer Antworten pro Stunde (${REVIEW_REPLY_MAX_PER_HOUR}) erreicht - bitte in Kürze erneut versuchen.`,
    );
  }
  const replyText = (editedReply?.trim() || row.generated_reply || "").trim();
  if (!replyText) throw new Error("Kein Antworttext vorhanden.");
  const creds = await resolveGoogleCredentials(customerId);
  if (!creds) throw new Error("Google-Unternehmensprofil nicht verbunden.");
  const sent = await updateReviewReply(row.review_name, replyText, creds.accessToken);
  // Achtung: die Kennung (`review_name`) bleibt hier bewusst im Klartext. Google kann eine
  // gesendete Antwort noch nachtraeglich ablehnen; `checkPendingModeration` fragt sieben Tage lang
  // damit nach. Erst danach wird sie gehasht - siehe vergissAbgelaufeneKennungen weiter unten.
  db.prepare("UPDATE google_reviews SET generated_reply = ?, status = 'answered', reply_state = ?, updated_at = ? WHERE id = ?").run(
    replyText,
    sent.reviewReplyState,
    nowIso(),
    row.id,
  );
  // Antwort fuer den Aufrufer festhalten, BEVOR Name und Text verschwinden - das Panel soll den
  // gerade freigegebenen Satz noch einmal zeigen koennen. Gespeichert bleibt er nicht.
  const ergebnis = toReviewEntry(db.prepare("SELECT * FROM google_reviews WHERE id = ?").get(row.id) as GoogleReviewRow);
  vergissPersonendaten("google_reviews", row.id);
  return ergebnis;
}

/** Lehnt einen wartenden Antwort-Entwurf ab - er wird nie gesendet. Auf den Kunden eingegrenzt wie approveReviewReply. */
export function rejectReviewReply(customerId: string, id: string): ReviewEntry | null {
  const result = db
    .prepare("UPDATE google_reviews SET status = 'rejected', updated_at = ? WHERE id = ? AND customer_id = ? AND status = 'pending_approval'")
    .run(nowIso(), id, customerId);
  if (result.changes === 0) return null;
  const ergebnis = toReviewEntry(db.prepare("SELECT * FROM google_reviews WHERE id = ?").get(id) as GoogleReviewRow);
  // Abgelehnt heisst: es geht nichts raus, es kommt auch keine Nachpruefung. Name und Text weg -
  // die Kennung faellt mit dem naechsten Lauf ueber vergissAbgelaufeneKennungen.
  vergissPersonendaten("google_reviews", id);
  return ergebnis;
}

// ---------- Content-Recycling ----------

/**
 * Wohin ein "Das sagen unsere Kunden"-Beitrag gehen soll. Instagram-Feed bevorzugt, sonst
 * LinkedIn - beides nur, wenn der Kanal verbunden UND vom Kunden aktiviert ist. null = der Kunde
 * hat gerade keinen passenden Kanal, dann entsteht auch kein Vorschlag (statt einen Beitrag
 * anzulegen, den niemand veröffentlichen kann).
 */
function targetChannelForReviewPost(customer: CustomerRow): { channel: "ig_feed" | "linkedin"; provider: string } | null {
  const connected = (provider: string): boolean =>
    Boolean(db.prepare("SELECT 1 FROM connections WHERE customer_id = ? AND provider = ?").get(customer.id, provider));
  if (customer.ig_feed_enabled && connected("instagram")) return { channel: "ig_feed", provider: "instagram" };
  if (customer.linkedin_enabled && connected("linkedin")) return { channel: "linkedin", provider: "linkedin" };
  return null;
}

function setSocialPostStatus(rowId: string, status: string, postId: string | null = null): void {
  db.prepare("UPDATE google_reviews SET social_post_status = ?, social_post_id = ?, updated_at = ? WHERE id = ?").run(
    status,
    postId,
    nowIso(),
    rowId,
  );
}

/**
 * Macht aus einer guten Bewertung einen Beitragsvorschlag - Text per KI, Bild im bestehenden
 * Branding-Stil, abgelegt als ganz normaler Beitrag zur Freigabe (pending_approvals), der danach
 * denselben Weg nimmt wie jeder andere Beitrag.
 *
 * ABSICHTLICH IMMER ÜBER DIE FREIGABE, auch bei Kunden mit ausgeschaltetem Freigabe-Modus: hier
 * wird der Text einer fremden Person weiterveröffentlicht, das soll niemandem einfach so
 * passieren (siehe auch den Hinweistext im Panel). Der Kunde sieht den Vorschlag, gibt ihn frei
 * oder lehnt ihn ab; ohne Freigabe geht nichts online.
 *
 * Reihenfolge ist Absicht: erst prüfen, ob der Tagesplatz für diesen Kanal überhaupt frei ist
 * (hasPendingOrApprovedToday - derselbe harte Duplikat-Schutz, den die tägliche Routine nutzt),
 * dann erst KI/Bild erzeugen. Andersherum würde bei belegtem Platz jedes Mal Geld für einen
 * Beitrag verbrannt, der gar nicht abgelegt werden kann. Ist der Platz belegt, bleibt die
 * Bewertung auf 'queued' und wird an einem der nächsten Tage erneut versucht.
 */
async function maybeCreateSocialPost(customer: CustomerRow, row: GoogleReviewRow): Promise<void> {
  if (!customer.google_review_posts_enabled) return;
  if (row.social_post_status && row.social_post_status !== "queued") return;
  if (row.star_rating < (customer.google_review_post_min_stars || 4)) {
    setSocialPostStatus(row.id, "skipped");
    return;
  }
  if (row.review_text.trim().length < REVIEW_POST_MIN_TEXT_LENGTH) {
    setSocialPostStatus(row.id, "skipped");
    return;
  }

  const target = targetChannelForReviewPost(customer);
  if (!target) {
    setSocialPostStatus(row.id, "queued"); // kein passender Kanal (mehr) - später erneut versuchen
    return;
  }
  if (hasPendingOrApprovedToday(customer.id, target.channel)) {
    setSocialPostStatus(row.id, "queued"); // Tagesplatz belegt - morgen erneut, ohne Kosten heute
    return;
  }

  const bannedWords = splitCommaList(customer.banned_words);
  const requiredElements = splitCommaList(customer.required_elements);
  const customHashtags = splitHashtagList(customer.custom_hashtags);
  const content = await generateReviewSocialPost({
    reviewText: row.review_text,
    starRating: row.star_rating,
    reviewerName: row.reviewer_name,
    company: customer.company,
    industry: customer.industry ?? "",
    about: customer.about ?? "",
    tone: customer.tone ?? "sachlich",
    language: customer.language ?? "de",
    hashtagPreference: customer.hashtag_pref ?? "wenige",
    emojisEnabled: Boolean(customer.emojis_enabled),
    channel: target.channel,
    bannedWords,
    requiredElements,
    customHashtags,
  });
  logUsageCost(customer.id, "review-post", content.costUsd);

  try {
    // Dieselben harten Grenzen wie bei jedem anderen Beitrag. Kein Retry wie in planning.ts: der
    // Ausgangstext ist eine feste, fremde Bewertung - scheitert sie an den Grenzen des Kunden,
    // hilft ein zweiter Versuch mit demselben Ausgangstext meist nicht, und ein Beitrag aus einer
    // Bewertung ist ein Bonus, kein Pflichttermin. Die Bewertung selbst wurde trotzdem beantwortet.
    assertNoBannedWords(customer.id, content.headline, content.caption);
    assertRequiredElements(customer.id, content.headline, content.caption);
  } catch (err) {
    console.error(
      `[reviews] ${customer.id}/${row.review_name}: Beitragsvorschlag verworfen (Wortgrenzen):`,
      err instanceof Error ? err.message : err,
    );
    setSocialPostStatus(row.id, "skipped");
    return;
  }

  const branding = resolveImageBranding(customer.id);
  const image = await generateImageUrl(content.headline, CHANNEL_IMAGE_FORMAT[target.channel], branding);
  logUsageCost(customer.id, "review-post", FAL_IMAGE_COST_USD);

  const approval = savePendingApproval({
    customerId: customer.id,
    provider: target.provider,
    channel: target.channel,
    headline: content.headline,
    caption: content.caption,
    imageUrl: image.imageUrl,
    source: "review",
  });
  if (!approval) {
    // Zwischen der Prüfung oben und jetzt ist der Tagesplatz belegt worden (paralleler Routine-
    // Lauf) - nicht verwerfen, an einem der nächsten Tage erneut versuchen.
    setSocialPostStatus(row.id, "queued");
    return;
  }
  setSocialPostStatus(row.id, "created", approval.id);
}

// ---------- Antworten ----------

/**
 * Erzeugt für eine neue Bewertung eine Antwort und schickt sie ab (oder legt sie zur Freigabe).
 * Legt in JEDEM Fall eine Zeile an, sobald die KI-Antwort steht - dadurch wird dieselbe Bewertung
 * nie zweimal beantwortet. Scheitert schon die KI, wird bewusst KEINE Zeile gespeichert: der
 * nächste Lauf versucht es dann erneut.
 */
async function answerNewReview(customer: CustomerRow, review: GoogleReview, accessToken: string): Promise<"answered" | "pending_approval" | "error" | "rate_limited"> {
  let generated;
  try {
    generated = await generateReviewReply({
      reviewText: review.comment,
      starRating: review.starRating,
      reviewerName: review.reviewerName,
      company: customer.company,
      industry: customer.industry ?? "",
      about: customer.about ?? "",
      tone: customer.tone ?? "sachlich",
      language: customer.language ?? "de",
    });
    logUsageCost(customer.id, "review-reply", generated.costUsd);
  } catch (err) {
    console.error(`[reviews] ${customer.id}/${review.name}: Antwort-Generierung fehlgeschlagen:`, err instanceof Error ? err.message : err);
    return "error";
  }

  const common = {
    reviewName: review.name,
    customerId: customer.id,
    locationName: review.name.split("/reviews/")[0],
    reviewerName: review.reviewerName,
    starRating: review.starRating,
    reviewText: review.comment,
    reviewCreatedAt: review.createTime,
    generatedReply: generated.reply,
  };

  if (customer.google_review_mode !== "auto") {
    insertReviewRow({ ...common, status: "pending_approval", replyState: null, socialPostStatus: null });
    return "pending_approval";
  }

  if (repliesSentInLastHour(customer.id) >= REVIEW_REPLY_MAX_PER_HOUR) {
    console.error(`[reviews] ${customer.id}: Stunden-Limit (${REVIEW_REPLY_MAX_PER_HOUR}) erreicht - Bewertung ${review.name} folgt später.`);
    return "rate_limited";
  }
  try {
    const sent = await updateReviewReply(review.name, generated.reply, accessToken);
    insertReviewRow({ ...common, status: "answered", replyState: sent.reviewReplyState, socialPostStatus: null });
    return "answered";
  } catch (err) {
    console.error(`[reviews] ${customer.id}/${review.name}: Antwort-Versand fehlgeschlagen:`, err instanceof Error ? err.message : err);
    return "error";
  }
}

/**
 * Nachkontrolle der Moderation: Google nimmt eine Antwort erst entgegen und prüft sie danach.
 * Für jede bereits gesendete Antwort, die noch nicht als abgelehnt bekannt ist, wird die Bewertung
 * frisch geladen und ihr Antwort-Status ausgewertet. Erst bei einer Ablehnung wird der Status
 * umgesetzt und der Kunde per E-Mail informiert - genau einmal (rejected_notified_at).
 *
 * `reviewsByName` sind die ohnehin schon geladenen Bewertungen dieses Laufs; nur was dort nicht
 * vorkommt (ältere Bewertung, außerhalb der ersten Seite), wird einzeln nachgeladen.
 */
async function checkPendingModeration(
  customer: CustomerRow,
  accessToken: string,
  reviewsByName: Map<string, GoogleReview>,
): Promise<number> {
  const checkSince = new Date(Date.now() - REVIEW_MODERATION_CHECK_DAYS * 86_400_000).toISOString();
  const rows = db
    .prepare("SELECT * FROM google_reviews WHERE customer_id = ? AND status = 'answered' AND rejected_notified_at IS NULL AND updated_at >= ?")
    .all(customer.id, checkSince) as GoogleReviewRow[];
  let rejected = 0;
  for (const row of rows) {
    let review = reviewsByName.get(row.review_name);
    if (!review) {
      try {
        review = (await getReview(row.review_name, accessToken)) ?? undefined;
      } catch (err) {
        console.error(`[reviews] ${customer.id}/${row.review_name}: Moderationsstatus nicht abrufbar:`, err instanceof Error ? err.message : err);
        continue;
      }
    }
    if (!review) continue;
    const state = review.reply?.reviewReplyState ?? null;
    if (!isReplyRejected(review.reply)) {
      // Status trotzdem mitschreiben, damit im Panel sichtbar ist, was Google meldet.
      if (state && state !== row.reply_state) {
        db.prepare("UPDATE google_reviews SET reply_state = ?, updated_at = ? WHERE id = ?").run(state, nowIso(), row.id);
      }
      continue;
    }
    const reason = policyViolationText(review.reply);
    db.prepare(
      "UPDATE google_reviews SET status = 'reply_rejected', reply_state = ?, policy_violation = ?, rejected_notified_at = ?, updated_at = ? WHERE id = ?",
    ).run(state, reason, nowIso(), nowIso(), row.id);
    sendMailBestEffort(
      reviewReplyRejectedEmail({
        to: customer.email,
        company: customer.company,
        reviewerName: row.reviewer_name,
        starRating: row.star_rating,
        reason,
      }),
    );
    rejected++;
  }
  return rejected;
}

interface CustomerReviewResult {
  answered: number;
  pendingApproval: number;
  replyRejected: number;
  postsCreated: number;
  errors: number;
}

async function processCustomerReviews(customer: CustomerRow): Promise<CustomerReviewResult> {
  const result: CustomerReviewResult = { answered: 0, pendingApproval: 0, replyRejected: 0, postsCreated: 0, errors: 0 };

  // Erst nachsehen, OB verbunden ist - sonst wuerde ein Kunde, der die Funktion eingeschaltet, aber
  // Google (noch) nicht verbunden hat, bei jedem Lauf eine Fehlerzeile erzeugen. Das ist kein
  // Fehler, sondern schlicht nichts zu tun (gleiche Reihenfolge wie in comments.ts).
  const connected = db
    .prepare("SELECT 1 FROM connections WHERE customer_id = ? AND provider = 'google'")
    .get(customer.id);
  if (!connected) return result;

  let creds;
  try {
    creds = await resolveGoogleCredentials(customer.id);
  } catch (err) {
    console.error(`[reviews] ${customer.id}: Zugangsdaten nicht verfügbar (Trial/Pause/Token):`, err instanceof Error ? err.message : err);
    result.errors++;
    return result;
  }
  if (!creds) return result;

  let locations;
  try {
    locations = await listLocations(creds.accountName, creds.accessToken);
  } catch (err) {
    console.error(`[reviews] ${customer.id}: Filialen nicht abrufbar:`, err instanceof Error ? err.message : err);
    result.errors++;
    return result;
  }

  const seen = new Map<string, GoogleReview>();
  const since = Date.now() - REVIEW_LOOKBACK_DAYS * 86_400_000;

  for (const location of locations) {
    let reviews: GoogleReview[];
    try {
      reviews = await listReviews(creds.accountName, location.name, creds.accessToken);
    } catch (err) {
      console.error(`[reviews] ${customer.id}/${location.name}: Bewertungen nicht abrufbar:`, err instanceof Error ? err.message : err);
      result.errors++;
      continue;
    }

    for (const review of reviews) {
      seen.set(review.name, review);
      const existing = findReviewRow(review.name);
      if (existing) continue; // schon verarbeitet - Moderations-Nachkontrolle läuft separat unten
      if (review.createTime && new Date(review.createTime).getTime() < since) continue; // zu alt, siehe REVIEW_LOOKBACK_DAYS
      if (review.reply?.comment) continue; // hat bereits eine (manuelle) Inhaber-Antwort - nie überschreiben

      const outcome = await answerNewReview(customer, review, creds.accessToken);
      if (outcome === "rate_limited") return result; // Rest folgt im nächsten Lauf
      if (outcome === "error") {
        result.errors++;
        continue;
      }
      if (outcome === "answered") result.answered++;
      if (outcome === "pending_approval") result.pendingApproval++;
    }
  }

  try {
    result.replyRejected += await checkPendingModeration(customer, creds.accessToken, seen);
  } catch (err) {
    console.error(`[reviews] ${customer.id}: Moderations-Nachkontrolle fehlgeschlagen:`, err instanceof Error ? err.message : err);
    result.errors++;
  }

  // Content-Recycling laeuft ueber ALLE noch offenen Bewertungen dieses Kunden, nicht nur die
  // gerade neu eingetroffenen - eine Bewertung, deren Tagesplatz gestern belegt war ('queued'),
  // bekommt so heute ihre Chance.
  if (customer.google_review_posts_enabled) {
    const postSince = new Date(Date.now() - REVIEW_POST_MAX_AGE_DAYS * 86_400_000).toISOString();
    const candidates = db
      .prepare(
        `SELECT * FROM google_reviews
         WHERE customer_id = ? AND (social_post_status IS NULL OR social_post_status = 'queued')
           AND star_rating >= ? AND status IN ('answered', 'pending_approval', 'reply_rejected')
           AND created_at >= ?
         ORDER BY created_at DESC LIMIT 10`,
      )
      .all(customer.id, customer.google_review_post_min_stars || 4, postSince) as GoogleReviewRow[];
    for (const row of candidates) {
      try {
        const before = row.social_post_status;
        await maybeCreateSocialPost(customer, row);
        const after = (db.prepare("SELECT social_post_status FROM google_reviews WHERE id = ?").get(row.id) as { social_post_status: string | null })
          .social_post_status;
        if (after === "created" && before !== "created") result.postsCreated++;
      } catch (err) {
        console.error(`[reviews] ${customer.id}/${row.review_name}: Beitragsvorschlag fehlgeschlagen:`, err instanceof Error ? err.message : err);
        result.errors++;
      }
    }
  }

  return result;
}

export interface ReviewRunSummary {
  startedAt: string;
  finishedAt: string;
  customersChecked: number;
  answered: number;
  pendingApproval: number;
  replyRejected: number;
  postsCreated: number;
  errors: number;
}

export async function runReviewAutomationPass(): Promise<ReviewRunSummary> {
  const startedAt = nowIso();
  // Kennungen abgeschlossener Rezensionen vergessen, sobald das Moderationsfenster zu ist. Haengt
  // bewusst am selben Lauf wie die Nachpruefung: dieselbe Frist, eine Stelle.
  const vergessen = vergissAbgelaufeneKennungen("google_reviews", REVIEW_MODERATION_CHECK_DAYS);
  if (vergessen) console.log(`[reviews] ${vergessen} Kennung(en) nach Ablauf des Moderationsfensters gehasht.`);
  const summary: ReviewRunSummary = {
    startedAt,
    finishedAt: startedAt,
    customersChecked: 0,
    answered: 0,
    pendingApproval: 0,
    replyRejected: 0,
    postsCreated: 0,
    errors: 0,
  };

  const customers = db
    .prepare(
      "SELECT * FROM customers WHERE status = 'active' AND customer_paused = 0 AND email_verified = 1 AND google_review_automation_enabled = 1",
    )
    .all() as CustomerRow[];

  for (const customer of customers) {
    summary.customersChecked++;
    try {
      const r = await processCustomerReviews(customer);
      summary.answered += r.answered;
      summary.pendingApproval += r.pendingApproval;
      summary.replyRejected += r.replyRejected;
      summary.postsCreated += r.postsCreated;
      summary.errors += r.errors;
    } catch (err) {
      summary.errors++;
      console.error(`[reviews] ${customer.id}: unerwarteter Fehler:`, err instanceof Error ? err.message : err);
    }
  }

  summary.finishedAt = nowIso();
  return summary;
}

/** Eigenständiger Cron, unabhängig von Posting-Routine, Kommentar- und Analytics-Crons (siehe Dateikopf). */
export function startReviewAutomationSchedule(intervalMinutes = REVIEW_CRON_INTERVAL_MINUTES): NodeJS.Timeout {
  const run = () =>
    runReviewAutomationPass()
      .then((summary) => {
        if (summary.customersChecked) console.log("[panel] Google-Bewertungen:", summary);
      })
      .catch((err) => console.error("[panel] Google-Bewertungen unerwartet fehlgeschlagen:", err));
  setTimeout(run, 90_000);
  return setInterval(run, intervalMinutes * 60_000);
}
