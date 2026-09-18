/**
 * Video-Diashow: der Ablauf vom Drehbuch bis zum veröffentlichten Reel (Teil B des
 * Karussell-Auftrags). Das eigentliche Rendern steckt in video.ts, die Sprachausgabe in tts.ts -
 * hier wird beides mit Kundendaten, Kosten-Logging, Freigabe und Veröffentlichung verbunden.
 *
 * WARUM SERVERSEITIG UND NICHT ÜBER DIE STÜNDLICHE CLAUDE-ROUTINE: ein Video braucht ein
 * Drehbuch, eine Sprachausgabe, ein Rendering von einer halben Minute CPU-Zeit und einen
 * Upload - das ist eine Kette, die vollständig determiniert ist und nichts zu entscheiden hat.
 * Sie gehört deshalb in den Server (wie planning.ts und reviews.ts), nicht in einen
 * Routine-Prompt. Video-Anfragen aus "Jetzt posten" werden aus demselben Grund hier abgearbeitet
 * und aus `list_open_post_requests` herausgefiltert (siehe credentials.ts), damit die externe
 * Routine sie nicht ebenfalls anfasst und am Ende zwei Beiträge entstehen.
 *
 * EIGENER WOCHENPLAN: video_weekdays/video_post_time (siehe schedule.ts's isVideoDue) - ein Kunde
 * kann "nur montags ein Reel" einstellen, während Einzelbilder ihrem eigenen Zeitplan folgen.
 * Ohne gewählte Video-Tage entsteht nie automatisch ein Video.
 *
 * REIHENFOLGE IST ABSICHT (Kosten): erst das Drehbuch (billig), dann die Prüfung gegen die harten
 * Wort-Grenzen des Kunden, dann die Sprachausgabe, dann das Hintergrundbild (fal.ai, kostet), dann
 * das Rendering. Wer zuerst rendert und dann merkt, dass ein verbotenes Wort drinsteht, hat CPU
 * und Geld verbrannt.
 */
import { db, nowIso, type CustomerRow } from "./db.js";
import {
  assertNoBannedWords,
  assertRequiredElements,
  getStyleSamples,
  hasPendingOrApprovedToday,
  listApprovedVideoPosts,
  markPendingApprovalPublished,
  logPost,
  expireStalePostRequests,
  markPostRequestDone,
  markPostRequestSkipped,
  pickPillarForToday,
  resolveImageBranding,
  resolveInstagramCredentials,
  savePendingApproval,
  scheduleInputFor,
  splitCommaList,
  splitHashtagList,
} from "./credentials.js";
import { isVideoDue } from "./schedule.js";
import { logUsageCost } from "./analytics.js";
import { sendMailBestEffort } from "./mailer.js";
import { postRequestExpiredEmail } from "./emails.js";
import { generateVideoScript } from "../anthropic.js";
import { generateBackgroundImage } from "../fal.js";
import { publishReelToInstagram } from "../instagram.js";
import { uploadImageBase64, uploadVideoBuffer } from "../r2.js";
import { getVoiceOption, synthesizeSpeech, ttsAvailable } from "../tts.js";
import {
  DEFAULT_VIDEO_LENGTH,
  POINTS_PER_LENGTH,
  probeDurationSeconds,
  renderSlideshowVideo,
  runQueued,
  spokenCharBudget,
  videoRenderingAvailable,
  VIDEO_LENGTHS,
  type VideoLength,
  type VideoSegment,
} from "../video.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Wie oft nachgesehen wird, ob ein Video fällig ist. Eigener Cron, unabhängig von Posting-Routine,
 *  Kommentar- und Bewertungs-Cron (dasselbe Prinzip wie dort). */
const VIDEO_CRON_INTERVAL_MINUTES = Number(process.env.PANEL_VIDEO_CRON_MINUTES) || 30;
/** Obergrenze für das Sprechtempo, wenn der Text länger geraten ist als das Zeitbudget. Darüber
 *  klingt es gehetzt - dann darf das Video lieber ein paar Sekunden länger werden. */
const MAX_SPEAKING_RATE = 1.18;

