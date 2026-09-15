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

/** Panel v6 Aufgabe 5: neuer persönlicher Zugangslink nach "Zugang verloren?". */
export function accessRecoveryEmail(input: { to: string; company: string; loginUrl: string }): MailInput {
  return {
    to: input.to,
    subject: "Ihr neuer Zugangslink - Pipeflow",
    text:
      `Hallo,\n\n` +
      `hier ist Ihr neuer persönlicher Zugangslink für "${input.company}":\n${input.loginUrl}\n\n` +
      `Der Link ersetzt jeden älteren Zugangslink - falls Sie noch einen gespeichert hatten, funktioniert ` +
      `dieser ab jetzt nicht mehr. Behandeln Sie diesen Link wie ein Passwort.\n\n` +
      `Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail einfach - es passiert nichts, ` +
      `solange Sie den Link nicht selbst öffnen.\n\n` +
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

/** Panel v8 Aufgabe 2: opt-in (notify_on_publish), bei JEDER tatsächlichen Veröffentlichung -
 *  anders als firstPostLiveEmail (immer, nur beim allerersten Post) läuft diese hier bei jedem
 *  einzelnen Beitrag, für Kunden, die das in ihren Einstellungen aktiviert haben. */
export function postPublishedEmail(input: { to: string; company: string; channelLabel: string }): MailInput {
  return {
    to: input.to,
    subject: `Ihr ${input.channelLabel}-Beitrag ist online - Pipeflow`,
    text:
      `Hallo,\n\n` +
      `Ihr ${input.channelLabel}-Beitrag für "${input.company}" ist gerade veröffentlicht worden.\n\n` +
      `Im Panel sehen Sie den Beitrag im Verlauf:\n${panelUrl()}\n\n` +
      `Sie erhalten diese Benachrichtigung, weil Sie das in Ihren Einstellungen aktiviert haben - jederzeit ` +
      `abschaltbar.\n\n` +
      `Ihr Pipeflow-Team\nPipeline AI Solutions`,
  };
}

/**
 * Panel v19: Stale-Content-Sicherheitsnetz (siehe Session-Bericht - Andrea/Physiotherapie-Vorfall,
 * cus_bW0p_HapELUZ). Verschickt sich NUR im Ausnahmefall: ein vorbereiteter Beitrag war veraltet
 * (Firmenname/Branche/Beschreibung/Tonalität haben sich seither geändert) UND die automatische
 * Neu-Generierung ist selbst fehlgeschlagen (z.B. KI-Dienst gerade nicht erreichbar) - der
 * Normalfall (Neu-Generierung gelingt) verschickt gar keine Mail, der Beitrag geht einfach mit
 * frischem Inhalt raus.
 */
export function stalePostSkippedEmail(input: { to: string; company: string; channelLabel: string }): MailInput {
  return {
    to: input.to,
    subject: `Ein vorbereiteter ${input.channelLabel}-Beitrag wurde übersprungen - Pipeflow`,
    text:
      `Hallo,\n\n` +
      `ein für "${input.company}" vorbereiteter ${input.channelLabel}-Beitrag wurde NICHT veröffentlicht, weil er ` +
      `nicht mehr zu Ihren aktuellen Angaben (Firmenname, Branche, Beschreibung oder Tonalität) passte - und die ` +
      `automatische Neu-Generierung mit den neuen Angaben gerade nicht möglich war.\n\n` +
      `Nichts Veraltetes wurde veröffentlicht. Im Panel unter "Die nächsten 7 Tage" können Sie jederzeit einen ` +
      `neuen Beitrag für diesen Platz vorbereiten:\n${panelUrl()}\n\n` +
      `Ihr Pipeflow-Team\nPipeline AI Solutions`,
  };
}

/**
 * Panel v9 Aufgabe 5: wöchentlicher Analytics-Bericht (opt-in, notify_weekly_report - eigener
 * Schalter neben notify_on_publish, siehe styleguide/Session-Bericht). Zahlen + KI-Zusammenfassung
 * kommen fertig vom Aufrufer (runWeeklyAnalyticsSummaries in analytics.ts) - diese Funktion baut
 * nur den Text, wie alle anderen Vorlagen hier.
 */
export function weeklyAnalyticsReportEmail(input: {
  to: string;
  company: string;
  followerCount: number | null;
  followerGrowth7d: number | null;
  reach7d: number;
  reachPrev7d: number;
  views7d: number;
  engagementRate7d: number | null;
  aiSummary: string;
}): MailInput {
  const growth =
    input.followerGrowth7d != null ? `${input.followerGrowth7d >= 0 ? "+" : ""}${input.followerGrowth7d}` : "unbekannt";
  const reachDiff = input.reach7d - input.reachPrev7d;
  const reachTrend = reachDiff > 0 ? `↑ ${reachDiff}` : reachDiff < 0 ? `↓ ${Math.abs(reachDiff)}` : "± 0";
  return {
    to: input.to,
    subject: "📊 Ihr wöchentlicher Instagram-Bericht - Pipeflow",
    text:
      `Hallo,\n\n` +
      `hier ist Ihr wöchentlicher Instagram-Bericht für "${input.company}":\n\n` +
      `Follower: ${input.followerCount ?? "unbekannt"} (letzte 7 Tage: ${growth})\n` +
      `Reichweite: ${input.reach7d} (Vorwoche: ${input.reachPrev7d}, ${reachTrend})\n` +
      `Views: ${input.views7d}\n` +
      `Engagement-Rate: ${input.engagementRate7d != null ? `${input.engagementRate7d}%` : "unbekannt"}\n\n` +
      `Was bedeutet das für Sie?\n${input.aiSummary}\n\n` +
      `Alle Details, den Follower-/Reichweite-Verlauf und Ihre Top-Beiträge sehen Sie im Panel:\n${panelUrl()}\n\n` +
      `Sie erhalten diesen Bericht, weil Sie das in Ihren Einstellungen aktiviert haben - jederzeit abschaltbar.\n\n` +
      `Ihr Pipeflow-Team\nPipeline AI Solutions`,
  };
}

/** Panel v8 Aufgabe 2: opt-in (notify_on_publish, derselbe Schalter wie postPublishedEmail),
 *  sobald bei aktivem approval_mode ein NEUER Beitrag zur Freigabe bereitsteht - unabhängig von
 *  der bestehenden gesammelten Erinnerung (max. 1x/Tag, pendingApprovalsSummaryEmail oben), die
 *  unverändert weiterläuft. Dies hier ist der sofortige Einzel-Hinweis pro neuem Beitrag. */
export function approvalNeededEmail(input: { to: string; company: string; channelLabel: string }): MailInput {
  return {
    to: input.to,
    subject: `Bitte geben Sie Ihren ${input.channelLabel}-Beitrag frei - Pipeflow`,
    text:
      `Hallo,\n\n` +
      `für "${input.company}" liegt ein neuer ${input.channelLabel}-Beitrag bereit. Sie müssen ihn noch ` +
      `freigeben, bevor er veröffentlicht wird.\n\n` +
      `Jetzt ansehen und freigeben:\n${panelUrl()}\n\n` +
      `Sie erhalten diese Benachrichtigung, weil Sie das in Ihren Einstellungen aktiviert haben - jederzeit ` +
      `abschaltbar.\n\n` +
      `Ihr Pipeflow-Team\nPipeline AI Solutions`,
  };
}
