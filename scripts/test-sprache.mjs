/**
 * Sprachwache (Auftrag 19.09.2026). Kein Beitrag darf in fremder Schrift oder in der falschen
 * Sprache entstehen. Reine Logik, ohne Server und ohne KI-Kosten.
 *   node scripts/test-sprache.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fremdeSchrift, sprachFehler, websiteSprache } from "../dist/panel/sprache.js";

test("genau der Fall, der aufgetreten ist", () => {
  // "Система красоты" stand bei channoine-mayr.at im Bild und in der Caption.
  assert.equal(fremdeSchrift("Система красоты"), "kyrillisch");
  assert.ok(sprachFehler("Система красоты", "de"));
  assert.match(sprachFehler("Система красоты", "de"), /kyrillisch/);
});

test("ein einziges fremdes Zeichen genuegt", () => {
  // Gemischte Texte sind der gefaehrlichere Fall: sie sehen auf den ersten Blick richtig aus.
  assert.ok(sprachFehler("Deine Haut verdient Pflege – красота", "de"));
  assert.ok(sprachFehler("Schönheit mit Σύστημα", "de"));
});

test("alle Schriftsysteme, die wir abfangen", () => {
  const faelle = [["kyrillisch", "Привет"], ["griechisch", "Καλημέρα"], ["hebräisch", "שלום"],
    ["arabisch", "مرحبا"], ["chinesisch/japanisch", "美容"], ["koreanisch", "안녕"],
    ["thailändisch", "สวัสดี"], ["devanagari", "नमस्ते"]];
  for (const [name, text] of faelle) assert.equal(fremdeSchrift(text), name, text);
});

test("deutsche Beitraege gehen durch, auch mit Umlauten und Emojis", () => {
  assert.equal(sprachFehler("Deine Haut verdient Wissenschaft ✨ Die richtige Reihenfolge deiner Gesichtspflege ist der Schlüssel zum Erfolg für schöne Haut.", "de"), null);
  assert.equal(fremdeSchrift("Grüße aus Österreich – schön, dass du da bist! 💫"), null);
});

test("ein englischer Slogan macht einen deutschen Beitrag nicht kaputt", () => {
  // Sonst wuerde die Wache staendig grundlos ausloesen.
  const text = "Unsere neue Pflegelinie ist da und wir freuen uns sehr darüber. Das Motto lautet: Beauty with purpose. Schau bei uns vorbei und lass dich beraten.";
  assert.equal(sprachFehler(text, "de"), null);
});

test("ein wirklich englischer Beitrag auf einer deutschen Website faellt auf", () => {
  const text = "Your skin deserves the best care and we are here for you. This is what our team does every day with all the products that we have for you.";
  const f = sprachFehler(text, "de");
  assert.ok(f, "haette auffallen muessen");
  assert.match(f, /englisch/);
});

test("kurze Texte werden nicht nach Sprache beurteilt, nur nach Schrift", () => {
  // Bei drei Woertern ist jede Statistik Zufall - fremde Schrift schlaegt trotzdem an.
  assert.equal(sprachFehler("Your skin today", "de"), null);
  assert.ok(sprachFehler("Ваша кожа", "de"));
});

test("Sprache der Website wird aus dem lang-Attribut gelesen", () => {
  assert.equal(websiteSprache('<html lang="de-AT">', "egal"), "de");
  assert.equal(websiteSprache('<html lang="en-GB">', "egal"), "en");
});

test("ohne lang-Attribut entscheidet der Text, im Zweifel Deutsch", () => {
  assert.equal(websiteSprache("<html>", "Wir sind ein Betrieb aus Linz und bieten Pflege für die Haut mit viel Erfahrung und Herz für unsere Kunden"), "de");
  assert.equal(websiteSprache("<html>", "We are a studio from London and we offer the best care for your skin with all that you need from our team"), "en");
  assert.equal(websiteSprache("<html>", ""), "de");
});
