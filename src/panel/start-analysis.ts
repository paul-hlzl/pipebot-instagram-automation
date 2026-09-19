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
import { fremdeSchrift, websiteSprache } from "./sprache.js";
import { logoFinden, logoAblegen, type LogoFund } from "./brand-logo.js";
import path from "node:path";
import { PACKAGE_ROOT } from "../config.js";

/* ------------------------------- Domain-Zwischenspeicher ------------------------------- */

export interface DomainAnalysis {
  suggestion: WebsiteSuggestion;
  colors: BrandColorResult | null;
  /** Auf der Website gefundenes Logo (19.09.2026). Der Zwischenspeicher merkt sich nur die
   *  Adresse; die Datei wird pro Kunde geholt, weil sie pro Kunde liegt. */
  logo?: LogoFund | null;
  /** Sprache der Website (19.09.2026). Vorher war "de" fest angenommen; die Sprachwache in
   *  planning.ts prueft jeden Beitrag gegen genau diesen Wert. Aeltere Eintraege im
   *  Zwischenspeicher haben ihn nicht - dort gilt weiter "de". */
  sprache?: "de" | "en";
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

/* ---------------------------------- Unterseiten ---------------------------------------- */

/** Wie viele Unterseiten hoechstens in die Analyse einfliessen (Ansage vom 19.09.2026). */
const UNTERSEITEN_MAX = Number(process.env.PANEL_ANALYSE_UNTERSEITEN) > 0 ? Number(process.env.PANEL_ANALYSE_UNTERSEITEN) : 5;
/** Wie viele Kandidaten dafuer ueberhaupt geholt werden - man muss sie lesen, um zu wissen,
 *  welche die groessten sind. Kostet kein KI-Geld, nur ein paar Sekunden, alle parallel. */
const KANDIDATEN_MAX = 10;
/** Zeichen je Unterseite. Deckelt den Eingabetext und damit die Kosten. */
const ZEICHEN_JE_SEITE = 3000;
/** Deckel fuer den GANZEN Schritt "Unterseiten holen", nicht je Seite. */
const GESAMT_BUDGET_MS = Number(process.env.PANEL_ANALYSE_BUDGET_MS) > 0 ? Number(process.env.PANEL_ANALYSE_BUDGET_MS) : 9000;

/**
 * Pfade, die nie Inhalt tragen: Feeds, die WordPress-Schnittstelle, Anhaenge, Rechtstexte,
 * Warenkorb und Konto. Gemessen an channoine-mayr.at machte `/wp-json/` allein 360.000 Zeichen
 * aus - reiner JSON-Ballast, der die Analyse teuer und schlechter gemacht haette.
 */
const PFAD_SPERRE = /\/(feed|comments|wp-json|wp-admin|wp-content|wp-includes|cart|checkout|warenkorb|kasse|mein-konto|my-account|impressum|datenschutz|agb|privacy|terms)(\/|$)/i;
const DATEI_SPERRE = /\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|json|xml|pdf|zip|mp4|webm|woff2?|ttf)$/i;

/** Interne Links aus dem Quelltext, entdoppelt, ohne Anker und Abfrageteil. */
export function interneLinks(html: string, basis: string): string[] {
  let heim: URL;
  try {
    heim = new URL(basis);
  } catch {
    return [];
  }
  const gefunden = new Set<string>();
  for (const treffer of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(treffer[1], heim);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    if (u.hostname.replace(/^www\./, "") !== heim.hostname.replace(/^www\./, "")) continue;
    u.hash = "";
    u.search = "";
    const pfad = u.pathname.replace(/\/+$/, "") || "/";
    if (pfad === "/" || pfad === heim.pathname.replace(/\/+$/, "")) continue;
    if (PFAD_SPERRE.test(`${pfad}/`) || DATEI_SPERRE.test(pfad)) continue;
    u.pathname = pfad;
    gefunden.add(u.toString());
    if (gefunden.size >= 40) break;
  }
  return [...gefunden];
}

export interface Unterseite {
  pfad: string;
  text: string;
}

/**
 * Holt bis zu KANDIDATEN_MAX Unterseiten parallel und gibt die UNTERSEITEN_MAX textreichsten
 * zurueck. Eine Seite, die nicht laedt, faellt still weg - eine kaputte Unterseite darf die
 * Vorschau nie scheitern lassen.
 */
