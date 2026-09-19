/**
 * Easy Onboarding: Hintergrundlaeufe pro Kunde (Vorschau erstellen, "Anders machen", Nachplanen,
 * Bild-Nachtrag), damit der Bildschirm "Es arbeitet" echten Fortschritt zeigen kann statt eines
 * Endlos-Spinners. Bewusst im Speicher (Map pro Prozess): ein Lauf gehoert zu genau einer
 * Sitzung, und die Wahrheit ueber das Ergebnis steht ohnehin in planned_posts - faellt der
 * Prozess mitten im Lauf um, zeigt der Status "idle", die schon fertigen Beitraege bleiben, und
 * der Nachtlauf (planUpcomingPosts) fuellt die Luecken wie bei jedem anderen Kunden.
 */
import { db, type CustomerRow } from "./db.js";
import { backfillMissingImages, planCustomerWeek, regeneratePlannedPostsForBranding, type PlanWeekOptions } from "./planning.js";
import { listContentPillars } from "./credentials.js";

export type JobPhase = "analyze" | "writing" | "images" | "done" | "error";

export interface StartJob {
  kind: "preview" | "adjust" | "replan" | "backfill";
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
