/**
 * Server-side daily pre-planning (Panel v5, task 4): generates up to 7 days of upcoming posts
 * per active customer/channel AHEAD of time, as plain Node function calls into the same
 * underlying modules the MCP tools use (fal.ts, watermark.ts via generateImageUrl,
 * anthropic.ts, instagram.ts via getStyleSamples) - deliberately NOT through an MCP tool or a
 * Claude Code routine, so the panel can show/let customers edit a whole week at once instead of
 * generating one post per hourly routine tick.
 *
 * This is purely additive to the existing K1-K9 routine: planUpcomingPosts() only ever CREATES
 * planned_posts rows ahead of time. Nothing here publishes anything or touches pending_approvals
 * or the posts table - the routine (with docs/ROUTINE_TEIL1_V5.md's new K0 step) is still the
 * only thing that ever actually publishes, and still generates on the spot as a fallback for any
 * customer/day this run skipped or hasn't reached yet (task 6).
 */
import { db, nowIso, type CustomerRow } from "./db.js";
import {
  assertNoBannedWords,
  assertRequiredElements,
  CHANNEL_IMAGE_FORMAT,
  createPlannedPost,
  EMAIL_CHANNEL_LABEL,
  forceRejectPendingApproval,
  getPlannedPostByChannelDate,
  getStyleSamples,
  listApprovedPendingPosts,
  listContentPillars,
  listPlannedPosts,
  listPlannedPostsWithoutImage,
  logPlanningError,
  markPlannedPostStatus,
  overwritePendingApprovalContent,
  overwritePlannedPostContent,
  pickWeightedPillar,
  resolveImageBranding,
  scheduleInputFor,
  setPlannedPostImage,
  splitCommaList,
  splitHashtagList,
  type ContentPillar,
  type PendingApproval,
  type PlannedPost,
  type PublishChannel,
} from "./credentials.js";
import { isPostingDayForChannel, viennaDateStr, type PostingChannel } from "./schedule.js";
import { wochenfarbe } from "./brand-colors.js";
import { darfNeuGeschriebenWerden } from "./credentials.js";
import { sprachFehler } from "./sprache.js";
import { headlineLayoutForFormat, HEADLINE_MAX_LINES } from "../watermark.js";
import { getFontOption, DEFAULT_FONT_ID } from "../fonts.js";
import { anthropicAvailable, generatePlannedPostContent } from "../anthropic.js";
import { generateImageUrl } from "../fal.js";
import { logUsageCost } from "./analytics.js";
import { ToolError } from "../errors.js";
import { sendMailBestEffort } from "./mailer.js";
import { stalePostSkippedEmail } from "./emails.js";

const LOOKAHEAD_DAYS = 7;

export type PlannableChannel = PublishChannel;

const CHANNEL_SCHEDULE: Record<PlannableChannel, PostingChannel> = {
  ig_feed: "instagram",
  ig_story: "instagram",
  linkedin: "linkedin",
};

/**
 * Wirft, wenn eine Ueberschrift im Zielformat nicht in der einheitlichen Schriftgroesse setzbar
 * ist. Die Meldung geht als `avoidNote` in den einen erlaubten zweiten Versuch - dieselbe
 * Mechanik wie bei verbotenen Woertern.
 *
 * Bewusst VOR dem Bild geprueft: das Bild kostet Geld, die Pruefung ist reine Rechnerei. Und
 * bewusst als Neu-Schreiben statt als Verkleinern - eine Ueberschrift, die selbst mit Trennung
 * nicht in vier Zeilen passt, ist zu lang, und kleinere Schrift macht sie nicht besser, nur
 * unauffaelliger. Angelegt ist die Grenze grosszuegig (rund 60 Zeichen, gemessene Ueberschriften
 * liegen im Median bei 35), sie soll nur echte Ausreisser abfangen.
 */
/* ------------------------- Keine zwei Beitraege mit demselben Aufhaenger -------------------
 * Auftrag vom 19.09.2026. Vorher entstanden zehn Beitraege in zehn getrennten Aufrufen, von
 * denen keiner wusste, was die anderen neun sagen - bei channoine-mayr.at begannen neun von
 * zehn Ueberschriften mit "Dein" oder "Deine", zwei teilten 60 Prozent ihrer Woerter.
 *
 * Die Sperre wirkt an zwei Stellen: der Prompt bekommt die schon vergebenen Ueberschriften
 * mit (anthropic.ts, vergebeneAufhaenger), und hier wird das Ergebnis nachgeprueft. Faellt es
 * durch, greift dieselbe Ein-Neuversuch-Regel wie bei Sperrwoertern.
 */
const FUELLWOERTER = new Set(["dein", "deine", "deinen", "deinem", "deiner", "dich", "der", "die", "das", "den", "dem", "und", "oder", "mit", "ohne", "fuer", "für", "von", "aus", "ein", "eine", "einen", "ist", "sind", "wir", "uns", "unser", "unsere", "sie", "ihr", "ihre", "mehr", "jetzt", "hier", "auch", "bei", "zum", "zur"]);

function aufhaengerWorte(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-zäöüß]+/g) ?? []).filter((w) => w.length > 3 && !FUELLWOERTER.has(w)),
  );
}

function erstesWort(text: string): string {
  return (text.toLowerCase().match(/[a-zäöüß]+/) ?? [""])[0];
}

/** Aehnlichkeit zweier Ueberschriften ueber gemeinsame Inhaltswoerter (Jaccard). */
export function aufhaengerAehnlichkeit(a: string, b: string): number {
  const wa = aufhaengerWorte(a);
  const wb = aufhaengerWorte(b);
  if (!wa.size || !wb.size) return 0;
  let gemeinsam = 0;
  for (const w of wa) if (wb.has(w)) gemeinsam++;
  return gemeinsam / (wa.size + wb.size - gemeinsam);
}

/** Ab hier gelten zwei Ueberschriften als derselbe Aufhaenger. 0,3 statt eines strengeren
 *  Werts, weil "Dein Weg zu Beauty-Erfolg" und "Dein Weg zur Beauty Unternehmerin" bei 0,33
 *  liegen - genau die Art Wiederholung, um die es geht. */
const AEHNLICH_GRENZE = 0.3;
/** So oft darf dasselbe Anfangswort in einer Woche vorkommen. */
const ANFANGSWORT_MAX = 2;

/** Die ersten zwei Woerter, klein und ohne Satzzeichen. "Deine Haut verdient Analyse" und
 *  "Deine Haut verdient Perfektion" teilen sie - das ist derselbe Aufhaenger, egal wie das
 *  Wortmass ausfaellt. */
