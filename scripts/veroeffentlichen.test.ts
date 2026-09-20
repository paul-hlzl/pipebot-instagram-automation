/**
 * Genau einmal veroeffentlichen (20.09.2026) - der Kern des Doppelpost-Vorfalls.
 *   npm run test:veroeffentlichen
 *
 * Am 20.09. gingen zwei identische Beitraege in den Feed eines echten Kunden: Container anlegen,
 * warten und veroeffentlichen steckten zusammen in einer Wiederholung, Instagram antwortete auf
 * `media_publish` mit 403 und hatte trotzdem veroeffentlicht - der zweite Versuch postete noch
 * einmal. Hier wird mit Attrappen bewiesen, dass genau das nicht mehr passieren kann. Kostet
 * nichts und ruft nichts Echtes auf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { veroeffentlicheEinmal } from "../src/instagram.js";

const fehler403 = () => Object.assign(new Error("Request failed with status code 403"), { status: 403 });

test("der glatte Fall: einmal vorbereiten, einmal posten, kein Nachsehen", async () => {
  let vorbereitet = 0, gepostet = 0, nachgesehen = 0;
  const r = await veroeffentlicheEinmal({
    vorbereiten: async () => { vorbereitet++; return "container_1"; },
    posten: async () => { gepostet++; return "post_1"; },
    nachsehen: async () => { nachgesehen++; return null; },
    label: "Test",
  });
  assert.deepEqual(r, { postId: "post_1", containerId: "container_1", nachtraeglichGefunden: false });
  assert.equal(vorbereitet, 1);
  assert.equal(gepostet, 1);
  assert.equal(nachgesehen, 0, "ohne Fehler wird nicht nachgesehen");
});

test("DER VORFALL: Fehlerantwort, aber der Beitrag ist draussen - kein zweiter Versuch", async () => {
  let gepostet = 0;
  const r = await veroeffentlicheEinmal({
    vorbereiten: async () => "container_1",
    posten: async () => { gepostet++; throw fehler403(); },
    nachsehen: async () => "post_echt",
    label: "Test",
  });
  assert.equal(gepostet, 1, "media_publish darf genau einmal laufen");
  assert.equal(r.postId, "post_echt", "die gefundene Beitrags-ID wird gemeldet, damit sie protokolliert wird");
  assert.equal(r.nachtraeglichGefunden, true);
});

test("Fehler und nichts gefunden: der Fehler fliegt weiter, trotzdem nur ein Versuch", async () => {
  let gepostet = 0;
  await assert.rejects(
    veroeffentlicheEinmal({
      vorbereiten: async () => "container_1",
      posten: async () => { gepostet++; throw fehler403(); },
      nachsehen: async () => null,
      label: "Test",
    }),
    /403/,
  );
  assert.equal(gepostet, 1);
});

test("scheitert das Nachsehen selbst, wird trotzdem nicht noch einmal gepostet", async () => {
  let gepostet = 0;
  await assert.rejects(
    veroeffentlicheEinmal({
      vorbereiten: async () => "container_1",
      posten: async () => { gepostet++; throw fehler403(); },
      nachsehen: async () => { throw new Error("Netzfehler beim Nachsehen"); },
      label: "Test",
    }),
    /403/,
  );
  assert.equal(gepostet, 1);
});

test("das Vorbereiten darf wiederholt werden - ein unveroeffentlichter Container schadet nicht", async () => {
  let vorbereitet = 0, gepostet = 0;
  const r = await veroeffentlicheEinmal({
    vorbereiten: async () => { vorbereitet++; if (vorbereitet === 1) throw new Error("Container-Anlegen gescheitert"); return "container_2"; },
    posten: async () => { gepostet++; return "post_2"; },
    nachsehen: async () => null,
    label: "Test",
  });
  assert.equal(vorbereitet, 2);
  assert.equal(gepostet, 1);
  assert.equal(r.containerId, "container_2");
});
