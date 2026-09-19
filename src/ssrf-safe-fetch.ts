/**
 * Fetches a URL a customer typed into a form field - so the target is fully attacker-controlled
 * and this needs real SSRF protection, not just a happy-path fetch. Used by website-analyze.ts.
 *
 * Defenses:
 * - Only http:/https: schemes.
 * - Resolve the hostname ourselves and reject any private/loopback/link-local/reserved address
 *   (this also blocks the classic 169.254.169.254 cloud-metadata SSRF target).
 * - Connect to the EXACT IP we validated (via a custom `lookup` on the request), so a DNS
 *   record that changes between our check and Node's own resolution (DNS rebinding) can't
 *   bypass the check - Node still uses the original hostname for the Host header/TLS SNI.
 * - Redirects are followed at most MAX_REDIRECTS times, and EVERY hop runs through the exact same
 *   checks as the first URL (scheme, hostname rules, IP validation, IP pinning). Frueher wurde
 *   jede 3xx-Antwort als Fehler behandelt. Das war unnoetig streng: praktisch jede Website mit
 *   www-Variante leitet kanonisch um (gemessen an pipebot.at: www.pipebot.at -> 301 ->
 *   pipebot.at), und der Kunde bekam "Die Website leitet weiter" fuer eine voellig intakte Seite.
 *   Sicherheitstechnisch aendert das Folgen nichts, SOLANGE jeder Sprung neu geprueft wird - die
 *   Gefahr eines Redirects ist ja gerade, dass er ungeprueft auf eine interne Adresse zeigt.
 *   Genau das faellt hier weiterhin durch dieselbe Pruefung wie eine direkt eingegebene Adresse.
 * - Timeout and a response-size cap.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns/promises";

const MAX_RESPONSE_BYTES = 2_000_000;
/** Reicht fuer die ueblichen Ketten (http->https, www->apex, Slash anhaengen); mehr deutet auf
 *  eine Schleife oder eine kaputte Seite hin, nicht auf einen legitimen Fall. */
const MAX_REDIRECTS = 3;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true; // malformed -> treat as unsafe
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique local
  if (lower.startsWith("ff")) return true; // ff00::/8 multicast
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateIPv4(mapped[1]); // IPv4-mapped - check the embedded address too
  return false;
}

function isPrivateIp(ip: string): boolean {
  return net.isIPv6(ip) ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

async function resolvePinnedIp(rawHostname: string): Promise<string> {
  // WHATWG URL keeps brackets on an IPv6 literal host (e.g. "[::1]") - net.isIP needs them stripped.
  const hostname = rawHostname.startsWith("[") && rawHostname.endsWith("]") ? rawHostname.slice(1, -1) : rawHostname;
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Diese Adresse ist nicht erlaubt.");
    return hostname;
  }
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal") || lower.endsWith(".localhost")) {
    throw new Error("Diese Adresse ist nicht erlaubt.");
  }
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("Die Website wurde nicht gefunden.");
  }
  if (!addresses.length) throw new Error("Die Website wurde nicht gefunden.");
  for (const a of addresses) {
    if (isPrivateIp(a.address)) throw new Error("Diese Adresse ist nicht erlaubt.");
  }
  return (addresses.find((a) => a.family === 4) ?? addresses[0]).address;
}

/** Ergebnis eines einzelnen Abrufs: der Inhalt, oder das Ziel einer Weiterleitung. */
type HopResult = { kind: "body"; body: string } | { kind: "bytes"; bytes: Buffer; contentType: string } | { kind: "redirect"; location: string };
type Modus = "text" | "binaer";

/**
 * Fetches a customer-supplied URL and returns its response body as text, or throws a user-facing
 * German error. Folgt bis zu MAX_REDIRECTS Weiterleitungen; jeder Sprung wird vollstaendig neu
 * geprueft (siehe Dateikopf).
 */
export async function fetchTextSafely(rawUrl: string, timeoutMs = 8000): Promise<string> {
  const ergebnis = await folgeWeiterleitungen(rawUrl, timeoutMs, "text");
  if (ergebnis.kind !== "body") throw new Error("Die Website lieferte keinen Text.");
  return ergebnis.body;
}

/**
 * Wie fetchTextSafely, aber fuer Binaerdaten (Favicon, Logo, Stylesheet-Bild) - identische
 * SSRF-Pruefung, identische Weiterleitungs-Logik, nur ohne Text-Dekodierung und mit einer
 * eigenen, kleineren Groessengrenze. Gebraucht seit der Markenfarben-Erkennung
 * (panel/brand-colors.ts), die Logo/Favicon auswertet.
 */