function anfangsPaar(text: string): string {
  return (text.toLowerCase().match(/[a-zäöüß]+/g) ?? []).slice(0, 2).join(" ");
}

export function aufhaengerKollision(headline: string, vergeben: string[]): string | null {
  const paar = anfangsPaar(headline);
  for (const alt of vergeben) {
    if (paar && paar.includes(" ") && anfangsPaar(alt) === paar) {
      return `Die Überschrift "${headline}" beginnt genauso wie die schon geplante "${alt}".`;
    }
  }
  for (const alt of vergeben) {
    const wert = aufhaengerAehnlichkeit(headline, alt);
    if (wert >= AEHNLICH_GRENZE) {
      return `Die Überschrift "${headline}" sagt dasselbe wie die schon geplante "${alt}" (${Math.round(wert * 100)} % gemeinsame Wörter).`;
    }
  }
  const anfang = erstesWort(headline);
  if (anfang && vergeben.filter((a) => erstesWort(a) === anfang).length >= ANFANGSWORT_MAX) {
    return `Schon ${ANFANGSWORT_MAX} Überschriften dieser Woche beginnen mit "${anfang}" - diese auch.`;
  }
  return null;
}

function assertSprache(headline: string, caption: string, sprache: string): void {
  const problem = sprachFehler(`${headline} ${caption}`, sprache);
  if (problem) {
    throw new ToolError(`${problem} Schreibe ausschliesslich auf ${sprache === "en" ? "Englisch" : "Deutsch"} und ausschliesslich in lateinischer Schrift.`);
  }
}

function assertHeadlineRenderable(row: CustomerRow, channel: PlannableChannel, headline: string): void {
  const font = getFontOption(row.font_choice ?? DEFAULT_FONT_ID);
  const layout = headlineLayoutForFormat(headline, CHANNEL_IMAGE_FORMAT[channel], font);
  if (layout.tooLong) {
    throw new ToolError(
      `Die Überschrift "${headline}" ist für das Bild zu lang (passt auch umbrochen nicht in ${HEADLINE_MAX_LINES_HINT} Zeilen). ` +
        "Schreibe eine deutlich kürzere Schlagzeile, höchstens 6 Wörter und höchstens 45 Zeichen.",
    );
  }
}

const HEADLINE_MAX_LINES_HINT = HEADLINE_MAX_LINES;

function checkTextsFor(channel: PlannableChannel, headline: string, caption: string): (string | undefined)[] {
  // Mirrors save_pending_approval's fix from the previous session: ig_story is only ever
  // checked/published by headline (Instagram Stories have no caption), everything else by
  // headline+caption combined - a mismatch here would let a planned story through that then
  // fails required-element checks forever once the routine actually tries to publish it.
  return channel === "ig_story" ? [headline] : [headline, caption];
}

interface PlanOneResult {
  planned: boolean;
  /** Die geschriebene Ueberschrift - die Wochenplanung sammelt sie, damit der naechste
   *  Beitrag einen anderen Aufhaenger bekommt (19.09.2026). */
  headline: string;
}

interface GeneratedPost {
  headline: string;
  caption: string;
  /** Leer, wenn der Aufrufer bewusst ohne Bild generiert hat (Easy Onboarding vor der Bestaetigung). */
  imageUrl: string;
  accentColorUsed?: string;
  /** Combined Anthropic (text, incl. a possible retry) + fal.ai (image) cost for this one post. */
  costUsd: number | null;
}

/**
 * The actual "write + illustrate one post" work, shared by planOnePost (nightly pre-planning,
 * creates a new planned_posts row) and regeneratePlannedPostsForBranding (rewrites an existing
 * row after the customer changed company/industry/about/tone) - everything from here down is
 * identical for both callers, only what happens to the result (INSERT vs UPDATE) differs.
 */
/**
 * `feature` landet in usage_costs. Wichtig: die Kosten werden SOFORT gebucht, sobald der jeweilige
 * Schritt bezahlt ist - nicht erst am Ende. Vorher wurden sie in einer lokalen Summe gesammelt und
 * nur im Erfolgsfall zurueckgegeben: scheiterte die Bildgenerierung nach dem (bezahlten) Text, war
 * der Text bezahlt, aber nirgends erfasst. Und der normale Tagesplan hat ueberhaupt nie gebucht,
 * dadurch fehlte in der Kostenuebersicht ausgerechnet der groesste Posten.
 */
