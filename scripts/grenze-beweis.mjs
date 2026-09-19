/**
 * Beweist am echten Browser: eine erreichte Tagesgrenze wird ruhig angezeigt, nicht rot.
 * Legt einen Testkunden an, setzt ihm drei Vorschauen in die Vergangenheit, laeuft in die
 * Konto-Grenze und misst die Darstellung. Raeumt danach alles wieder weg.
 *   node scripts/grenze-beweis.mjs
 */
import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import Database from "better-sqlite3";

const BASE = process.env.SANDBOX_URL ?? "https://mcp.pipebot.at";
const MOUNT = "/panel/sandbox";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const mail = `grenze-${Date.now()}@example.invalid`;
let fehler = 0;
const ok = (t, b, extra = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${extra ? ` :: ${extra}` : ""}`); if (!b) fehler++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${BASE}${MOUNT}/start/`, { waitUntil: "networkidle" });
await page.click(".mail-weg");
await page.fill("#email", mail);
await page.click('button[type=submit]');
await page.waitForSelector("#website", { timeout: 15000 });

const id = db.prepare("SELECT id FROM customers WHERE email = ?").get(mail)?.id;
ok("Testkonto angelegt", Boolean(id), String(id));
const ins = db.prepare("INSERT INTO start_previews (id, ip, domain, email, customer_id, kind, created_at) VALUES (?,?,?,?,?,?,?)");
// Aeltester Eintrag vor 2 Stunden -> naechster Platz in 22 Stunden, also eine echte Uhrzeit.
for (let i = 0; i < 3; i++) ins.run(`prev_test${Date.now()}${i}`, "127.0.0.1", `seed${i}.example`, mail, id, "preview", new Date(Date.now() - 2 * 3600_000 + i * 1000).toISOString());

await page.fill("#website", "hittaro.com");
await page.click("#btn-vorschau");
await page.waitForSelector(".notice.ruhig", { timeout: 15000 });

const m = await page.evaluate(() => {
  const n = document.querySelector(".notice.ruhig");
  const feld = document.querySelector("#website");
  const fehlerFeld = document.querySelector("#err-website");
  const knopf = n?.querySelector("button");
  const cs = getComputedStyle(n);
  return {
    text: n.textContent.trim(),
    textFarbe: cs.color,
    randLinks: cs.borderLeftColor,
    hintergrund: cs.backgroundColor,
    ariaInvalid: feld?.getAttribute("aria-invalid"),
    roteMeldung: (fehlerFeld?.textContent || "").trim(),
    knopf: knopf?.textContent.trim() || null,
    knopfHoehe: knopf ? Math.round(knopf.getBoundingClientRect().height) : 0,
    imBild: n.getBoundingClientRect().top < innerHeight,
  };
});
console.log(JSON.stringify(m, null, 2));

const rot = (f) => { const [r, g, b] = f.match(/\d+/g).map(Number); return r > 120 && r > g * 1.8 && r > b * 1.8; };
ok("Kein Rot im Text", !rot(m.textFarbe), m.textFarbe);
ok("Kein Rot am Rahmen", !rot(m.randLinks), m.randLinks);
ok("Feld ist nicht als fehlerhaft markiert", m.ariaInvalid !== "true", String(m.ariaInvalid));
ok("Keine zusaetzliche rote Feldmeldung", m.roteMeldung === "", m.roteMeldung);
ok("Text nennt eine echte Uhrzeit", /\b\d{1,2}:\d{2} Uhr\b/.test(m.text), m.text);
ok("Text sagt nicht mehr \"Anschluss\"", !/Anschluss/i.test(m.text));
ok("Hinweis ist ohne Scrollen sichtbar", m.imBild);

await page.screenshot({ path: "docs/easy-onboarding/handy/360-grenze.png", fullPage: false });
db.prepare("DELETE FROM start_previews WHERE email = ?").run(mail);
db.prepare("DELETE FROM customers WHERE email = ?").run(mail);
await browser.close();
console.log(fehler ? `${fehler} Problem(e)` : "alles gruen");
process.exit(fehler ? 1 : 0);
