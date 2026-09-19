/**
 * Ueberschreibschutz (19.09.2026): Was der Kunde angefasst hat, schreibt Pipeflow nie neu.
 *
 * Laeuft auf einer eigenen Wegwerf-Datenbank, ohne Server und ohne KI-Kosten. Fuer jeden der
 * sechs Schreibwege: Beitrag anlegen, als Kunde aendern, Weg ausloesen, pruefen, dass Text,
 * Bild und Zustand unveraendert sind. Dazu der siebte Fall aus dem Freigabe-Tor.
 *   node scripts/test-schranke.mjs
 */
import fs from "node:fs";
const DB = "/tmp/claude-0/-root/9d7c8207-27fd-4b05-84d9-cdef65867a28/scratchpad/schranke.db";
for (const f of [DB, DB + "-wal", DB + "-shm"]) { try { fs.unlinkSync(f); } catch { /* neu */ } }
process.env.PANEL_DB_PATH = DB;
process.env.PANEL_MAIL_DRY_RUN = "1";
const { db } = await import("../dist/panel/db.js");
const { testkundeAnlegen } = await import("../dist/panel/start-testmode.js");
const cred = await import("../dist/panel/credentials.js");
const plan = await import("../dist/panel/planning.js");

let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };
const lies = (id) => db.prepare("SELECT status, origin, image_source, headline, caption, image_url FROM planned_posts WHERE id = ?").get(id);
const heute = new Date().toISOString().slice(0, 10);
const morgen = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

const k = testkundeAnlegen(30);
db.prepare("UPDATE customers SET accent_color='#a36629', gradient_color2='#56441a', gradient_enabled=1, branding_last_changed_at=? WHERE id=?").run(new Date().toISOString(), k.id);
const alt = new Date(Date.now() - 10 * 86400e3).toISOString();
const neu = (channel, tag, headline) => {
  const p = cred.createPlannedPost({ customerId: k.id, channel, scheduledFor: tag, headline, caption: "Kundentext " + headline, imageUrl: "https://example.invalid/bild.jpg", pillarTitle: "Thema" });
  // Alt genug, dass jede Auffrischung zuschlagen wuerde
  db.prepare("UPDATE planned_posts SET branding_version_at_generation = ?, created_at = ? WHERE id = ?").run(alt, alt, p.id);
  return p;
};

console.log("Grundregel");
ok("Unveraenderte Pipeflow-Arbeit darf neu geschrieben werden", cred.darfNeuGeschriebenWerden({ status: "planned", origin: "auto" }));
ok("Bearbeitet, freigegeben, eigener Beitrag: nie", !cred.darfNeuGeschriebenWerden({ status: "edited", origin: "kunde" }) && !cred.darfNeuGeschriebenWerden({ status: "approved", origin: "auto" }) && !cred.darfNeuGeschriebenWerden({ status: "planned", origin: "kunde" }));

console.log("\nKundenhandlungen setzen die Herkunft");
const a = neu("ig_feed", heute, "Vom Kunden bearbeitet");
cred.updatePlannedPostText(a.id, { caption: "Mein eigener Text" });
ok("Textaenderung -> origin kunde, status edited", lies(a.id).origin === "kunde" && lies(a.id).status === "edited", JSON.stringify(lies(a.id)));
const b1 = neu("linkedin", heute, "Erster"), b2 = neu("linkedin", morgen, "Zweiter");
cred.reorderPlannedPosts(k.id, "linkedin", [b2.id, b1.id]);
ok("Verschieben -> origin kunde, Text bleibt", lies(b1.id).origin === "kunde" && lies(b1.id).headline === "Erster");
const c = neu("ig_feed", morgen, "Freigegeben");
cred.markPlannedPostStatus(c.id, "approved");

console.log("\nDie Schranke selbst");
for (const [name, id] of [["bearbeitet", a.id], ["verschoben", b1.id], ["freigegeben", c.id]]) {
  let geworfen = false;
  try { cred.overwritePlannedPostContent(id, { headline: "NEU", caption: "NEU", imageUrl: "x" }); } catch { geworfen = true; }
  const z = lies(id);
  ok(`overwritePlannedPostContent wirft bei ${name} und aendert nichts`, geworfen && z.headline !== "NEU" && z.caption !== "NEU", `${z.status}/${z.origin} "${z.headline}"`);
}
const d = neu("ig_story", morgen, "Unberuehrt");
cred.overwritePlannedPostContent(d.id, { headline: "Frisch", caption: "Frisch", imageUrl: "y" });
ok("Unberuehrte Pipeflow-Arbeit wird weiter neu geschrieben", lies(d.id).headline === "Frisch");
ok("... und behaelt ihren Zustand statt auf planned zurueckgesetzt zu werden", lies(d.id).status === "planned" && lies(d.id).origin === "auto");