export async function generatePost(
  row: CustomerRow,
  channel: PlannableChannel,
  pillar: ContentPillar | null,
  feature = "planned-post",
  opts: {
    withImage?: boolean;
    farbSchluessel?: string;
    /** Liefert die AKTUELL vergebenen Aufhaenger - als Funktion, nicht als Kopie: bei
     *  paralleler Planung aendert sich die Liste waehrend der Generierung. */
    vergebenJetzt?: () => string[];
    /** Prueft UND belegt in einem Schritt. Gibt eine Begruendung zurueck, wenn die Ueberschrift
     *  einen schon vergebenen Aufhaenger wiederholt, sonst null. Der Aufruf ist synchron und
     *  damit unteilbar - genau das schliesst das Rennen zwischen gleichzeitigen Beitraegen. */
    reservieren?: (headline: string) => string | null;
  } = {},
): Promise<GeneratedPost> {
  const styleSamples = await getStyleSamples(row.id);
  const bannedWords = splitCommaList(row.banned_words);
  const requiredElements = splitCommaList(row.required_elements);
  const customHashtags = splitHashtagList(row.custom_hashtags);

  const baseInput = {
    channel,
    company: row.company,
    industry: row.industry ?? "",
    about: row.about ?? "",
    tone: row.tone ?? "sachlich",
    language: row.language ?? "de",
    hashtagPreference: row.hashtag_pref ?? "wenige",
    emojisEnabled: Boolean(row.emojis_enabled),
    pillarTitle: pillar?.title ?? null,
    pillarDescription: pillar?.description ?? null,
    bannedWords,
    requiredElements,
    customHashtags,
    styleSamples: styleSamples.samples.map((s) => s.caption).filter((c): c is string => Boolean(c)).slice(0, 5),
    vergebeneAufhaenger: opts.vergebenJetzt?.().slice(-12),
  };

  const sprache = row.language ?? "de";
  let content = await generatePlannedPostContent(baseInput);
  let costUsd = content.costUsd;
  let belegt = false;
  logUsageCost(row.id, feature, content.costUsd);

  /**
   * Sprachwache (19.09.2026). Anders als die uebrigen Pruefungen wird diese NIE durchgewinkt:
   * ein russischer Beitrag geht im Namen des Kunden raus, ein fehlender Tag nicht. Deshalb bis
   * zu zwei zusaetzliche Versuche - Text kostet 0,0017 USD, das ist die Sache wert - und
   * danach lieber ein Fehler als ein Beitrag in fremder Schrift.
   */
  for (let versuch = 0; versuch < 2; versuch++) {
    const problem = sprachFehler(`${content.headline} ${content.caption}`, sprache);
    if (!problem) break;
    console.warn(`[planning] ${row.id}: Sprachwache hat angeschlagen (${problem}) - Versuch ${versuch + 2}.`);
    content = await generatePlannedPostContent({
      ...baseInput,
      avoidNote: `${problem} Schreibe ausschliesslich auf ${sprache === "en" ? "Englisch" : "Deutsch"} und ausschliesslich in lateinischer Schrift.`,
    });
    costUsd = costUsd != null && content.costUsd != null ? costUsd + content.costUsd : content.costUsd ?? costUsd;
    logUsageCost(row.id, feature, content.costUsd);
  }
  const bleibt = sprachFehler(`${content.headline} ${content.caption}`, sprache);
  if (bleibt) {
    throw new ToolError(`Beitrag verworfen: ${bleibt} Auch nach drei Versuchen kam kein Text in der richtigen Sprache zurück.`);
  }
  try {
    assertNoBannedWords(row.id, ...checkTextsFor(channel, content.headline, content.caption));
    assertRequiredElements(row.id, ...checkTextsFor(channel, content.headline, content.caption));
    assertHeadlineRenderable(row, channel, content.headline);
    assertSprache(content.headline, content.caption, sprache);
    if (opts.reservieren) {
      const problem = opts.reservieren(content.headline);
      if (problem) throw new ToolError(`${problem} Nimm einen anderen Aufhänger - ein anderes Angebot, einen anderen Anlass, eine andere Zielgruppe -, nicht dieselbe Aussage in neuen Worten.`);
      belegt = true;
    }
  } catch (err) {
    // One retry, feeding back exactly what was wrong - same "retry ONCE, don't retry forever
    // and don't give up after one attempt either" policy as K7 in the routine.
    const avoidNote = err instanceof Error ? err.message : String(err);
    content = await generatePlannedPostContent({ ...baseInput, avoidNote, vergebeneAufhaenger: opts.vergebenJetzt?.().slice(-12) });
    costUsd = costUsd != null && content.costUsd != null ? costUsd + content.costUsd : content.costUsd ?? costUsd;
    logUsageCost(row.id, feature, content.costUsd);
    assertNoBannedWords(row.id, ...checkTextsFor(channel, content.headline, content.caption));
    assertRequiredElements(row.id, ...checkTextsFor(channel, content.headline, content.caption));
    assertHeadlineRenderable(row, channel, content.headline);
    // Die Sprache dagegen SCHON: hier wird geworfen, der Beitrag entsteht nicht. Ein Tag ohne
    // Beitrag ist reparierbar, ein russischer Beitrag im Namen des Kunden nicht.
    assertSprache(content.headline, content.caption, sprache);
    // Nach dem zweiten Versuch wird die Aehnlichkeit NICHT mehr erzwungen: lieber ein etwas
    // aehnlicher Beitrag als ein fehlender Tag in der Woche (Auftrag: keine leeren Tage).
    if (opts.reservieren && !belegt) {
      const problem = opts.reservieren(content.headline);
      if (problem) console.warn(`[planning] ${row.id}: "${content.headline}" bleibt trotz Neuversuch nah an einem anderen Beitrag - ${problem}`);
      belegt = true;
    }
  }

  const roh = resolveImageBranding(row.id);
  // Abwechslung innerhalb der Markenfarbe (19.09.2026): jeder Beitrag der Woche bekommt eine
  // eigene Stufe derselben Farbe. Ohne Farbverlauf (also ohne erkannte Markenfarben) bleibt
  // alles wie bisher - dort erzeugt fal.ai das Bild und es gibt nichts zu variieren.
  const branding = roh.gradient && roh.accentColor && opts.farbSchluessel
    ? (() => {
        const v = wochenfarbe(roh.accentColor, roh.gradient.color2, opts.farbSchluessel);
        return { ...roh, accentColor: v.accentColor, gradient: { color2: v.color2, direction: v.direction } };
      })()
    : roh;
  // Easy Onboarding (Kostenschutz): vor der E-Mail-Bestaetigung nur fuer die ersten Slots ein
  // echtes Bild - der Text ist billig, das Bild nicht. Zeilen ohne Bild bekommen es spaeter ueber
  // backfillMissingImages (nach der Bestaetigung) nachgetragen.
  if (opts.withImage === false) {
    return { headline: content.headline, caption: content.caption, imageUrl: "", accentColorUsed: branding.accentColor, costUsd };
  }
  const generated = await generateImageUrl(content.headline, CHANNEL_IMAGE_FORMAT[channel], branding);
  // generated.costUsd ist 0, wenn der Hintergrund ein lokal gerenderter Farbverlauf war.
  costUsd = costUsd != null ? costUsd + generated.costUsd : generated.costUsd;
  logUsageCost(row.id, feature, generated.costUsd);

  return { headline: content.headline, caption: content.caption, imageUrl: generated.imageUrl, accentColorUsed: branding.accentColor, costUsd };
}

async function planOnePost(
  row: CustomerRow,
  channel: PlannableChannel,
  scheduledFor: string,
  pillar: ContentPillar | null,
  withImage = true,
  feature = "planned-post",
  aufhaenger?: { jetzt: () => string[]; reservieren: (h: string) => string | null },
): Promise<PlanOneResult> {
  const generated = await generatePost(row, channel, pillar, feature, {
    withImage,
    farbSchluessel: `${scheduledFor}|${channel}`,
    vergebenJetzt: aufhaenger?.jetzt,
    reservieren: aufhaenger?.reservieren,
  });
  createPlannedPost({
    customerId: row.id,
    channel,
    scheduledFor,
    headline: generated.headline,
    caption: generated.caption,
    imageUrl: generated.imageUrl || undefined,
    pillarTitle: pillar?.title,
    accentColorUsed: generated.accentColorUsed,
  });
  return { planned: true, headline: generated.headline };
}

