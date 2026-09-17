/**
 * Test der Rückzugs-Logik (src/panel/backoff.ts) und der Sperr-Erkennung
 * (src/panel/connection-block.ts, nur die reine Funktion detectPlatformBlock).
 *
 * Läuft ohne Datenbank, ohne .env und ohne Netz - beide getesteten Teile sind bewusst frei von
 * Seiteneffekten. Dadurch ist dieser Test auch auf einem Rechner ausführbar, der keinen Zugang
 * zur Produktion hat.
 *
 *   npm run test:backoff
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  PAUSE_AFTER_FAILURES,
  PAUSE_MS,
  backoffDelayMs,
  classifyFailure,
  formatDelay,
  isPaused,
  mayAttempt,
  nextAttemptAt,
} from "../src/panel/backoff.js";
import { detectPlatformBlock } from "../src/panel/platform-blocks.js";

const STUNDE = 3_600_000;

test("classifyFailure: 4xx ist dauerhaft, alles andere vorübergehend", () => {
  // Der auslösende Fall: HTTP 400 auf eine tote Medien-ID.
  assert.equal(classifyFailure(400), "dauerhaft");
  assert.equal(classifyFailure(403), "dauerhaft");
  assert.equal(classifyFailure(404), "dauerhaft");

  // Drosselung und Serverfehler sagen nichts über die Medien-ID aus.
  assert.equal(classifyFailure(429), "voruebergehend");
  assert.equal(classifyFailure(500), "voruebergehend");
  assert.equal(classifyFailure(503), "voruebergehend");

  // Keine Antwort erhalten (Netzfehler, Zeitüberschreitung).
  assert.equal(classifyFailure(undefined), "voruebergehend");
});

test("die ersten drei Fehlschläge werden nicht gebremst", () => {
  assert.equal(backoffDelayMs(0), 0);
  assert.equal(backoffDelayMs(1), 0);
  assert.equal(backoffDelayMs(2), 0);
});

test("ab dem dritten Fehlschlag verdoppelt sich der Abstand", () => {
  assert.equal(backoffDelayMs(3), 1 * STUNDE);
  assert.equal(backoffDelayMs(4), 2 * STUNDE);
  assert.equal(backoffDelayMs(5), 4 * STUNDE);
  assert.equal(backoffDelayMs(6), 8 * STUNDE);
  assert.equal(backoffDelayMs(7), 16 * STUNDE);
  assert.equal(backoffDelayMs(3), BACKOFF_BASE_MS);
});

test("der Abstand ist bei 24 Stunden gedeckelt", () => {
  // 2^5 * 1h = 32h wäre der rechnerische Wert - gedeckelt auf 24h.
  assert.equal(backoffDelayMs(8), BACKOFF_MAX_MS);
  assert.equal(backoffDelayMs(9), BACKOFF_MAX_MS);
  assert.equal(BACKOFF_MAX_MS, 24 * STUNDE);
});

test("ab dem zehnten Fehlschlag gilt die 7-Tage-Pause", () => {
  assert.equal(PAUSE_AFTER_FAILURES, 10);
  assert.equal(isPaused(9), false);
  assert.equal(isPaused(10), true);
  assert.equal(isPaused(25), true);
  assert.equal(backoffDelayMs(10), PAUSE_MS);
  assert.equal(backoffDelayMs(99), PAUSE_MS);
  assert.equal(PAUSE_MS, 7 * 24 * STUNDE);
});

test("der Abstand wächst nie rückwärts", () => {
  let vorher = -1;
  for (let n = 0; n <= PAUSE_AFTER_FAILURES; n++) {
    const jetzt = backoffDelayMs(n);
    assert.ok(jetzt >= vorher, `Abstand bei ${n} Fehlschlägen (${jetzt}) kleiner als bei ${n - 1} (${vorher})`);
    vorher = jetzt;
  }
});

test("nextAttemptAt rechnet vom übergebenen Zeitpunkt aus", () => {
  const jetzt = Date.parse("2026-09-17T06:00:00.000Z");
  assert.equal(nextAttemptAt(2, jetzt), "2026-09-17T06:00:00.000Z"); // kein Abstand
  assert.equal(nextAttemptAt(3, jetzt), "2026-09-17T07:00:00.000Z"); // +1h
  assert.equal(nextAttemptAt(10, jetzt), "2026-09-24T06:00:00.000Z"); // +7 Tage
});

test("mayAttempt lässt vor Ablauf nicht durch, danach schon", () => {
  const jetzt = Date.parse("2026-09-17T06:00:00.000Z");
  assert.equal(mayAttempt("2026-09-17T07:00:00.000Z", jetzt), false);
  assert.equal(mayAttempt("2026-09-17T06:00:00.000Z", jetzt), true); // exakt fällig
  assert.equal(mayAttempt("2026-09-17T05:59:59.000Z", jetzt), true);
});

test("mayAttempt sperrt niemals dauerhaft aus, wenn der gespeicherte Wert unbrauchbar ist", () => {
  // Ein kaputter oder fehlender Datensatz darf einen Kunden nie stilllegen.
  assert.equal(mayAttempt(null), true);
  assert.equal(mayAttempt(undefined), true);
  assert.equal(mayAttempt(""), true);
  assert.equal(mayAttempt("kein Datum"), true);
});

test("der vollständige Ablauf einer dauerhaft toten Medien-ID", () => {
  // Bildet nach, was comment-backoff.ts tut: zählen, Abstand rechnen, irgendwann pausieren.
  const start = Date.parse("2026-09-17T00:00:00.000Z");
  let failures = 0;
  let retryAfter: string | null = null;
  let versuche = 0;
  let jetzt = start;

  // Zwei Wochen simulieren, Cron-Takt 45 Minuten (wie in der Produktion).
  const ende = start + 14 * 24 * STUNDE;
  while (jetzt < ende) {
    if (mayAttempt(retryAfter, jetzt)) {
      versuche++;
      failures++;
      retryAfter = nextAttemptAt(failures, jetzt);
    }
    jetzt += 45 * 60_000;
  }

  // Vorher: 45-Minuten-Takt über 14 Tage = 448 Versuche und ebenso viele Fehlerzeilen.
  // Nachher: eine gute Handvoll, danach ruht die ID.
  assert.ok(versuche <= 12, `zu viele Versuche: ${versuche}`);
  assert.ok(isPaused(failures), "die ID müsste nach 14 Tagen pausiert sein");
  assert.ok(versuche < 448 / 30, `kaum eine Verbesserung: ${versuche} statt 448`);
});

test("ein einzelner Aussetzer bremst nichts, wenn danach Erfolg kommt", () => {
  // Nach Erfolg löscht comment-backoff.ts die Zeile - der Zähler beginnt wieder bei 0.
  assert.equal(backoffDelayMs(1), 0);
  assert.equal(backoffDelayMs(0), 0); // Zustand nach dem Löschen
});

test("formatDelay schreibt lesbare Abstände", () => {
  assert.equal(formatDelay(0), "sofort");
  assert.equal(formatDelay(45 * 60_000), "45 Min");
  assert.equal(formatDelay(1 * STUNDE), "1 Std");
  assert.equal(formatDelay(24 * STUNDE), "24 Std");
  assert.equal(formatDelay(7 * 24 * STUNDE), "7 Tage");
});

test("detectPlatformBlock erkennt die LinkedIn-Kontosperre", () => {
  // Wortlaut aus dem Produktions-Log vom 16.09.2026.
  const echt = new Error(
    'LinkedIn Image-Init fehlgeschlagen (401): {"status":401,"serviceErrorCode":65608,"code":"RESTRICTED_MEMBER","message":"Member is restricted"}',
  );
  const block = detectPlatformBlock(echt);
  assert.equal(block?.code, "RESTRICTED_MEMBER");
  assert.match(block?.reason ?? "", /LinkedIn/);
});

test("detectPlatformBlock erkennt die Instagram-Einschränkung", () => {
  // Wortlaut aus dem Produktions-Log vom 16.09.2026.
  const echt = new Error(
    "Instagram Graph API Fehler: We restrict certain activity to protect our community. Tell us if you think we made a mistake. code=4 subcode=2207051",
  );
  const block = detectPlatformBlock(echt);
  assert.equal(block?.code, "IG_RESTRICTED_ACTIVITY");
  assert.match(block?.reason ?? "", /Instagram/);
});

test("detectPlatformBlock schlägt bei gewöhnlichen Fehlern nicht an", () => {
  // Wichtig: eine abgelaufene API-Version oder ein Bildfehler darf keine Verbindung sperren.
  assert.equal(detectPlatformBlock(new Error('{"status":426,"code":"NONEXISTENT_VERSION"}')), null);
  assert.equal(detectPlatformBlock(new Error("Request failed with status code 400")), null);
  assert.equal(detectPlatformBlock(new Error("Das Bild wurde von Instagram abgelehnt")), null);
  assert.equal(detectPlatformBlock(null), null);
  assert.equal(detectPlatformBlock(undefined), null);
  assert.equal(detectPlatformBlock(new Error("")), null);
});
