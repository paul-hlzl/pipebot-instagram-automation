/**
 * Beweis fuer die Planweite (20.09.2026): ein echter Planungslauf legt Beitraege bis zum Ende der
 * NAECHSTEN Kalenderwoche an - nicht nur sieben Tage.
 *   node scripts/test-wochenlauf.mjs
 *
 * ECHTE KOSTEN: ein Lauf fuer einen Testkunden, nur Instagram Feed, mit Markenfarben (die Bilder
 * rendert der Server dann selbst, fal.ai wird nicht gerufen) - gemessen rund 0,02 EUR.
 */
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = "https://mcp.pipebot.at", MOUNT = "/panel/sandbox";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const KEY = (() => { const j = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8")); return (Array.isArray(j.apps) ? j.apps[0] : j).env.PANEL_TEST_KEY; })();
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session="));
let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };

/** Erwartetes Ende der Planweite - hier bewusst NOCHMAL gerechnet, nicht aus dem Code geholt. */
function erwartetesEnde(jetzt = new Date()) {
  const wienTag = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });
  const kurz = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Vienna", weekday: "short" }).format(jetzt);
  const wochentag = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(kurz);
  const bisSonntag = wochentag === 0 ? 7 : 7 - wochentag;
  return wienTag.format(new Date(jetzt.getTime() + (bisSonntag + 7) * 86400e3));
}
const heute = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ende = erwartetesEnde();
const istWerktag = (iso) => { const t = new Date(`${iso}T12:00:00Z`).getUTCDay(); return t >= 1 && t <= 5; };
let letzterWerktag = ende;
while (!istWerktag(letzterWerktag)) letzterWerktag = new Date(Date.parse(`${letzterWerktag}T12:00:00Z`) - 86400e3).toISOString().slice(0, 10);

const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const ck = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
db.prepare("UPDATE customers SET company='Channoine Mayr', industry='Kosmetik', about='Kosmetikstudio mit Ausbildung zur Beauty Advisorin.', accent_color='#a36629', gradient_color2='#56441a', gradient_enabled=1, email_verified=1, frequency='werktags', active_weekdays=NULL, ig_feed_enabled=1, ig_story_enabled=0, linkedin_enabled=0, customer_paused=0 WHERE id=?").run(id);
db.prepare("DELETE FROM planned_posts WHERE customer_id=?").run(id);
console.log(`Testkunde ${id}\nHeute ${heute}, erwartetes Ende der Planweite ${ende}, letzter Werktag darin ${letzterWerktag}`);

const antwort = await fetch(`${BASE}${MOUNT}/api/start/replan`, { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: "{}" });
ok("Lauf gestartet", antwort.status === 200, `HTTP ${antwort.status}`);
for (let i = 0; i < 90; i++) {
  const st = await (await fetch(`${BASE}${MOUNT}/api/start/status`, { headers: { cookie: ck } })).json();
  const phase = st?.job?.phase;
  if (!phase || ["done", "error", "idle"].includes(phase)) { console.log(`  Lauf beendet: ${phase ?? "ohne Job"} (${st?.job?.done ?? 0}/${st?.job?.total ?? 0})`); break; }
  await new Promise((r) => setTimeout(r, 2000));
}

const zeilen = db.prepare("SELECT scheduled_for, channel, headline FROM planned_posts WHERE customer_id=? ORDER BY scheduled_for").all(id);
const tage = [...new Set(zeilen.map((z) => z.scheduled_for))];
console.log(`  ${zeilen.length} Beitraege an ${tage.length} Tagen: ${tage.join(", ")}`);
ok("Es wurde ueber die erste Woche hinaus geplant", tage.some((t) => t > new Date(Date.parse(`${heute}T12:00:00Z`) + 6 * 86400e3).toISOString().slice(0, 10)), tage.at(-1));
ok("Der letzte geplante Tag ist der letzte Werktag der naechsten Kalenderwoche", tage.at(-1) === letzterWerktag, `${tage.at(-1)} statt ${letzterWerktag}`);
ok("Kein Tag ueber die Planweite hinaus", tage.every((t) => t <= ende), tage.at(-1));
ok("Nur Werktage", tage.every(istWerktag), tage.filter((t) => !istWerktag(t)).join(","));
ok("Kein Tag doppelt belegt", new Set(zeilen.map((z) => `${z.scheduled_for}|${z.channel}`)).size === zeilen.length);
const koepfe = zeilen.map((z) => (z.headline ?? "").toLowerCase().trim()).filter(Boolean);
ok("Keine wortgleiche Ueberschrift zweimal - auch nicht ueber die Wochengrenze", new Set(koepfe).size === koepfe.length, koepfe.length - new Set(koepfe).size + " Dubletten");

console.log(fehler ? `\n${fehler} Bruchstelle(n)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
