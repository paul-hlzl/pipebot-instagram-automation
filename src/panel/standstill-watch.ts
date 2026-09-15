/**
 * Stillstands-Wache.
 *
 * Der ganze Wert des Produkts ist "es läuft von selbst". Der gefährlichste Fehlerzustand ist
 * deshalb nicht ein Fehler, sondern Stille: ein Kunde, für den seit Tagen nichts veröffentlicht
 * wurde, obwohl sein Zeitplan es vorsah. Bisher wäre das niemandem aufgefallen - weder eine
 * E-Mail noch ein Log-Eintrag hätte darauf hingewiesen, weil "nichts passiert" kein Ereignis ist.
 *
 * Diese Wache läuft einmal täglich, prüft jeden aktiven Kunden und meldet an Paul (nicht an den
 * Kunden), wenn ein Kunde länger als STILLSTAND_STUNDEN nichts veröffentlicht hat, obwohl er
 * einen Kanal verbunden, einen Wochenplan gesetzt und nicht pausiert hat. Höchstens eine Meldung
 * je Kunde und Stillstands-Phase - eine wiederkehrende Mail wäre schnell Rauschen und würde
 * genauso ignoriert wie die Stille davor.
 */
import { db, nowIso, type CustomerRow } from "./db.js";
import { sendMailBestEffort } from "./mailer.js";
import { isTrialExpired } from "./credentials.js";

const STILLSTAND_STUNDEN = Number(process.env.PANEL_STANDSTILL_HOURS ?? 48);
const PRUEF_INTERVALL_MS = Number(process.env.PANEL_STANDSTILL_INTERVAL_MS ?? 24 * 3_600_000);

/** Standard ist dieselbe Adresse, an die schon der Health-Check seine Alarme schickt
 *  (/root/scripts/health-check.sh) - damit die Wache ohne zusaetzliche Konfiguration wirkt.
 *  Mit PANEL_ALERT_EMAIL umstellbar. */
function empfaenger(): string {
  return process.env.PANEL_ALERT_EMAIL ?? "office@pipebot.at";
}

/** Ein Kunde zählt nur als "sollte veröffentlichen", wenn wirklich alles dafür steht. */
function sollteVeroeffentlichen(c: CustomerRow): boolean {
  if (c.status !== "active") return false;
  if (isTrialExpired({ trialEndsAt: c.trial_ends_at })) return false;
  if (!c.email_verified) return false;
  const heute = new Date().toISOString().slice(0, 10);
  if (c.pause_from && c.pause_until && c.pause_from <= heute && heute <= c.pause_until) return false;
  const tage = (c.instagram_weekdays || c.linkedin_weekdays || c.active_weekdays || "").trim();
  if (!tage) return false;
  const verbindungen = db.prepare("SELECT COUNT(*) as n FROM connections WHERE customer_id = ?").get(c.id) as { n: number };
  return verbindungen.n > 0;
}

export function runStandstillCheck(): { geprueft: number; auffaellig: number; gemeldet: number } {
  const kunden = db.prepare("SELECT * FROM customers WHERE status = 'active'").all() as CustomerRow[];
  const grenze = Date.now() - STILLSTAND_STUNDEN * 3_600_000;
  let auffaellig = 0;
  let gemeldet = 0;

  for (const c of kunden) {
    if (!sollteVeroeffentlichen(c)) continue;
    const letzter = db
      .prepare("SELECT MAX(posted_at) as zuletzt FROM posts WHERE customer_id = ?")
      .get(c.id) as { zuletzt: string | null };
    // Kein einziger Beitrag: erst ab dem Zeitpunkt zählen, ab dem der Kunde eingerichtet ist -
    // ein frisch angelegtes Konto ohne Beitrag ist kein Stillstand, sondern normal.
    const referenz = letzter.zuletzt ?? c.created_at;
    if (new Date(referenz).getTime() > grenze) continue;

    auffaellig++;
    const stunden = Math.round((Date.now() - new Date(referenz).getTime()) / 3_600_000);
    // Guard gegen Mail-Wiederholung: pro Stillstands-Phase genau eine Meldung.
    if (c.standstill_alert_sent_at && new Date(c.standstill_alert_sent_at).getTime() > new Date(referenz).getTime()) continue;

    const to = empfaenger();
    if (to) {
      sendMailBestEffort({
        to,
        subject: `[Pipeflow] Stillstand: ${c.company} seit ${stunden} Stunden ohne Beitrag`,
        text:
          `Für ${c.company} (${c.email}) wurde seit ${stunden} Stunden nichts veröffentlicht, ` +
          `obwohl ein Kanal verbunden ist, ein Wochenplan gesetzt ist und keine Pause läuft.\n\n` +
          `Letzter Beitrag bzw. Kontoanlage: ${referenz}\n` +
          `Kunden-id: ${c.id}\n\n` +
          `Bitte im Admin nachsehen: Verbindung abgelaufen? Routine gestoppt? Fehler im Log?\n` +
          `Diese Meldung kommt einmal je Stillstands-Phase, nicht täglich.`,
      });
      gemeldet++;
    }
    db.prepare("UPDATE customers SET standstill_alert_sent_at = ? WHERE id = ?").run(nowIso(), c.id);
    console.error(`[stillstand] ${c.id} (${c.company}): seit ${stunden}h ohne Beitrag${to ? ", Meldung verschickt" : ", KEIN Empfänger konfiguriert (PANEL_ALERT_EMAIL)"}`);
  }

  return { geprueft: kunden.length, auffaellig, gemeldet };
}

export function startStandstillWatch(intervalMs = PRUEF_INTERVALL_MS): NodeJS.Timeout {
  const run = () => {
    try {
      const r = runStandstillCheck();
      if (r.auffaellig) console.error("[panel] Stillstands-Wache:", r);
    } catch (err) {
      console.error("[panel] Stillstands-Wache fehlgeschlagen:", err instanceof Error ? err.message : err);
    }
  };
  setTimeout(run, 5 * 60_000);
  return setInterval(run, intervalMs);
}
