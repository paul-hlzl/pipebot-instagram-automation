/**
 * Sprachwache (Auftrag vom 19.09.2026).
 *
 * Anlass: bei channoine-mayr.at erschien ein Beitrag auf Russisch - "Система красоты" stand im
 * Bild UND in der Caption. Ein Beitrag in fremder Schrift ist schlimmer als ein fehlender
 * Beitrag: er geht im Namen des Kunden raus.
 *
 * Was NICHT die Ursache war (geprueft):
 *   - Die Website. Weder Startseite noch die fuenf gelesenen Unterseiten enthalten ein
 *     kyrillisches Zeichen, auch nicht im Quelltext.
 *   - Die Analyse. Saeulen, Branche und Beschreibung im Zwischenspeicher sind durchgehend
 *     deutsch.
 *   - Eine fehlende Sprachvorgabe. "Schreibe vollständig auf Deutsch" stand schon im Prompt.
 *
 * Reproduzieren liess es sich in 64 Erzeugungen nicht (0 Treffer, weder mit den heutigen noch
 * mit den alten Saeulen). Es ist also ein seltener Ausrutscher des Modells, keine
 * deterministische Kette. Deshalb reicht ein staerkerer Prompt NICHT: er senkt die
 * Wahrscheinlichkeit, garantiert aber nichts. Die Garantie kommt aus dieser Pruefung, die jeden
 * fertigen Text ansieht, bevor er gespeichert wird.
 */

/** Schriftsysteme, die in einem deutschen oder englischen Beitrag nichts zu suchen haben. */
const FREMDE_SCHRIFT: { name: string; muster: RegExp }[] = [
  { name: "kyrillisch", muster: /[Ѐ-ӿԀ-ԯ]/ },
  { name: "griechisch", muster: /[Ͱ-Ͽἀ-῿]/ },
  { name: "hebräisch", muster: /[֐-׿]/ },
  { name: "arabisch", muster: /[؀-ۿݐ-ݿ]/ },
  { name: "chinesisch/japanisch", muster: /[぀-ヿ一-鿿]/ },
  { name: "koreanisch", muster: /[가-힯]/ },
  { name: "thailändisch", muster: /[฀-๿]/ },
  { name: "devanagari", muster: /[ऀ-ॿ]/ },
  { name: "armenisch", muster: /[԰-֏]/ },
  { name: "georgisch", muster: /[Ⴀ-ჿ]/ },
];

/** Nennt das erste fremde Schriftsystem im Text, sonst null. Emojis zaehlen nicht. */
export function fremdeSchrift(text: string): string | null {
  for (const s of FREMDE_SCHRIFT) if (s.muster.test(text)) return s.name;
  return null;
}

/* ---------------------------- Deutsch oder Englisch? ------------------------------------
 * Nur diese beiden kann das Panel (LANGUAGES in router.ts). Die Unterscheidung laeuft ueber
 * Funktionswoerter - die stehen in jedem echten Satz und lassen sich nicht wegformulieren.
 * Bewusst KEINE Bibliothek: es geht nicht darum, 60 Sprachen zu erkennen, sondern darum, einen
 * versehentlich englischen Beitrag auf einer deutschen Website zu bemerken. */
const DEUTSCH = ["der", "die", "das", "und", "ist", "nicht", "mit", "für", "auf", "dein", "deine", "wir", "sie", "ein", "eine", "auch", "aus", "sich", "bei", "wie", "mehr", "oder", "vom", "zum", "zur", "werden", "haben", "kann", "schon", "immer", "durch", "über"];
const ENGLISCH = ["the", "and", "your", "you", "with", "for", "this", "that", "our", "are", "from", "have", "more", "can", "will", "about", "every", "into", "they", "them", "when", "what", "which", "their"];

function woerter(text: string): string[] {
  return (text.toLowerCase().match(/[a-zäöüß]+/g) ?? []).filter((w) => w.length > 1);
}

export interface SprachBefund {
  deutsch: number;
  englisch: number;
  woerter: number;
}

export function sprachSignal(text: string): SprachBefund {
  const w = woerter(text);
  const menge = new Set(w);
  return {
    deutsch: DEUTSCH.filter((x) => menge.has(x)).length,
    englisch: ENGLISCH.filter((x) => menge.has(x)).length,
    woerter: w.length,
  };
}

/**
 * Stimmt der Text mit der erwarteten Sprache ueberein? Gibt eine Begruendung zurueck, wenn
 * nicht - sonst null.
 *
 * Absichtlich zurueckhaltend bei der de/en-Unterscheidung: ein deutscher Beitrag darf einen
 * englischen Slogan enthalten, ohne verworfen zu werden. Es braucht mindestens 12 Woerter UND
 * ein deutliches Uebergewicht der falschen Seite. Fremde Schrift dagegen ist immer ein Fehler,
 * schon bei einem einzigen Zeichen.
 */
export function sprachFehler(text: string, erwartet: string): string | null {
  const schrift = fremdeSchrift(text);
  if (schrift) return `Der Text enthält ${schrift}e Schriftzeichen.`;

  const s = sprachSignal(text);
  if (s.woerter < 12) return null;
  if (erwartet === "de" && s.englisch >= 3 && s.englisch > s.deutsch * 2) {
    return `Der Text wirkt englisch (${s.englisch} englische gegen ${s.deutsch} deutsche Funktionswörter), erwartet war Deutsch.`;
  }
  if (erwartet === "en" && s.deutsch >= 3 && s.deutsch > s.englisch * 2) {
    return `Der Text wirkt deutsch (${s.deutsch} deutsche gegen ${s.englisch} englische Funktionswörter), erwartet war Englisch.`;
  }
  return null;
}

/**
 * Sprache einer Website: erst `<html lang>`, dann die Funktionswoerter des Seitentextes.
 * Alles, was weder Deutsch noch Englisch ist, wird zu Deutsch - das Produkt ist oesterreichisch,
 * und eine falsche Vermutung waere schlimmer als der Standard.
 */
export function websiteSprache(html: string, text: string): "de" | "en" {
  const lang = /<html[^>]+lang=["']([a-zA-Z-]{2,})["']/i.exec(html)?.[1]?.toLowerCase() ?? "";
  if (lang.startsWith("de")) return "de";
  if (lang.startsWith("en")) return "en";
  const s = sprachSignal(text);
  if (s.woerter >= 20 && s.englisch > s.deutsch) return "en";
  return "de";
}
