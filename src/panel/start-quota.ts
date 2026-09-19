/**
 * Kostenschutz fuer die Vorschau VOR der E-Mail-Bestaetigung (Easy-Onboarding, Abschnitt 4).
 *
 * Grundsatz aus Panel v6 bleibt: ein unbestaetigtes Konto darf keine unbegrenzten KI-Kosten
 * verursachen. Der neue Flow zeigt trotzdem sofort ein echtes Ergebnis - deshalb ist hier NICHT
 * "alles oder nichts" geregelt, sondern ein harter, serverseitig gespeicherter Deckel:
 *
 *   - Zaehler liegen in der Tabelle `start_previews` (nicht im Speicher wie `rateLimited()` in
 *     router.ts): ein Neustart des Prozesses setzt sie NICHT zurueck, und die Zahlen sind im
 *     Nachhinein pruefbar.
 *   - Gezaehlt wird pro IP, pro Domain (normalisierter Host der eingegebenen Website) und
 *     global pro Tag. Eine E-Mail-Adresse, die schon ein unbestaetigtes Konto hat, bekommt KEINE
 *     zweite Vorschau, sondern ihr bestehendes Konto zurueck (siehe start-routes.ts).
 *   - Vor der Bestaetigung entstehen hoechstens PANEL_PREVIEW_IMAGES_UNVERIFIED echte Bilder
 *     (Standard 3), der Rest der Woche bekommt Text + Platzhalter und wird nach der Bestaetigung
 *     nachgezogen (planning.ts, backfillMissingImages).
 *
 * Alle Grenzen sind ueber die Umgebung anpassbar, ohne neuen Build. Die reinen Entscheidungs-
 * funktionen (decidePreviewQuota) haben keinen DB-Zugriff und werden in
 * scripts/start-quota.test.ts direkt getestet.
 */
import { db, nowIso } from "./db.js";
import { randomToken } from "./crypto.js";

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

export interface PreviewLimits {
  /** Vorschauen pro angemeldetem Konto und Tag - der teuerste Weg eines echten Nutzers. */
  perAccountPerDay: number;
  perIpPerDay: number;
  perDomainPerDay: number;
  globalPerDay: number;
  /** Echte Bilder vor der Bestaetigung - Rest als Platzhalter. */
  imagesUnverified: number;
  /** "Anders machen"-Durchlaeufe vor der Bestaetigung. */
  adjustUnverified: number;
  /** Beitraege (Texte) hoechstens pro unbestaetigtem Konto - deckelt auch "Kanal dazu"/"taeglich" im Plan. */
  postsUnverified: number;
}

export function previewLimits(): PreviewLimits {
  return {
    perAccountPerDay: envInt("PANEL_PREVIEW_PER_ACCOUNT_DAY", 3),
    perIpPerDay: envInt("PANEL_PREVIEW_PER_IP_DAY", 3),
    perDomainPerDay: envInt("PANEL_PREVIEW_PER_DOMAIN_DAY", 2),
    globalPerDay: envInt("PANEL_PREVIEW_GLOBAL_DAY", 40),
    imagesUnverified: envInt("PANEL_PREVIEW_IMAGES_UNVERIFIED", 3),
    adjustUnverified: envInt("PANEL_PREVIEW_ADJUST_UNVERIFIED", 1),
    postsUnverified: envInt("PANEL_PREVIEW_POSTS_UNVERIFIED", 14),
  };
}

export interface QuotaCounts {
  ip: number;
  domain: number;
  global: number;
}

export type QuotaDecision = { ok: true } | { ok: false; reason: "ip" | "domain" | "global"; message: string };

/** Reine Entscheidung - keine Seiteneffekte, direkt testbar. */
export function decidePreviewQuota(counts: QuotaCounts, limits: PreviewLimits = previewLimits()): QuotaDecision {
  if (counts.global >= limits.globalPerDay) {
    return {
      ok: false,
      reason: "global",
      message: "Heute sind alle Vorschau-Plätze vergeben. Bitte versuche es morgen noch einmal - oder bestätige deine E-Mail-Adresse, dann geht es sofort weiter.",
    };
  }
  if (counts.ip >= limits.perIpPerDay) {
    return {
      ok: false,
      reason: "ip",
      message: "Von deinem Anschluss wurden heute schon mehrere Vorschauen erstellt. Bitte versuche es morgen noch einmal oder melde dich mit deinem bestehenden Konto an.",
    };
  }
  if (counts.domain >= limits.perDomainPerDay) {
    return {
      ok: false,
      reason: "domain",
      message: "Für diese Website wurde heute schon eine Vorschau erstellt. Melde dich mit der E-Mail-Adresse an, die du dabei verwendet hast.",
    };
  }
  return { ok: true };
}

/** "www.Hoelzl-Physio.at/" -> "hoelzl-physio.at". Leer, wenn keine Website (Freitext-Weg). */
export function normalizeDomain(website: string | null | undefined): string {
  const raw = (website ?? "").trim().toLowerCase();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

const DAY_MS = 86_400_000;

export function countPreviews(ip: string, domain: string, now: number = Date.now()): QuotaCounts {
  const since = new Date(now - DAY_MS).toISOString();
  const count = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n;
  return {
    ip: count("SELECT COUNT(*) AS n FROM start_previews WHERE ip = ? AND created_at > ?", ip, since),
    domain: domain ? count("SELECT COUNT(*) AS n FROM start_previews WHERE domain = ? AND created_at > ?", domain, since) : 0,
    global: count("SELECT COUNT(*) AS n FROM start_previews WHERE created_at > ?", since),
  };
}

/** Erst NACH einem tatsaechlich gestarteten Generierungslauf aufrufen (wie bei analyze-website:
 *  ein gescheiterter Versuch kostet nichts und soll niemanden aussperren). */
export function recordPreview(input: { ip: string; domain: string; email: string; customerId: string; kind: "preview" | "adjust" }): void {
  db.prepare("INSERT INTO start_previews (id, ip, domain, email, customer_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    `prev_${randomToken(9)}`,
    input.ip,
    input.domain,
    input.email,
    input.customerId,
    input.kind,
    nowIso(),
  );
}

export function countAdjustsForCustomer(customerId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM start_previews WHERE customer_id = ? AND kind = 'adjust'").get(customerId) as { n: number }).n;
}
