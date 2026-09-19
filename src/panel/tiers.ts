/**
 * Preisstufen - NUR die Struktur (Easy-Onboarding-Auftrag, Abschnitt 7). Keine Bezahlfunktion,
 * keine Stripe-Anbindung. `customers.plan_tier` (additiv, NULL = "basic") entscheidet, welche
 * Funktionen die neue Oberflaeche ueberhaupt zeigt. Das klassische Panel ignoriert das Merkmal
 * vollstaendig (bestehende Kunden sehen weiter alles, was sie kennen).
 *
 * Die Zuordnung ist bewusst hier zentral und nicht im Frontend verstreut: das Frontend bekommt
 * ueber /api/me ein fertiges `features`-Objekt und blendet nur ein/aus - welche Stufe was darf,
 * aendert sich spaeter an genau einer Stelle.
 */
export type PlanTier = "basic" | "pro";

export interface TierFeatures {
  /** Wochentags-Matrix je Kanal (statt "3x pro Woche / werktags / taeglich"). */
  weekdayMatrix: boolean;
  /** Mehrere gespeicherte Farbthemen. */
  multiThemes: boolean;
  /** Analytics-Ansicht. */
  analytics: boolean;
  /** Granulare Formatoptionen (Karussell, Video-Diashow, Slide-Anzahl). */
  formatOptions: boolean;
  /** Kommentar- und Bewertungs-Automatik. */
  automations: boolean;
  /** Eigener Farbverlaufs-Picker mit freier Farbwahl (Grundstufe: die Farben der Website). */
  freieFarbwahl: boolean;
}

const FEATURES_BY_TIER: Record<PlanTier, TierFeatures> = {
  basic: { weekdayMatrix: false, multiThemes: false, analytics: false, formatOptions: false, automations: false, freieFarbwahl: true },
  pro: { weekdayMatrix: true, multiThemes: true, analytics: true, formatOptions: true, automations: true, freieFarbwahl: true },
};

export function normalizeTier(raw: string | null | undefined): PlanTier {
  return raw === "pro" ? "pro" : "basic";
}

export function featuresForTier(raw: string | null | undefined): TierFeatures {
  return { ...FEATURES_BY_TIER[normalizeTier(raw)] };
}
