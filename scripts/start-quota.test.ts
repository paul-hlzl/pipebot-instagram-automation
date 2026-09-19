/**
 * Reine Entscheidungslogik des Kostenschutzes (start-quota.ts) - ohne Server, ohne DB.
 *   npm run test:start-quota
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePreviewQuota, normalizeDomain, zeitSatz, type PreviewLimits } from "../src/panel/start-quota.js";

const limits: PreviewLimits = { perAccountPerDay: 3, perIpPerDay: 3, perDomainPerDay: 2, globalPerDay: 40, imagesUnverified: 3, adjustUnverified: 1, postsUnverified: 14 };

test("frei, solange alle Zaehler unter den Grenzen liegen", () => {
  assert.deepEqual(decidePreviewQuota({ ip: 2, domain: 1, global: 39 }, limits), { ok: true });
});

test("IP-Grenze greift genau beim Erreichen", () => {
  const d = decidePreviewQuota({ ip: 3, domain: 0, global: 0 }, limits);
  assert.equal(d.ok, false);
  assert.equal(d.ok === false && d.reason, "ip");
});

test("Domain-Grenze greift unabhaengig von der IP", () => {
  const d = decidePreviewQuota({ ip: 0, domain: 2, global: 0 }, limits);
  assert.equal(d.ok === false && d.reason, "domain");
});

test("globale Tagesgrenze schlaegt alles andere", () => {
  const d = decidePreviewQuota({ ip: 0, domain: 0, global: 40 }, limits);
  assert.equal(d.ok === false && d.reason, "global");
  const text = d.ok === false ? d.message : "";
  // Der alte Text versprach "bestaetige deine E-Mail-Adresse, dann geht es sofort weiter" -
  // das war falsch: die globale Grenze gilt auch fuer bestaetigte Konten.
  assert.doesNotMatch(text, /bestätige deine E-Mail/i);
  assert.match(text, /liegt an uns/);
});

test("Freitext-Weg (keine Domain) zaehlt nur pro IP und global", () => {
  assert.deepEqual(decidePreviewQuota({ ip: 0, domain: 0, global: 0 }, limits), { ok: true });
  assert.equal(normalizeDomain(""), "");
  assert.equal(normalizeDomain(null), "");
});

test("Domain wird normalisiert (Schema, www, Pfad, Grossschreibung)", () => {
  assert.equal(normalizeDomain("https://www.Hoelzl-Physio.at/ueber-uns"), "hoelzl-physio.at");
  assert.equal(normalizeDomain("deine-firma.at"), "deine-firma.at");
  assert.equal(normalizeDomain("WWW.EXAMPLE.COM"), "example.com");
});

test("Zeitsatz nennt die echte Uhrzeit, nicht \"morgen frueh\"", () => {
  const jetzt = Date.parse("2026-09-19T10:00:00Z");
  assert.match(zeitSatz("2026-09-19T14:42:00Z", jetzt), /^Ab 16:42 Uhr ist wieder eine frei\.$/);
  assert.match(zeitSatz("2026-09-20T07:15:00Z", jetzt), /^Morgen ab 09:15 Uhr ist wieder eine frei\.$/);
});

test("Zeitsatz bleibt leer, wenn nichts zu nennen ist", () => {
  const jetzt = Date.parse("2026-09-19T10:00:00Z");
  assert.equal(zeitSatz(null, jetzt), "");
  assert.equal(zeitSatz("2026-09-19T09:00:00Z", jetzt), "");
  assert.equal(zeitSatz("kaputt", jetzt), "");
});