export interface BrandingRegenResult {
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Re-generates content for a customer's still-open (today..+6 days) planned posts after they
 * changed a content-relevant branding field (company/industry/about/tone) in settings - see
 * router.ts's POST /api/planned-posts/regenerate-for-branding, which decides `includeEdited`
 * based on the customer's explicit confirmation. Only ever UPDATES existing planned_posts rows
 * (never creates/removes any) and only ones with status 'planned' (always) or 'edited' (only
 * when includeEdited) - an already published/rejected/approved/submitted row is left alone no
 * matter what, since overwriting any of those would be a correctness bug, not a convenience.
 * Keeps each row's already-assigned content pillar and schedule slot, so this only refreshes the
 * wording/image to match the new branding instead of reshuffling the week.
 */
export interface BrandingRegenOptions {
  /** Easy Onboarding vor der Bestaetigung: Zeilen ohne Bild bleiben ohne Bild (nur Text neu). */
  keepImageless?: boolean;
  concurrency?: number;
  onProgress?: (done: number, total: number, errors: number) => void;
}

export async function regeneratePlannedPostsForBranding(row: CustomerRow, includeEdited: boolean, opts: BrandingRegenOptions = {}): Promise<BrandingRegenResult> {
  if (!anthropicAvailable()) {
    throw new ToolError("KI-Vorschläge sind gerade nicht verfügbar.");
  }
  const today = viennaDateStr();
  const to = viennaDateStr(new Date(Date.now() + 6 * 86_400_000));
  const targetStatuses = includeEdited ? ["planned", "edited"] : ["planned"];
  // Ueberschreibschutz: Kundenarbeit ist auch mit includeEdited unantastbar - 'edited' ist seit
  // 19.09.2026 immer Kundenarbeit (origin = 'kunde'), also faellt includeEdited faktisch weg.
  const candidates = listPlannedPosts(row.id, today, to).filter((p) => targetStatuses.includes(p.status) && darfNeuGeschriebenWerden(p));
  const pillars = listContentPillars(row.id);

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const work = candidates.filter((plan) => {
    if (plan.channel in CHANNEL_SCHEDULE) return true;
    skipped++;
    return false;
  });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < work.length) {
      const plan = work[next++];
      const channel = plan.channel as PlannableChannel;
      const pillar = plan.pillarTitle ? pillars.find((p) => p.title === plan.pillarTitle) ?? { id: "", title: plan.pillarTitle, description: null, weight: 1 } : null;
      try {
        const withImage = opts.keepImageless ? Boolean(plan.imageUrl) : true;
        const generated = await generatePost(row, channel, pillar, "planned-post-branding-regen", { withImage, farbSchluessel: `${plan.scheduledFor}|${channel}` });
        overwritePlannedPostContent(plan.id, {
          headline: generated.headline,
          caption: generated.caption,
          imageUrl: generated.imageUrl,
          accentColorUsed: generated.accentColorUsed,
        });
        updated++;
      } catch (err) {
        errors++;
        const message = err instanceof Error ? err.message : String(err);
        logPlanningError(row.id, channel, plan.scheduledFor, `Branding-Neugenerierung fehlgeschlagen: ${message}`);
        console.error(`[panel] Branding-Neugenerierung fehlgeschlagen für ${row.id}/${channel}/${plan.scheduledFor}:`, message);
      }
      opts.onProgress?.(updated + errors, work.length, errors);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, opts.concurrency ?? 1), Math.max(1, work.length)) }, worker));
  return { updated, skipped, errors };
}

export interface PlanningRunSummary {
  startedAt: string;
  finishedAt: string;
  customersChecked: number;
  planned: number;
  skippedExisting: number;
  /** Bestehende 'planned'-Zeilen, die dieser Lauf neu geschrieben hat (veraltetes Profil oder Alter). */
  refreshed: number;
  /** Auffrischungen, die fehlgeschlagen sind - alter Stand blieb stehen, siehe planning_errors. */
  refreshFailed: number;
  errors: number;
}

/**
 * Runs one full planning pass: every active, non-trial-expired, non-paused customer x every
 * enabled channel x the next 7 days. Idempotent (checks getPlannedPostByChannelDate first), so
 * running it more than once a day, or re-running after a partial failure, never creates
 * duplicates. A failure for one customer/day/channel is logged (logPlanningError) and skipped -
 * it NEVER aborts the rest of the run (task 8's safety net).
 */
export async function planUpcomingPosts(): Promise<PlanningRunSummary> {
  const startedAt = nowIso();
  let customersChecked = 0;
  let planned = 0;
  let skippedExisting = 0;
  let refreshed = 0;
  let refreshFailed = 0;
  let errors = 0;

  if (!anthropicAvailable()) {
    logPlanningError(null, null, null, "ANTHROPIC_API_KEY fehlt - Vorausplanung komplett übersprungen.");
    return { startedAt, finishedAt: nowIso(), customersChecked: 0, planned: 0, skippedExisting: 0, refreshed: 0, refreshFailed: 0, errors: 1 };
  }

  const rows = db.prepare("SELECT * FROM customers WHERE status = 'active'").all() as CustomerRow[];
  for (const row of rows) {
    customersChecked++;
    if (row.customer_paused) continue;
    if (row.trial_ends_at && new Date(row.trial_ends_at).getTime() < Date.now()) continue;
    // Panel v6 Aufgabe 2b: kein einziger Anthropic-/fal.ai-Aufruf fuer einen Kunden, der seine
    // E-Mail-Adresse noch nicht bestaetigt hat - schliesst genau die Luecke, die diese Aufgabe
    // beheben sollte (Signup mit Wegwerf-Adresse, nie wiedergekommen, kostet trotzdem jede Nacht).
    if (!row.email_verified) continue;

    const pillars = listContentPillars(row.id);

    // Erst aufraeumen, dann planen: die Schleife darunter ueberspringt jeden Tag, fuer den schon
    // eine Zeile existiert - eine veraltete Zeile wuerde dort also fuer immer liegen bleiben.
    const aufgefrischt = await refreshStalePlannedPosts(row, pillars);
    refreshed += aufgefrischt.refreshed;
    refreshFailed += aufgefrischt.failed;

    // Easy Onboarding: Zeilen, die vor der Bestaetigung ohne Bild angelegt wurden und deren
    // Nachtrag nach der Bestaetigung nicht durchkam (Prozess-Neustart, fal.ai-Ausfall), bekommen
    // hier ihr Bild - bevor die Woche darunter aufgefuellt wird. Fuer Kunden ohne solche Zeilen
    // ist das ein Lesezugriff und sonst nichts.
    const nachgetragen = await backfillMissingImages(row);
    errors += nachgetragen.failed;

    const week = await planCustomerWeek(row, { pillars });
    planned += week.planned;
    skippedExisting += week.skippedExisting;
    errors += week.errors;
  }

  return { startedAt, finishedAt: nowIso(), customersChecked, planned, skippedExisting, refreshed, refreshFailed, errors };
}

export const PLANNING_LOOKAHEAD_DAYS = LOOKAHEAD_DAYS;

export interface PlanWeekProgress {
  /** Slots, die dieser Lauf zu erzeugen hatte (ohne schon vorhandene). */
  total: number;
  done: number;
  errors: number;
}

