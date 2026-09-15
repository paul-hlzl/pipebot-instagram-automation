#!/usr/bin/env node
/**
 * Prüft die Teile der Google-Bewertungs-Automatisierung, die sich OHNE Google prüfen lassen:
 * die Auswertung des Moderationsstatus (isReplyRejected/policyViolationText) und das Verhalten
 * des Cron-Laufs, wenn kein Kunde verbunden/eingeschaltet ist.
 *
 * Bewusst KEIN echter Aufruf an Google - das ginge ohnehin erst nach der Zugangsfreigabe (siehe
 * docs/GOOGLE_BUSINESS_PROFILE_API.md). Läuft gegen eine eigene Wegwerf-Datenbank, nie gegen
 * Produktion oder Staging: PANEL_DB_PATH wird hier gesetzt, bevor irgendetwas importiert wird.
 *
 * Aufruf: npm run test:reviews
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeflow-reviews-test-"));
process.env.PANEL_DB_PATH = path.join(tmpDir, "reviews-test.db");
process.env.PANEL_ENCRYPTION_KEY = process.env.PANEL_ENCRYPTION_KEY ?? "0".repeat(64);
process.env.PANEL_MAIL_DRY_RUN = "1";

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok - ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` (${detail})` : ""}`);
    console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const { isReplyRejected, policyViolationText } = await import("../dist/google-business.js");
const { db, nowIso } = await import("../dist/panel/db.js");
const { listPendingReviewApprovals, rejectReviewReply, reviewStatsForCustomer, runReviewAutomationPass } = await import("../dist/panel/reviews.js");

console.log("Moderationsstatus (Googles Antwort-Prüfung):");
{
  ok("keine Antwort -> nicht abgelehnt", isReplyRejected(null) === false);
  ok("Antwort ohne Statusfelder -> nicht abgelehnt (fail-open)", isReplyRejected({ comment: "Danke!", updateTime: null, reviewReplyState: null, policyViolation: null }) === false);
  ok("Status PUBLISHED -> nicht abgelehnt", isReplyRejected({ comment: "x", updateTime: null, reviewReplyState: "PUBLISHED", policyViolation: null }) === false);
  ok("Status REJECTED -> abgelehnt", isReplyRejected({ comment: "x", updateTime: null, reviewReplyState: "REJECTED", policyViolation: null }) === true);
  ok(
    "unbekannte Schreibweise mit REJECT -> abgelehnt",
    isReplyRejected({ comment: "x", updateTime: null, reviewReplyState: "reply_rejected_by_policy", policyViolation: null }) === true,
  );
  ok(
    "policyViolation allein reicht -> abgelehnt",
    isReplyRejected({ comment: "x", updateTime: null, reviewReplyState: null, policyViolation: { policy: "OFF_TOPIC" } }) === true,
  );
  ok(
    "leerer policyViolation-Block loest NICHT aus",
    isReplyRejected({ comment: "x", updateTime: null, reviewReplyState: "PUBLISHED", policyViolation: {} }) === false,
  );
  ok(
    "Begründung wird lesbar gemacht",
    (policyViolationText({ comment: "x", updateTime: null, reviewReplyState: "REJECTED", policyViolation: { policy: "OFF_TOPIC" } }) ?? "").includes("OFF_TOPIC"),
  );
  ok(
    "ohne policyViolation faellt die Begründung auf den Status zurück",
    policyViolationText({ comment: "x", updateTime: null, reviewReplyState: "REJECTED", policyViolation: null }) === "REJECTED",
  );
}

console.log("\nCron-Lauf ohne verbundene Kunden:");
{
  const summary = await runReviewAutomationPass();
  ok("leere Datenbank -> kein Kunde geprüft", summary.customersChecked === 0, JSON.stringify(summary));
  ok("keine Fehler", summary.errors === 0, JSON.stringify(summary));
}

console.log("\nEingeschaltet, aber Google nicht verbunden:");
{
  const now = nowIso();
  db.prepare(
    `INSERT INTO customers (id, company, contact_name, email, tone, frequency, post_time, login_key_hash, status, consent_at, created_at, updated_at,
       email_verified, google_review_automation_enabled)
     VALUES ('cus_test', 'Test GmbH', 'Test', 'test@example.invalid', 'sachlich', 'werktags', '15:00', 'hash', 'active', ?, ?, ?, 1, 1)`,
  ).run(now, now, now);

  const summary = await runReviewAutomationPass();
  // Kein Google verbunden heisst: nichts zu tun, aber auch KEIN Fehler - genau wie bei der
  // Kommentar-Automatisierung ohne Instagram-Verbindung.
  ok("Kunde wird geprüft", summary.customersChecked === 1, JSON.stringify(summary));
  ok("ohne Verbindung passiert nichts (kein Fehler)", summary.errors === 0 && summary.answered === 0, JSON.stringify(summary));
}

console.log("\nFreigabe-Warteschlange:");
{
  const now = nowIso();
  db.prepare(
    `INSERT INTO google_reviews (id, review_name, customer_id, location_name, reviewer_name, star_rating, review_text,
       review_created_at, generated_reply, status, reply_state, policy_violation, rejected_notified_at,
       social_post_status, social_post_id, created_at, updated_at)
     VALUES ('grev_1', 'accounts/1/locations/2/reviews/3', 'cus_test', 'accounts/1/locations/2', 'Testkundin', 5,
       'Sehr freundlich und kompetent.', ?, 'Vielen Dank!', 'pending_approval', NULL, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(now, now, now);

  ok("wartender Entwurf taucht auf", listPendingReviewApprovals("cus_test").length === 1);
  ok("fremder Kunde sieht ihn nicht", listPendingReviewApprovals("cus_fremd").length === 0);

  const rejected = rejectReviewReply("cus_test", "grev_1");
  ok("Ablehnen setzt den Status", rejected?.status === "rejected", JSON.stringify(rejected?.status));
  ok("danach wartet nichts mehr", listPendingReviewApprovals("cus_test").length === 0);
  ok("zweimal Ablehnen liefert null statt zu werfen", rejectReviewReply("cus_test", "grev_1") === null);
  ok("fremder Kunde kann nicht ablehnen", rejectReviewReply("cus_fremd", "grev_1") === null);

  const stats = reviewStatsForCustomer("cus_test");
  ok("Statistik zählt die Ablehnung", stats.rejected === 1, JSON.stringify(stats));
  ok("Statistik zählt keine Beiträge", stats.posts === 0, JSON.stringify(stats));
}

db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFehlgeschlagen:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