function videoLengthOf(c: CustomerRow): VideoLength {
  const value = Number(c.video_length_seconds);
  return (VIDEO_LENGTHS as readonly number[]).includes(value) ? (value as VideoLength) : DEFAULT_VIDEO_LENGTH;
}

/**
 * Zoomrichtung für den nächsten Beitrag. 'alternate' wechselt ab - abgeleitet aus der Anzahl
 * bisheriger Video-Beiträge, damit kein zusätzlicher Zustand gespeichert werden muss und zwei
 * aufeinanderfolgende Videos eines Kunden nie gleich aussehen.
 */
function zoomFor(c: CustomerRow): "in" | "out" {
  const mode = c.video_zoom_direction || "alternate";
  if (mode === "in" || mode === "out") return mode;
  const n = (
    db.prepare("SELECT COUNT(*) as n FROM posts WHERE customer_id = ? AND format = 'video_slideshow'").get(c.id) as { n: number }
  ).n;
  return n % 2 === 0 ? "in" : "out";
}

export interface VideoProductionResult {
  status: "published" | "pending_approval" | "skipped";
  reason?: string;
  videoUrl?: string;
  posterUrl?: string;
  durationSeconds?: number;
  renderMs?: number;
  hasAudio: boolean;
  costUsd: number;
}

/**
 * Erzeugt EIN fertiges Video für einen Kunden - Drehbuch, Ton, Bild, Rendering, Upload - und legt
 * es entweder zur Freigabe ab oder veröffentlicht es direkt (je nach approval_mode).
 *
 * `topic` kommt von "Jetzt posten", sonst null (automatischer Lauf).
 */
