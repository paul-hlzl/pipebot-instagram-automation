/**
 * Fremddaten vergessen (20.09.2026) - und die Sperre trotzdem behalten.
 *   npm run test:fremddaten
 *
 * Der Kern des Vorschlags: Name und Text nur solange eine Freigabe offen ist, die Kennung nur
 * solange sie zum Antworten bzw. zur Nachpruefung gebraucht wird. Die Gefahr dabei ist die
 * Doppelantwort-Sperre: vergisst man die Kennung ersatzlos, ist ein laengst beantworteter
 * Kommentar wieder "neu" und die Person bekaeme eine zweite Antwort - dasselbe Muster wie der
 * Doppelpost-Vorfall vom selben Tag. Hier wird bewiesen, dass genau das nicht passiert.
 *
 * Laeuft auf einer eigenen Datenbank, nie auf Produktion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PANEL_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fremd-")), "panel.db");
const { db } = await import("../dist/panel/db.js");
const { fremdKennung, kennungsFormen, vergissAlles, vergissPersonendaten, vergissAbgelaufeneKennungen } =
  await import("../dist/panel/fremddaten.js");

function kunde(id = "cus_test") {
  const n = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO customers (id, company, contact_name, email, login_key_hash, status, consent_at, created_at, updated_at)
     VALUES (?,?,?,?,?,'active',?,?,?)`,
  ).run(id, "Testfirma", "Test", "test@example.invalid", "x", n, n, n);
  return id;
}

function kommentar(kennung, status = "pending_approval") {
  const n = new Date().toISOString();
  const id = "cmt_" + Math.random().toString(36).slice(2, 11);
  db.prepare(
    `INSERT INTO processed_comments (id, comment_id, customer_id, media_id, comment_text, author_username, comment_type, generated_reply, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, kennung, kunde(), "media_1", "Toller Beitrag!", "echter_nutzername", "comment", "Danke, Andrea!", status, n, n);
  return id;
}

const lies = (id) => db.prepare("SELECT * FROM processed_comments WHERE id = ?").get(id);
const gesperrt = (k) => {
  const [klar, hash] = kennungsFormen(k);
  return Boolean(db.prepare("SELECT 1 FROM processed_comments WHERE comment_id IN (?, ?)").get(klar, hash));
};

test("solange die Freigabe offen ist, sind Name und Text da", () => {
  const id = kommentar("ig_offen_1");
  const r = lies(id);
  assert.equal(r.author_username, "echter_nutzername");
  assert.equal(r.comment_text, "Toller Beitrag!");
  assert.equal(r.comment_id, "ig_offen_1", "Kennung im Klartext - sonst koennte nicht geantwortet werden");
});

test("DER KERN: nach dem Vergessen sind Name und Text weg, die Sperre greift weiter", () => {
  const id = kommentar("ig_fertig_1");
  assert.ok(gesperrt("ig_fertig_1"), "vorher gesperrt");
  vergissAlles("processed_comments", id);
  const r = lies(id);
  assert.equal(r.author_username, null, "Name muss weg sein");
  assert.equal(r.comment_text, "", "Text muss leer sein");
  assert.equal(r.generated_reply, null, "erzeugte Antwort kann den Namen enthalten");
  assert.match(r.comment_id, /^[0-9a-f]{64}$/, "Kennung ist jetzt ein Hash");
  assert.notEqual(r.comment_id, "ig_fertig_1");
  assert.ok(gesperrt("ig_fertig_1"), "die Doppelantwort-Sperre MUSS trotzdem greifen");
});

test("zweimal vergessen aendert nichts - sonst waere es der Hash des Hashes", () => {
  const id = kommentar("ig_zweimal");
  vergissAlles("processed_comments", id);
  const einmal = lies(id).comment_id;
  vergissAlles("processed_comments", id);
  assert.equal(lies(id).comment_id, einmal, "nicht idempotent - die Sperre waere verloren");
  assert.ok(gesperrt("ig_zweimal"));
});

test("Hash ist stabil und nicht der Klartext", () => {
  assert.equal(fremdKennung("abc"), fremdKennung("abc"));
  assert.notEqual(fremdKennung("abc"), fremdKennung("abd"));
  assert.match(fremdKennung("abc"), /^[0-9a-f]{64}$/);
});

test("die Frist wirkt: frisch Abgeschlossenes bleibt, Abgelaufenes wird gehasht", () => {
  const frisch = kommentar("ig_frisch", "answered");
  const alt = kommentar("ig_alt", "answered");
  const lang = new Date(Date.now() - 30 * 86_400_000).toISOString();
  db.prepare("UPDATE processed_comments SET updated_at = ? WHERE id = ?").run(lang, alt);
  vergissPersonendaten("processed_comments", frisch);
  vergissPersonendaten("processed_comments", alt);

  const anzahl = vergissAbgelaufeneKennungen("processed_comments", 7);
  assert.ok(anzahl >= 1, "der alte Satz haette gehasht werden muessen");
  assert.equal(lies(frisch).comment_id, "ig_frisch", "der frische Satz bleibt unangetastet");
  assert.match(lies(alt).comment_id, /^[0-9a-f]{64}$/, "der alte Satz ist gehasht");
  assert.ok(gesperrt("ig_alt"), "auch danach gesperrt");
});

test("ein wartender Satz wird von der Frist NIE angefasst", () => {
  const id = kommentar("ig_wartet", "pending_approval");
  db.prepare("UPDATE processed_comments SET updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 99 * 86_400_000).toISOString(), id);
  vergissAbgelaufeneKennungen("processed_comments", 7);
  assert.equal(lies(id).comment_id, "ig_wartet", "sonst koennte nicht mehr geantwortet werden");
  assert.equal(lies(id).author_username, "echter_nutzername", "der Kunde muss beim Freigeben sehen, wer schreibt");
});
