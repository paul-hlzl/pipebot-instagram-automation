/**
 * Fuer welche Kanaele geplant wird (20.09.2026).
 *
 * Befund, der das ausgeloest hat: LinkedIn war eingeschaltet, aber nie verbunden - es wurden
 * fuenf Beitraege je Woche erzeugt und zur Freigabe vorgelegt, die nirgends hin konnten.
 * Regel seither: solange der Kunde GAR KEINE Verbindung hat, wird fuer alles geplant, was
 * eingeschaltet ist (das ist das Onboarding und dessen ganzer Sinn); sobald die erste Verbindung
 * steht, nur noch fuer verbundene Kanaele.
 *   node scripts/test-kanalplanung.mjs
 *
 * Kosten: ein einziger Beitrag im Onboarding-Fall (postBudget 1), sonst nichts - die anderen
 * Faelle duerfen gar keinen Slot ergeben und rufen deshalb nie die KI.
 */
import Database from "better-sqlite3";
import dotenv from "dotenv";
import fs from "node:fs";

Object.assign(process.env, dotenv.parse(fs.readFileSync("/root/mcp-server/.env", "utf8")), { PANEL_DB_PATH: "/root/mcp-server/data/panel-staging.db" });
const db = new Database("/root/mcp-server/data/panel-staging.db");
let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };

const { planCustomerWeek } = await import("../dist/panel/planning.js");
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const jetzt = new Date().toISOString();
const kunde = () => db.prepare("SELECT * FROM customers WHERE id=?").get(id);
const aufraeumen = () => { db.prepare("DELETE FROM planned_posts WHERE customer_id=?").run(id); db.prepare("DELETE FROM connections WHERE customer_id=?").run(id); };
const verbinden = (provider) => db.prepare("INSERT INTO connections (customer_id, provider, account_id, account_name, access_token_enc, expires_at, connected_at, updated_at) VALUES (?,?,?,?,?,NULL,?,?)")
  .run(id, provider, `${provider}_test`, "@testkonto", "x", jetzt, jetzt);

db.prepare("UPDATE customers SET company='Channoine Mayr', industry='Kosmetik', about='Kosmetikstudio.', accent_color='#00818f', gradient_color2='#355cf0', gradient_enabled=1, email_verified=1, frequency='taeglich', active_weekdays=NULL, customer_paused=0, linkedin_image_mode='bild' WHERE id=?").run(id);

console.log("Ohne jede Verbindung (Onboarding)");
aufraeumen();
db.prepare("UPDATE customers SET ig_feed_enabled=1, ig_story_enabled=0, linkedin_enabled=1 WHERE id=?").run(id);
let r = await planCustomerWeek(kunde(), { concurrency: 2, postBudget: 1, feature: "test-kanalplanung" });
ok("Es wird trotzdem geplant - sonst waere der Onboarding-Bildschirm leer", r.slots > 0 && r.planned >= 1, `slots ${r.slots}, geplant ${r.planned}`);
const kanaeleOnboarding = new Set(db.prepare("SELECT DISTINCT channel FROM planned_posts WHERE customer_id=?").all(id).map((z) => z.channel));
ok("Und zwar fuer die eingeschalteten Kanaele, auch ohne Anschluss", kanaeleOnboarding.size >= 1, [...kanaeleOnboarding].join(","));

console.log("\nMit Instagram verbunden, LinkedIn nur eingeschaltet");
aufraeumen();
verbinden("instagram");
db.prepare("UPDATE customers SET ig_feed_enabled=0, ig_story_enabled=0, linkedin_enabled=1 WHERE id=?").run(id);
r = await planCustomerWeek(kunde(), { concurrency: 1, feature: "test-kanalplanung" });
ok("Fuer den unverbundenen Kanal entsteht kein einziger Slot", r.slots === 0 && r.planned === 0, `slots ${r.slots}`);
ok("Und damit auch kein Beitrag in der Datenbank", db.prepare("SELECT COUNT(*) n FROM planned_posts WHERE customer_id=?").get(id).n === 0);

console.log("\nDerselbe Kunde, verbundener Kanal an");
db.prepare("UPDATE customers SET ig_feed_enabled=1 WHERE id=?").run(id);
r = await planCustomerWeek(kunde(), { concurrency: 2, postBudget: 1, feature: "test-kanalplanung" });
// Geprueft wird die ENTSCHEIDUNG (entsteht ein Slot?), nicht das Erzeugen: der Testanschluss
// oben traegt einen Attrappen-Token, an dem das Abholen der Stilproben scheitert. Mit einem
// echten Anschluss ist das genau der Weg, der im ersten Fall schon durchgelaufen ist.
ok("Fuer den verbundenen Kanal entsteht wieder ein Slot", r.slots > 0, `slots ${r.slots}`);
ok("Ausschliesslich fuer ihn", db.prepare("SELECT COUNT(*) n FROM planned_posts WHERE customer_id=? AND channel<>'ig_feed'").get(id).n === 0);

aufraeumen();
console.log(fehler ? `\n${fehler} Bruchstelle(n)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