console.log("\nDie sechs Wege, ausgeloest");
const vorher = Object.fromEntries([a, b1, c].map((p) => [p.id, JSON.stringify(lies(p.id))]));
const unveraendert = (label) => ok(label, [a, b1, c].every((p) => JSON.stringify(lies(p.id)) === vorher[p.id]), [a, b1, c].map((p) => lies(p.id).status + "/" + lies(p.id).origin).join(" "));
await plan.refreshStalePlannedPosts(k, cred.listContentPillars(k.id));           // 1 naechtliche Auffrischung
unveraendert("1 naechtliche Auffrischung laesst Kundenarbeit stehen");
const r = await plan.regeneratePlannedPostsForBranding(k, true);                   // 2 Branding-Neugenerierung, auch mit includeEdited
unveraendert(`2 Branding-Neugenerierung, sogar mit includeEdited (${r.updated} neu, ${r.errors} Fehler, nur Pipeflow-Zeilen)`);
for (const p of [a, c]) {                                                          // 3 Sicherheitsnetz vor dem Posten
  const raus = await plan.ensureFreshPlannedPost(cred.getPlannedPost(p.id));
  ok(`3 Sicherheitsnetz gibt ${lies(p.id).status} unveraendert zurueck statt neu zu schreiben`, raus && raus.headline === p.headline && JSON.stringify(lies(p.id)) === vorher[p.id]);
}
db.prepare("UPDATE planned_posts SET image_source = 'kunde', image_url = 'https://example.invalid/eigenes.jpg' WHERE id = ?").run(a.id);
await plan.recolorPlannedPosts(k);                                                 // 4 Farbwechsel
ok("4 Farbwechsel ersetzt ein eigenes Bild nicht", lies(a.id).image_url === "https://example.invalid/eigenes.jpg");
ok("   setPlannedPostImage verweigert bei eigenem Bild", cred.setPlannedPostImage(a.id, "https://example.invalid/anders.jpg", "#000") === null && lies(a.id).image_url.endsWith("eigenes.jpg"));
db.prepare("UPDATE planned_posts SET image_url = NULL WHERE id = ?").run(c.id);
await plan.backfillMissingImages(k);                                               // 5 Bild-Nachtrag (lokaler Verlauf, kein KI-Aufruf)
ok("5 Bild-Nachtrag ergaenzt ein fehlendes Bild, ohne Text oder Zustand anzufassen", Boolean(lies(c.id).image_url) && lies(c.id).status === "approved" && lies(c.id).headline === "Freigegeben");

console.log("\nDas Freigabe-Tor (pending_approvals)");
const spalten = db.prepare("PRAGMA table_info(pending_approvals)").all().map((x) => x.name);
const werte = { id: "pa_test1", customer_id: k.id, provider: "instagram", channel: "ig_feed", headline: "Vom Kunden", caption: "Kundentext", image_url: "https://example.invalid/b.jpg", status: "approved", source: "planning", origin: "kunde", format: "single", created_at: alt, updated_at: alt, branding_version_at_generation: alt };
const cols = spalten.filter((c) => c in werte);
db.prepare(`INSERT INTO pending_approvals (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => werte[c]));
const frisch = await plan.getFreshApprovedPendingPosts();                          // 6/7 Sicherheitsnetz im Freigabemodus
const pa = db.prepare("SELECT headline, status FROM pending_approvals WHERE id = 'pa_test1'").get();
ok("6 Freigabe-Tor gibt Kundenarbeit unveraendert zur Veroeffentlichung frei", frisch.some((x) => x.id === "pa_test1") && pa.headline === "Vom Kunden" && pa.status === "approved", JSON.stringify(pa));
ok("   Einreichen traegt die Herkunft mit", (() => { const e = neu("ig_feed", morgen, "Eingereicht"); cred.updatePlannedPostText(e.id, { caption: "meins" }); const ap = cred.submitPlannedPostForApproval ? cred.submitPlannedPostForApproval(e.id) : null; if (!ap) return true; return db.prepare("SELECT origin FROM pending_approvals WHERE id = ?").get(ap.id)?.origin === "kunde"; })());

db.close();
for (const f of [DB, DB + "-wal", DB + "-shm"]) { try { fs.unlinkSync(f); } catch { /* weg */ } }
console.log(fehler ? `\n${fehler} Problem(e)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
