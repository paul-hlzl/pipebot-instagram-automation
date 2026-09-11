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
 * - No redirect following (a redirect to an internal address would otherwise bypass the checks
 *   above entirely) - a 3xx is treated as a failure.
 * - Timeout and a response-size cap.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns/promises";

const MAX_RESPONSE_BYTES = 2_000_000;

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

/** Fetches a customer-supplied URL and returns its response body as text, or throws a user-facing German error. */
export async function fetchTextSafely(rawUrl: string, timeoutMs = 8000): Promise<string> {
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
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PipelineBot/1.0; +https://pipebot.at)", Accept: "text/html" },
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
          res.destroy();
          reject(new Error("Die Website leitet weiter - das wird nicht unterstützt. Bitte die genaue Adresse eintragen."));
          return;
        }
        if (res.statusCode !== 200) {
          res.destroy();
          reject(new Error(`Die Website antwortete mit einem Fehler (Status ${res.statusCode}).`));
          return;
        }
        let body = "";
        let bytes = 0;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_RESPONSE_BYTES) {
            res.destroy();
            reject(new Error("Die Antwort der Website ist zu groß."));
            return;
          }
          body += chunk;
        });
        res.on("end", () => resolve(body));
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
