/**
 * Beweis (20.09.2026): ein ueber "Jetzt posten" angefragter Beitrag bekommt die Marke des
 * Kunden - auch wenn die Routine das Bild ohne customer_id erzeugt hat.
 *   node scripts/test-marke-anfrage.mjs
 *
 * Kostet nichts: der Kunde im Test hat Markenfarben, der Hintergrund wird lokal gerendert
 * (fal.ai wird nicht gerufen). Laeuft gegen die Sandbox-Datenbank, nie gegen Produktion.
 */
import fs from "node:fs";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import sharp from "sharp";

Object.assign(process.env, dotenv.parse(fs.readFileSync("/root/mcp-server/.env", "utf8")), {
  PANEL_DB_PATH: "/root/mcp-server/data/panel-staging.db",
});
const db = new Database("/root/mcp-server/data/panel-staging.db");
let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };

/** Das Haus-Bild aus dem echten Fall vom 19.09.: schwarzer Hintergrund, Wasserzeichen "Pipeline". */
const HAUSBILD = "https://pub-ca94c8f7d991428986a52fce66b47718.r2.dev/posts/2026-09-19T19-24-21-843Z-70cf6161-ffa8-4530-b82e-2a8262e9f529.jpg";
const ACCENT = "#00818f", ZWEITFARBE = "#355cf0";

const { mitKundenmarke } = await import("../dist/panel/planning.js");

const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get()?.id;
if (!id) { console.log("Kein Testkunde in der Sandbox - erst scripts/test-freigabe.mjs laufen lassen."); process.exit(1); }
db.prepare("UPDATE customers SET accent_color=?, gradient_color2=?, gradient_enabled=1, gradient_direction='diagonal' WHERE id=?").run(ACCENT, ZWEITFARBE, id);

async function ecken(url) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * info.width + x) * info.channels; return "#" + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join(""); };
  return { ol: px(6, 6), ur: px(info.width - 7, info.height - 7) };
}
const nah = (hex, ziel) => {
  const z = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [z(hex), z(ziel)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

console.log("Kunde mit Markenfarben");
const vorher = await ecken(HAUSBILD);
const neu = await mitKundenmarke(id, "ig_feed", "Wer wir sind", HAUSBILD);
ok("Das gelieferte Haus-Bild war wirklich dunkel, ohne Verlauf", nah(vorher.ol, "#000000") < 40 && nah(vorher.ol, vorher.ur) < 20, JSON.stringify(vorher));
ok("Es kommt ein anderes Bild zurueck", Boolean(neu) && neu !== HAUSBILD, String(neu).slice(-28));
const nachher = await ecken(neu);
ok("Oben links liegt die Markenfarbe", nah(nachher.ol, ACCENT) < 90, `${nachher.ol} gegen ${ACCENT}`);
ok("Unten rechts liegt die zweite Farbe", nah(nachher.ur, ZWEITFARBE) < 90, `${nachher.ur} gegen ${ZWEITFARBE}`);
ok("Es ist ein Verlauf, keine Flaeche", nah(nachher.ol, nachher.ur) > 60, `${nachher.ol} -> ${nachher.ur}`);

console.log("\nGrenzen");
const jetzt = new Date().toISOString();
const aid = `appr_m${Date.now()}`;
db.prepare("INSERT INTO pending_approvals (id, customer_id, provider, channel, headline, caption, image_url, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'approved',?,?)")
  .run(aid, id, "instagram", "ig_feed", "Schon freigegeben", "Text", HAUSBILD, jetzt, jetzt);
ok("Ein vom Kunden freigegebenes Bild wird NIE ersetzt", (await mitKundenmarke(id, "ig_feed", "Schon freigegeben", HAUSBILD)) === HAUSBILD);
db.prepare("DELETE FROM pending_approvals WHERE id=?").run(aid);

db.prepare("UPDATE customers SET gradient_enabled=0 WHERE id=?").run(id);
ok("Ohne Markenfarben bleibt es beim gelieferten Bild (kein zweiter fal.ai-Aufruf)", (await mitKundenmarke(id, "ig_feed", "Wer wir sind", HAUSBILD)) === HAUSBILD);
db.prepare("UPDATE customers SET gradient_enabled=1 WHERE id=?").run(id);

ok("Ohne Ueberschrift passiert nichts", (await mitKundenmarke(id, "ig_feed", undefined, HAUSBILD)) === HAUSBILD);
ok("Ohne Kunde passiert nichts", (await mitKundenmarke(undefined, "ig_feed", "Wer wir sind", HAUSBILD)) === HAUSBILD);

console.log(fehler ? `\n${fehler} Bruchstelle(n)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
