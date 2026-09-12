/**
 * Text-Vorlagen für Kunden-E-Mails (Panel v6). Getrennt von mailer.ts (dem reinen Versandweg),
 * damit Aufgabe 4/5 hier nur neue Funktionen ergänzen statt den Versand-Baustein zu duplizieren.
 * Alle Texte Deutsch, im nüchternen Panel-Ton (siehe styleguide.md).
 */
import type { MailInput } from "./mailer.js";

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
