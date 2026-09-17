/**
 * Lesender Gegentest für den LinkedIn-Versions-Header (siehe src/linkedin-version.ts).
 *
 * Ruft ausschließlich LESENDE Endpunkte auf - es wird nichts veröffentlicht, nichts hochgeladen
 * und nichts verändert. Zweck: belegen, dass die neu gesetzte Version von LinkedIn akzeptiert
 * wird und die alte tatsächlich abgelaufen ist.
 *
 * Gibt niemals Tokens oder vollständige Profil-IDs aus.
 *
 *   node scripts/test-linkedin-version.mjs
 */
import "dotenv/config";
import { LINKEDIN_ANALYTICS_VERSION, LINKEDIN_VERSION } from "../dist/linkedin-version.js";

const API = "https://api.linkedin.com";
const token = process.env.LINKEDIN_ACCESS_TOKEN?.trim();

if (!token) {
  console.error("LINKEDIN_ACCESS_TOKEN fehlt - Test nicht möglich.");
  process.exit(2);
}

const maske = (s) => (typeof s === "string" && s.length > 6 ? `${s.slice(0, 4)}…(${s.length} Z.)` : "…");

/** Ein lesender Aufruf gegen /rest/me mit einer bestimmten Version. */
async function leseProfil(version) {
  const res = await fetch(`${API}/rest/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "LinkedIn-Version": version,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  const text = await res.text();
  let code = null;
  try {
    code = JSON.parse(text)?.code ?? null;
  } catch {
    /* kein JSON - egal, uns interessiert der Status */
  }
  return { status: res.status, code, text };
}

console.log("Lesender Test gegen GET /rest/me - es wird nichts veröffentlicht.\n");

// 1. Token überhaupt gültig? (unversionierter OpenID-Endpunkt)
const info = await fetch(`${API}/v2/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
console.log(`Token gültig (/v2/userinfo)        : HTTP ${info.status}${info.ok ? " – ok" : ""}`);
if (info.ok) {
  const body = await info.json();
  console.log(`Konto                              : ${maske(body.sub)}`);
}

// 2. Die alte, abgelaufene Version - soll 426 liefern
const alt = await leseProfil("202509");
console.log(`\nalte Version 202509                : HTTP ${alt.status} ${alt.code ?? ""}`);
if (alt.status === 426 && alt.code === "NONEXISTENT_VERSION") {
  console.log("  -> bestätigt: genau der Fehler aus dem Produktions-Log.");
}

// 3. Die neu gesetzte Version - soll NICHT 426 liefern
const neu = await leseProfil(LINKEDIN_VERSION);
console.log(`\nneue Version ${LINKEDIN_VERSION} (Posting-API) : HTTP ${neu.status} ${neu.code ?? ""}`);

// 4. Die Analytics-Version, die unverändert bleibt
const ana = await leseProfil(LINKEDIN_ANALYTICS_VERSION);
console.log(`Analytics-Version ${LINKEDIN_ANALYTICS_VERSION} (unverändert): HTTP ${ana.status} ${ana.code ?? ""}`);

/**
 * WICHTIG: LinkedIn prüft den Token VOR dem Versions-Header. Ist der Token ungültig oder
 * widerrufen, antwortet jede Version mit 401 - auch eine nachweislich abgelaufene. Ein "kein 426"
 * ist dann also KEIN Beleg dafür, dass die Version gültig ist. Genau dieser Fall würde sonst ein
 * falsches Erfolgssignal liefern, deshalb wird er hier ausdrücklich als "unbestimmt" gemeldet.
 */
const tokenBrauchbar = info.ok && alt.status !== 401 && neu.status !== 401;
const bewerten = (r) => (r.status === 426 || r.code === "NONEXISTENT_VERSION" ? "ABGELAUFEN" : r.status === 401 ? "unbestimmt" : "akzeptiert");

console.log("\n--- Ergebnis ---");
if (!tokenBrauchbar) {
  console.log("Der Token aus LINKEDIN_ACCESS_TOKEN ist ungültig/widerrufen (HTTP 401).");
  console.log("LinkedIn prüft den Token vor der Version - der Versions-Header lässt sich damit");
  console.log("NICHT gegenprüfen. Ergebnis: unbestimmt, kein Beleg für oder gegen die Version.");
  console.log(`\n  alte Version 202509              : ${bewerten(alt)}`);
  console.log(`  neue Version ${LINKEDIN_VERSION}             : ${bewerten(neu)}`);
  console.log(`  Analytics-Version ${LINKEDIN_ANALYTICS_VERSION}        : ${bewerten(ana)}`);
  process.exit(3); // 3 = unbestimmt, nicht bestanden und nicht durchgefallen
}

const versionOk = bewerten(neu) === "akzeptiert";
const analyticsOk = bewerten(ana) === "akzeptiert";
console.log(`alte Version 202509                : ${bewerten(alt)}`);
console.log(`neue Version ${LINKEDIN_VERSION} (Posting)     : ${bewerten(neu)}`);
console.log(`Analytics-Version ${LINKEDIN_ANALYTICS_VERSION}            : ${bewerten(ana)}`);
if (!versionOk) console.log(`  Antwort: ${neu.text.slice(0, 200)}`);

process.exit(versionOk && analyticsOk ? 0 : 1);
