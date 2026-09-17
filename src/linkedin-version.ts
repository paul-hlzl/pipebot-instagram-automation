/**
 * Zentrale Stelle für die `LinkedIn-Version`-Header (Format JJJJMM).
 *
 * Warum überhaupt zentral: die Version stand bisher an zwei Stellen im Code. Als `202509` am
 * 2026-09 aus dem Supportfenster fiel, antwortete LinkedIn mit
 * `426 NONEXISTENT_VERSION: Requested version 20250901 is not active` - und das Veröffentlichen
 * von Bildbeiträgen schlug still fehl, während der Analytics-Teil weiterlief, weil er eine eigene,
 * neuere Version benutzte. Ein einziger Ort, an dem beide Werte samt Begründung stehen, macht so
 * ein Auseinanderdriften sichtbar, bevor es einen Ausfall gibt.
 *
 * LinkedIn veröffentlicht monatlich und unterstützt jede Version **mindestens ein Jahr**
 * (Quelle: https://learn.microsoft.com/en-us/linkedin/marketing/versioning, Stand 2026-09-17).
 * Zum Zeitpunkt dieser Änderung war `202609` die neueste Version; die älteste noch unterstützte
 * war `202510` (Sunset am 15.10.2026).
 *
 * **Pflege:** einmal im Jahr anheben, am besten mit einem lesenden Testaufruf
 * (`scripts/test-linkedin-version.mjs`) gegengeprüft. Wer hier etwas ändert, ändert es für alle
 * LinkedIn-Aufrufe - das ist der Zweck, aber genau deshalb sind es zwei getrennte Konstanten und
 * nicht eine (siehe ANALYTICS unten).
 */

/**
 * Version für alle schreibenden/lesenden Aufrufe der Posting-API (linkedin.ts):
 * Profil, Bild-Upload, Beitrag anlegen.
 *
 * Auf die neueste Version gesetzt, weil LinkedIn selbst dazu rät: sie verschafft die vollen zwölf
 * Monate Vorlauf bis zur nächsten Pflicht-Anhebung.
 */
export const LINKEDIN_VERSION = "202609";

/**
 * Version für die Analytics-API (linkedin-analytics.ts) - **bewusst eine eigene Konstante.**
 *
 * Bei `202605` hat sich die Antwortform von `metricType` geändert (Objekt -> einfacher String,
 * siehe parseMetricType in linkedin-analytics.ts). Dieser Client muss deshalb immer genau wissen,
 * welche Form er erwartet. Diese Version darf nur bewusst und mit erneuter Prüfung der
 * Antwortform angehoben werden - nie als Nebenwirkung einer Anhebung von LINKEDIN_VERSION.
 *
 * `202608` liegt innerhalb des Supportfensters (Sunset frühestens 08/2027) und ist gegen die
 * aktuelle Antwortform geprüft - hier besteht kein Handlungsbedarf.
 */
export const LINKEDIN_ANALYTICS_VERSION = "202608";
