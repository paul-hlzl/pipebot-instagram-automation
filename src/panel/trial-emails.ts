/**
 * Panel v6 Aufgabe 4c: "Ihr Probezeitraum endet in 2 Tagen" - einmalig, nicht wiederholt
 * (trial_ending_email_sent_at ist der Guard, wie approval_email_sent_at/
 * first_post_email_sent_at in credentials.ts). Eigener taeglicher Check, unabhaengig von
 * planning.ts's Vorausplanung, damit ein Fehler in der einen Aufgabe die andere nie mitreisst.
 */
import { db, nowIso, type CustomerRow } from "./db.js";
import { trialDaysLeft } from "./credentials.js";
import { sendMailBestEffort } from "./mailer.js";
import { trialEndingEmail } from "./emails.js";

export interface TrialEndingCheckSummary {
  checked: number;
  sent: number;
}

/** Exported for a possible future admin-triggered manual run - the schedule below is the only caller today. */
export function checkTrialEndingSoon(): TrialEndingCheckSummary {
  let checked = 0;
  let sent = 0;
  const rows = db
    .prepare("SELECT * FROM customers WHERE status = 'active' AND trial_ends_at IS NOT NULL AND trial_ending_email_sent_at IS NULL")
    .all() as CustomerRow[];
  for (const row of rows) {
    checked++;
    if (trialDaysLeft(row.trial_ends_at) !== 2) continue;
    const result = db
      .prepare("UPDATE customers SET trial_ending_email_sent_at = ? WHERE id = ? AND trial_ending_email_sent_at IS NULL")
      .run(nowIso(), row.id);
    if (result.changes === 0) continue; // gerade von einem parallelen Lauf beansprucht
    sendMailBestEffort(trialEndingEmail({ to: row.email, company: row.company }));
    sent++;
  }
  return { checked, sent };
}

/** Mirrors planning.ts's msUntilNextUtcHour - deliberately not shared/exported from there, this
 *  stays a tiny, independent helper so a change to planning.ts's scheduling can never accidentally
 *  affect this one. */
function msUntilNextUtcHour(hourUtc: number): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/** Default 04:00 UTC - one hour after planning.ts's 03:00 run, still clear of the
 *  14:30-15:45 UTC blackout and every hourly Kunden-Loop tick. */
export function startTrialEndingEmailSchedule(hourUtc = 4): NodeJS.Timeout {
  const run = () => {
    try {
      console.log("[panel] Trial-Ende-Mail-Check:", checkTrialEndingSoon());
    } catch (err) {
      console.error("[panel] Trial-Ende-Mail-Check unerwartet fehlgeschlagen:", err);
    }
  };
  return setTimeout(() => {
    run();
    setInterval(run, 24 * 3_600_000);
  }, msUntilNextUtcHour(hourUtc));
}
