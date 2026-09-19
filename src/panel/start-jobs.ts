/**
 * Easy Onboarding: Hintergrundlaeufe pro Kunde (Vorschau erstellen, "Anders machen", Nachplanen,
 * Bild-Nachtrag), damit der Bildschirm "Es arbeitet" echten Fortschritt zeigen kann statt eines
 * Endlos-Spinners. Bewusst im Speicher (Map pro Prozess): ein Lauf gehoert zu genau einer
 * Sitzung, und die Wahrheit ueber das Ergebnis steht ohnehin in planned_posts - faellt der
 * Prozess mitten im Lauf um, zeigt der Status "idle", die schon fertigen Beitraege bleiben, und
 * der Nachtlauf (planUpcomingPosts) fuellt die Luecken wie bei jedem anderen Kunden.
 */
import { db, type CustomerRow } from "./db.js";
import { backfillMissingImages, planCustomerWeek, recolorPlannedPosts, regeneratePlannedPostsForBranding, type PlanWeekOptions } from "./planning.js";
import { listContentPillars } from "./credentials.js";
import { analysiereWebsite, uebernehmeAnalyse, type DomainAnalysis } from "./start-analysis.js";
import { suggestFromWebsite } from "../anthropic.js";
import { logUsageCost } from "./analytics.js";

/** Die Phasen entsprechen genau den Zeilen auf Bildschirm 3 ("Es arbeitet"). */
export type JobPhase = "reading" | "colors" | "writing" | "images" | "done" | "error";

export interface StartJob {
  kind: "preview" | "adjust" | "replan" | "backfill" | "recolor";
  /** Was die Analyse erkannt hat - fuellt Bildschirm 3, bevor der erste Beitrag fertig ist. */
  found?: { company: string; pillars: string[]; colors: { accentColor: string; gradientColor2: string } | null; cached: boolean };
  phase: JobPhase;
  total: number;
  done: number;
  errors: number;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
}

const jobs = new Map<string, StartJob>();

export function getStartJob(customerId: string): StartJob | null {
  return jobs.get(customerId) ?? null;
}

export function isJobRunning(customerId: string): boolean {
  const job = jobs.get(customerId);
  return Boolean(job && job.phase !== "done" && job.phase !== "error");
}

function freshRow(customerId: string): CustomerRow | undefined {
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as CustomerRow | undefined;
}

function begin(customerId: string, kind: StartJob["kind"], phase: JobPhase): StartJob {
  const job: StartJob = { kind, phase, total: 0, done: 0, errors: 0, startedAt: new Date().toISOString(), finishedAt: null, message: null };
  if (kind === "preview") job.found = undefined;
  jobs.set(customerId, job);
  return job;
}

function finish(job: StartJob, err?: unknown): void {
  job.finishedAt = new Date().toISOString();
  if (err) {
    job.phase = "error";
    job.message = err instanceof Error ? err.message : String(err);
  } else {
    job.phase = "done";
  }
}

/**
 * Der komplette Vorschau-Lauf: Website lesen, Themen und Markenfarben uebernehmen, Woche planen.
 * Laeuft im Hintergrund, damit Bildschirm 3 den Fortschritt in Klartext zeigen kann statt eines
 * Spinners - die Analyse allein dauert je nach Website eine bis vier Sekunden.
 */
export function runPreviewJob(customerId: string, opts: { website: string | null; description: string; imageBudget?: number; postBudget?: number }): StartJob {
  const job = begin(customerId, "preview", "reading");
  (async () => {
    const row = freshRow(customerId);
    if (!row) throw new Error("Kunde nicht gefunden");
    let analyse: DomainAnalysis;
    let ausCache = false;
    if (opts.website) {
      const ergebnis = await analysiereWebsite(opts.website);
      analyse = ergebnis.analyse;
      ausCache = ergebnis.ausCache;
    } else {
      // Weg ohne Website: die eigene Beschreibung des Kunden ist der "Seitentext". Keine Farben -
      // es gibt keine Seite, von der man welche nehmen koennte; es bleibt still beim Standard.
      analyse = { suggestion: await suggestFromWebsite({ title: "", description: "", bodyText: opts.description }), colors: null };
    }
    if (!ausCache) logUsageCost(customerId, "easy-onboarding-analyze", analyse.suggestion.costUsd ?? null);
    job.phase = "colors";
    uebernehmeAnalyse(customerId, opts.website, analyse);
    const frisch = freshRow(customerId);
    job.found = {
      company: frisch?.company ?? row.company,
      pillars: analyse.suggestion.pillars.map((p) => p.title),
      colors: analyse.colors ? { accentColor: analyse.colors.accentColor, gradientColor2: analyse.colors.gradientColor2 } : null,
      cached: ausCache,
    };
    job.phase = "writing";
    const result = await planCustomerWeek(frisch ?? row, {
      concurrency: 3,
      feature: "easy-onboarding-preview",
      imageBudget: opts.imageBudget,
      postBudget: opts.postBudget,
      onProgress: (p) => {
        job.total = p.total;
        job.done = p.done;
        job.errors = p.errors;
      },
    });
    if (result.planned === 0 && result.errors > 0) throw new Error("Kein Beitrag konnte erstellt werden.");
    if (result.planned === 0 && result.slots === 0) throw new Error("Für die nächsten sieben Tage gibt es keinen Tag, an dem etwas rausgehen soll.");
  })()
    .then(() => finish(job))
    .catch((err) => {
      console.error(`[start] Vorschau-Lauf für ${customerId} fehlgeschlagen:`, err instanceof Error ? err.message : err);
      finish(job, err);
    });
  return job;
}

