#!/usr/bin/env node
/**
 * Störsender für Ausfall-Proben: ein lokaler HTTP-Server, der sich wie ein kaputter externer
 * Dienst verhält. Damit lässt sich prüfen, was das System tut, wenn Anthropic, fal.ai oder
 * Google TTS nicht erreichbar sind, mit einem Fehler antworten oder ewig brauchen.
 *
 *   node scripts/fault-injector.mjs <port> <modus>
 *   Modi: error (500), slow (antwortet nie), refuse (sofort Verbindung zu)
 *
 * Nur für Tests gegen die Staging-Instanz gedacht - die Endpunkt-Umlenkung geschieht über
 * ANTHROPIC_ENDPOINT_OVERRIDE / FAL_ENDPOINT_OVERRIDE / TTS_ENDPOINT_OVERRIDE.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] || 4599);
const mode = process.argv[3] || "error";

if (mode === "refuse") {
  console.log(`Störsender: Port ${port} bleibt bewusst geschlossen (Verbindung wird abgelehnt).`);
  process.exit(0);
}

const server = createServer((req, res) => {
  const start = Date.now();
  req.on("data", () => {});
  req.on("end", () => {
    if (mode === "slow") {
      console.log(`  ${new Date().toISOString()} ${req.method} ${req.url} -> antwortet nie (hängt)`);
      return; // absichtlich keine Antwort
    }
    console.log(`  ${new Date().toISOString()} ${req.method} ${req.url} -> 500 nach ${Date.now() - start}ms`);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: "simulierter_ausfall", message: "Störsender: Dienst antwortet mit Fehler" } }));
  });
});
server.listen(port, "127.0.0.1", () => console.log(`Störsender auf 127.0.0.1:${port}, Modus "${mode}"`));