export async function produceVideoPost(
  customer: CustomerRow,
  topic: string | null = null,
  /** true = der Kunde hat es ausdruecklich ueber "Jetzt posten" angefordert (nicht der Wochenplan).
   *  Eine solche Anfrage ueberstimmt den Tagesplatz-Schutz, siehe savePendingApproval. */
  aufAnfrage = false,
): Promise<VideoProductionResult> {
  const result: VideoProductionResult = { status: "skipped", hasAudio: false, costUsd: 0 };

  if (!(await videoRenderingAvailable())) {
    result.reason = "ffmpeg/ffprobe sind auf diesem Server nicht verfügbar";
    return result;
  }

  const length = videoLengthOf(customer);
  const voice = getVoiceOption(customer.video_voice);
  const wantsSpeech = Boolean(customer.video_voice_enabled) && ttsAvailable();
  const points = POINTS_PER_LENGTH[length];
  const pillar = pickPillarForToday(customer.id);
  const styleSamples = await getStyleSamples(customer.id).catch(() => ({ samples: [] as { caption?: string | null }[] }));

  // ---- 1. Drehbuch (billig zuerst, siehe Dateikopf) ----
  const scriptInput = {
    company: customer.company,
    industry: customer.industry ?? "",
    about: customer.about ?? "",
    tone: customer.tone ?? "sachlich",
    language: customer.language ?? "de",
    hashtagPreference: customer.hashtag_pref ?? "wenige",
    emojisEnabled: Boolean(customer.emojis_enabled),
    pillarTitle: pillar?.title ?? null,
    pillarDescription: pillar?.description ?? null,
    topic,
    lengthSeconds: length,
    minPoints: points.min,
    maxPoints: points.max,
    spokenCharBudget: spokenCharBudget(length, voice.charsPerSecond),
    bannedWords: splitCommaList(customer.banned_words),
    requiredElements: splitCommaList(customer.required_elements),
    customHashtags: splitHashtagList(customer.custom_hashtags),
    styleSamples: styleSamples.samples.map((s) => s.caption).filter((c): c is string => Boolean(c)).slice(0, 5),
  };

  let script = await generateVideoScript(scriptInput);
  result.costUsd += script.costUsd ?? 0;
  const allTexts = (s: typeof script): string[] => [s.hook.text, ...s.points.map((p) => p.text), s.cta.text, s.caption];
  try {
    assertNoBannedWords(customer.id, ...allTexts(script));
    assertRequiredElements(customer.id, ...allTexts(script));
  } catch (err) {
    // Genau ein Nachversuch mit konkreter Rückmeldung - gleiche Regel wie in planning.ts.
    const avoidNote = err instanceof Error ? err.message : String(err);
    script = await generateVideoScript({ ...scriptInput, avoidNote });
    result.costUsd += script.costUsd ?? 0;
    assertNoBannedWords(customer.id, ...allTexts(script));
    assertRequiredElements(customer.id, ...allTexts(script));
  }
  logUsageCost(customer.id, "video-post", script.costUsd);

  const segments: VideoSegment[] = [
    { kind: "hook", text: script.hook.text, spoken: script.hook.spoken },
    ...script.points.map((p) => ({ kind: "point" as const, text: p.text, spoken: p.spoken })),
    { kind: "cta", text: script.cta.text, spoken: script.cta.spoken },
  ];

  // ---- 2. Sprachausgabe. Fällt sie aus, entsteht dasselbe Video stumm (der Text steht im Bild). ----
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeflow-tts-"));
  let audio: { path: string; duration: number }[] | null = null;
  try {
    if (wantsSpeech) {
      try {
        const spokenChars = segments.reduce((sum, s) => sum + (s.spoken ?? s.text).length, 0);
        // Sprechtempo EINMAL vorab aus der Zeichenzahl abschätzen statt hinterher nachzusynthetisieren:
        // ein zweiter Durchlauf würde nur Geld kosten und das Ergebnis kaum verbessern.
        const estimatedSeconds = spokenChars / voice.charsPerSecond;
        const rate = Math.min(MAX_SPEAKING_RATE, Math.max(1, estimatedSeconds / Math.max(1, length - 1)));
        const files: { path: string; duration: number }[] = [];
        let ttsCost = 0;
        for (const [i, seg] of segments.entries()) {
          const spoken = await synthesizeSpeech(seg.spoken ?? seg.text, voice.id, Math.round(rate * 100) / 100);
          ttsCost += spoken.costUsd;
          const p = path.join(workDir, `seg${i}.mp3`);
          await fs.writeFile(p, Buffer.from(spoken.audioBase64, "base64"));
          files.push({ path: p, duration: await probeDurationSeconds(p) });
        }
        logUsageCost(customer.id, "video-tts", ttsCost);
        result.costUsd += ttsCost;
        audio = files;
        result.hasAudio = true;
      } catch (err) {
        console.error(
          `[videos] ${customer.id}: Sprachausgabe fehlgeschlagen - Video entsteht stumm:`,
          err instanceof Error ? err.message : err,
        );
        audio = null;
      }
    }

    // ---- 3. Hintergrund + Rendering ----
    const branding = resolveImageBranding(customer.id);
    const background = await generateBackgroundImage("story", branding);
    if (background.costUsd) logUsageCost(customer.id, "video-post", background.costUsd);
    result.costUsd += background.costUsd;

    const rendered = await runQueued(() =>
      renderSlideshowVideo({
        background: background.buffer,
        segments,
        audio,
        targetSeconds: length,
        zoom: zoomFor(customer),
        branding: {
          accentColor: branding.accentColor,
          watermarkText: branding.watermarkText,
          logoPath: branding.logoPath,
          fontId: branding.fontId,
        },
      }),
    );
    result.durationSeconds = rendered.durationSeconds;
    result.renderMs = rendered.renderMs;

    const [videoUrl, posterUrl] = await Promise.all([
      uploadVideoBuffer(rendered.videoBuffer),
      uploadImageBase64(`data:image/jpeg;base64,${rendered.posterBuffer.toString("base64")}`),
    ]);
    result.videoUrl = videoUrl;
    result.posterUrl = posterUrl;

    // ---- 4. Freigabe oder Veröffentlichung ----
    if (customer.approval_mode) {
      const approval = savePendingApproval({
        customerId: customer.id,
        provider: "instagram",
        channel: "ig_feed",
        headline: script.hook.text,
        caption: script.caption,
        imageUrl: posterUrl,
        videoUrl,
        pillarTitle: pillar?.title,
        source: topic ? "routine" : "planning",
        format: "video_slideshow",
        allowSecondToday: aufAnfrage,
      });
      if (!approval) {
        result.status = "skipped";
        result.reason = "für heute liegt für diesen Kanal schon ein Beitrag zur Freigabe bereit";
        return result;
      }
      result.status = "pending_approval";
      return result;
    }

    const creds = await resolveInstagramCredentials(customer.id);
    if (!creds) {
      result.status = "skipped";
      result.reason = "Instagram nicht verbunden";
      return result;
    }
    const published = await publishReelToInstagram(videoUrl, script.caption, creds, customer.id);
    logPost(customer.id, "instagram", {
      externalPostId: published.postId,
      headline: script.hook.text,
      caption: script.caption,
      imageUrl: posterUrl,
      videoUrl,
      pillarTitle: pillar?.title ?? undefined,
      channel: "ig_feed",
      format: "video_slideshow",
    });
    result.status = "published";
    return result;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Veröffentlicht ein bereits freigegebenes Video (pending_approvals-Zeile mit format='video_slideshow'). */
export async function publishApprovedVideo(input: {
  customerId: string;
  videoUrl: string;
  caption: string;
  headline?: string | null;
  posterUrl?: string | null;
  pillarTitle?: string | null;
}): Promise<string> {
  const creds = await resolveInstagramCredentials(input.customerId);
  if (!creds) throw new Error("Instagram nicht verbunden.");
  const published = await publishReelToInstagram(input.videoUrl, input.caption, creds, input.customerId);
  logPost(input.customerId, "instagram", {
    externalPostId: published.postId,
    headline: input.headline ?? undefined,
    caption: input.caption,
    imageUrl: input.posterUrl ?? undefined,
    videoUrl: input.videoUrl,
    pillarTitle: input.pillarTitle ?? undefined,
    channel: "ig_feed",
    format: "video_slideshow",
  });
  return published.postId;
}

/**
 * Veröffentlicht alles, was der Kunde im Freigabe-Modus bereits freigegeben hat. Läuft im selben
 * Cron wie die Produktion - die externe Routine kann diese Beiträge nicht übernehmen, weil sie
 * kein Video hochladen kann (siehe listApprovedPendingPosts in credentials.ts).
 */
async function publishApprovedVideos(): Promise<{ published: number; errors: number }> {
  const stats = { published: 0, errors: 0 };
  for (const approval of listApprovedVideoPosts()) {
    if (!approval.videoUrl) {
      console.error(`[videos] Freigegebener Video-Beitrag ${approval.id} hat keine Video-URL - übersprungen.`);
      stats.errors++;
      continue;
    }
    try {
      await publishApprovedVideo({
        customerId: approval.customerId,
        videoUrl: approval.videoUrl,
        caption: approval.caption ?? "",
        headline: approval.headline,
        posterUrl: approval.imageUrl,
        pillarTitle: approval.pillarTitle,
      });
      markPendingApprovalPublished(approval.id);
      stats.published++;
    } catch (err) {
      stats.errors++;
      console.error(`[videos] Veröffentlichung des freigegebenen Videos ${approval.id} fehlgeschlagen:`, err instanceof Error ? err.message : err);
    }
  }
  return stats;
}

export interface VideoRunSummary {
  startedAt: string;
  finishedAt: string;
  customersChecked: number;
  produced: number;
  pendingApproval: number;
  skipped: number;
  errors: number;
}

/** Ein Kunde ist für die Video-Automatik überhaupt nur dann ein Kandidat, wenn er sie aktiviert
 *  hat, Instagram Feed nutzt und Instagram verbunden ist. */
/**
 * Wer kommt fuer einen Video-Lauf ueberhaupt in Frage.
 *
 * `video_enabled` steuert den AUTOMATISCHEN Wochenplan. Eine ausdrueckliche "Jetzt posten"-Anfrage
 * mit Format Video-Diashow ueberstimmt ihn (15.09.2026): sonst legt der Kunde eine Anfrage an,
 * die hier nie aufgegriffen wird - sie bliebe fuer immer offen, wuerde den Kanal blockieren
 * (openPostRequestCount) und im Panel dauerhaft als "angefragt" stehen. Dieselbe Logik gilt in
 * runVideoPass schon fuer den Wochentag und den Tagesplatz: was der Kunde ausdruecklich anfordert,
 * schlaegt die Automatik-Einstellungen.
 *
 * Instagram-Verbindung und ig_feed_enabled bleiben Pflicht - ohne die kann ein Reel nicht
 * entstehen, und /api/post-now laesst eine Anfrage fuer einen abgeschalteten Kanal ohnehin nicht zu.
 */
function videoCandidates(): CustomerRow[] {
  return db
    .prepare(
      `SELECT c.* FROM customers c
       JOIN connections k ON k.customer_id = c.id AND k.provider = 'instagram'
       WHERE c.status = 'active' AND c.customer_paused = 0 AND c.email_verified = 1
         AND c.ig_feed_enabled = 1
         AND (c.video_enabled = 1
              OR EXISTS (SELECT 1 FROM post_requests r
                         WHERE r.customer_id = c.id AND r.status = 'pending' AND r.format = 'video_slideshow'))`,
    )
    .all() as CustomerRow[];
}

/**
 * Uebersetzt einen internen Skip-Grund in einen Satz, den der Kunde lesen soll.
 *
 * Bewusst eine feste Zuordnung statt der Rohmeldung: "ffmpeg/ffprobe sind auf diesem Server nicht
 * verfuegbar" nennt ein Programm auf unserem Server - das gehoert nicht nach aussen, sagt dem
 * Kunden nichts und wirkt wie ein Defekt bei ihm. Unbekannte Gruende bekommen einen neutralen
 * Satz; der genaue Wortlaut steht weiterhin im Log.
 */
function kundengrund(intern: string | undefined): string {
  const g = String(intern ?? "").toLowerCase();
  if (g.includes("instagram nicht verbunden")) {
    return "Für ein Video muss Instagram verbunden sein. Verbinden Sie Ihr Konto unter „Instagram verbinden“ und fordern Sie den Beitrag danach erneut an.";
  }
  if (g.includes("ffmpeg") || g.includes("ffprobe")) {
    return "Die Videoerstellung war vorübergehend nicht verfügbar. Bitte fordern Sie den Beitrag später noch einmal an - wir haben den Fehler protokolliert.";
  }
  if (g.includes("freigabe bereit")) {
    return "Für diesen Kanal liegt heute schon ein Beitrag zur Freigabe bereit. Geben Sie ihn frei oder lehnen Sie ihn ab, dann können Sie einen neuen anfordern.";
  }
  return "Aus dieser Anfrage ist kein Beitrag geworden. Bitte versuchen Sie es noch einmal - wenn es wieder nicht klappt, schreiben Sie uns.";
}

export async function runVideoPass(): Promise<VideoRunSummary> {
  const startedAt = nowIso();
  const summary: VideoRunSummary = {
    startedAt,
    finishedAt: startedAt,
    customersChecked: 0,
    produced: 0,
    pendingApproval: 0,
    skipped: 0,
    errors: 0,
  };

  const approved = await publishApprovedVideos();
  summary.produced += approved.published;
  summary.errors += approved.errors;

  for (const customer of videoCandidates()) {
    summary.customersChecked++;

    // Fehlerisolation: alles, was pro Kunde passiert, liegt in EINEM try. Vorher standen die
    // Vorpruefungen (offene Anfrage, Faelligkeit, Tagesplatz) davor - wirft dort etwas, bricht
    // der ganze Lauf ab und jeder spaetere Kunde bekommt in dieser Stunde nichts. Die anderen
    // vier Routine-Schleifen (Analytics, Bewertungen, Kommentare) machen es bereits so.
    try {
    // "Jetzt posten"-Anfragen zuerst - der Kunde wartet darauf, der Wochenplan nicht.
    const request = db
      .prepare(
        "SELECT id, topic FROM post_requests WHERE customer_id = ? AND status = 'pending' AND format = 'video_slideshow' ORDER BY created_at LIMIT 1",
      )
      .get(customer.id) as { id: string; topic: string | null } | undefined;

    const due = request ? true : isVideoDue(scheduleInputFor(customer));
    if (!due) continue;
    // Der Tagesplatz-Schutz gilt auch hier (siehe hasPendingOrApprovedToday) - aber nur für den
    // automatischen Lauf: eine ausdrückliche "Jetzt posten"-Anfrage darf ihn überstimmen, sonst
    // klickt ein Kunde auf den Knopf und es passiert sichtbar nichts.
    if (!request && customer.approval_mode && hasPendingOrApprovedToday(customer.id, "ig_feed")) continue;

      const produced = await produceVideoPost(customer, request?.topic ?? null, Boolean(request));
      if (request) {
        // 15.09.2026: eine Anfrage, aus der nichts geworden ist, wird nicht mehr stillschweigend
        // als erledigt abgehakt - der Kunde bekommt den Grund im Klartext zu sehen.
        if (produced.status === "skipped") markPostRequestSkipped(request.id, kundengrund(produced.reason));
        else markPostRequestDone(request.id);
      }
      if (produced.status === "published") summary.produced++;
      else if (produced.status === "pending_approval") summary.pendingApproval++;
      else {
        summary.skipped++;
        console.log(`[videos] ${customer.id}: übersprungen - ${produced.reason ?? "kein Grund angegeben"}`);
      }
      if (produced.renderMs) {
        console.log(
          `[videos] ${customer.id}: ${produced.status}, ${produced.durationSeconds}s Video, Rendern ${Math.round(produced.renderMs / 1000)}s, Ton ${produced.hasAudio ? "ja" : "nein"}, Kosten ${produced.costUsd.toFixed(4)} USD`,
        );
      }
    } catch (err) {
      summary.errors++;
      console.error(`[videos] ${customer.id}: Video fehlgeschlagen:`, err instanceof Error ? err.message : err);
      // Eine fehlgeschlagene ausdrückliche Anfrage bleibt offen, damit der nächste Lauf es erneut
      // versucht - anders als beim Wochenplan, der ohnehin täglich neu greift.
    }
  }

  summary.finishedAt = nowIso();
  return summary;
}

/**
 * Zeitablauf-Waechter fuer haengende "Jetzt posten"-Anfragen (15.09.2026, Punkt 8).
 *
 * Laeuft alle 20 Minuten - oft genug, dass die Zwei-Stunden-Grenze nicht zur Drei-Stunden-Grenze
 * wird, selten genug, dass es nichts kostet (eine indizierte Abfrage, sonst nichts).
 */
/** Gleiche Adresse wie die Stillstands-Warnung - eine Stelle, an der der Betreiber nachsieht. */
const betreiberMail = (): string => process.env.PANEL_ALERT_EMAIL ?? "office@pipebot.at";

export function startPostRequestExpiry(intervalMinutes = 20): NodeJS.Timeout {
  const run = () => {
    try {
      const abgelaufen = expireStalePostRequests();
      if (!abgelaufen.length) return;
      console.warn(`[panel] ${abgelaufen.length} "Jetzt posten"-Anfrage(n) nach 2 Stunden abgelaufen:`, abgelaufen.map((r) => `${r.customerId}/${r.channel}`).join(", "));
      const eintraege = abgelaufen.map((r) => ({
        company: (db.prepare("SELECT company FROM customers WHERE id = ?").get(r.customerId) as { company?: string } | undefined)?.company ?? r.customerId,
        channel: r.channel ?? "unbekannt",
        createdAt: r.createdAt,
      }));
      sendMailBestEffort(postRequestExpiredEmail({ to: betreiberMail(), eintraege }));
    } catch (err) {
      console.error("[panel] Zeitablauf-Waechter fehlgeschlagen:", err instanceof Error ? err.message : err);
    }
  };
  setTimeout(run, 90_000);
  return setInterval(run, intervalMinutes * 60_000);
}

export function startVideoSchedule(intervalMinutes = VIDEO_CRON_INTERVAL_MINUTES): NodeJS.Timeout {
  const run = () =>
    runVideoPass()
      .then((summary) => {
        if (summary.produced || summary.pendingApproval || summary.errors) console.log("[panel] Video-Diashow:", summary);
      })
      .catch((err) => console.error("[panel] Video-Diashow unerwartet fehlgeschlagen:", err));
  setTimeout(run, 120_000);
  return setInterval(run, intervalMinutes * 60_000);
}