export async function unterseitenLesen(startHtml: string, basis: string): Promise<Unterseite[]> {
  const kandidaten = interneLinks(startHtml, basis).slice(0, KANDIDATEN_MAX);
  if (!kandidaten.length) return [];
  // Gesamtbudget statt engem Einzellimit (19.09.2026, gemessen). Die Unterseiten sind mit
  // rund 6 s der groesste Einzelposten der Analyse - aber nicht, weil wir zu lange warten:
  // sie laufen nachweislich parallel (6 Seiten einzeln 29,1 s, parallel 8,3 s), die Website
  // des Kunden ist schlicht langsam, 4 bis 5 s je Seite. Ein enges Einzellimit hat deshalb
  // nur Seiten verloren (bei 3,5 s kamen 4 statt 6 an), ohne Zeit zu sparen. Jetzt begrenzt
  // ein Deckel fuer den ganzen Schritt: was bis dahin da ist, wird genommen.
  const budget = new Promise<(Unterseite | null)[]>((f) => setTimeout(() => f([]), GESAMT_BUDGET_MS));
  const geholt: (Unterseite | null)[] = await Promise.race([budget, Promise.all(
    kandidaten.map(async (url) => {
      try {
        const html = await fetchTextSafely(url, 6000);
        const seite = extractPageText(html, { maxBodyChars: ZEICHEN_JE_SEITE });
        const text = [seite.title, seite.description, seite.bodyText].filter(Boolean).join(" ").trim();
        return text.length >= 200 ? { pfad: new URL(url).pathname, text } : null;
      } catch {
        return null;
      }
    }),
  )]);
  return geholt
    .filter((x): x is Unterseite => x !== null)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, UNTERSEITEN_MAX);
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
  // Farben und Unterseiten parallel holen, danach erst die KI fragen. Die Unterseiten sind der
  // Grund, warum ueberhaupt genug Stoff fuer zehn verschiedene Aufhaenger zusammenkommt: die
  // Startseite allein trug bei channoine-mayr.at 1.873 von 42.031 Zeichen, also 4,5 Prozent,
  // und die inhaltsreichste Seite (Produkte, Wirkstoffe) war nie dabei.
  const [colors, unterseiten, logo] = await Promise.all([
    extractBrandColorsFromHtml(html, url).catch(() => null),
    unterseitenLesen(html, url).catch(() => [] as Unterseite[]),
    logoFinden(html, url).then((x) => x?.fund ?? null).catch(() => null),
  ]);
  const sprache = websiteSprache(html, `${seite.title} ${seite.description} ${seite.bodyText}`);
  // Profil und Themen laufen parallel (19.09.2026). Beide bekommen BEIDE Textquellen, Start-
  // und Unterseiten: die Zeit kommt daraus, dass die beiden Ausgaben nebeneinander entstehen
  // statt hintereinander, nicht daraus, dass eine davon weniger zu lesen bekommt. Ein duenneres
  // `about` waere derselbe Fehler wie kuerzere Themenbeschreibungen.
  let suggestion = await suggestFromWebsite(seite, unterseiten);
  // Sprachwache schon hier: eine Analyse in fremder Schrift wuerde sich ueber Beschreibung und
  // Saeulen auf JEDEN Beitrag der Woche vererben. Ein Neuversuch, danach wird abgebrochen -
  // lieber keine Vorschau als eine Woche auf Russisch.
  const analyseText = `${suggestion.industry} ${suggestion.about} ${suggestion.pillars.map((x) => `${x.title} ${x.description}`).join(" ")}`;
  const schrift = fremdeSchrift(analyseText);
  if (schrift) {
    console.warn(`[start] ${domain}: Analyse kam in ${schrift}er Schrift zurueck - zweiter Versuch.`);
    suggestion = await suggestFromWebsite(seite, unterseiten);
    const nochmal = fremdeSchrift(`${suggestion.industry} ${suggestion.about} ${suggestion.pillars.map((x) => `${x.title} ${x.description}`).join(" ")}`);
    if (nochmal) throw new ToolError(`Die Analyse dieser Website kam in ${nochmal}er Schrift zurück. Bitte versuche es noch einmal.`);
  }
  console.log(`[start] ${domain}: Startseite + ${unterseiten.length} Unterseite(n) gelesen (${unterseiten.map((u) => u.pfad).join(", ") || "keine"}), Sprache ${sprache}`);
  const analyse: DomainAnalysis = { suggestion, colors, sprache, logo };
  cacheSchreiben(domain, analyse);
  return { analyse, ausCache: false };
}

/** Analyse-Ergebnis und Markenfarben in die BESTEHENDEN Kundenfelder schreiben - kein zweites System. */
/**
 * Holt das gefundene Logo fuer diesen einen Kunden und legt es ab. Getrennt von
 * `uebernehmeAnalyse`, weil das Netz im Spiel ist - und bewusst so gebaut, dass ein
 * fehlschlagender Download NICHTS kaputtmacht: dann bleibt die Kopfzeile eben ohne Logo.
 */
export async function logoUebernehmen(customerId: string, analyse: DomainAnalysis): Promise<void> {
  if (!analyse.logo) return;
  try {
    const { bytes } = await import("../ssrf-safe-fetch.js").then((m) => m.fetchBinarySafely(analyse.logo!.url, 8000, 3_000_000));
    const ziel = await logoAblegen(bytes, path.join(PACKAGE_ROOT, "data/logos"), `auto-${customerId}.png`);
    db.prepare("UPDATE customers SET detected_logo_url = ?, detected_logo_tile = ?, updated_at = ? WHERE id = ?")
      .run(ziel, analyse.logo.eigenerGrund ? 1 : 0, nowIso(), customerId);
    console.log(`[start] ${customerId}: Logo uebernommen (${analyse.logo.quelle}, ${analyse.logo.breite}x${analyse.logo.hoehe}${analyse.logo.eigenerGrund ? ", eigener Grund" : ""}).`);
  } catch (err) {
    console.warn(`[start] ${customerId}: Logo konnte nicht geholt werden -`, err instanceof Error ? err.message : err);
  }
}

export function uebernehmeAnalyse(customerId: string, website: string | null, analyse: DomainAnalysis): void {
  const { suggestion, colors } = analyse;
  const hashtags = suggestion.hashtags.map((h) => `#${h}`).join(" ");
  db.prepare(
    `UPDATE customers SET company = COALESCE(NULLIF(?, ''), company), contact_name = COALESCE(NULLIF(?, ''), contact_name),
       website = COALESCE(?, website), industry = ?, about = ?, tone = ?, custom_hashtags = ?, language = ?,
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
    analyse.sprache ?? "de",
    colors?.accentColor ?? null,
    colors ? 1 : 0,
    colors?.gradientColor2 ?? null,
    colors?.gradientDirection ?? "diagonal",
    nowIso(),
    customerId,
  );
  if (suggestion.pillars.length) setContentPillars(customerId, suggestion.pillars.map((p) => ({ ...p, weight: 1 })));
}