export interface PlanWeekOptions {
  pillars?: ContentPillar[];
  /** Hoechstens so viele NEUE Zeilen mit echtem Bild; alle weiteren nur mit Text (Easy Onboarding
   *  vor der Bestaetigung). Undefined = alle mit Bild (bisheriges Nachtlauf-Verhalten). */
  imageBudget?: number;
  /** Hoechstens so viele NEUE Zeilen ueberhaupt (Kostendeckel pro unbestaetigtem Konto). */
  postBudget?: number;
  /** Parallel laufende Generierungen. Nachtlauf: 1 (unveraendert), Onboarding: 3. */
  concurrency?: number;
  feature?: string;
  onProgress?: (p: PlanWeekProgress) => void;
}

export interface PlanWeekResult {
  /** Wie viele Slots dieser Lauf ueberhaupt zu fuellen hatte (0 = kein Posting-Tag in der Woche). */
  slots: number;
  planned: number;
  skippedExisting: number;
  errors: number;
  /** Slots, die wegen postBudget NICHT angelegt wurden (der Plan bleibt dort leer, bis nachgeplant wird). */
  overBudget: number;
}

/**
 * Plant die naechsten LOOKAHEAD_DAYS Tage fuer EINEN Kunden - die Schleife, die vorher direkt in
 * planUpcomingPosts stand, unveraendert im Verhalten (gleiche Slot-Auswahl, gleiche Idempotenz
 * ueber getPlannedPostByChannelDate, gleiche Saeulen-Rotation), nur herausgeloest, damit das
 * Easy Onboarding sie SOFORT fuer den gerade angelegten Kunden aufrufen kann, statt bis 03:00
 * Uhr zu warten. Die Routine bei claude.ai merkt davon nichts: sie liest wie bisher nur ueber
 * get_planned_post, ob fuer heute eine Zeile existiert.
 */
export async function planCustomerWeek(row: CustomerRow, opts: PlanWeekOptions = {}): Promise<PlanWeekResult> {
  const pillars = opts.pillars ?? listContentPillars(row.id);
  const scheduleInput = scheduleInputFor(row);
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const feature = opts.feature ?? "planned-post";

  const channelDefs: { channel: PlannableChannel; enabled: boolean }[] = [
    { channel: "ig_feed", enabled: Boolean(row.ig_feed_enabled) },
    { channel: "ig_story", enabled: Boolean(row.ig_story_enabled) },
    { channel: "linkedin", enabled: Boolean(row.linkedin_enabled) },
  ];

  // Erst alle offenen Slots einsammeln (inkl. Saeulen-Zuweisung in Planreihenfolge - dieselbe
  // Rotation wie bisher, nur vorab statt unmittelbar vor jeder Generierung), dann abarbeiten.
  let skippedExisting = 0;
  let overBudget = 0;
  let lastPillarTitle: string | null = null;
  const slots: { channel: PlannableChannel; dateStr: string; pillar: ContentPillar | null; withImage: boolean }[] = [];
  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    const date = new Date(Date.now() + offset * 86_400_000);
    for (const { channel, enabled } of channelDefs) {
      if (!enabled) continue;
      const { dateStr, due } = isPostingDayForChannel(scheduleInput, CHANNEL_SCHEDULE[channel], date);
      if (!due) continue;
      if (getPlannedPostByChannelDate(row.id, channel, dateStr)) {
        skippedExisting++;
        continue;
      }
      if (opts.postBudget != null && slots.length >= opts.postBudget) {
        overBudget++;
        continue;
      }
      const pillar = pickWeightedPillar(pillars, lastPillarTitle);
      if (pillar) lastPillarTitle = pillar.title;
      const withImage = opts.imageBudget == null || slots.filter((s) => s.withImage).length < opts.imageBudget;
      slots.push({ channel, dateStr, pillar, withImage });
    }
  }

  const progress: PlanWeekProgress = { total: slots.length, done: 0, errors: 0 };
  // Gesamtzahl sofort melden, damit "Beiträge entworfen 0 von 10" schon steht, bevor der erste
  // fertig ist - sonst zeigt der Bildschirm 15 Sekunden lang keine Zahl.
  opts.onProgress?.({ ...progress });
  let planned = 0;
  let errors = 0;
  let next = 0;
  // Gemeinsame Liste aller Ueberschriften dieser Woche. Jeder Slot liest sie beim Start und
  // traegt sein Ergebnis ein. Bei mehreren Arbeitern sieht ein spaeter Slot nicht zwingend
  // ALLE frueheren - aber die grosse Mehrheit, und das genuegt: die Wiederholung entstand
  // dadurch, dass gar nichts bekannt war, nicht dadurch, dass zwei gleichzeitig liefen.
  const vergeben: string[] = listPlannedPosts(row.id, viennaDateStr(), viennaDateStr(new Date(Date.now() + (LOOKAHEAD_DAYS - 1) * 86_400_000)))
    .map((p) => p.headline)
    .filter((h): h is string => Boolean(h));
  // Pruefen und Belegen in EINEM synchronen Schritt. JavaScript unterbricht eine Funktion nicht
  // mittendrin, also kann zwischen Pruefung und Eintrag kein zweiter Beitrag dazwischenfunken.
  // Genau das ist vorher passiert: bei drei gleichzeitigen Laeufen sahen zwei dieselbe alte
  // Liste und schrieben beide "Energie statt Erschoepfung".
  const aufhaenger = {
    jetzt: () => vergeben,
    reservieren: (headline: string): string | null => {
      const problem = aufhaengerKollision(headline, vergeben);
      if (problem) return problem;
      vergeben.push(headline);
      return null;
    },
  };
  const worker = async (): Promise<void> => {
    while (next < slots.length) {
      const slot = slots[next++];
      try {
        await planOnePost(row, slot.channel, slot.dateStr, slot.pillar, slot.withImage, feature, aufhaenger);
        planned++;
      } catch (err) {
        errors++;
        progress.errors++;
        const message = err instanceof Error ? err.message : String(err);
        logPlanningError(row.id, slot.channel, slot.dateStr, message);
        console.error(`[panel] Vorausplanung fehlgeschlagen für ${row.id}/${slot.channel}/${slot.dateStr}:`, message);
      }
      progress.done++;
      opts.onProgress?.({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, slots.length) }, worker));
  return { slots: slots.length, planned, skippedExisting, errors, overBudget };
}

/**
 * Rendert die Bilder der offenen Woche mit dem AKTUELLEN Branding neu - fuer den Moment, in dem
 * der Kunde im Plan-Bildschirm die Farbe aendert. Text und Termin bleiben unberuehrt, nur das
 * Bild wird ersetzt; `regenerate_count` bleibt unveraendert, weil das keine Neu-Erstellung auf
 * Kundenwunsch ist, sondern dieselbe Schlagzeile in neuer Farbe.
 */