/** Woche fuer einen frisch angelegten (oder nachzuplanenden) Kunden - laeuft im Hintergrund. */
export function runPlanWeekJob(customerId: string, kind: "preview" | "replan", opts: PlanWeekOptions): StartJob {
  const job = begin(customerId, kind, "writing");
  (async () => {
    const row = freshRow(customerId);
    if (!row) throw new Error("Kunde nicht gefunden");
    const result = await planCustomerWeek(row, {
      ...opts,
      onProgress: (p) => {
        job.total = p.total;
        job.done = p.done;
        job.errors = p.errors;
      },
    });
    if (result.planned === 0 && result.errors > 0) throw new Error("Kein Beitrag konnte erstellt werden.");
    if (row.email_verified) {
      job.phase = "images";
      await backfillMissingImages(row, { concurrency: 2 });
    }
  })()
    .then(() => finish(job))
    .catch((err) => {
      console.error(`[start] ${kind}-Lauf für ${customerId} fehlgeschlagen:`, err instanceof Error ? err.message : err);
      finish(job, err);
    });
  return job;
}

/** "Anders machen": bestehende Zeilen mit dem geaenderten Profil neu schreiben. */
export function runAdjustJob(customerId: string, keepImageless: boolean): StartJob {
  const job = begin(customerId, "adjust", "writing");
  (async () => {
    const row = freshRow(customerId);
    if (!row) throw new Error("Kunde nicht gefunden");
    const result = await regeneratePlannedPostsForBranding(row, true, {
      keepImageless,
      concurrency: 3,
      onProgress: (done, total, errors) => {
        job.done = done;
        job.total = total;
        job.errors = errors;
      },
    });
    if (result.updated === 0 && result.errors > 0) throw new Error("Die Beiträge konnten nicht neu geschrieben werden.");
    // Neue Slots (z. B. nach geaendertem Rhythmus) gleich mit - Budgets wie beim ersten Lauf.
    const pillars = listContentPillars(row.id);
    await planCustomerWeek(row, { pillars, concurrency: 3, feature: "easy-onboarding-adjust", ...(keepImageless ? { imageBudget: 0 } : {}) });
  })()
    .then(() => finish(job))
    .catch((err) => {
      console.error(`[start] Anpassungs-Lauf für ${customerId} fehlgeschlagen:`, err instanceof Error ? err.message : err);
      finish(job, err);
    });
  return job;
}

/**
 * Farbe geaendert: die schon erzeugten Bilder der Woche mit dem neuen Verlauf neu rendern.
 * Kostet bei Farbverlauf-Kunden nichts (lokal gerendert, siehe fal.ts) - trotzdem begrenzt der
 * Aufrufer die Haeufigkeit, weil ohne Verlauf jedes Bild ein fal.ai-Aufruf waere.
 */
export function runRecolorJob(customerId: string): StartJob {
  const job = begin(customerId, "recolor", "images");
  (async () => {
    const row = freshRow(customerId);
    if (!row) throw new Error("Kunde nicht gefunden");
    await recolorPlannedPosts(row, {
      concurrency: 2,
      onProgress: (done, total) => {
        job.done = done;
        job.total = total;
      },
    });
  })()
    .then(() => finish(job))
    .catch((err) => {
      console.error(`[start] Farbwechsel fuer ${customerId} fehlgeschlagen:`, err instanceof Error ? err.message : err);
      finish(job, err);
    });
  return job;
}

/** Nach der E-Mail-Bestaetigung: fehlende Bilder nachziehen (fire-and-forget vom /verify-email-Handler). */
export function runBackfillJob(customerId: string): StartJob {
  const job = begin(customerId, "backfill", "images");
  (async () => {
    const row = freshRow(customerId);
    if (!row) throw new Error("Kunde nicht gefunden");
    await backfillMissingImages(row, {
      concurrency: 2,
      onProgress: (done, total) => {
        job.done = done;
        job.total = total;
      },
    });
    // Und falls der Deckel vor der Bestaetigung Slots offen gelassen hat: jetzt auffuellen.
    await planCustomerWeek(row, { concurrency: 3, feature: "easy-onboarding-after-verify" });
  })()
    .then(() => finish(job))
    .catch((err) => {
      console.error(`[start] Bild-Nachtrag für ${customerId} fehlgeschlagen:`, err instanceof Error ? err.message : err);
      finish(job, err);
    });
  return job;
}
