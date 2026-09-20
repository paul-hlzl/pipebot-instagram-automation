/**
 * Die Zeitrechnung der Wochenplanung (20.09.2026) - ohne Server, ohne KI, ohne Kosten.
 *   npm run test:planweite
 *
 * Geprueft wird genau das, was beim Umbau leicht falsch wird: dass die Planweite im Lauf der
 * Woche NICHT schrumpft (sie endet Montag bis Samstag auf demselben Sonntag), dass sie am
 * Sonntag auf 14 Tage springt, und dass der Wochenlauf ueber die Zeitumstellung hinweg um
 * 18:00 Wiener Wandzeit bleibt statt um eine Stunde zu verrutschen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { erstPlanungEnde, nextViennaWeekly, planWindowEnd, viennaWeekday } from "../src/panel/schedule.js";

/** Wiener Wandzeit -> UTC-Instant, grob: im September gilt UTC+2, Ende Oktober UTC+1. */
const wien = (iso: string) => new Date(iso);

test("Sonntag: die Weite reicht 14 Tage, bis zum uebernaechsten Sonntag", () => {
  assert.equal(planWindowEnd(wien("2026-09-20T16:00:00Z")), "2026-10-04"); // So 18:00 Wien
});

test("Montag bis Samstag enden alle auf demselben Sonntag - die Vorschau schrumpft nicht auf einen Tag", () => {
  for (const tag of ["2026-09-21T08:00:00Z", "2026-09-23T08:00:00Z", "2026-09-25T08:00:00Z", "2026-09-26T08:00:00Z"]) {
    assert.equal(planWindowEnd(wien(tag)), "2026-10-04", tag);
  }
});

test("gerechnet wird nach dem Wiener Kalendertag, nicht nach UTC", () => {
  // 22:30 UTC am Samstag ist in Wien schon Sonntag 00:30 - die Weite springt also mit.
  assert.equal(planWindowEnd(wien("2026-09-26T22:30:00Z")), "2026-10-11");
});

test("der Sprung passiert am Sonntag, nicht mitten in der Woche", () => {
  assert.equal(planWindowEnd(wien("2026-09-26T08:00:00Z")), "2026-10-04"); // Sa
  assert.equal(planWindowEnd(wien("2026-09-27T08:00:00Z")), "2026-10-11"); // So
});

test("die Weite ist nie kuerzer als acht und nie laenger als 14 Tage", () => {
  for (let i = 0; i < 40; i++) {
    const jetzt = new Date(Date.UTC(2026, 8, 20, 10, 0, 0) + i * 86_400_000);
    const heute = jetzt.toISOString().slice(0, 10);
    const tage = Math.round((Date.parse(planWindowEnd(jetzt)) - Date.parse(heute)) / 86_400_000);
    assert.ok(tage >= 8 && tage <= 14, `${heute}: ${tage} Tage`);
  }
});

test("die Erst-Planung beim Anmelden bleibt bei sieben Tagen", () => {
  assert.equal(erstPlanungEnde(wien("2026-09-23T08:00:00Z")), "2026-09-29");
});

test("Wochenlauf: Sonntag 18:00 Wien ist im Sommer 16:00 UTC", () => {
  const ziel = nextViennaWeekly(0, 18, 0, wien("2026-09-20T10:00:00Z")); // So 12:00 Wien
  assert.equal(ziel.toISOString(), "2026-09-20T16:00:00.000Z");
});

test("Wochenlauf: nach 18:00 zaehlt der naechste Sonntag, nicht heute", () => {
  const ziel = nextViennaWeekly(0, 18, 0, wien("2026-09-20T16:30:00Z")); // So 18:30 Wien
  assert.equal(ziel.toISOString(), "2026-09-27T16:00:00.000Z");
});

test("Wochenlauf: nach der Zeitumstellung bleibt es 18:00 Wiener Zeit (17:00 UTC)", () => {
  const ziel = nextViennaWeekly(0, 18, 0, wien("2026-10-20T10:00:00Z")); // Di vor der Umstellung
  assert.equal(ziel.toISOString(), "2026-10-25T17:00:00.000Z");
});

test("viennaWeekday zaehlt Sonntag als 0", () => {
  assert.equal(viennaWeekday(wien("2026-09-20T10:00:00Z")), 0);
  assert.equal(viennaWeekday(wien("2026-09-21T10:00:00Z")), 1);
});
