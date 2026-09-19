#!/usr/bin/env node
/**
 * Macht die Anmeldung ueber Google und Microsoft auf PRODUKTION scharf.
 *
 * Die vier Zugangsdaten liegen bisher nur in der Sandbox-Konfiguration
 * (/root/staging.ecosystem.json). Produktion liest /root/mcp-server/.env - dieses Skript
 * traegt sie dort nach, ohne sie je auszugeben. Die Sandbox behaelt ihre eigenen Werte,
 * weil pm2-Variablen Vorrang vor der .env haben.
 *
 * Vorher muessen die Rueckadressen beim Anbieter registriert sein:
 *   https://app.pipeflow.at/auth/google/callback
 *   https://app.pipeflow.at/auth/microsoft/callback
 * (pruefbar mit scripts/rueckadressen-pruefen.mjs)
 *
 *   node scripts/anmeldung-freischalten.mjs            zeigt nur, was fehlt
 *   node scripts/anmeldung-freischalten.mjs --wirklich traegt es ein
 */
import fs from "node:fs";

const ENV = "/root/mcp-server/.env";
const SANDBOX = "/root/staging.ecosystem.json";
const SCHLUESSEL = ["AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET", "AUTH_MICROSOFT_CLIENT_ID", "AUTH_MICROSOFT_CLIENT_SECRET"];
const wirklich = process.argv.includes("--wirklich");

const konf = JSON.parse(fs.readFileSync(SANDBOX, "utf8"));
const quelle = (Array.isArray(konf.apps) ? konf.apps[0] : konf).env ?? {};
let env = fs.readFileSync(ENV, "utf8");

const fehlend = SCHLUESSEL.filter((k) => !new RegExp(`^${k}=`, "m").test(env));
const ohneQuelle = fehlend.filter((k) => !quelle[k]);

console.log(`In der Produktionskonfiguration vorhanden: ${SCHLUESSEL.length - fehlend.length} von ${SCHLUESSEL.length}`);
for (const k of fehlend) console.log(`  fehlt: ${k}${quelle[k] ? "" : "  (auch in der Sandbox-Konfiguration nicht vorhanden!)"}`);
if (ohneQuelle.length) { console.error("\nAbbruch: fuer diese Werte gibt es keine Quelle."); process.exit(1); }
if (!fehlend.length) { console.log("Nichts zu tun."); process.exit(0); }
if (!wirklich) { console.log("\nProbelauf - nichts geschrieben. Mit --wirklich eintragen."); process.exit(0); }

const rechte = fs.statSync(ENV).mode & 0o777;
fs.copyFileSync(ENV, `${ENV}.bak-anmeldung-20260919`);
fs.chmodSync(`${ENV}.bak-anmeldung-20260919`, rechte);

env = env.replace(/\n*$/, "\n");
env += `\n# Anmeldung ueber Google und Microsoft, freigeschaltet am 19.09.2026.\n`;
for (const k of fehlend) env += `${k}=${quelle[k]}\n`;
fs.writeFileSync(ENV, env, { mode: rechte });
fs.chmodSync(ENV, rechte);

console.log(`\n${fehlend.length} Wert(e) eingetragen. Sicherung: ${ENV}.bak-anmeldung-20260919`);
console.log("Jetzt noch: pm2 restart instagram-mcp --update-env (ausserhalb :38-:48)");