export async function fetchBinarySafely(rawUrl: string, timeoutMs = 8000, maxBytes = 1_500_000): Promise<{ bytes: Buffer; contentType: string }> {
  const ergebnis = await folgeWeiterleitungen(rawUrl, timeoutMs, "binaer", maxBytes);
  if (ergebnis.kind !== "bytes") throw new Error("Die Adresse lieferte keine Daten.");
  return { bytes: ergebnis.bytes, contentType: ergebnis.contentType };
}

async function folgeWeiterleitungen(rawUrl: string, timeoutMs: number, modus: Modus, maxBytes = MAX_RESPONSE_BYTES): Promise<HopResult> {
  let aktuell = rawUrl;
  const besucht = new Set<string>();
  for (let sprung = 0; sprung <= MAX_REDIRECTS; sprung++) {
    if (besucht.has(aktuell)) throw new Error("Die Website leitet im Kreis - bitte die genaue Adresse eintragen.");
    besucht.add(aktuell);
    const ergebnis = await fetchOneHop(aktuell, timeoutMs, modus, maxBytes);
    if (ergebnis.kind !== "redirect") return ergebnis;
    // Location darf relativ sein ("/de/") - gegen die aktuelle Adresse aufloesen.
    try {
      aktuell = new URL(ergebnis.location, aktuell).toString();
    } catch {
      throw new Error("Die Website leitet auf eine ungültige Adresse weiter.");
    }
  }
  throw new Error("Die Website leitet zu oft weiter - bitte die genaue Adresse eintragen.");
}

async function fetchOneHop(rawUrl: string, timeoutMs: number, modus: Modus = "text", maxBytes = MAX_RESPONSE_BYTES): Promise<HopResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Das ist keine gültige Adresse.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Nur http:// oder https:// werden unterstützt.");
  }

  const ip = await resolvePinnedIp(url.hostname);
  const mod = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        timeout: timeoutMs,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PipelineBot/1.0; +https://pipebot.at)",
          Accept: modus === "binaer" ? "image/*,text/css;q=0.9,*/*;q=0.5" : "text/html",
        },
        // Pins the connection to the pre-validated IP without changing the hostname used for
        // the Host header / TLS SNI - see the file-level comment on why this matters. Node's
        // newer "happy eyeballs" connect logic calls this with `options.all: true` and expects
        // an array back (the dns.lookup(..., {all:true}) shape), not the single-result triple -
        // support both, since which one Node picks isn't part of its documented contract.
        lookup: ((_hostname: string, options: { all?: boolean } | ((err: NodeJS.ErrnoException | null, ...rest: unknown[]) => void), callback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
          const family = net.isIPv6(ip) ? 6 : 4;
          const opts = typeof options === "function" ? {} : options;
          const cb = typeof options === "function" ? options : callback!;
          if (opts?.all) {
            (cb as (err: null, addrs: { address: string; family: number }[]) => void)(null, [{ address: ip, family }]);
          } else {
            (cb as (err: null, address: string, family: number) => void)(null, ip, family);
          }
        }) as unknown as typeof import("node:dns").lookup,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          const location = res.headers.location;
          res.destroy();
          if (!location) {
            reject(new Error("Die Website leitet weiter, nennt aber kein Ziel."));
            return;
          }
          resolve({ kind: "redirect", location });
          return;
        }
        if (res.statusCode !== 200) {
          res.destroy();
          reject(new Error(`Die Website antwortete mit einem Fehler (Status ${res.statusCode}).`));
          return;
        }
        if (modus === "binaer") {
          const stuecke: Buffer[] = [];
          let gelesen = 0;
          res.on("data", (chunk: Buffer) => {
            gelesen += chunk.length;
            if (gelesen > maxBytes) {
              res.destroy();
              reject(new Error("Die Antwort der Website ist zu groß."));
              return;
            }
            stuecke.push(chunk);
          });
          res.on("end", () => resolve({ kind: "bytes", bytes: Buffer.concat(stuecke), contentType: String(res.headers["content-type"] ?? "") }));
          return;
        }
        let body = "";
        let bytes = 0;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > maxBytes) {
            res.destroy();
            reject(new Error("Die Antwort der Website ist zu groß."));
            return;
          }
          body += chunk;
        });
        res.on("end", () => resolve({ kind: "body", body }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err: NodeJS.ErrnoException & { message: string }) => {
      if (err.message === "timeout") {
        reject(new Error("Zeitüberschreitung beim Abrufen der Website."));
      } else if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
        reject(new Error("Die Website wurde nicht gefunden."));
      } else if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET" || err.code === "EHOSTUNREACH") {
        reject(new Error("Die Website ist gerade nicht erreichbar."));
      } else {
        reject(new Error("Die Website konnte nicht abgerufen werden."));
      }
    });
    req.end();
  });
}
