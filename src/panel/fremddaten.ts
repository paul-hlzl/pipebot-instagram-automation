/**
 * Fremddaten vergessen (20.09.2026).
 *
 * `processed_comments` und `google_reviews` halten Daten von Menschen, die mit uns nie einen
 * Vertrag geschlossen haben: Instagram-Benutzernamen, Google-Klarnamen und die jeweiligen Texte.
 * Bis heute blieben sie unbegrenzt liegen. Gar nicht speichern geht aber nicht - ohne Kennung
 * faellt die Doppelantwort-Sperre weg, und dann schreibt die Routine denselben Menschen mehrfach
 * an (dasselbe Muster wie der Doppelpost-Vorfall vom selben Tag, nur sichtbar unter dem Beitrag
 * eines Kunden).
 *
 * Darum: behalten, solange es einen Zweck hat - danach vergessen.
 *
 *  - NAME und TEXT: nur solange eine Freigabe offen ist. Der Kunde muss beim Freigeben sehen,
 *    wer schreibt; danach hat der Name keinen Zweck mehr.
 *  - KENNUNG (`comment_id` / `review_name`): wird zum Antworten gebraucht und bleibt bis dahin
 *    im Klartext. Danach wird sie durch ihren eigenen Hash ERSETZT statt geleert - beide Spalten
 *    sind UNIQUE und NOT NULL, ein Leeren waere beim zweiten Satz an der Eindeutigkeit
 *    gescheitert. Der Hash bleibt eindeutig, taugt weiter zum Wiedererkennen und laesst sich
 *    nicht zurueckrechnen.
 *
 * Bei Google faellt die Kennung NICHT sofort: Google kann eine bereits gesendete Antwort noch
 * nachtraeglich ablehnen, und `checkPendingModeration` fragt dafuer sieben Tage lang mit
 * `review_name` nach. Erst danach wird auch sie gehasht.
 */
import crypto from "node:crypto";
import { db } from "./db.js";

export type Fremdtabelle = "processed_comments" | "google_reviews";

interface Felder {
  /** Name der Person - darf NULL werden. */
  name: string;
  /** Freitexte - NOT NULL, werden darum geleert statt genullt. */
  texte: string[];
  /** Eigene erzeugte Antwort - kann den Namen enthalten ("Danke, Andrea!"). */
  antwort: string;
  /** Kennung der Plattform - UNIQUE und NOT NULL, wird durch ihren Hash ersetzt. */
  kennung: string;
}

const FELDER: Record<Fremdtabelle, Felder> = {
  processed_comments: { name: "author_username", texte: ["comment_text"], antwort: "generated_reply", kennung: "comment_id" },
  google_reviews: { name: "reviewer_name", texte: ["review_text"], antwort: "generated_reply", kennung: "review_name" },
};

const HASH_MUSTER = /^[0-9a-f]{64}$/;

/** Wiedererkennungswert einer Kennung. Gleiche Eingabe, gleicher Wert - mehr braucht die Sperre nicht. */
export function fremdKennung(wert: string): string {
  return crypto.createHash("sha256").update(wert).digest("hex");
}

/**
 * Beide Formen einer Kennung fuer die Suche: der Klartext (solange die Freigabe laeuft) und der
 * Hash (danach). Die Doppelantwort-Sperre muss beide finden, sonst waere ein bereits
 * beantworteter Kommentar nach dem Vergessen wieder "neu".
 */
export function kennungsFormen(wert: string): [string, string] {
  return [wert, fremdKennung(wert)];
}

/** Name, Text und erzeugte Antwort entfernen. Aufzurufen, sobald der Satz nicht mehr auf Freigabe wartet. */
export function vergissPersonendaten(tabelle: Fremdtabelle, id: string): void {
  const f = FELDER[tabelle];
  const leeren = f.texte.map((s) => `${s} = ''`).join(", ");
  // `updated_at` wird BEWUSST nicht angefasst. Es markiert, wann der Satz fachlich abgeschlossen
  // wurde, und genau daran haengen zwei Fristen: das Moderationsfenster von Google und der
  // Zeitpunkt, an dem die Kennung gehasht wird. Wuerde das Vergessen den Stempel hochsetzen,
  // liefe die Aufbewahrungsuhr bei jedem Aufraeumen von vorn los - der Test hat das gefunden.
  db.prepare(`UPDATE ${tabelle} SET ${f.name} = NULL, ${leeren}, ${f.antwort} = NULL WHERE id = ?`).run(id);
}

/**
 * Kennung durch ihren Hash ersetzen. Idempotent: ein bereits gehashter Wert bleibt unveraendert,
 * damit ein zweiter Lauf nicht den Hash des Hashes schreibt und die Sperre ins Leere greift.
 */
export function vergissKennung(tabelle: Fremdtabelle, id: string): void {
  const f = FELDER[tabelle];
  const zeile = db.prepare(`SELECT ${f.kennung} AS k FROM ${tabelle} WHERE id = ?`).get(id) as { k: string } | undefined;
  if (!zeile?.k || HASH_MUSTER.test(zeile.k)) return;
  // Auch hier kein neuer Zeitstempel - aus demselben Grund wie oben.
  db.prepare(`UPDATE ${tabelle} SET ${f.kennung} = ? WHERE id = ?`).run(fremdKennung(zeile.k), id);
}

/** Beides auf einmal - der Normalfall, wenn ein Satz abgeschlossen ist und nichts mehr nachkommt. */
export function vergissAlles(tabelle: Fremdtabelle, id: string): void {
  vergissPersonendaten(tabelle, id);
  vergissKennung(tabelle, id);
}

/**
 * Kennungen abgeschlossener Saetze nachtraeglich vergessen, sobald ihr Zweck abgelaufen ist.
 * Gibt zurueck, wie viele umgeschrieben wurden.
 */
export function vergissAbgelaufeneKennungen(tabelle: Fremdtabelle, aelterAlsTage: number): number {
  const f = FELDER[tabelle];
  const grenze = new Date(Date.now() - aelterAlsTage * 86_400_000).toISOString();
  const offen = db
    .prepare(
      `SELECT id FROM ${tabelle} WHERE status != 'pending_approval' AND updated_at < ? AND length(${f.kennung}) != 64`,
    )
    .all(grenze) as { id: string }[];
  for (const { id } of offen) vergissKennung(tabelle, id);
  return offen.length;
}