export async function recolorPlannedPosts(row: CustomerRow, opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<BackfillResult> {
  const today = viennaDateStr();
  const to = viennaDateStr(new Date(Date.now() + (LOOKAHEAD_DAYS - 1) * 86_400_000));
  const rows = listPlannedPosts(row.id, today, to).filter((p) => p.headline && p.imageUrl && ["planned", "edited", "approved"].includes(p.status) && p.imageSource !== "kunde");
  if (!rows.length) return { filled: 0, failed: 0 };
  const branding = resolveImageBranding(row.id);
  let filled = 0;
  let failed = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < rows.length) {
      const plan = rows[next++];
      try {
        const generated = await generateImageUrl(plan.headline as string, CHANNEL_IMAGE_FORMAT[plan.channel as PlannableChannel], branding);
        logUsageCost(row.id, "easy-onboarding-farbwechsel", generated.costUsd);
        setPlannedPostImage(plan.id, generated.imageUrl, branding.accentColor);
        filled++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        logPlanningError(row.id, plan.channel, plan.scheduledFor, `Farbwechsel fehlgeschlagen: ${message}`);
      }
      opts.onProgress?.(filled + failed, rows.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, opts.concurrency ?? 1), rows.length) }, worker));
  return { filled, failed };
}

export interface BackfillResult {
  filled: number;
  failed: number;
}

/**
 * Traegt bei allen Zeilen im Vorschaufenster, die noch kein Bild haben, das Bild nach - mit dem
 * AKTUELLEN Branding des Kunden. Aufrufer: /verify-email (sofort nach der Bestaetigung, im
 * Hintergrund), der Nachtlauf (Sicherheitsnetz) und das Easy-Onboarding-Dashboard. Fuer
 * Zeilen, die ein Bild haben, passiert nichts.
 */
export async function backfillMissingImages(row: CustomerRow, opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<BackfillResult> {
  const today = viennaDateStr();
  const to = viennaDateStr(new Date(Date.now() + (LOOKAHEAD_DAYS - 1) * 86_400_000));
  const rows = listPlannedPostsWithoutImage(row.id, today, to).filter((p) => p.headline);
  if (!rows.length) return { filled: 0, failed: 0 };
  const branding = resolveImageBranding(row.id);
  let filled = 0;
  let failed = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < rows.length) {
      const plan = rows[next++];
      try {
        // Dieselbe Farbstufe wie beim ersten Rendern - der Schluessel ist Datum und Kanal,
        // also bekommt ein nachgetragenes Bild genau die Farbe, die es haette haben sollen.
        const b = branding.gradient && branding.accentColor
          ? (() => {
              const v = wochenfarbe(branding.accentColor as string, branding.gradient!.color2, `${plan.scheduledFor}|${plan.channel}`);
              return { ...branding, accentColor: v.accentColor, gradient: { color2: v.color2, direction: v.direction } };
            })()
          : branding;
        const generated = await generateImageUrl(plan.headline as string, CHANNEL_IMAGE_FORMAT[plan.channel as PlannableChannel], b);
        logUsageCost(row.id, "planned-post-bild-nachtrag", generated.costUsd);
        setPlannedPostImage(plan.id, generated.imageUrl, b.accentColor);
        filled++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        logPlanningError(row.id, plan.channel, plan.scheduledFor, `Bild-Nachtrag fehlgeschlagen: ${message}`);
        console.error(`[panel] Bild-Nachtrag fehlgeschlagen für ${row.id}/${plan.channel}/${plan.scheduledFor}:`, message);
      }
      opts.onProgress?.(filled + failed, rows.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, opts.concurrency ?? 1), rows.length) }, worker));
  return { filled, failed };
}

function msUntilNextUtcHour(hourUtc: number): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Starts the once-daily planning run at a fixed UTC wall-clock hour (default 03:00 - clear of
 * both the 14:30-15:45 UTC own-account blackout and every hourly Kunden-Loop fire, which lands
 * on the hour). Unlike startTokenRefreshSchedule's simple setInterval (fine for "roughly every N
 * hours"), this deliberately anchors to a specific UTC hour so a server restart at some random
 * time of day doesn't permanently shift when planning runs.
 */
export function startDailyPlanningSchedule(hourUtc = 3): NodeJS.Timeout {
  const run = () =>
    planUpcomingPosts()
      .then((summary) => console.log("[panel] Tägliche Vorausplanung:", summary))
      .catch((err) => console.error("[panel] Tägliche Vorausplanung unerwartet fehlgeschlagen:", err));
  return setTimeout(() => {
    run();
    setInterval(run, 24 * 3_600_000);
  }, msUntilNextUtcHour(hourUtc));
}

/* ================= Stale-Content-Sicherheitsnetz (Panel v19) =================
 *
 * See Session-Bericht: a planned_post generated on 2026-09-12 (physiotherapy/"Andrea" branding)
 * sat untouched and was auto-published on 2026-09-15, three days after the customer had renamed
 * their business to "Pipeflow" in settings - the opt-in "regenerate after a branding change"
 * banner (router.ts's brandingRegenOffer) only helps a customer who notices and acts on it; this
 * is the hard backstop for everyone else, enforced here in code rather than left to the routine's
 * own judgement.
 *
 * Both entry points below are the SAME two places that already hand pre-generated content to the
 * routine (get_planned_post and list_approved_pending_posts in index.ts) - nothing publishes
 * without going through one of them first (ad-hoc "Jetzt posten"/spontaneous generation is always
 * fresh by construction and never touches planned_posts/pending_approvals, so it needs no guard).
 */

/** Cheap, single timestamp comparison - no DB/network access, safe to call on every post on every
 *  routine tick without slowing anything down. NULL branding_last_changed_at (no recorded change
 *  for this customer, ever) means never stale, so a customer who's never touched their branding
 *  isn't affected by this feature at all. A NULL version_at_generation on an otherwise-tracked
 *  customer means "written before this column existed" - treated as stale (unknown age, and a
 *  change IS on record), which is exactly what lets the 6 already-stale planned_posts from the
 *  incident fall under this check automatically once branding_last_changed_at is backfilled for
 *  that one customer (see admin note in the session report) - no separate manual cleanup needed. */
export function isBrandingStale(versionAtGeneration: string | null, brandingLastChangedAt: string | null): boolean {
  if (!brandingLastChangedAt) return false;
  if (!versionAtGeneration) return true;
  return versionAtGeneration < brandingLastChangedAt;
}

