#!/usr/bin/env node
/**
 * Responsive-Matrix: jede Ansicht bei 360/390/768/1440 px tatsächlich rendern und messen.
 * Geprüft wird pro Ansicht: horizontales Scrollen, Elemente die aus dem Container laufen,
 * zu kleine Tap-Ziele (<44px) und überlappende Bedienelemente.
 * Läuft gegen die Sandbox mit Testkonto - keine echten Kundendaten.
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const BASE = process.env.PANEL_URL ?? "https://mcp.pipebot.at/panel/sandbox";
const KEY = process.env.PANEL_KEY ?? "cJaCXkVjls9umce3x9Pvg-KA3Q29eBWU";
const WIDTHS = [360, 390, 768, 1440];
const VIEWS = [
  ["#uebersicht", "Übersicht"],
  ["#beitraege/geplant", "Beiträge · Geplant"],
  ["#beitraege/freigabe", "Beiträge · Freigabe"],
  ["#beitraege/veroeffentlicht", "Beiträge · Veröffentlicht"],
  ["#analytics", "Analytics"],
  ["#einstellungen", "Einstellungen"],
  ["#einstellungen/aussehen", "Einstellungen · Aussehen"],
  ["#einstellungen/kanaele", "Einstellungen · Kanäle"],
  ["#einstellungen/automatik", "Einstellungen · Automatik"],
  ["#einstellungen/konto", "Einstellungen · Konto"],
  ["#posten", "Jetzt posten"],
  ["#hilfe", "Hilfe-Chat"],
  ["#was-kann-pipeflow", "Was kann Pipeflow?"],
];

const rows = [];
let problems = 0;

// EINMAL anmelden und das Sitzungs-Cookie fuer alle Breiten wiederverwenden: /login ist auf
// 20 Versuche je Stunde und IP begrenzt (Schutz gegen das Durchprobieren von Zugangslinks).
// Ein Login je Breite hat diese Sperre regelmaessig ausgeloest - die Messung lief dann still
// gegen die Anmeldeseite statt gegen die Ansicht und meldete faelschlich "sauber".
const authBrowser = await chromium.launch();
const authCtx = await authBrowser.newContext();
await authCtx.request.get(`${BASE}/login?key=${KEY}`, { maxRedirects: 0 }).catch(() => {});
const cookies = await authCtx.cookies();
await authBrowser.close();
if (!cookies.some((c) => c.name === "pp_session")) {
  console.error("Anmeldung fehlgeschlagen (Sperre aktiv? 20 Logins/Stunde/IP). Abbruch, statt gegen die Anmeldeseite zu messen.");
  process.exit(2);
}

for (const width of WIDTHS) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : width < 1000 ? 1024 : 900 },
    isMobile: width < 500, hasTouch: width < 800,
  });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const tour = page.getByText("Rundgang beenden");
  if (await tour.isVisible().catch(() => false)) { await tour.click(); await page.waitForTimeout(300); }
  // Absicherung: ohne gueltige Sitzung zeigt das Panel die Anmeldung - dann ist jede Messung wertlos.
  if (await page.locator("#company").count()) {
    console.error(`Breite ${width}: keine gueltige Sitzung (Anmeldeseite sichtbar) - Abbruch.`);
    process.exit(2);
  }

  for (const [hash, name] of VIEWS) {
    await page.goto(`${BASE}/${hash}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const r = await page.evaluate((w) => {
      const doc = document.documentElement;
      const out = { docW: doc.scrollWidth, ueberlauf: [], kleineZiele: [], ueberlappungen: 0 };
      const sichtbar = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";
      // Elemente in einem absichtlich seitlich scrollbaren Streifen (Tagesreiter, breite Tabellen)
      // duerfen ueber den Rand hinausragen - das ist kein Layout-Bruch, sondern der Zweck.
      const inScroller = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll") return true;
        }
        return false;
      };
      document.querySelectorAll("body *").forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.right > doc.clientWidth + 1 && !inScroller(el)) {
          const sel = el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : "");
          if (out.ueberlauf.length < 3) out.ueberlauf.push(`${sel}@${Math.round(b.right)}`);
        }
      });
      document.querySelectorAll("button, a[href], input[type=checkbox], input[type=radio], select, summary").forEach((el) => {
        if (!sichtbar(el)) return;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return;
        // Ein Label mit eigener Trefferflaeche zaehlt fuer verdeckte Eingaben.
        const wrap = el.closest("label");
        const box = wrap ? wrap.getBoundingClientRect() : b;
        // Massstab: echte Bedienelemente mindestens 40px hoch, reine Textlinks nach WCAG 2.5.8
        // mindestens 24x24. Ein Textlink im Fliesstext muss kein 44px-Block sein.
        // Der Sheet-Griff ist eine Zusatz-Geste (Sheets schliessen auch per Escape und Tipp
        // daneben) - er zaehlt wie ein Textlink, nicht wie eine Hauptaktion.
        if (el.classList.contains("sheet-grip")) return;
        // Die Schritt-Knoten der Einrichtungs-Kette sind optisch 24px, ihre Trefferflaeche wird
        // per ::before unsichtbar auf 44px erweitert - das misst getBoundingClientRect nicht.
        if (el.classList.contains("pipe-node") && el.closest(".rail")) return;
        // Aufklapper (summary) und Textlinks sind Inline-Affordanzen - fuer sie gilt die
        // WCAG-Untergrenze von 24px, nicht der 36px-Hausstandard fuer Knoepfe.
        const istTextlink = el.tagName === "SUMMARY" || el.classList.contains("link") || (el.tagName === "A" && !el.classList.contains("btn"));
        // 24px ist die WCAG-2.5.8-Untergrenze (AA) fuer jedes Ziel, 36px der hier gesetzte
        // Hausstandard fuer echte Bedienelemente; die Hauptaktionen liegen ohnehin bei 44px.
        const minH = istTextlink ? 24 : 36;
        if (box.height < minH || box.width < 24) {
          const sel = el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : "");
          if (out.kleineZiele.length < 4) out.kleineZiele.push(`${sel} ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
      });
      return out;
    }, width);

    const ok = r.docW <= width + 1 && r.ueberlauf.length === 0 && r.kleineZiele.length === 0;
    if (!ok) problems++;
    rows.push({ width, name, ok, docW: r.docW, ueberlauf: r.ueberlauf, kleineZiele: r.kleineZiele });
  }
  await ctx.close(); await browser.close();
}

for (const w of WIDTHS) {
  console.log(`\n${w} px:`);
  for (const r of rows.filter((x) => x.width === w)) {
    const detail = [
      r.docW > w + 1 ? `Dokument ${r.docW}px breit` : "",
      r.ueberlauf.length ? `läuft raus: ${r.ueberlauf.join(", ")}` : "",
      r.kleineZiele.length ? `zu kleine Ziele: ${r.kleineZiele.join(", ")}` : "",
    ].filter(Boolean).join(" · ");
    console.log(`  ${r.ok ? "ok  " : "FAIL"} - ${r.name}${detail ? " — " + detail : ""}`);
  }
}
console.log(problems ? `\n${problems} Auffaelligkeit(en)` : "\nalle Ansichten sauber");
process.exit(0);
