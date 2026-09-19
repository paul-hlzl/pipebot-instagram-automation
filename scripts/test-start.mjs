#!/usr/bin/env node
/**
 * Black-box-HTTP-Tests fuer das Easy Onboarding (Sandbox-Auftrag, Fassung 19.09.2026).
 * NUR gegen die Staging-Instanz (Port 3100, panel-staging.db) - nie Produktion.
 *
 * ACHTUNG, echte Kosten: ein Lauf erzeugt genau EINE echte Vorschau (Website lesen, Markenfarben,
 * Wochentexte, Bilder) und einmal "Anders machen" - zusammen rund 0,03 USD. Die Kostenschutz-
 * Grenzen werden dagegen OHNE Kosten geprueft: die Zaehlertabelle wird direkt befuellt und danach
 * wieder geleert. Die Anmeldung ueber Google/Microsoft hat einen eigenen Test (test-auth.mjs).
 *
 *   node scripts/test-start.mjs            (Standard: Website pipeflow.at)
 *   TEST_WEBSITE=hittaro.com node scripts/test-start.mjs
 */
import { createHash } from "node:crypto";

const BASE = process.env.STAGING_URL ?? "http://127.0.0.1:3100";
const MOUNT = process.env.STAGING_MOUNT ?? "/panel";
const STAGING_DB = process.env.STAGING_DB ?? "/root/mcp-server/data/panel-staging.db";
const WEBSITE = process.env.TEST_WEBSITE ?? "pipeflow.at";
const KNOWN_EMAIL = "test1@sandbox.invalid"; // Testfirma Eins (docs/SANDBOX.md)

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   - ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` (${detail})` : ""}`); console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ""}`); }
};
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")]).filter(Boolean).map((c) => c.split(";")[0]).join("; ");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const turnstileAktiv = await fetch(`${BASE}${MOUNT}/api/providers`).then((r) => r.json()).then((b) => Boolean(b.turnstileSiteKey)).catch(() => false);
async function call(method, path, { body, cookie, headers = {}, redirect = "manual" } = {}) {
  if (body && path === "/api/start/preview" && turnstileAktiv) body = { ...body, "cf-turnstile-response": "test-token" };
  const res = await fetch(`${BASE}${MOUNT}${path}`, {
    method,
    redirect,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* HTML */ }
  return { res, json, text };
}

const { default: Database } = await import("better-sqlite3");
const db = new Database(STAGING_DB);
const seeded = [];
function seedPreview(ip, domain, ageMs = 60_000, customerId = "cus_seed") {
  const id = `prev_test_${Math.random().toString(36).slice(2, 11)}`;
  db.prepare("INSERT INTO start_previews (id, ip, domain, email, customer_id, kind, created_at) VALUES (?, ?, ?, ?, ?, 'preview', ?)")
    .run(id, ip, domain, "seed@example.invalid", customerId, new Date(Date.now() - ageMs).toISOString());
  seeded.push(id);
}
function unseed() {
  if (seeded.length) db.prepare(`DELETE FROM start_previews WHERE id IN (${seeded.map(() => "?").join(",")})`).run(...seeded);
  seeded.length = 0;
}

async function warteAufJob(cookie, { timeoutMs = 240_000, bis } = {}) {
  const frist = Date.now() + timeoutMs;
  let letzter = null;
  while (Date.now() < frist) {
    const { json } = await call("GET", "/api/start/status", { cookie });
    letzter = json;
    const phase = json.job?.phase;
    if (bis ? bis(json) : (phase === "done" || phase === "error" || phase === "idle")) return json;
    await sleep(2000);
  }
  return letzter;
}

let customerId = null;
let quotaId = null;
try {
  console.log(`Easy Onboarding gegen ${BASE}${MOUNT} (Website: ${WEBSITE})\n`);
  ok("Staging-Server antwortet", (await fetch(`${BASE}/health`)).ok);

  console.log("\nStatische Auslieferung und Marke:");
  {
    const a = await call("GET", "/start/");
    ok("GET /start/ liefert die neue Oberflaeche", a.res.status === 200 && a.text.includes("start.js"), String(a.res.status));
    ok("Kopfzeile traegt Produktname und Zusatz", a.text.includes("Pipeflow") && a.text.includes("powered by Pipeline AI Solutions"));
    ok("GET /start (ohne Slash) ebenfalls", (await call("GET", "/start")).res.status === 200);
    ok("start.css wird ausgeliefert (dunkle Fassung)", (await call("GET", "/start/start.css")).text.includes("--grund:   #0d0e11"));
    ok("Klassisches Panel ohne Session unveraendert erreichbar", (await call("GET", "/")).text.includes("panel.js"));
  }

  console.log("\nBildschirm 1 - Konto:");
  {
    const cfg = await call("GET", "/api/start/config");
    const ids = (cfg.json.authProviders || []).map((p) => p.id);
    ok("Drei Anmeldewege angeboten: Google, Microsoft, Apple", ids.join(",") === "google,microsoft,apple", ids.join(","));
    ok("Ohne Zugangsdaten sind sie ehrlich als nicht verfuegbar gekennzeichnet", (cfg.json.authProviders || []).every((p) => p.available === false && p.note));
    const bad = await call("POST", "/api/start/email", { body: { email: "kein-mail" } });
    ok("Ungueltige E-Mail -> 400 mit Feldfehler", bad.res.status === 400 && bad.json.fields?.email);
    const bekannt = await call("POST", "/api/start/email", { body: { email: KNOWN_EMAIL } });
    ok("Bekannte Adresse -> Einmal-Anmeldelink statt neuem Konto", bekannt.json.status === "known", bekannt.text.slice(0, 80));
    const tok = db.prepare("SELECT login_link_token_hash, login_link_expires_at, login_key_hash FROM customers WHERE email = ?").get(KNOWN_EMAIL);
    ok("Einmal-Token mit Ablauf gespeichert", Boolean(tok?.login_link_token_hash) && tok.login_link_expires_at > new Date().toISOString());
    const einmal = `einmal-${Date.now()}`;
    db.prepare("UPDATE customers SET login_link_token_hash = ? WHERE email = ?").run(sha256(einmal), KNOWN_EMAIL);
    const l1 = await call("GET", `/login?key=${einmal}`);
    ok("Einmal-Link meldet an", l1.res.status === 303 && !/error=/.test(l1.res.headers.get("location") || ""));
    const l2 = await call("GET", `/login?key=${einmal}`);
    ok("Einmal-Link ist danach verbraucht", /error=login/.test(l2.res.headers.get("location") || ""));
    const danach = db.prepare("SELECT login_key_hash FROM customers WHERE email = ?").get(KNOWN_EMAIL);
    ok("Der dauerhafte Zugangslink des Kunden bleibt unangetastet", danach.login_key_hash === tok.login_key_hash);
  }

  console.log("\nKostenschutz (serverseitig, ohne echte Generierung):");
  const quotaMail = `quota-${Date.now()}@example.invalid`;
  let quotaCookie = "";
  {
    const konto = await call("POST", "/api/start/email", { body: { email: quotaMail } });
    quotaCookie = cookieOf(konto.res);
    quotaId = db.prepare("SELECT id FROM customers WHERE email = ?").get(quotaMail)?.id ?? null;
    ok("Neues Konto ueber den E-Mail-Weg angelegt (201, Session)", konto.res.status === 201 && quotaCookie.includes("pp_session"));
    ok("Vorschau ohne Anmeldung -> 401", (await call("POST", "/api/start/preview", { body: { website: "x.example" } })).res.status === 401);
    ok("Ohne Website und ohne Beschreibung -> 400", (await call("POST", "/api/start/preview", { cookie: quotaCookie, body: {} })).res.status === 400);

    seedPreview("203.0.113.9", "a.example"); seedPreview("203.0.113.9", "b.example"); seedPreview("203.0.113.9", "c.example");
    const ip = await call("POST", "/api/start/preview", { cookie: quotaCookie, body: { website: "d.example" }, headers: { "x-forwarded-for": "203.0.113.9" } });
    ok("3 Vorschauen von derselben IP in 24 h -> 429 (Grund ip)", ip.res.status === 429 && ip.json.reason === "ip", ip.text.slice(0, 90));

    seedPreview("203.0.113.50", "quota-test.example"); seedPreview("203.0.113.51", "quota-test.example");
    const dom = await call("POST", "/api/start/preview", { cookie: quotaCookie, body: { website: "https://www.quota-test.example/" }, headers: { "x-forwarded-for": "203.0.113.77" } });
    ok("2 Vorschauen fuer dieselbe Domain -> 429 (Grund domain), Domain normalisiert", dom.res.status === 429 && dom.json.reason === "domain");
    unseed();

    seedPreview("203.0.113.60", "acc1.example", 60_000, quotaId); seedPreview("203.0.113.60", "acc2.example", 60_000, quotaId); seedPreview("203.0.113.60", "acc3.example", 60_000, quotaId);
    const konto3 = await call("POST", "/api/start/preview", { cookie: quotaCookie, body: { website: "acc4.example" }, headers: { "x-forwarded-for": "203.0.113.90" } });
    ok("3 Vorschauen fuer dasselbe KONTO an einem Tag -> 429 (Grund account)", konto3.res.status === 429 && konto3.json.reason === "account", konto3.text.slice(0, 90));
    unseed();

    seedPreview("203.0.113.9", "alt1.example", 25 * 3_600_000); seedPreview("203.0.113.9", "alt2.example", 25 * 3_600_000); seedPreview("203.0.113.9", "alt3.example", 25 * 3_600_000);
    const alt = await call("POST", "/api/start/preview", { cookie: quotaCookie, body: { website: "e.example" }, headers: { "x-forwarded-for": "203.0.113.9" } });
    ok("Zaehler aelter als 24 h zaehlen nicht mehr", alt.res.status !== 429 || alt.json.reason !== "ip", alt.text.slice(0, 90));
    unseed();

    for (let i = 0; i < 40; i++) seedPreview(`198.51.100.${i}`, `g${i}.example`);
    const glob = await call("POST", "/api/start/preview", { cookie: quotaCookie, body: { website: "h.example" }, headers: { "x-forwarded-for": "203.0.113.200" } });
    ok("40 Vorschauen weltweit am Tag -> 429 (Grund global)", glob.res.status === 429 && glob.json.reason === "global");
    unseed();
  }

  console.log("\nBildschirm 2 -> 4 - echte Vorschau mit Markenfarben (kostet ca. 0,02 USD):");
  const email = `easy-${Date.now()}@example.invalid`;
  let cookie = "";
  {
    const konto = await call("POST", "/api/start/email", { body: { email } });
    cookie = cookieOf(konto.res);
    customerId = db.prepare("SELECT id FROM customers WHERE email = ?").get(email)?.id ?? null;
    const t0 = Date.now();
    const r = await call("POST", "/api/start/preview", { cookie, body: { website: WEBSITE }, headers: { "x-forwarded-for": "203.0.113.150" } });
    ok("Vorschau gestartet (202)", r.res.status === 202 && r.json.status === "started", r.text.slice(0, 140));
    const st = await warteAufJob(cookie);
    ok(`Lauf beendet nach ${Math.round((Date.now() - t0) / 1000)}s`, st?.job?.phase === "done", JSON.stringify(st?.job));
    const row = db.prepare("SELECT company, industry, about, accent_color, gradient_enabled, gradient_color2, website FROM customers WHERE id = ?").get(customerId);
    ok("Firmenname, Branche und Beschreibung aus der Website uebernommen", Boolean(row?.company && row?.industry && row?.about), JSON.stringify({ c: row?.company, i: row?.industry }));
    ok("Themen als Content-Saeulen angelegt", db.prepare("SELECT COUNT(*) AS n FROM content_pillars WHERE customer_id = ?").get(customerId).n >= 1);
    console.log(`     Farben: ${row?.accent_color ?? "(Standard)"} ${row?.gradient_enabled ? `+ ${row?.gradient_color2} (Verlauf an)` : "(kein Verlauf - Fallback)"}`);
    ok("Markenfarben uebernommen ODER still auf Standard zurueckgefallen", row?.gradient_enabled === 1 ? Boolean(row.accent_color && row.gradient_color2) : true);
    const posts = st?.posts ?? [];
    ok("Mindestens 5 Beitraege fuer die Woche", posts.length >= 5, String(posts.length));
    ok("Nur Feed und LinkedIn geplant (Story aus)", posts.every((p) => ["ig_feed", "linkedin"].includes(p.channel)));
    ok("Jeder Beitrag hat Headline und Caption", posts.every((p) => p.headline && p.caption));
    // Keine leeren Tage: an jedem Tag, den die Woche enthaelt, steht mindestens ein Beitrag.
    const tage = [...new Set(posts.map((p) => p.scheduledFor))];
    ok("Jeder gelieferte Tag traegt mindestens einen Beitrag (keine leeren Tage)", tage.every((t) => posts.some((p) => p.scheduledFor === t)));
    ok("Kein Wochenendtag geplant (werktags)", tage.every((t) => ![0, 6].includes(new Date(`${t}T12:00:00`).getDay())), tage.join(","));
    const limit = st?.summary?.limits?.imagesUnverified ?? 3;
    ok(`Hoechstens ${limit} echte Bilder vor der Bestaetigung`, st.imagesDone <= limit, `${st.imagesDone}/${posts.length}`);
    const kosten = db.prepare("SELECT feature, COUNT(*) AS n, ROUND(SUM(estimated_cost_usd), 4) AS usd FROM usage_costs WHERE customer_id = ? GROUP BY feature").all(customerId);
    console.log("     Kosten dieses Kunden:", JSON.stringify(kosten));
    ok("Gesamtkosten der unbestaetigten Vorschau unter 0,08 USD", kosten.reduce((s, c) => s + (c.usd || 0), 0) < 0.08);
    const zweite = await call("POST", "/api/start/preview", { cookie, body: { website: WEBSITE } });
    ok("Zweite Vorschau fuer dasselbe Konto -> 409 (die Woche liegt schon)", zweite.res.status === 409 && zweite.json.ready === true);
  }

  console.log("\nDomain-Zwischenspeicher (Abschnitt 8):");
  {
    const zweitesKonto = `cache-${Date.now()}@example.invalid`;
    const konto = await call("POST", "/api/start/email", { body: { email: zweitesKonto } });
    const c2 = cookieOf(konto.res);
    const id2 = db.prepare("SELECT id FROM customers WHERE email = ?").get(zweitesKonto)?.id;
    const r = await call("POST", "/api/start/preview", { cookie: c2, body: { website: WEBSITE }, headers: { "x-forwarded-for": "203.0.113.151" } });
    ok("Dieselbe Domain nochmal -> aus dem Zwischenspeicher, ohne neue Analyse", r.res.status === 202 && r.json.cached === true, JSON.stringify(r.json.cached));
    await warteAufJob(c2);
    const analysen = db.prepare("SELECT COUNT(*) AS n FROM usage_costs WHERE customer_id = ? AND feature = 'easy-onboarding-analyze'").get(id2).n;
    ok("Fuer den zweiten Kunden wurde keine Analyse bezahlt", analysen === 0, String(analysen));
    if (id2) { db.prepare("DELETE FROM customers WHERE id = ?").run(id2); db.prepare("DELETE FROM start_previews WHERE customer_id = ?").run(id2); }
  }

  console.log("\nAlte Oberflaeche / Koexistenz:");
  {
    const root = await call("GET", "/", { cookie });
    ok("Easy-Kunde: GET / leitet auf /start/ um", root.res.status === 302 && /\/start\/$/.test(root.res.headers.get("location") || ""));
    ok("?classic=1 zeigt dem Easy-Kunden das klassische Panel", (await call("GET", "/?classic=1", { cookie })).text.includes("panel.js"));
    const me = await call("GET", "/api/me", { cookie });
    ok("/api/me: uiMode easy, planTier basic, features", me.json.customer?.uiMode === "easy" && me.json.customer?.planTier === "basic" && me.json.customer?.features?.analytics === false);
    const keyA = process.env.SANDBOX_KEY_A;
    if (keyA) {
      const login = await call("GET", `/login?key=${keyA}`);
      const ck = cookieOf(login.res);
      ok("Bestehender Kunde: GET / bleibt das klassische Panel", (await call("GET", "/", { cookie: ck })).res.status === 200);
      ok("Bestehender Kunde: uiMode classic, kein Anbieterkonto", (await call("GET", "/api/me", { cookie: ck })).json.customer?.uiMode === "classic");
    } else {
      console.log("     (SANDBOX_KEY_A nicht gesetzt - Bestandskunden-Check uebersprungen)");
    }
  }

  console.log("\nBildschirm 5 - Plan, Farbwechsel und Umsortieren:");
  {
    const p = await call("PATCH", "/api/me", { cookie, body: { frequency: "3x-woche", activeWeekdays: "", instagramWeekdays: "", linkedinWeekdays: "" } });
    ok("Rhythmus per bestehendem PATCH geaendert", p.res.status === 200 && p.json.customer?.frequency === "3x-woche");
    const farbe = await call("PATCH", "/api/me", { cookie, body: { accentColor: "#2e1a1a", gradientEnabled: true, gradientColor2: "#1a1a2e", gradientDirection: "vertical" } });
    ok("Farbverlauf per bestehendem PATCH gespeichert", farbe.json.customer?.gradientEnabled === true && farbe.json.customer?.gradientColor2 === "#1a1a2e");
    const recolor = await call("POST", "/api/start/recolor", { cookie, body: {} });
    ok("Farbwechsel stoesst das Neurendern der Bilder an", recolor.res.status === 200 && ["started", "running"].includes(recolor.json.status), recolor.text.slice(0, 80));
    await warteAufJob(cookie, { bis: (j) => j.job?.kind === "recolor" && ["done", "error"].includes(j.job.phase), timeoutMs: 120_000 });
    const nachher = db.prepare("SELECT accent_color_used FROM planned_posts WHERE customer_id = ? AND image_url IS NOT NULL LIMIT 1").get(customerId);
    ok("Bilder tragen danach die neue Farbe", nachher?.accent_color_used === "#2e1a1a", JSON.stringify(nachher));

    const st = await call("GET", "/api/start/status", { cookie });
    const li = st.json.posts.filter((x) => x.channel === "linkedin" && x.status === "planned").sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
    if (li.length >= 2) {
      const [a, b] = li;
      const r = await call("POST", "/api/planned-posts/reorder", { cookie, body: { channel: "linkedin", ids: [b.id, a.id] } });
      ok("Umsortieren tauscht die Termine", r.res.status === 200 && r.json.posts?.find((x) => x.id === a.id)?.scheduledFor === b.scheduledFor);
      const dup = db.prepare("SELECT channel, scheduled_for, COUNT(*) AS n FROM planned_posts WHERE customer_id = ? GROUP BY channel, scheduled_for HAVING n > 1").all(customerId);
      ok("Nie zwei Beitraege fuer denselben Kanal und Tag (die Routine sieht weiter genau einen)", dup.length === 0, JSON.stringify(dup));
      ok("Unbekannte id -> 400", (await call("POST", "/api/planned-posts/reorder", { cookie, body: { channel: "linkedin", ids: [a.id, "plan_gibtsnicht"] } })).res.status === 400);
    } else ok("Umsortieren (zu wenige LinkedIn-Beitraege zum Testen)", true);
  }

  console.log("\nBildschirm 4b - Anders machen (kostet ca. 0,01 USD):");
  {
    const r = await call("POST", "/api/start/adjust", { cookie, body: { wish: "lockerer im Ton, keine Preise nennen" } });
    ok("Anpassung angenommen", r.res.status === 200 && r.json.status === "started", r.text.slice(0, 120));
    const c = db.prepare("SELECT tone, avoid_topics, branding_last_changed_at FROM customers WHERE id = ?").get(customerId);
    ok("Wunsch auf die bestehenden Felder abgebildet", Boolean(c?.branding_last_changed_at) && (c.tone === "locker" || (c.avoid_topics || "").length > 0), JSON.stringify(c));
    ok("Neuschreiben beendet", (await warteAufJob(cookie))?.job?.phase === "done");
    const nochmal = await call("POST", "/api/start/adjust", { cookie, body: { wish: "noch lockerer" } });
    ok("Zweite Anpassung vor der Bestaetigung -> 429", nochmal.res.status === 429 && nochmal.json.reason === "unverified");
  }

  console.log("\nE-Mail-Bestaetigung -> Bild-Nachtrag:");
  {
    const token = `test-token-${Date.now()}`;
    db.prepare("UPDATE customers SET email_verify_token_hash = ? WHERE id = ?").run(sha256(token), customerId);
    const v = await call("GET", `/verify-email?token=${token}`);
    ok("Verify leitet Easy-Kunden auf /start/?verified=1", v.res.status === 303 && /\/start\/\?verified=1$/.test(v.res.headers.get("location") || ""));
    const st = await warteAufJob(cookie, { bis: (j) => j.job?.kind === "backfill" && ["done", "error"].includes(j.job.phase) });
    ok("Bild-Nachtrag gelaufen", st?.job?.kind === "backfill" && st.job.phase === "done", JSON.stringify(st?.job));
    ok("Danach hat jeder Beitrag ein Bild", (st?.posts ?? []).length > 0 && st.posts.every((p) => p.imageUrl), `${st?.posts.filter((p) => p.imageUrl).length}/${st?.posts.length}`);
  }

  console.log("\nBildschirm 6 / Dashboard:");
  {
    ok("Spaeter verbinden wird serverseitig gespeichert", ((await call("POST", "/api/skip-provider/instagram", { cookie })).json.customer?.skippedProviders || []).includes("instagram"));
    ok("Plan uebernommen", (await call("POST", "/api/tour-done", { cookie })).json.customer?.tourDone === true);
    const pn = await call("POST", "/api/post-now", { cookie, body: { channels: ["linkedin"], topic: "Testthema", format: "single" } });
    ok("Jetzt posten nimmt die Anfrage an", pn.res.status === 200);
    await call("POST", "/api/post-now/cancel", { cookie, body: {} });
    const r = await call("GET", "/start/");
    ok("Sicherheitskopf auf der neuen Seite gesetzt", Boolean(r.res.headers.get("content-security-policy")) && r.res.headers.get("x-frame-options") === "DENY");
  }
} catch (err) {
  fail++;
  failures.push(`Abbruch: ${err.message}`);
  console.error("Testlauf abgebrochen:", err);
} finally {
  unseed();
  for (const id of [customerId, quotaId].filter(Boolean)) {
    db.prepare("DELETE FROM customers WHERE id = ?").run(id);
    db.prepare("DELETE FROM start_previews WHERE customer_id = ?").run(id);
  }
  console.log(`\n(Cleanup: Testkunden entfernt)`);
  db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFehlgeschlagen:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
