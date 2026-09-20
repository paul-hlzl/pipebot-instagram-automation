/**
 * Erkennung von Plattform-Sperren, reine Logik (19.09.2026). Der neue Fall ist der entwertete
 * Instagram-Token - genau die Meldung, die bei @pipeflow_solution zwei Tage lang nur im Log stand.
 *   node scripts/test-sperren.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatformBlock } from "../dist/panel/platform-blocks.js";

test("der Fall aus dem Produktionslog wird als Sperre erkannt", () => {
  const meldung = new Error(
    "Instagram-Authentifizierung fehlgeschlagen (Session/Token ungültig oder abgelaufen). Falls der Token älter als 24 Stunden ist, " +
    "Tool `refresh_access_token` ausführen. Details: Error validating access token: The session has been invalidated because the user " +
    "changed their password or Facebook has changed the session for security reasons.",
  );
  const b = detectPlatformBlock(meldung);
  assert.ok(b, "haette erkannt werden muessen");
  assert.equal(b.code, "IG_TOKEN_INVALID");
  assert.match(b.reason, /neu verbinden/i);
});

test("auch die rohe Meta-Meldung ohne Aufbereitung", () => {
  assert.equal(detectPlatformBlock("Error validating access token: Session has expired")?.code, "IG_TOKEN_INVALID");
  assert.equal(detectPlatformBlock(new Error("... session has been invalidated ..."))?.code, "IG_TOKEN_INVALID");
});

test("die bisherigen Sperren bleiben, wie sie waren", () => {
  assert.equal(detectPlatformBlock(new Error("401 RESTRICTED_MEMBER"))?.code, "RESTRICTED_MEMBER");
  assert.equal(detectPlatformBlock(new Error("code=4 subcode=2207051"))?.code, "IG_RESTRICTED_ACTIVITY");
});

test("ein voruebergehender Fehler ist keine Sperre", () => {
  assert.equal(detectPlatformBlock(new Error("Vorübergehender Instagram-API-Fehler (bitte später erneut versuchen)")), null);
  assert.equal(detectPlatformBlock(new Error("ECONNRESET")), null);
  assert.equal(detectPlatformBlock(null), null);
});

/**
 * DER VORFALL VOM 20.09.2026: axios wirft den 403 unaufbereitet, `.message` ist nur
 * "Request failed with status code 403". Vorher lieferte detectPlatformBlock dafuer null, die
 * Verbindung blieb unvermerkt und der Doppelpost lief durch. Nachbau der echten Antwort.
 */
function axiosFehler(status, data) {
  const e = new Error(`Request failed with status code ${status}`);
  e.name = "AxiosError";
  e.response = { status, data };
  return e;
}

test("DER VORFALL: roher axios-403 von Meta wird als Sperre erkannt", () => {
  const e = axiosFehler(403, {
    error: {
      message: "We restrict certain activity to protect our community. Tell us if you think we made a mistake.",
      code: 4,
      error_subcode: 2207051,
    },
  });
  assert.equal(e.message, "Request failed with status code 403", "genau diese Meldung sah die Erkennung vorher");
  const b = detectPlatformBlock(e);
  assert.ok(b, "der rohe axios-Fehler haette erkannt werden muessen");
  assert.equal(b.code, "IG_RESTRICTED_ACTIVITY");
});

test("auch LinkedIns RESTRICTED_MEMBER unaufbereitet", () => {
  const e = axiosFehler(401, { serviceErrorCode: 65608, message: "Member is restricted" });
  assert.equal(detectPlatformBlock(e)?.code, "RESTRICTED_MEMBER");
});

test("ein roher 500 ohne Sperrkennung bleibt keine Sperre", () => {
  assert.equal(detectPlatformBlock(axiosFehler(500, { error: { message: "Internal", code: 1 } })), null);
  assert.equal(detectPlatformBlock(axiosFehler(429, {})), null);
});
