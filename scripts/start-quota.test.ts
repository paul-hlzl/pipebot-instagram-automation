/**
 * Reine Entscheidungslogik des Kostenschutzes (start-quota.ts) - ohne Server, ohne DB.
 *   npm run test:start-quota
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePreviewQuota, limitsAusgeschaltet, normalizeDomain, quotaText, zeitSatz, type PreviewLimits } from "../src/panel/start-quota.js";

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

/**
 * Der Kern der Sandbox-Abschaltung: sie haengt an EINER Bedingung, und die ist in Produktion
 * nie erfuellt. Diese vier Faelle sind die eigentliche Sicherung gegen ein versehentliches
 * Mitnehmen des Schalters auf Produktion.
 */
test("Deckel sind NUR bei PANEL_SANDBOX=true abgeschaltet", () => {
  const vorher = process.env.PANEL_SANDBOX;
  try {
    delete process.env.PANEL_SANDBOX;
    assert.equal(limitsAusgeschaltet(), false, "ohne PANEL_SANDBOX muss der Deckel greifen");
    process.env.PANEL_SANDBOX = "false";
    assert.equal(limitsAusgeschaltet(), false);
    // Auch ein wohlmeinendes "1" oder "TRUE" zaehlt nicht - nur exakt "true".
    process.env.PANEL_SANDBOX = "1";
    assert.equal(limitsAusgeschaltet(), false);
    process.env.PANEL_SANDBOX = "TRUE";
    assert.equal(limitsAusgeschaltet(), false);
    process.env.PANEL_SANDBOX = "true";
    assert.equal(limitsAusgeschaltet(), true);
  } finally {
    if (vorher === undefined) delete process.env.PANEL_SANDBOX;
    else process.env.PANEL_SANDBOX = vorher;
  }
});

test("Die Grenzen selbst bleiben unveraendert - auch waehrend die Sandbox sie ignoriert", () => {
  const vorher = process.env.PANEL_SANDBOX;
  process.env.PANEL_SANDBOX = "true";
  try {
    // decidePreviewQuota kennt den Sandbox-Schalter GAR NICHT. Es entscheidet weiter wie in
    // Produktion; nur die Aufrufstelle in start-routes.ts fragt vorher, ob sie zuhoeren muss.
    const d = decidePreviewQuota({ ip: 3, domain: 0, global: 0 }, limits);
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, "ip");
  } finally {
    if (vorher === undefined) delete process.env.PANEL_SANDBOX;
    else process.env.PANEL_SANDBOX = vorher;
  }
});

/**
 * Die Texte selbst. Frueher standen diese Pruefungen in scripts/test-start.mjs und liessen sich
 * eine echte 429 vom Server geben. Seit die Sandbox die Deckel ignoriert, kommt dort keine 429
 * mehr - also werden die Texte hier direkt geprueft, wo sie entstehen.
 */
test("Kein Text nennt den \"Anschluss\" und keiner klingt nach Fehler", () => {
  for (const grund of ["global", "ip", "domain", "account"] as const) {
    const t = quotaText(grund);
    assert.doesNotMatch(t, /Anschluss/i, `${grund}: "Anschluss" ist Vorwurfssprache`);
    assert.doesNotMatch(t, /Fehler|fehlgeschlagen|ungültig/i, `${grund}: klingt nach Fehler`);
    assert.ok(t.length > 40, `${grund}: zu knapp, um verstanden zu werden`);
  }
});

test("Der Netzwerk-Text erklaert das gemeinsame WLAN und nennt einen Weg", () => {
  const t = quotaText("ip");
  assert.match(t, /WLAN/);
  assert.match(t, /geht trotzdem sofort durch/);
});

test("Der Domain-Text bietet den Anmeldeweg an", () => {
  assert.match(quotaText("domain"), /Anmelden/);
});

test("Der Konto-Text sagt zu, dass die bestehende Woche bleibt", () => {
  assert.match(quotaText("account"), /Woche bleibt bestehen/);
});
