/**
 * Keine zwei Beitraege einer Woche mit demselben Aufhaenger (Auftrag 19.09.2026, Punkt 1).
 * Prueft die reine Entscheidungslogik - ohne Server, ohne KI, ohne Kosten.
 *   node scripts/test-aufhaenger.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aufhaengerAehnlichkeit, aufhaengerKollision } from "../dist/panel/planning.js";

test("wortgleiche Ueberschriften werden erkannt", () => {
  // Genau der Fall aus dem Lauf vom 19.09.: zwei Beitraege hiessen identisch.
  assert.equal(aufhaengerAehnlichkeit("Energie statt Erschöpfung", "Energie statt Erschöpfung"), 1);
  assert.ok(aufhaengerKollision("Energie statt Erschöpfung", ["Energie statt Erschöpfung"]));
});

test("dieselbe Aussage in neuen Worten wird erkannt", () => {
  assert.ok(aufhaengerKollision("Deine Haut verdient Analyse", ["Deine Haut verdient Perfektion"]));
  assert.ok(aufhaengerKollision("Dein Weg zur Beauty Unternehmerin", ["Dein Weg zu Beauty-Erfolg"]));
});

test("wirklich verschiedene Aufhaenger gehen durch", () => {
  assert.equal(aufhaengerKollision("Energie statt Erschöpfung", ["Deine Haut verdient Analyse"]), null);
  assert.equal(aufhaengerKollision("Hauttyp erkannt, Routine perfekt", ["NOBUSAN im Alltag"]), null);
});

test("Fuellwoerter allein machen noch keine Wiederholung", () => {
  // "Deine" und "mit" sind keine Aussage - sonst waere jede zweite Ueberschrift eine Kollision.
  assert.equal(aufhaengerAehnlichkeit("Deine Haut mit System", "Deine Ruhe mit Plan"), 0);
});

test("hoechstens zwei Ueberschriften duerfen mit demselben Wort beginnen", () => {
  assert.equal(aufhaengerKollision("Deine Ruhe kommt zurück", ["Deine Haut braucht Pflege"]), null);
  const drei = aufhaengerKollision("Deine Ruhe kommt zurück", ["Deine Haut braucht Pflege", "Deine Wahl zählt heute"]);
  assert.ok(drei, "das dritte 'Deine' haette auffallen muessen");
  assert.match(drei, /beginnen mit/);
});

test("leere Liste blockiert nichts", () => {
  assert.equal(aufhaengerKollision("Irgendeine Überschrift", []), null);
});
