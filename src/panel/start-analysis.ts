/**
 * Website-Analyse fuer das Easy Onboarding: EIN Abruf der Seite, daraus Text fuer die
 * KI-Analyse UND die Markenfarben (brand-colors.ts). Eigenes Modul, damit sowohl die Routen
 * (start-routes.ts) als auch der Hintergrundlauf (start-jobs.ts) es nutzen koennen, ohne dass
 * sich die beiden gegenseitig importieren.
 */
import { db, nowIso } from "./db.js";
import { suggestFromWebsite, type WebsiteSuggestion } from "../anthropic.js";
import { extractBrandColorsFromHtml, type BrandColorResult } from "./brand-colors.js";
import { fetchTextSafely } from "../ssrf-safe-fetch.js";
import { extractPageText } from "../website-analyze.js";
import { ToolError } from "../errors.js";
import { setContentPillars } from "./credentials.js";
import { normalizeDomain } from "./start-quota.js";

/* ------------------------------- Domain-Zwischenspeicher ------------------------------- */

export interface DomainAnalysis {
  suggestion: WebsiteSuggestion;
  colors: BrandColorResult | null;
}

const DOMAIN_CACHE_STUNDEN = Number(process.env.PANEL_DOMAIN_CACHE_HOURS) > 0 ? Number(process.env.PANEL_DOMAIN_CACHE_HOURS) : 24 * 7;

export function cacheLesen(domain: string): DomainAnalysis | null {
  if (!domain) return null;
  const row = db.prepare("SELECT payload_json, created_at FROM domain_cache WHERE domain = ?").get(domain) as { payload_json: string; created_at: string } | undefined;
  if (!row) return null;
  if (Date.now() - Date.parse(row.created_at) > DOMAIN_CACHE_STUNDEN * 3_600_000) return null;
  try {
    return JSON.parse(row.payload_json) as DomainAnalysis;
  } catch {
    return null;
  }
}

function cacheSchreiben(domain: string, daten: DomainAnalysis): void {
  if (!domain) return;
  db.prepare("INSERT INTO domain_cache (domain, payload_json, created_at) VALUES (?, ?, ?) ON CONFLICT(domain) DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at")
    .run(domain, JSON.stringify(daten), nowIso());
}

/**
 * Website EINMAL laden und daraus beides gewinnen: den Text fuer die KI-Analyse und die
 * Markenfarben. Zweiter Aufruf derselben Domain kommt aus dem Zwischenspeicher (Abschnitt 8).
 */
export async function analysiereWebsite(website: string): Promise<{ analyse: DomainAnalysis; ausCache: boolean }> {
  const domain = normalizeDomain(website);
  const zwischengespeichert = cacheLesen(domain);
  if (zwischengespeichert) return { analyse: zwischengespeichert, ausCache: true };

  const url = /^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`;
  let html: string;
  try {
    html = await fetchTextSafely(url, 8000);
  } catch (err) {
    throw new ToolError(err instanceof Error ? err.message : "Die Website konnte nicht abgerufen werden.");
  }
  const seite = extractPageText(html);
  if (!seite.title && !seite.description && !seite.bodyText) {
    throw new ToolError("Auf dieser Seite konnte kein Text gefunden werden.");
  }
  // Farben und Text parallel: die Farberkennung laedt Stylesheets/Logo, die Analyse haengt am
  // Anthropic-Aufruf - nacheinander waeren das zwei Wartezeiten statt einer.
  const [suggestion, colors] = await Promise.all([
    suggestFromWebsite(seite),
    extractBrandColorsFromHtml(html, url).catch(() => null),
  ]);
  const analyse: DomainAnalysis = { suggestion, colors };
  cacheSchreiben(domain, analyse);
  return { analyse, ausCache: false };
}

/** Analyse-Ergebnis und Markenfarben in die BESTEHENDEN Kundenfelder schreiben - kein zweites System. */
export function uebernehmeAnalyse(customerId: string, website: string | null, analyse: DomainAnalysis): void {
  const { suggestion, colors } = analyse;
  const hashtags = suggestion.hashtags.map((h) => `#${h}`).join(" ");
  db.prepare(
    `UPDATE customers SET company = COALESCE(NULLIF(?, ''), company), contact_name = COALESCE(NULLIF(?, ''), contact_name),
       website = COALESCE(?, website), industry = ?, about = ?, tone = ?, custom_hashtags = ?,
       accent_color = COALESCE(?, accent_color), gradient_enabled = ?, gradient_color2 = COALESCE(?, gradient_color2), gradient_direction = ?,
       updated_at = ? WHERE id = ?`,
  ).run(
    suggestion.company ?? "",
    suggestion.company ?? "",
    website,
    suggestion.industry || null,
    suggestion.about || null,
    suggestion.tone,
    hashtags || null,
    colors?.accentColor ?? null,
    colors ? 1 : 0,
    colors?.gradientColor2 ?? null,
    colors?.gradientDirection ?? "diagonal",
    nowIso(),
    customerId,
  );
  if (suggestion.pillars.length) setContentPillars(customerId, suggestion.pillars.map((p) => ({ ...p, weight: 1 })));
}

