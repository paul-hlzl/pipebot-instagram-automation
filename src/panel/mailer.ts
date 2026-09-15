/**
 * Zentraler E-Mail-Versand-Baustein (Panel v6, Aufgabe 2b/4/5) - AN KUNDEN, nicht an Paul (dafür
 * gibt es bereits weekly-report.mjs, das dieses Modul bewusst NICHT anfasst oder ersetzt, siehe
 * Regel 7 dieser Sitzung).
 *
 * Nutzt denselben Versandweg wie weekly-report.mjs (execFileSync("msmtp", ["-a", "pipebot",
 * "-t"], ...) über den bereits konfigurierten Hostinger-SMTP-Account "pipebot") statt eines
 * neuen Dritt-Dienstes/Accounts - Recherche vor dem Bauen ergab, dass ein funktionierender
 * Versandweg bereits existiert (weekly-report.mjs verschickt darüber seit Längerem echte
 * Wochenreports), nur eben bisher ausschließlich an Paul selbst.
 *
 * DRY-RUN: mit PANEL_MAIL_DRY_RUN=1 wird NICHTS wirklich verschickt, nur geloggt - für
 * Test-Läufe/Staging in dieser Sitzung (Regel 3: keine echten Mails an echte Kundenadressen).
 * In Produktion bleibt diese Variable ungesetzt, Versand funktioniert dann wie gewohnt.
 */
import { execFileSync } from "node:child_process";

const MAIL_TIMEOUT_MS = Number(process.env.PANEL_MAIL_TIMEOUT_MS ?? 20_000);
const FROM = "Pipeflow <office@pipebot.at>";

export interface MailInput {
  to: string;
  subject: string;
  text: string;
}

function isDryRun(): boolean {
  return process.env.PANEL_MAIL_DRY_RUN === "1";
}

/**
 * Fire-and-forget von der Absicht her, aber nicht async/nebenläufig wie routine-trigger.ts - der
 * Versand selbst ist synchron (execFileSync, wie im Vorbild), Aufrufer entscheiden selbst, ob sie
 * einen Fehlschlag den Nutzer spüren lassen wollen (meistens nein: siehe sendMailBestEffort).
 */
export function sendMail(input: MailInput): void {
  if (isDryRun()) {
    console.log(`[panel] Mail (DRY RUN, nicht wirklich verschickt) an ${input.to}: "${input.subject}"`);
    return;
  }
  const message =
    `From: ${FROM}\n` +
    `To: ${input.to}\n` +
    `Subject: ${input.subject}\n` +
    `Content-Type: text/plain; charset=UTF-8\n\n${input.text}`;
  // Ohne Zeitgrenze blockiert ein haengender SMTP-Server den GESAMTEN Node-Prozess: execFileSync
  // haelt die Ereignisschleife an, das Panel antwortet dann fuer ALLE Kunden nicht mehr und die
  // stuendliche Routine steht still. 20 Sekunden sind grosszuegig fuer eine Zustellung an den
  // lokalen msmtp und begrenzen den Schaden auf genau diesen einen Versand.
  execFileSync("msmtp", ["-a", "pipebot", "-t"], { input: message, timeout: MAIL_TIMEOUT_MS, killSignal: "SIGKILL" });
}

/** Wie sendMail, aber schluckt Fehler (geloggt, nie geworfen) - für Stellen, an denen ein
 *  fehlgeschlagener Mail-Versand die eigentliche Nutzer-Aktion (Signup, Freigabe, ...) nicht
 *  kaputt machen darf. Das Gegenstück zu routine-trigger.ts's Fire-and-forget-Prinzip. */
export function sendMailBestEffort(input: MailInput): void {
  try {
    sendMail(input);
  } catch (err) {
    console.error(`[panel] Mail-Versand an ${input.to} fehlgeschlagen ("${input.subject}"):`, err instanceof Error ? err.message : err);
  }
}
