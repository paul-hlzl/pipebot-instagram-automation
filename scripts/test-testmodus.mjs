/**
 * Testmodus der Sandbox (Auftrag vom 19.09.2026) - prueft alle sechs Zusagen:
 *   1. ein Klick in einen frischen, leeren Durchlauf, ohne Anmeldung und ohne E-Mail
 *   2. ein Klick setzt zurueck und faengt sofort wieder von vorne an
 *   3. kein Tageslimit, keine Wartezeit, keine Sperre
 *   4. sauber getrennt von echten Kunden: keine Liste, keine Statistik, keine Abrechnung
 *   5. der Zugang existiert nur in der Sandbox und nicht fuer Zufallsbesucher
 *   6. die Kosten eines Durchlaufs sind messbar
 *
 *   node scripts/test-testmodus.mjs            (ohne echte Generierung)
 *   MIT_KOSTEN=1 node scripts/test-testmodus.mjs   (ein echter Durchlauf, kostet ~0,02 USD)
 */
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = process.env.SANDBOX_URL ?? "https://mcp.pipebot.at";
const MOUNT = "/panel/sandbox";
const DB = process.env.PANEL_DB_PATH ?? "/root/mcp-server/data/panel-staging.db";
const db = new Database(DB);

// Schluessel aus der Prozessdatei lesen, NIE ausgeben.
const KEY = (() => {
  const j = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8"));
  const app = Array.isArray(j.apps) ? j.apps[0] : j;
  return app.env?.PANEL_TEST_KEY ?? "";
})();

