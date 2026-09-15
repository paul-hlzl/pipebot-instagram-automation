/**
 * Cloudflare Turnstile (Panel v6, Aufgabe 2a) - CAPTCHA-Alternative fürs Signup-Formular.
 * Recherche (2026-09, gegen developers.cloudflare.com/turnstile, nicht geraten): kostenlos ohne
 * dokumentierte Mengen-Obergrenze (Free-Plan-Limits betreffen nur Anzahl Widgets/Hostnamen, nicht
 * Verifizierungs-Volumen), funktioniert auf JEDER Website unabhängig davon, ob sie über
 * Cloudflare läuft ("Turnstile is designed to be an independent service" laut offizieller Doku) -
 * kein DNS-Umzug/Cloudflare-Zone nötig, nur ein kostenloser Cloudflare-Account. Siehe
 * docs/PANEL_V6_REPORT.md für die Einrichtungsschritte, die Paul selbst machen muss.
 *
 * Ohne TURNSTILE_SECRET_KEY (bzw. TURNSTILE_SITE_KEY fürs Frontend) bleibt das Feature
 * deaktiviert - wie bei den KI-Buttons, kein Fehler, einfach unsichtbar - siehe aber Report:
 * das ist ein bewusst hervorgehobener, dringender offener Punkt, kein "kann man machen".
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5_000;

export function turnstileSiteKey(): string | null {
  return process.env.TURNSTILE_SITE_KEY?.trim() || null;
}

export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

/**
 * Hostnamen, auf denen ein Token geloest worden sein darf. Standard sind die Adressen, unter
 * denen das Panel selbst ein Signup-Formular ausliefert; ueber TURNSTILE_EXPECTED_HOSTNAMES
 * (kommagetrennt) anpassbar, ohne neuen Build.
 */
function expectedHostnames(): string[] {
  const roh = process.env.TURNSTILE_EXPECTED_HOSTNAMES?.trim();
  if (roh) return roh.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return ["app.pipeflow.at"];
}

/**
 * true nur bei einer tatsächlich von Cloudflare bestätigten Verifizierung. Bei jedem Fehler
 * (fehlender/leerer Token, Netzwerkfehler, Timeout, von Cloudflare abgelehnt) wird "fail
 * closed" mit false geantwortet - ein Ausfall des Verify-Endpunkts darf nie versehentlich zum
 * Freifahrtschein für Bots werden. Timeout bewusst kurz (5s), damit ein haengender Aufruf nicht
 * das ganze Signup-Formular blockiert.
 *
 * 15.09.2026: zusaetzlich wird der von Cloudflare zurueckgemeldete `hostname` geprueft. Die
 * Domainliste des Widgets verhindert zwar schon, dass das Widget auf einer fremden Seite
 * ueberhaupt rendert, aber diese Pruefung ist die zweite, serverseitige Haelfte davon und von
 * Cloudflare ausdruecklich empfohlen: sie schliesst aus, dass ein anderswo geloester Token
 * (etwa auf einer weiteren, spaeter im selben Widget eingetragenen Domain) hier eingereicht
 * wird. `requestHost` ist der Host, unter dem das Formular tatsaechlich abgeschickt wurde -
 * stimmt er mit dem gemeldeten ueberein, ist alles gut, unabhaengig von der Standardliste.
 */
export async function verifyTurnstileToken(token: string, remoteIp: string, requestHost?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return true; // Feature nicht konfiguriert - Aufrufer entscheidet, ob ueberhaupt geprueft wird.
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const data = (await res.json()) as { success?: boolean; hostname?: string; "error-codes"?: string[] };
    if (!data.success) {
      console.warn("[panel] Turnstile lehnt Token ab:", data["error-codes"]?.join(", ") || "unbekannt");
      return false;
    }
    const gemeldet = (data.hostname ?? "").toLowerCase();
    const erlaubt = new Set(expectedHostnames());
    if (requestHost) erlaubt.add(requestHost.toLowerCase());
    // Ein fehlender Hostname in der Antwort wird durchgelassen (dann bleibt es bei der reinen
    // success-Pruefung). Cloudflares oeffentliche Test-Keys melden dagegen immer "example.com" -
    // die Sandbox setzt dafuer TURNSTILE_EXPECTED_HOSTNAMES=example.com, statt dass hier ein
    // Sonderfall fuer Testschluessel im Produktionscode steht.
    if (gemeldet && !erlaubt.has(gemeldet)) {
      console.warn(`[panel] Turnstile: Token wurde auf einem fremden Hostnamen geloest (${gemeldet}) - abgelehnt.`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[panel] Turnstile-Verifizierung fehlgeschlagen (Netzwerk/Timeout):", err instanceof Error ? err.message : err);
    return false;
  }
}