/* ========== Auffrischung liegengebliebener Tagesplaene (15.09.2026) ==========
 *
 * Das Sicherheitsnetz darunter greift erst in dem Moment, in dem die Routine einen Beitrag
 * abholt. Was der Kunde die Tage davor im Kalender SIEHT, war damit weiterhin der alte Stand -
 * genau die Beschwerde, die diese Aenderung ausgeloest hat: ein am 12.09. unter dem alten
 * Firmenprofil geschriebener Beitrag stand am 15.09. immer noch fuer den 18.09. in der Vorschau.
 * planUpcomingPosts() ueberspringt jeden Tag, fuer den schon eine Zeile existiert (Absicht: der
 * Kunde soll nicht jeden Morgen anderen Text vorfinden), und niemand hat die alte Zeile je
 * angefasst. Deshalb frischt der naechtliche Lauf jetzt zuerst auf, bevor er neue Tage plant.
 *
 * Aufgefrischt wird ausschliesslich Status 'planned': ein 'edited' ist die Handarbeit des Kunden,
 * 'approved'/'submitted' hat er freigegeben, 'published' ist raus, 'rejected' hat er abgelehnt -
 * alles davon zu ueberschreiben waere ein Fehler, keine Verbesserung.
 */

/**
 * Ab welchem Alter ein unangetasteter Tagesplan allein wegen der Zeit neu geschrieben wird.
 *
 * Warum 14 und nicht weniger: vorausgeplant wird LOOKAHEAD_DAYS = 7 Tage. Im Normalbetrieb ist
 * ein Beitrag am Tag seiner Veroeffentlichung also hoechstens 7 Tage alt. Ein Schwellwert
 * darunter wuerde Nacht fuer Nacht Beitraege neu schreiben, die der planende Lauf selbst gerade
 * erst erzeugt hat - Kosten fuer jeden Kunden jede Nacht, und der Kunde saehe genau das staendig
 * wechselnde Programm, das die Ueberspring-Regel verhindern soll. 14 Tage = doppelte Planweite
 * und feuert deshalb im geregelten Betrieb nie; es faengt die Faelle ab, in denen eine Zeile
 * wirklich liegen bleibt: pausierter Kunde, der wieder aktiv wird, ein Kanal, der erst spaeter
 * wieder eingeschaltet wird, ein gescheiterter Versand, oder eine spaeter groessere Planweite.
 *
 * Der eigentliche Auslöser fuer "veraltet" ist nicht das Alter, sondern das geaenderte
 * Kundenprofil - das deckt die Branding-Regel unten praezise ab, und zwar sofort statt nach
 * Tagen. Das Alter ist nur die grobe Rueckfallebene fuer alles, was sonst durchrutscht.
 * Ueber PLANNED_POST_MAX_AGE_DAYS anpassbar, ohne neuen Build.
 */
