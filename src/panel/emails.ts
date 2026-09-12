/**
 * Text-Vorlagen für Kunden-E-Mails (Panel v6). Getrennt von mailer.ts (dem reinen Versandweg),
 * damit Aufgabe 4/5 hier nur neue Funktionen ergänzen statt den Versand-Baustein zu duplizieren.
 * Alle Texte Deutsch, im nüchternen Panel-Ton (siehe styleguide.md).
 */
import type { MailInput } from "./mailer.js";

/** Absichtlich lokal (kein Import aus router.ts) - hält emails.ts unabhängig von router.ts,
 *  vermeidet einen Zirkel-Import (router.ts -> mailer/emails, credentials.ts -> emails). */
function panelUrl(): string {
  const base = (process.env.PANEL_BASE_URL ?? "").replace(/\/$/, "");
  const mount = (process.env.PANEL_MOUNT_PATH ?? "/panel").replace(/\/$/, "");
  return `${base}${mount}/`;
}

/** Panel v6 Aufgabe 2b: Bestätigungs-Mail nach Signup (und beim erneuten Anfordern). */
export function verificationEmail(input: { to: string; company: string; verifyUrl: string }): MailInput {
  return {
    to: input.to,
    subject: "Bitte bestätigen Sie Ihre E-Mail-Adresse - Pipeflow",
    text:
      `Hallo,\n\n` +
      `fast fertig: bitte bestätigen Sie Ihre E-Mail-Adresse, damit Pipeflow für "${input.company}" ` +
      `mit der automatischen Erstellung von Beiträgen beginnen kann.\n\n` +
      `Klicken Sie dazu auf diesen Link:\n${input.verifyUrl}\n\n` +
      `Bis zur Bestätigung können Sie Ihre Kanäle (Instagram/LinkedIn) schon verbinden - das ` +
      `kostet nichts. Beiträge werden aber erst nach der Bestätigung vorbereitet/veröffentlicht.\n\n` +
      `Falls Sie sich nicht angemeldet haben, ignorieren Sie diese E-Mail einfach - es passiert nichts.\n\n` +
      `Ihr Pipeflow-Team\nPipeline AI Solutions`,
  };
}

/**
 * Panel v6 Aufgabe 4b: "X Beiträge warten auf Ihre Freigabe" - gesammelt, max. 1x/Tag pro Kunde
 * (der Aufrufer in credentials.ts entscheidet, WANN das gilt; diese Funktion baut nur den Text,
 * mit der aktuellen Gesamtzahl wartender Beiträge zum Versandzeitpunkt).
 */
export function pendingApprovalsSummaryEmail(input: { to: string; company: string; count: number }): MailInput {
  const plural = input.count === 1;
  return {
    to: input.to,
    subject: `${input.count} ${plural ? "Beitrag wartet" : "Beiträge warten"} auf Ihre Freigabe - Pipeflow`,
    text:
      `Hallo,\n\n` +
      `${plural ? "ein Beitrag wartet" : `${input.count} Beiträge warten`} aktuell auf Ihre Freigabe, bevor ${plural ? "er" : "sie"} veröffentlicht werden ${plural ? "kann" : "können"}.\n\n` +
      `Schauen Sie sich ${plural ? "ihn" : "sie"} im Panel an:\n${panelUrl()}\n\n` +
      `Ohne Ihre Freigabe bleibt ${plural ? "er" : "sie"} liegen - nach der Freigabe wird in der Regel innerhalb weniger Minuten veröffentlicht.\n\n` +
      `Ihr Pipeflow-Team\nPipeline AI Solutions`,
  };
}

/** Panel v6 Aufgabe 4c: einmalig, wenn der Probezeitraum in genau 2 Tagen endet. */
export function trialEndingEmail(input: { to: string; company: string }): MailInput {
  return {
    to: input.to,
    subject: "Ihr Probezeitraum endet in 2 Tagen - Pipeflow",
    text:
      `Hallo,\n\n` +
      `Ihr kostenloser Probezeitraum für "${input.company}" endet in 2 Tagen. Danach werden vorübergehend ` +
      `keine neuen Beiträge mehr veröffentlicht, bis das Konto freigeschaltet wird.\n\n` +
      `Melden Sie sich gerne bei uns, wenn Sie weitermachen möchten: office@pipeline-solutions.at\n\n` +
      `Ihr Panel: ${panelUrl()}\n\n` +
      `Ihr Pipeflow-Team\nPipeline AI Solutions`,
  };
}

/** Panel v6 Aufgabe 4d: einmalig, beim allerersten erfolgreichen Post dieses Kunden. */
export function firstPostLiveEmail(input: { to: string; company: string }): MailInput {
  return {
    to: input.to,
    subject: "Ihr erster Beitrag ist live! - Pipeflow",
    text:
      `Hallo,\n\n` +
      `der erste Beitrag für "${input.company}" ist gerade veröffentlicht worden. Ab jetzt kümmern wir uns ` +
      `laufend automatisch um Ihre Beiträge, in Ihrem gewählten Rhythmus.\n\n` +
      `Im Panel sehen Sie jederzeit, was veröffentlicht wurde und was als Nächstes ansteht:\n${panelUrl()}\n\n` +
      `Ihr Pipeflow-Team\nPipeline AI Solutions`,
  };
}
