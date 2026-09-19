#!/usr/bin/env node
/**
 * Prueft beim Anbieter, ob eine Rueckadresse (redirect_uri) registriert ist - ohne Zugangsdaten,
 * nur mit der oeffentlichen Autorisierungsadresse, die der Server selbst baut. Eine erfundene
 * Kontrolladresse laeuft immer mit: nur wenn die durchfaellt und die echte nicht, ist die
 * Aussage etwas wert.
 *
 *   node scripts/rueckadressen-pruefen.mjs
 */
const QUELLE = process.env.QUELLE ?? "https://mcp.pipebot.at/panel/sandbox";
const ZIELE = (process.env.ZIELE ?? "https://app.pipeflow.at").split(",");

const vorlageVon = async (anbieter) => {
  const r = await fetch(`${QUELLE}/auth/${anbieter}`, { redirect: "manual" });
  const l = r.headers.get("location");
  if (!l) throw new Error(`${anbieter}: keine Autorisierungsadresse (HTTP ${r.status})`);
  return new URL(l);
};

for (const anbieter of ["google", "microsoft"]) {
  const vorlage = await vorlageVon(anbieter);
  const kandidaten = [
    ...ZIELE.map((z) => `${z}/auth/${anbieter}/callback`),
    `${QUELLE}/auth/${anbieter}/callback`,
    `https://kontrolle-erfunden.example.com/auth/${anbieter}/callback`,
  ];
  for (const ziel of kandidaten) {
    const u = new URL(vorlage);
    u.searchParams.set("redirect_uri", ziel);
    const res = await fetch(u, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0" } });
    const loc = res.headers.get("location") ?? "";
    let grund = "";
    const m = loc.match(/authError=([^&]+)/);
    if (m) { try { grund = Buffer.from(decodeURIComponent(m[1]), "base64").toString("utf8").replace(/[^\x20-\x7E]/g, " ").trim(); } catch { /* egal */ } }
    if (!grund) { const t = await res.text(); grund = (t.match(/AADSTS\d+[^<"\\]{0,90}/) ?? [""])[0]; }
    const kaputt = /redirect_uri_mismatch|AADSTS50011|AADSTS900971/i.test(grund);
    const kontrolle = ziel.includes("kontrolle-erfunden");
    console.log(`${anbieter.padEnd(9)} ${kaputt ? "NICHT REGISTRIERT" : "registriert      "} ${kontrolle ? "(Kontrolle) " : ""}${ziel}`);
    if (grund) console.log(`          ${grund.slice(0, 70)}`);
  }
}