export const PLANNED_POST_MAX_AGE_DAYS = (() => {
  const raw = Number(process.env.PLANNED_POST_MAX_AGE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 14;
})();

export type StaleReason = "branding" | "alter";

/**
 * Entscheidet fuer genau eine Zeile, ob und warum sie neu geschrieben gehoert - reine
 * Zeitstempel-Arithmetik, keine DB, kein Netz, damit der naechtliche Lauf das ueber alle Kunden
 * durchziehen kann, ohne teuer zu werden.
 *
 * Als Schreibzeitpunkt zaehlt branding_version_at_generation und ersatzweise created_at, bewusst
 * NICHT updated_at: updated_at wandert auch bei reinen Statuswechseln mit und wuerde eine alte
 * Zeile faelschlich frisch aussehen lassen.
 */
export function plannedPostStaleReason(
  plan: Pick<PlannedPost, "status" | "brandingVersionAtGeneration" | "createdAt">,
  brandingLastChangedAt: string | null,
  now: number = Date.now(),
): StaleReason | null {
  if (plan.status !== "planned") return null;
  if (isBrandingStale(plan.brandingVersionAtGeneration, brandingLastChangedAt)) return "branding";
  const geschriebenAm = Date.parse(plan.brandingVersionAtGeneration ?? plan.createdAt);
  if (!Number.isFinite(geschriebenAm)) return null;
  return now - geschriebenAm >= PLANNED_POST_MAX_AGE_DAYS * 86_400_000 ? "alter" : null;
}

export interface RefreshResult {
  refreshed: number;
  failed: number;
}

/**
 * Schreibt die veralteten 'planned'-Zeilen eines Kunden im Vorschaufenster neu - gleicher Tag,
 * gleicher Kanal, gleiche Content-Saeule, nur frischer Text und frisches Bild aus dem AKTUELLEN
 * Profil. Laeuft fuer jeden Kunden automatisch, niemand muss einen Einzelfall erkennen.
 *
 * Ein Fehlschlag bleibt folgenlos: die alte Zeile bleibt stehen, wird protokolliert und beim
 * naechsten Lauf erneut versucht - und falls sie bis zu ihrem Tag ueberlebt, faengt sie das
 * Sicherheitsnetz in ensureFreshPlannedPost ab, bevor irgendetwas Veraltetes veroeffentlicht wird.
 */
export async function refreshStalePlannedPosts(row: CustomerRow, pillars: ContentPillar[]): Promise<RefreshResult> {
  const von = viennaDateStr();
  const bis = viennaDateStr(new Date(Date.now() + (LOOKAHEAD_DAYS - 1) * 86_400_000));
  const jetzt = Date.now();
  let refreshed = 0;
  let failed = 0;

  for (const plan of listPlannedPosts(row.id, von, bis)) {
    const grund = plannedPostStaleReason(plan, row.branding_last_changed_at, jetzt);
    if (!grund || !darfNeuGeschriebenWerden(plan)) continue;
    const channel = plan.channel as PlannableChannel;
    if (!(channel in CHANNEL_SCHEDULE)) continue;
    try {
      const generated = await generatePost(row, channel, findPillar(pillars, plan.pillarTitle), `planned-post-stale-refresh-${grund}`);
      overwritePlannedPostContent(plan.id, {
        headline: generated.headline,
        caption: generated.caption,
        imageUrl: generated.imageUrl,
        accentColorUsed: generated.accentColorUsed,
      });
      refreshed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      logPlanningError(row.id, channel, plan.scheduledFor, `Auffrischung (${grund}) fehlgeschlagen, alter Stand bleibt vorerst stehen: ${message}`);
      console.error(`[panel] Auffrischung fehlgeschlagen für ${row.id}/${channel}/${plan.scheduledFor}:`, message);
    }
  }
  return { refreshed, failed };
}

function getCustomerRowById(customerId: string): CustomerRow | undefined {
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as CustomerRow | undefined;
}

function findPillar(pillars: ContentPillar[], title: string | null): ContentPillar | null {
  if (!title) return null;
  return pillars.find((p) => p.title === title) ?? { id: "", title, description: null, weight: 1 };
}

function sendStalePostSkippedEmailBestEffort(row: CustomerRow, channel: string): void {
  sendMailBestEffort(stalePostSkippedEmail({ to: row.email, company: row.company, channelLabel: EMAIL_CHANNEL_LABEL[channel] ?? "neuer" }));
}

/**
 * Called from the `get_planned_post` MCP tool for every post about to be handed to the routine as
 * "ready to use as-is". Only the three "ready" statuses (see get_planned_post's own docs) are
 * checked - 'rejected'/'published'/'submitted' pass through untouched, nothing to decide there.
 * On staleness: regenerates the SAME row in place (same channel/day/pillar slot, fresh text+image
 * from the customer's CURRENT branding) and returns the refreshed post - the routine never sees
 * the stale version at all. If regeneration itself fails (Anthropic/fal.ai unavailable): marks the
 * row 'rejected' (never retried, never published stale) and best-effort emails the customer, then
 * returns null - get_planned_post's existing "nothing prepared" contract, so the routine's
 * documented fallback (generate on the spot, with current customer data, so never stale either)
 * takes over exactly as it already does for a day pre-planning simply hasn't reached yet.
 */
export async function ensureFreshPlannedPost(plan: PlannedPost): Promise<PlannedPost | null> {
  if (plan.status !== "planned" && plan.status !== "edited" && plan.status !== "approved") return plan;
  const row = getCustomerRowById(plan.customerId);
  if (!row) return plan;
  // Easy Onboarding: eine Zeile ohne Bild (vor der Bestaetigung angelegt, Nachtrag noch nicht
  // durch) darf die Routine nie als "Bild existiert schon" erreichen - hier wird es nachgeholt.
  if (!plan.imageUrl && plan.headline) {
    const result = await backfillMissingImages(row);
    const refreshed = result.filled ? getPlannedPostByChannelDate(plan.customerId, plan.channel, plan.scheduledFor) : null;
    if (!refreshed?.imageUrl) {
      // Kundenarbeit wird nicht still uebersprungen: sie geht so raus, wie sie ist; ein Kanal,
      // der ein Bild verlangt, meldet das laut, statt dass der Text verloren geht.
      if (plan.origin === "kunde") return plan;
      markPlannedPostStatus(plan.id, "rejected");
      logPlanningError(row.id, plan.channel, plan.scheduledFor, "Beitrag ohne Bild konnte nicht nachgezogen werden - übersprungen, Routine generiert selbst.");
      return null;
    }
    plan = refreshed;
  }
  // Die Luecke vom 19.09.2026: hier liefen bearbeitete und freigegebene Beitraege durch und
  // wurden bei geaenderter Farbe kurz vor dem Posten komplett neu geschrieben. Jetzt endet der
  // Weg fuer alles, was nicht unveraenderte Pipeflow-Arbeit ist.
  if (!darfNeuGeschriebenWerden(plan)) return plan;
  if (!isBrandingStale(plan.brandingVersionAtGeneration, row.branding_last_changed_at)) return plan;

  try {
    const pillars = listContentPillars(row.id);
    const pillar = findPillar(pillars, plan.pillarTitle);
    const generated = await generatePost(row, plan.channel as PlannableChannel, pillar, "stale-content-guard-regen");
    const updated = overwritePlannedPostContent(plan.id, {
      headline: generated.headline,
      caption: generated.caption,
      imageUrl: generated.imageUrl,
      accentColorUsed: generated.accentColorUsed,
    });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markPlannedPostStatus(plan.id, "rejected");
    logPlanningError(
      row.id,
      plan.channel,
      plan.scheduledFor,
      `Stale-Content-Sicherheitsnetz: Neu-Generierung fehlgeschlagen, Beitrag übersprungen statt veraltet zu veröffentlichen: ${message}`,
    );
    sendStalePostSkippedEmailBestEffort(row, plan.channel);
    return null;
  }
}

/**
 * Called from the `list_approved_pending_posts` MCP tool - the equivalent gateway for the
 * approval-mode flow. Checks every 'approved' row for staleness and, when stale, either
 * regenerates it in place (single-image formats, same mechanism as ensureFreshPlannedPost) or -
 * for a carousel/video-slideshow, which has no server-side text generator at all - force-rejects
 * it and emails the customer, since there is no safe way to auto-regenerate that here. Returns
 * only the rows actually safe to publish; a stale row that got skipped is simply absent from the
 * result, same effect as if it had never been approved.
 */
export async function getFreshApprovedPendingPosts(): Promise<PendingApproval[]> {
  const approvals = listApprovedPendingPosts();
  const customerCache = new Map<string, CustomerRow | undefined>();
  const fresh: PendingApproval[] = [];

  for (const approval of approvals) {
    if (!customerCache.has(approval.customerId)) {
      customerCache.set(approval.customerId, getCustomerRowById(approval.customerId));
    }
    const row = customerCache.get(approval.customerId);
    // Kundenarbeit (origin 'kunde') wird im Freigabe-Tor nie neu geschrieben - sie geht so raus.
    if (!row || approval.origin === "kunde" || !isBrandingStale(approval.brandingVersionAtGeneration, row.branding_last_changed_at)) {
      fresh.push(approval);
      continue;
    }

    if (approval.format !== "single") {
      forceRejectPendingApproval(approval.id);
      logPlanningError(row.id, approval.channel, null, "Stale-Content-Sicherheitsnetz: Karussell/Video-Diashow kann serverseitig nicht automatisch neu geschrieben werden - Beitrag übersprungen.");
      sendStalePostSkippedEmailBestEffort(row, approval.channel);
      continue;
    }

    try {
      const pillars = listContentPillars(row.id);
      const pillar = findPillar(pillars, approval.pillarTitle);
      const channel = (approval.channel as PlannableChannel) || (approval.provider === "linkedin" ? "linkedin" : "ig_feed");
      const generated = await generatePost(row, channel, pillar, "stale-content-guard-regen");
      const updated = overwritePendingApprovalContent(approval.id, { headline: generated.headline, caption: generated.caption, imageUrl: generated.imageUrl });
        if (updated) fresh.push(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      forceRejectPendingApproval(approval.id);
      logPlanningError(row.id, approval.channel, null, `Stale-Content-Sicherheitsnetz: Neu-Generierung fehlgeschlagen, Beitrag übersprungen statt veraltet zu veröffentlichen: ${message}`);
      sendStalePostSkippedEmailBestEffort(row, approval.channel);
    }
  }

  return fresh;
}
