#!/usr/bin/env node
/**
 * Statische Bruchstellen-Prüfung für das Panel.
 *
 * Hintergrund: Beim Aufteilen der alten 252-KB-Einzeldatei sind Verbindungen zerrissen, die beim
 * Brechen nichts melden - die Diktierfunktion suchte monatelang ".dictate-wrap", während das
 * Markup ".with-dictate" hiess (auf JEDEM Browser tot), und zwanzig Komponenten hatten gar kein
 * CSS mehr. Diese Prüfung findet genau solche Fälle, ohne dass jemand sie zufällig entdecken muss:
 *
 *   1. Selektoren, die das JS sucht, die es im erzeugten Markup aber nicht gibt  -> toter Knopf
 *   2. Klassen im Markup, für die es keine CSS-Regel gibt                        -> Komponente ohne Stil
 *   3. API-Aufrufe des Panels gegen die tatsächlich registrierten Server-Routen  -> Aufruf ins Leere
 *
 * Läuft rein statisch (kein Browser, kein Server) und ist deshalb Teil von `npm run test:panel`.
 */
import { readFileSync } from "node:fs";

const panelJs = readFileSync(new URL("../public/panel/panel.js", import.meta.url), "utf8");
const panelCss = readFileSync(new URL("../public/panel/panel.css", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../public/panel/index.html", import.meta.url), "utf8");
const adminHtml = readFileSync(new URL("../public/panel/admin.html", import.meta.url), "utf8");
const routerTs = readFileSync(new URL("../src/panel/router.ts", import.meta.url), "utf8");
const adminTs = readFileSync(new URL("../src/panel/admin.ts", import.meta.url), "utf8");
// Easy Onboarding (19.09.2026): zweite Oberflaeche unter /start mit eigenen Routen - beide
// gehoeren in dieselbe Pruefung (Aufrufe gegen Routen, Routen gegen Aufrufe), sonst gilt eine
// Route, die nur die neue Oberflaeche nutzt, faelschlich als unerreichbar.
const startJs = readFileSync(new URL("../public/panel/start/start.js", import.meta.url), "utf8");
const startRoutesTs = readFileSync(new URL("../src/panel/start-routes.ts", import.meta.url), "utf8");
// Die neue Oberflaeche registriert Routen aus mehreren Modulen (Wochenkontrolle 19.09.2026,
// Testmodus). Ohne sie meldet der Abgleich unten Routen als fehlend, die es sehr wohl gibt.
const wocheRoutesTs = readFileSync(new URL("../src/panel/woche-routes.ts", import.meta.url), "utf8");
const testmodeTs = readFileSync(new URL("../src/panel/start-testmode.ts", import.meta.url), "utf8");

let problems = 0;
const fail = (msg, list) => {
  problems++;
  console.log(`  FAIL - ${msg}`);
  for (const l of list) console.log(`         ${l}`);
};
const pass = (msg) => console.log(`  ok   - ${msg}`);

/* ---------- Was das Markup tatsächlich hergibt ---------- */
const markup = panelJs + indexHtml;
const classesInMarkup = new Set();
// Zwei Durchgaenge: vollstaendige Attribute UND der literale Anfang eines Attributs, das in einen
// Template-Ausdruck uebergeht (class="prose${...}") - sonst faellt genau dieser Name hinten runter.
for (const m of markup.matchAll(/class="([^"$]*)\$/g)) {
  for (const c of m[1].split(/\s+/)) if (/^[a-z][\w-]*$/i.test(c)) classesInMarkup.add(c);
}
for (const m of markup.matchAll(/class="([^"]*)"/g)) {
  for (const raw of m[1].split(/\s+/)) {
    // Template-Ausdrücke (${...}) enthalten dynamische Klassen - die statischen Teile zählen.
    for (const c of raw.split(/\$\{[^}]*\}/)) if (/^[a-z][\w-]*$/i.test(c)) classesInMarkup.add(c);
  }
}
for (const m of markup.matchAll(/classList\.(?:add|toggle|remove)\("([\w-]+)"/g)) classesInMarkup.add(m[1]);
for (const m of markup.matchAll(/className = "([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => classesInMarkup.add(c));

const idsInMarkup = new Set();
for (const m of markup.matchAll(/id="([^"$]+)"/g)) idsInMarkup.add(m[1]);
for (const m of markup.matchAll(/\.id = "([\w-]+)"/g)) idsInMarkup.add(m[1]);

const dataAttrsInMarkup = new Set();
for (const m of markup.matchAll(/\s(data-[\w-]+)/g)) dataAttrsInMarkup.add(m[1]);

/* ---------- 1. Gesuchte Selektoren gegen das Markup ---------- */
const searched = new Map(); // selektor -> Fundstelle
const addSel = (sel, line) => { if (sel && !searched.has(sel)) searched.set(sel, line); };
const lineOf = (index) => panelJs.slice(0, index).split("\n").length;

for (const m of panelJs.matchAll(/(?:querySelector|querySelectorAll|closest|matches)\(\s*["'`]([^"'`$]+)["'`]/g)) {
  addSel(m[1], lineOf(m.index));
}
for (const m of panelJs.matchAll(/getElementById\(\s*["']([^"'$]+)["']/g)) addSel("#" + m[1], lineOf(m.index));
for (const m of panelJs.matchAll(/\$\(\s*["']([#.][^"'$]+)["']/g)) addSel(m[1], lineOf(m.index));

const dead = [];
for (const [sel, line] of searched) {
  // Eine Selektorliste ist in Ordnung, sobald EIN Teil existiert - ".with-dictate, .dictate-wrap"
  // ist bewusst so geschrieben (neuer Name plus Altlast). Gemeldet wird nur, wenn KEIN Teil passt.
  const parts = sel.split(",").map((s) => s.trim());
  const checkable = [], hits = [];
  for (const part of parts) {
    const simpleClass = /^\.([\w-]+)$/.exec(part);
    const simpleId = /^#([\w-]+)$/.exec(part);
    const dataAttr = /^\[(data-[\w-]+)\]$/.exec(part);
    if (simpleClass) { checkable.push(part); if (classesInMarkup.has(simpleClass[1])) hits.push(part); }
    else if (simpleId) { checkable.push(part); if (idsInMarkup.has(simpleId[1])) hits.push(part); }
    else if (dataAttr) { checkable.push(part); if (dataAttrsInMarkup.has(dataAttr[1])) hits.push(part); }
  }
  if (checkable.length && !hits.length) dead.push(`${sel} (Zeile ${line}) - kommt im Markup nirgends vor`);
}
if (dead.length) fail(`${dead.length} Selektor(en) greifen ins Leere`, dead); else pass("jeder gesuchte Selektor kommt im Markup vor");

/* ---------- 2. Klassen ohne CSS ---------- */
const cssClasses = new Set();
for (const m of panelCss.matchAll(/\.([A-Za-z][\w-]*)/g)) cssClasses.add(m[1]);
// Klassen, die bewusst nur als Zustands-Haken dienen bzw. von Fremdcode kommen.
// Zustands-Haken ohne eigene Optik, Hilfsklassen und Namen, die nur aus Template-Ausdruecken
// stammen (JS-Variablen, die beim Auslesen mitgelesen werden) - hier bewusst ohne Befund.
const ignored = new Set([
  "vh", "opt", "num", "small", "micro", "muted", "prose", "err", "hint", "busy", "pending",
  "cur", "n", "todayStr", "previewSelectedDate", "is-", "guide",
  // Reine Fanghaken fuer JS (querySelector), nie zum Gestalten gedacht - das Aussehen kommt
  // vom umgebenden .approval-body bzw. vom textarea-Grundstil.
  "comment-reply-text", "review-reply-text", "fp-body", "post-now-channels", "post-now-format", "sheet-body",
  "turnstile-load-error", "overlay", "close",
]);
const unstyled = [...classesInMarkup].filter((c) => !cssClasses.has(c) && !ignored.has(c)).sort();
if (unstyled.length) fail(`${unstyled.length} Klasse(n) im Markup ohne jede CSS-Regel`, [unstyled.join("  ")]);
else pass("jede Klasse im Markup hat mindestens eine CSS-Regel");

/* ---------- 3. API-Aufrufe gegen die Server-Routen ---------- */
const routes = new Set();
for (const src of [routerTs, adminTs, startRoutesTs, wocheRoutesTs, testmodeTs]) {
  for (const m of src.matchAll(/router\.(get|post|patch|put|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
    routes.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
}
// Der Admin-Router hängt unter /admin, seine Pfade also entsprechend ergänzen.
for (const m of adminTs.matchAll(/router\.(get|post|patch|put|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
  routes.add(`${m[1].toUpperCase()} /admin${m[2] === "/" ? "" : m[2]}`);
}
const normalize = (p) => p.split("?")[0].replace(/\$\{[^}]*\}/g, ":x").replace(/\/+$/, "") || "/";
const routeSet = new Set([...routes].map((r) => { const [m, p] = r.split(" "); return `${m} ${normalize(p).replace(/:[\w]+/g, ":x")}`; }));

const calls = new Set();
for (const m of (panelJs + "\n" + startJs).matchAll(/api\(\s*"(GET|POST|PATCH|PUT|DELETE)"\s*,\s*`?["'`]?([^"'`,)]+)/g)) {
  calls.add(`${m[1]} ${normalize(m[2].trim())}`);
}
// Ein dynamisches Segment (`${action}`) kann mehrere Routen treffen - deshalb Vergleich ueber ein
// Muster: gleiche Methode, gleiche Segmentzahl, und jedes feste Segment muss uebereinstimmen.
const matchesRoute = (call) => {
  const [method, path] = call.split(" ");
  const segs = path.split("/");
  for (const route of routeSet) {
    const [rm, rp] = route.split(" ");
    if (rm !== method) continue;
    const rsegs = rp.split("/");
    if (rsegs.length !== segs.length) continue;
    if (segs.every((s, i) => s === rsegs[i] || s === ":x" || rsegs[i] === ":x")) return true;
  }
  return false;
};
const missingRoutes = [...calls].filter((c) => !matchesRoute(c)).sort();
if (missingRoutes.length) fail(`${missingRoutes.length} API-Aufruf(e) ohne passende Server-Route`, missingRoutes);
else pass(`alle ${calls.size} API-Aufrufe des Panels haben eine Server-Route`);

/* ---------- 4. Admin-Seite: eigene Prüfung derselben Art ---------- */
const adminClasses = new Set();
for (const m of adminHtml.matchAll(/class="([^"$]*)"/g)) m[1].split(/\s+/).forEach((c) => { if (/^[a-z][\w-]*$/i.test(c)) adminClasses.add(c); });
const adminCss = adminHtml.slice(adminHtml.indexOf("<style>"), adminHtml.indexOf("</style>"));
const adminCssClasses = new Set();
for (const m of adminCss.matchAll(/\.([A-Za-z][\w-]*)/g)) adminCssClasses.add(m[1]);
const adminUnstyled = [...adminClasses].filter((c) => !adminCssClasses.has(c) && !ignored.has(c)).sort();
if (adminUnstyled.length) fail(`Admin-Seite: ${adminUnstyled.length} Klasse(n) ohne CSS`, [adminUnstyled.join("  ")]);
else pass("Admin-Seite: jede Klasse hat CSS");

/* ---------- 5. Vom Server angebotene Formate, die das Panel nie zur Wahl stellt ----------
 *
 * Eigene Fehlerklasse, die die Prüfungen 1-4 nicht sehen: dort geht es immer um etwas, das im
 * Panel REFERENZIERT wird und ins Leere zeigt. Hier ist es umgekehrt - der Server kann etwas,
 * das im Panel gar nicht erst angeboten wird, und genau deshalb fällt es niemandem auf.
 *
 * Anlass: die Video-Diashow. Server, Rendering und Veröffentlichung waren seit Panel v22 fertig,
 * `/api/post-now` nahm das Format entgegen - aber beim Redesign "Flow" wurde die Datei ersetzt,
 * in der die dritte Auswahlmöglichkeit stand, und damit war die Funktion monatelang unerreichbar,
 * ohne dass irgendein Test oder eine Prüfung angeschlagen hätte.
 */
const serverFormate = new Set();
const formatWhitelist = /\[([^\]]*)\]\.includes\(requestedFormat\)/.exec(routerTs);
if (formatWhitelist) for (const m of formatWhitelist[1].matchAll(/"([a-z_]+)"/g)) serverFormate.add(m[1]);
const panelFormate = new Set();
const formatKonstante = /const POST_FORMATS\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(panelJs);
if (formatKonstante) for (const m of formatKonstante[1].matchAll(/^\s*([a-z_]+):/gm)) panelFormate.add(m[1]);

if (!serverFormate.size || !panelFormate.size) {
  fail("Formatliste nicht gefunden - die Prüfung greift ins Leere und muss angepasst werden", [
    `Server: ${serverFormate.size} Werte, Panel: ${panelFormate.size} Werte`,
  ]);
} else {
  const nichtWaehlbar = [...serverFormate].filter((f) => !panelFormate.has(f)).sort();
  if (nichtWaehlbar.length) {
    fail(`${nichtWaehlbar.length} Beitragsformat(e) nimmt der Server an, das Panel bietet sie nicht an`, nichtWaehlbar);
  } else {
    pass(`alle ${serverFormate.size} vom Server akzeptierten Beitragsformate sind im Panel wählbar`);
  }
}

/* ---------- 6. Server-Routen, die das Panel nie aufruft ----------
 *
 * Die Gegenrichtung zu Pruefung 3. Dort geht es um Panel-Aufrufe ohne Route (kaputt, faellt
 * sofort auf); hier um Routen ohne Panel-Aufruf - eine fertig gebaute Funktion, die im Panel
 * nicht erreichbar ist und deshalb NIEMANDEM auffaellt.
 *
 * Anlass: /api/review-approvals. Die Freigabe-Oberflaeche fuer Antworten auf Google-Bewertungen
 * ging beim Redesign "Flow" verloren, waehrend die zugehoerigen Einstellungen ueberlebten. Der
 * Standardmodus ist "approval" - wer die Automatik einschaltet, haette also Antworten erzeugt,
 * die er nirgends freigeben kann. Zweiter Fall desselben Musters nach der Video-Diashow, damit
 * ist "das war der Einzelfall" widerlegt und eine Dauerpruefung faellig.
 */
/** Umgekehrte Richtung von matchesRoute: ruft irgendein Panel-Aufruf DIESE Route an? */
const wirdAufgerufen = (route) => {
  const [rm, rp] = route.split(" ");
  const rsegs = rp.split("/");
  for (const call of calls) {
    const [method, path] = call.split(" ");
    if (method !== rm) continue;
    const segs = path.split("/");
    if (segs.length !== rsegs.length) continue;
    if (segs.every((s, i) => s === rsegs[i] || s === ":x" || rsegs[i] === ":x")) return true;
  }
  return false;
};
// Nur die Routen des KUNDEN-Routers pruefen. Die Admin-Seite ist eine eigene Datei mit eigener
// Pruefung (Abschnitt 4) und ruft ihre Routen selbst auf.
const panelRoutes = new Set();
for (const m of (routerTs + "\n" + startRoutesTs + "\n" + wocheRoutesTs + "\n" + testmodeTs).matchAll(/router\.(get|post|patch|put|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
  panelRoutes.add(`${m[1].toUpperCase()} ${normalize(m[2]).replace(/:[\w]+/g, ":x")}`);
}
const nurServer = [...panelRoutes]
  .filter((r) => {
    const pfad = r.split(" ")[1];
    // Nicht jede Route gehoert ins Panel: OAuth-Rueckwege, Seitenauslieferung und Webhooks
    // steuert der Browser direkt an, nicht per api(). /api/health und /api/providers holt der
    // Startcode ausserhalb von api().
    if (!pfad.startsWith("/api/")) return false;
    if (/^\/api\/(health|providers)$/.test(pfad)) return false;
    if (wirdAufgerufen(r)) return false;
    // Letzte Chance: manche Aufrufe bauen die Adresse dynamisch zusammen oder haengen sie an ein
    // src-Attribut. Taucht der Pfad irgendwo woertlich im Panel auf, gilt er als erreichbar.
    const woertlich = pfad.replace(/\/:x/g, "");
    return !panelJs.includes(woertlich) && !startJs.includes(woertlich);
  })
  .sort();
if (nurServer.length) {
  fail(`${nurServer.length} Server-Route(n) ruft das Panel nirgends auf - fertig gebaut, aber unerreichbar?`, nurServer);
} else {
  pass("jede /api-Route des Servers wird vom Panel auch aufgerufen");
}

console.log(problems ? `\n${problems} Bruchstelle(n)` : "\nkeine Bruchstellen gefunden");
process.exit(problems ? 1 : 0);