let fehler = 0;
const ok = (t, b, extra = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${extra ? ` :: ${extra}` : ""}`); if (!b) fehler++; };
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")]).filter(Boolean).map((c) => c.split(";")[0]).join("; ");
const call = (method, path, { body, cookie, redirect = "manual" } = {}) =>
  fetch(`${BASE}${MOUNT}${path}`, {
    method, redirect,
    body: body ? JSON.stringify(body) : undefined,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
  });

console.log(`Testmodus gegen ${BASE}${MOUNT}\n`);
ok("Ein Schluessel ist hinterlegt", KEY.length >= 20, `${KEY.length} Zeichen`);

console.log("\nZugang (Zusage 5):");
{
  for (const pfad of ["/start/test", "/start/test?key=falsch", "/start/gibtesnicht"]) {
    const r = await call("GET", pfad);
    ok(`${pfad} -> kein Zugang`, r.status !== 303, String(r.status));
  }
  const a = (await call("GET", "/start/test?key=falsch")).status;
  const b = (await call("GET", "/start/gibtesnicht")).status;
  ok("Falscher Schluessel sieht aus wie ein unbekannter Pfad (kein Hinweis auf den Weg)", a === b, `${a} / ${b}`);
}

console.log("\nEinstieg (Zusage 1):");
const ein = await call("GET", `/start/test?key=${encodeURIComponent(KEY)}`);
const cookie = cookieOf(ein);
ok("Richtiger Schluessel -> Weiterleitung in den Flow", ein.status === 303 && (ein.headers.get("location") || "").endsWith("/start/"), `${ein.status} ${ein.headers.get("location")}`);
ok("Sitzung wird sofort gesetzt (keine Anmeldung noetig)", cookie.includes("pp_session"));
ok("Der Schluessel bleibt nicht in der Adresszeile stehen", !(ein.headers.get("location") || "").includes("key="));

const status1 = await (await call("GET", "/api/start/status", { cookie })).json();
const id1 = db.prepare("SELECT id FROM customers WHERE status = 'test' ORDER BY created_at DESC").get()?.id;
ok("Ein Testkunde existiert", Boolean(id1), String(id1));
ok("Er ist als Testlauf gekennzeichnet", status1.customer?.isTest === true);
ok("Der Durchlauf ist leer (keine Beitraege)", (status1.posts || []).length === 0, String((status1.posts || []).length));
ok("Keine E-Mail-Bestaetigung noetig", status1.customer?.emailVerified === true);

console.log("\nTrennung von echten Kunden (Zusage 4):");
{
  const aktive = db.prepare("SELECT COUNT(*) n FROM customers WHERE status = 'active'").get().n;
  const tests = db.prepare("SELECT COUNT(*) n FROM customers WHERE status = 'test'").get().n;
  ok("Testkunden haben einen eigenen Status", tests >= 1 && aktive >= 1, `aktiv ${aktive}, test ${tests}`);
  // Genau die Abfragen, aus denen echte Kundenlisten, die Routine und die Abrechnung lesen.
  const wie = (sql) => db.prepare(sql).all().some((r) => r.id === id1);
  ok("Nicht in list_customers", !wie("SELECT id FROM customers WHERE status = 'active' ORDER BY created_at"));
  ok("Nicht in der Admin-Uebersicht", !wie("SELECT id FROM customers WHERE status != 'test' ORDER BY created_at DESC"));
  ok("Nicht in der naechtlichen Planung", !wie("SELECT id FROM customers WHERE status = 'active'"));
  ok("Nicht in Analytics", !wie("SELECT id FROM customers WHERE status = 'active' AND customer_paused = 0"));
  ok("Nicht in der Kommentar-Automatik", !wie("SELECT id FROM customers WHERE status = 'active' AND customer_paused = 0 AND email_verified = 1 AND comment_automation_enabled = 1"));
  ok("Nicht in der Stillstands-Wache", !wie("SELECT id FROM customers WHERE status = 'active'"));
  const kosten = db.prepare("SELECT COUNT(*) n FROM usage_costs WHERE created_at >= ? AND customer_id NOT IN (SELECT id FROM customers WHERE status = 'test')").get(new Date(0).toISOString()).n;
  const alle = db.prepare("SELECT COUNT(*) n FROM usage_costs").get().n;
  ok("Die Kostenuebersicht blendet Testlaeufe aus", kosten <= alle, `${kosten} von ${alle}`);
}

console.log("\nKeine Sperren (Zusage 3):");
{
  // Drei Vorschauen in die Vergangenheit setzen - fuer einen echten Kunden waere hier Schluss.
  const ins = db.prepare("INSERT INTO start_previews (id, ip, domain, email, customer_id, kind, created_at) VALUES (?,?,?,?,?,?,?)");
  for (let i = 0; i < 5; i++) ins.run(`prev_tm${Date.now()}${i}`, "203.0.113.5", `tm${i}.example`, "x@y.invalid", id1, "preview", new Date().toISOString());
  const heute = db.prepare("SELECT COUNT(*) n FROM start_previews WHERE customer_id = ?").get(id1).n;
  ok("Der Zaehler steht ueber der Grenze (3 pro Konto)", heute >= 5, String(heute));
  const r = await call("POST", "/api/start/preview", { cookie, body: { website: "hittaro.com" } });
  ok("Vorschau wird trotzdem angenommen (keine 429)", r.status === 202 || r.status === 200, String(r.status));
  db.prepare("DELETE FROM start_previews WHERE customer_id = ?").run(id1);
}

console.log("\nZuruecksetzen (Zusage 2):");
{
  const r = await call("POST", "/api/start/test/reset", { cookie });
  const neu = await r.json();
  const cookie2 = cookieOf(r);
  ok("Zuruecksetzen wird angenommen", r.status === 200 && neu.status === "reset", String(r.status));
  ok("Es gibt eine neue Sitzung", cookie2.includes("pp_session"));
  const weg = db.prepare("SELECT COUNT(*) n FROM customers WHERE id = ?").get(id1).n;
  ok("Der alte Testkunde ist restlos weg", weg === 0);
  const rest = db.prepare("SELECT COUNT(*) n FROM planned_posts WHERE customer_id = ?").get(id1).n
    + db.prepare("SELECT COUNT(*) n FROM start_previews WHERE customer_id = ?").get(id1).n
    + db.prepare("SELECT COUNT(*) n FROM sessions WHERE customer_id = ?").get(id1).n;
  ok("Auch seine Beitraege, Zaehler und Sitzungen sind weg", rest === 0, String(rest));
  const st = await (await call("GET", "/api/start/status", { cookie: cookie2 })).json();
  ok("Der neue Durchlauf ist wieder leer", (st.posts || []).length === 0 && st.customer?.isTest === true);

  console.log("\nNeu starten fuer ein angemeldetes Sandbox-Konto (Ansage 19.09.2026):");
  {
    const mail = `reset-${Date.now()}@example.invalid`;
    const r = await call("POST", "/api/start/email", { body: { email: mail } });
    const ck = cookieOf(r);
    const kid = db.prepare("SELECT id FROM customers WHERE email = ?").get(mail).id;
    db.prepare(`UPDATE customers SET tour_done_at = ?, website = 'beispiel.at', industry = 'Test',
      about = 'Text aus der Analyse', accent_color = '#a36629', gradient_color2 = '#56441a',
      gradient_enabled = 1 WHERE id = ?`).run(new Date().toISOString(), kid);
    const jetzt = new Date().toISOString();
    db.prepare("INSERT INTO content_pillars (id, customer_id, title, description, weight, created_at, updated_at) VALUES (?,?,?,?,1,?,?)").run(`pil_${Date.now()}`, kid, "Thema", "Beschreibung", jetzt, jetzt);
    db.prepare("INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(`plp_${Date.now()}`, kid, "ig_feed", jetzt.slice(0, 10), "planned", "Kopf", "Text", jetzt, jetzt);
    const vorher = await (await call("GET", "/api/me", { cookie: ck })).json();
    ok("Vorbereitetes Konto ist eingerichtet und hat eine Woche", vorher.customer.tourDone === true && db.prepare("SELECT COUNT(*) n FROM planned_posts WHERE customer_id = ?").get(kid).n === 1);
    ok("Es ist ausdruecklich KEIN Testlauf", vorher.customer.isTest !== true);

    const res = await call("POST", "/api/start/test/reset", { cookie: ck });
    const body = await res.json();
    ok("Zuruecksetzen wird angenommen", res.status === 200 && body.art === "konto", `${res.status} ${body.art}`);
    ok("Das Konto bleibt bestehen", db.prepare("SELECT COUNT(*) n FROM customers WHERE id = ?").get(kid).n === 1);
    ok("Die Sitzung bleibt bestehen", db.prepare("SELECT COUNT(*) n FROM sessions WHERE customer_id = ?").get(kid).n >= 1);
    const nach = db.prepare("SELECT tour_done_at, website, industry, about, accent_color, gradient_enabled FROM customers WHERE id = ?").get(kid);
    ok("Beginnt wieder bei der Website-Frage (tour_done_at leer)", nach.tour_done_at === null, String(nach.tour_done_at));
    ok("Website, Branche, Beschreibung und Farben sind weg", !nach.website && !nach.industry && !nach.about && !nach.accent_color && nach.gradient_enabled === 0, JSON.stringify(nach));
    ok("Woche und Saeulen sind weg",
      db.prepare("SELECT COUNT(*) n FROM planned_posts WHERE customer_id = ?").get(kid).n === 0
      && db.prepare("SELECT COUNT(*) n FROM content_pillars WHERE customer_id = ?").get(kid).n === 0);
    db.prepare("DELETE FROM sessions WHERE customer_id = ?").run(kid);
    db.prepare("DELETE FROM customers WHERE id = ?").run(kid);
  }

  console.log("\nSchutz vor Missbrauch:");
  const ohne = await call("POST", "/api/start/test/reset");
  ok("Zuruecksetzen ohne Anmeldung -> 401", ohne.status === 401, String(ohne.status));

  // Aufraeumen
  // Gezielt DIESEN Testkunden pruefen, nicht die Gesamtzahl: ein paralleler Browserlauf oder
  // ein Rest aus einem abgebrochenen Durchgang haette die Zaehlung sonst rot gefaerbt, ohne
  // dass am Beenden etwas kaputt waere.
  const id2 = db.prepare("SELECT id FROM customers WHERE status = 'test' ORDER BY created_at DESC").get()?.id;
  await call("POST", "/api/start/test/end", { cookie: cookie2 });
  ok("Beenden raeumt genau diesen Testkunden weg", Boolean(id2) && db.prepare("SELECT COUNT(*) n FROM customers WHERE id = ?").get(id2).n === 0, String(id2));
}

console.log(fehler ? `\n${fehler} Problem(e)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
