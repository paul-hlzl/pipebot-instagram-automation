#!/usr/bin/env node
/**
 * Black-box-HTTP-Tests fuer das Easy Onboarding (Sandbox-Auftrag 19.09.2026). NUR gegen die
 * Staging-Instanz (Port 3100, panel-staging.db) - nie Produktion.
 *
 * ACHTUNG, echte Kosten: ein Lauf erzeugt genau EINE echte Vorschau (Website-Analyse + Texte der
 * Woche + hoechstens PANEL_PREVIEW_IMAGES_UNVERIFIED Bilder), einmal "Anders machen" und den
 * Bild-Nachtrag nach der Bestaetigung - zusammen rund 0,10 USD (gemessene Einzelpreise in
 * usage_costs). Die Kostenschutz-Grenzen werden dagegen OHNE Kosten getestet: die Zaehler-Tabelle
 * wird direkt befuellt und danach wieder geleert.
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

// Turnstile ist in der Sandbox mit Cloudflares Test-Schluesseln aktiv (docs/SANDBOX.md) - der
// Server verlangt dann ein Token; das Test-Secret akzeptiert jeden Wert (siehe test-panel.mjs).
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
function seedPreview(ip, domain, ageMs = 60_000) {
  const id = `prev_test_${Math.random().toString(36).slice(2, 11)}`;
  db.prepare("INSERT INTO start_previews (id, ip, domain, email, customer_id, kind, created_at) VALUES (?, ?, ?, ?, ?, 'preview', ?)")
    .run(id, ip, domain, "seed@example.invalid", "cus_seed", new Date(Date.now() - ageMs).toISOString());
  seeded.push(id);
}
function unseed() {
  if (seeded.length) db.prepare(`DELETE FROM start_previews WHERE id IN (${seeded.map(() => "?").join(",")})`).run(...seeded);
  seeded.length = 0;
}

async function waitForJob(cookie, { timeoutMs = 240_000, until } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const { json } = await call("GET", "/api/start/status", { cookie });
    last = json;
    const phase = json.job?.phase;
    if (until ? until(json) : (phase === "done" || phase === "error" || phase === "idle")) return json;
    await sleep(2000);
  }
  return last;
}

let customerId = null;
try {
  console.log(`Easy Onboarding gegen ${BASE}${MOUNT} (Website: ${WEBSITE})\n`);
  const health = await fetch(`${BASE}/health`);
  ok("Staging-Server antwortet", health.ok);

  console.log("\nStatische Auslieferung:");
  {
    const a = await call("GET", "/start/");
    ok("GET /start/ liefert die neue Oberflaeche", a.res.status === 200 && a.text.includes("start.js"), String(a.res.status));
    const b = await call("GET", "/start");
    ok("GET /start (ohne Slash) ebenfalls", b.res.status === 200 && b.text.includes("start.js"));
    const c = await call("GET", "/start/start.css");
    ok("start.css wird ausgeliefert", c.res.status === 200 && c.text.includes("--ink"));
    const d = await call("GET", "/");
    ok("Klassisches Panel ohne Session unveraendert erreichbar", d.res.status === 200 && d.text.includes("panel.js"));
  }

  console.log("\nBildschirm 1 - Einstieg:");
  {
    const bad = await call("POST", "/api/start/begin", { body: { email: "kein-mail" } });
    ok("Ungueltige E-Mail -> 400 mit Feldfehler", bad.res.status === 400 && bad.json.fields?.email, bad.text.slice(0, 80));
    const neu = await call("POST", "/api/start/begin", { body: { email: `neu-${Date.now()}@example.invalid` } });
    ok("Unbekannte Adresse -> status new", neu.json.status === "new", neu.text.slice(0, 80));
    const bekannt = await call("POST", "/api/start/begin", { body: { email: KNOWN_EMAIL } });
    ok("Bekannte Adresse -> status known (Einmal-Anmeldelink per Mail, hier Dry-Run)", bekannt.json.status === "known", bekannt.text.slice(0, 80));
    const tokRow = db.prepare("SELECT login_link_token_hash, login_link_expires_at FROM customers WHERE email = ?").get(KNOWN_EMAIL);
    ok("Einmal-Token mit Ablauf gespeichert, dauerhafter Zugangslink NICHT ersetzt", tokRow?.login_link_token_hash && tokRow?.login_link_expires_at > new Date().toISOString());
    // Einmal-Link ausprobieren: Token in der DB durch einen bekannten ersetzen (der echte steht nur in der Dry-Run-Mail).
    const einmal = `einmal-${Date.now()}`;
    db.prepare("UPDATE customers SET login_link_token_hash = ? WHERE email = ?").run(sha256(einmal), KNOWN_EMAIL);
    const l1 = await call("GET", `/login?key=${einmal}`);
    ok("Einmal-Link meldet an (303 ohne error)", l1.res.status === 303 && !/error=/.test(l1.res.headers.get("location") || ""), l1.res.headers.get("location"));
    const l2 = await call("GET", `/login?key=${einmal}`);
    ok("Einmal-Link ist danach verbraucht", /error=login/.test(l2.res.headers.get("location") || ""));
  }

  console.log("\nKostenschutz (serverseitig, ohne echte Generierung):");
  {
    const email = `quota-${Date.now()}@example.invalid`;
    const miss = await call("POST", "/api/start/preview", { body: { email } });
    ok("Ohne Website und Beschreibung -> 400", miss.res.status === 400, String(miss.res.status));

    seedPreview("203.0.113.9", "a.example"); seedPreview("203.0.113.9", "b.example"); seedPreview("203.0.113.9", "c.example");
    const ip = await call("POST", "/api/start/preview", { body: { email, website: "d.example" }, headers: { "x-forwarded-for": "203.0.113.9" } });
    ok("3 Vorschauen von derselben IP in 24h -> 429 (Grund ip)", ip.res.status === 429 && ip.json.reason === "ip", ip.text.slice(0, 100));

    seedPreview("203.0.113.50", "quota-test.example"); seedPreview("203.0.113.51", "quota-test.example");
    const dom = await call("POST", "/api/start/preview", { body: { email, website: "https://www.quota-test.example/" }, headers: { "x-forwarded-for": "203.0.113.77" } });
    ok("2 Vorschauen fuer dieselbe Domain -> 429 (Grund domain), Domain normalisiert", dom.res.status === 429 && dom.json.reason === "domain", dom.text.slice(0, 100));

    unseed();
    seedPreview("203.0.113.9", "alt.example", 25 * 3_600_000); seedPreview("203.0.113.9", "alt2.example", 25 * 3_600_000); seedPreview("203.0.113.9", "alt3.example", 25 * 3_600_000);
    const alt = await call("POST", "/api/start/preview", { body: { email, website: "e.example" }, headers: { "x-forwarded-for": "203.0.113.9" } });
    ok("Zaehler aelter als 24h zaehlen nicht mehr (Fehler kommt jetzt vom Abruf, nicht vom Deckel)", alt.res.status !== 429 || alt.json.reason !== "ip", alt.text.slice(0, 100));
    unseed();

    for (let i = 0; i < 40; i++) seedPreview(`198.51.100.${i}`, `g${i}.example`);
    const glob = await call("POST", "/api/start/preview", { body: { email, website: "h.example" }, headers: { "x-forwarded-for": "203.0.113.200" } });
    ok("40 Vorschauen weltweit am Tag -> 429 (Grund global)", glob.res.status === 429 && glob.json.reason === "global", glob.text.slice(0, 100));
    unseed();

    const known = await call("POST", "/api/start/preview", { body: { email: KNOWN_EMAIL, website: "pipeflow.at" }, headers: { "x-forwarded-for": "203.0.113.201" } });
    ok("Bekannte E-Mail bekommt keine zweite Vorschau (409, known)", known.res.status === 409 && known.json.known === true, known.text.slice(0, 100));
  }

  console.log("\nBildschirm 2 -> 4 - echte Vorschau (kostet ca. 0,03 USD):");
  const email = `easy-${Date.now()}@example.invalid`;
  let cookie = "";
  {
    const t0 = Date.now();
    const r = await call("POST", "/api/start/preview", { body: { email, website: WEBSITE }, headers: { "x-forwarded-for": "203.0.113.150" } });
    cookie = cookieOf(r.res);
    ok("Vorschau gestartet (201, status started, Session-Cookie)", r.res.status === 201 && r.json.status === "started" && cookie.includes("pp_session"), r.text.slice(0, 160));
    customerId = null;
    const row = db.prepare("SELECT id, company, ui_mode, approval_mode, ig_feed_enabled, ig_story_enabled, linkedin_enabled, frequency, email_verified FROM customers WHERE email = ?").get(email);
    customerId = row?.id ?? null;
    ok("Kunde angelegt mit ui_mode=easy, Freigabe an, Feed+LinkedIn, werktags, unbestaetigt", row && row.ui_mode === "easy" && row.approval_mode === 1 && row.ig_feed_enabled === 1 && row.ig_story_enabled === 0 && row.linkedin_enabled === 1 && row.frequency === "werktags" && row.email_verified === 0, JSON.stringify(row));
    ok("Firmenname aus der Website abgeleitet (nicht leer, nicht 'Mein Unternehmen')", row && row.company && row.company !== "Mein Unternehmen", row?.company);
    ok("Antwort enthaelt Zusammenfassung mit Themen", Array.isArray(r.json.summary?.pillars) && r.json.summary.pillars.length >= 1, JSON.stringify(r.json.summary?.pillars));
    ok("Kostenschutz-Zaehler geschrieben", db.prepare("SELECT COUNT(*) AS n FROM start_previews WHERE customer_id = ?").get(customerId).n === 1);

    const st = await waitForJob(cookie);
    const secs = Math.round((Date.now() - t0) / 1000);
    ok(`Lauf beendet (phase done) nach ${secs}s`, st?.job?.phase === "done", JSON.stringify(st?.job));
    const posts = st?.posts ?? [];
    ok("Mindestens 5 Beitraege fuer die Woche (werktags, 2 Kanaele)", posts.length >= 5, String(posts.length));
    ok("Nur Feed + LinkedIn geplant (Story aus)", posts.every((p) => ["ig_feed", "linkedin"].includes(p.channel)));
    ok("Jeder Beitrag hat Headline und Caption", posts.every((p) => p.headline && p.caption));
    const limit = st?.summary?.limits?.imagesUnverified ?? 3;
    ok(`Hoechstens ${limit} echte Bilder vor der Bestaetigung (Deckel)`, st.imagesDone <= limit && st.imagesDone >= Math.min(limit, posts.length), `${st.imagesDone}/${posts.length}`);
    ok("Restliche Beitraege bewusst ohne Bild (image_url NULL)", posts.length <= limit || posts.some((p) => p.imageUrl === null));
    const costs = db.prepare("SELECT feature, COUNT(*) AS n, ROUND(SUM(estimated_cost_usd), 4) AS usd FROM usage_costs WHERE customer_id = ? GROUP BY feature").all(customerId);
    console.log("     Kosten dieses Kunden:", JSON.stringify(costs));
    const total = costs.reduce((s, c) => s + (c.usd || 0), 0);
    ok("Gesamtkosten der unbestaetigten Vorschau unter 0,08 USD", total < 0.08, total.toFixed(4));
  }

  console.log("\nAlte Oberflaeche / Koexistenz:");
  {
    const root = await call("GET", "/", { cookie });
    ok("Easy-Kunde: GET / leitet auf /start/ um", root.res.status === 302 && /\/start\/$/.test(root.res.headers.get("location") || ""), `${root.res.status} ${root.res.headers.get("location")}`);
    const classic = await call("GET", "/?classic=1", { cookie });
    ok("?classic=1 zeigt dem Easy-Kunden das klassische Panel", classic.res.status === 200 && classic.text.includes("panel.js"));
    const me = await call("GET", "/api/me", { cookie });
    ok("/api/me liefert uiMode easy, planTier basic, features-Objekt", me.json.customer?.uiMode === "easy" && me.json.customer?.planTier === "basic" && me.json.customer?.features?.analytics === false, JSON.stringify({ u: me.json.customer?.uiMode, t: me.json.customer?.planTier }));
    const keyA = process.env.SANDBOX_KEY_A;
    if (keyA) {
      const login = await call("GET", `/login?key=${keyA}`);
      const ck = cookieOf(login.res);
      const rootA = await call("GET", "/", { cookie: ck });
      ok("Bestehender Kunde (Testfirma Eins): GET / bleibt das klassische Panel (200, keine Umleitung)", rootA.res.status === 200 && rootA.text.includes("panel.js"), String(rootA.res.status));
      const meA = await call("GET", "/api/me", { cookie: ck });
      ok("Bestehender Kunde: uiMode classic", meA.json.customer?.uiMode === "classic");
    } else {
      console.log("     (SANDBOX_KEY_A nicht gesetzt - Bestandskunden-Check uebersprungen; laden mit: set -a && . /root/sandbox-keys.env && set +a)");
    }
  }

  console.log("\nBildschirm 5 - Plan aendern (bestehendes PATCH /api/me) und Umsortieren:");
  {
    const p = await call("PATCH", "/api/me", { cookie, body: { frequency: "3x-woche", activeWeekdays: "", instagramWeekdays: "", linkedinWeekdays: "" } });
    ok("Rhythmus per PATCH geaendert", p.res.status === 200 && p.json.customer?.frequency === "3x-woche", p.text.slice(0, 100));
    const st = await call("GET", "/api/start/status", { cookie });
    const li = st.json.posts.filter((x) => x.channel === "linkedin" && x.status === "planned").sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
    if (li.length >= 2) {
      const [a, b] = li;
      const r = await call("POST", "/api/planned-posts/reorder", { cookie, body: { channel: "linkedin", ids: [b.id, a.id] } });
      const na = r.json.posts?.find((x) => x.id === a.id);
      const nb = r.json.posts?.find((x) => x.id === b.id);
      ok("Umsortieren tauscht die Termine zweier Beitraege desselben Kanals", r.res.status === 200 && na?.scheduledFor === b.scheduledFor && nb?.scheduledFor === a.scheduledFor, r.text.slice(0, 160));
      const dup = db.prepare("SELECT channel, scheduled_for, COUNT(*) AS n FROM planned_posts WHERE customer_id = ? GROUP BY channel, scheduled_for HAVING n > 1").all(customerId);
      ok("Nach dem Umsortieren nie zwei Beitraege fuer denselben Kanal/Tag (Routine sieht weiter genau einen)", dup.length === 0, JSON.stringify(dup));
      const bad = await call("POST", "/api/planned-posts/reorder", { cookie, body: { channel: "linkedin", ids: [a.id, "plan_gibtsnicht"] } });
      ok("Unbekannte id -> 400", bad.res.status === 400);
      const mix = await call("POST", "/api/planned-posts/reorder", { cookie, body: { channel: "ig_feed", ids: [a.id, b.id] } });
      ok("Falscher Kanal -> 400", mix.res.status === 400);
    } else {
      ok("Umsortieren (zu wenige LinkedIn-Beitraege zum Testen)", true);
    }
  }

  console.log("\nBildschirm 4b - Anders machen (kostet ca. 0,03 USD):");
  {
    const r = await call("POST", "/api/start/adjust", { cookie, body: { wish: "lockerer im Ton, keine Preise nennen" } });
    ok("Anpassung angenommen (status started)", r.res.status === 200 && r.json.status === "started", r.text.slice(0, 160));
    const c = db.prepare("SELECT tone, avoid_topics, branding_last_changed_at FROM customers WHERE id = ?").get(customerId);
    ok("Wunsch auf bestehende Felder abgebildet (Tonalitaet/vermeiden), Profilwechsel vermerkt", c && c.branding_last_changed_at && (c.tone === "locker" || (c.avoid_topics || "").length > 0), JSON.stringify(c));
    const st = await waitForJob(cookie);
    ok("Neuschreiben beendet", st?.job?.phase === "done", JSON.stringify(st?.job));
    const limit = st?.summary?.limits?.imagesUnverified ?? 3;
    ok("Bild-Deckel gilt auch beim Neuschreiben", (st?.imagesDone ?? 0) <= limit, String(st?.imagesDone));
    const again = await call("POST", "/api/start/adjust", { cookie, body: { wish: "noch lockerer" } });
    ok("Zweite Anpassung vor der Bestaetigung -> 429 (Grund unverified)", again.res.status === 429 && again.json.reason === "unverified", again.text.slice(0, 120));
  }

  console.log("\nE-Mail-Bestaetigung -> Bild-Nachtrag (kostet ca. 0,02 USD):");
  {
    const token = `test-token-${Date.now()}`;
    db.prepare("UPDATE customers SET email_verify_token_hash = ? WHERE id = ?").run(sha256(token), customerId);
    const v = await call("GET", `/verify-email?token=${token}`);
    ok("Verify leitet Easy-Kunden auf /start/?verified=1", v.res.status === 303 && /\/start\/\?verified=1$/.test(v.res.headers.get("location") || ""), `${v.res.status} ${v.res.headers.get("location")}`);
    const st = await waitForJob(cookie, { until: (j) => j.job?.kind === "backfill" && ["done", "error"].includes(j.job.phase) });
    ok("Bild-Nachtrag gelaufen (Job backfill done)", st?.job?.kind === "backfill" && st.job.phase === "done", JSON.stringify(st?.job));
    const posts = st?.posts ?? [];
    ok("Nach der Bestaetigung hat jeder Beitrag ein Bild", posts.length > 0 && posts.every((p) => Boolean(p.imageUrl)), `${posts.filter((p) => p.imageUrl).length}/${posts.length}`);
    const me = await call("GET", "/api/me", { cookie });
    ok("emailVerified true", me.json.customer?.emailVerified === true);
  }

  console.log("\nBildschirm 6 / Dashboard:");
  {
    const s = await call("POST", "/api/skip-provider/instagram", { cookie });
    ok("Spaeter verbinden wird serverseitig gespeichert (bestehender Endpunkt)", s.res.status === 200 && (s.json.customer?.skippedProviders || []).includes("instagram"));
    const t = await call("POST", "/api/tour-done", { cookie });
    ok("Plan uebernommen (tour-done als Onboarding-Abschluss)", t.res.status === 200 && t.json.customer?.tourDone === true);
    const root = await call("GET", "/", { cookie });
    ok("Auch danach: GET / -> /start/", root.res.status === 302);
    const pn = await call("POST", "/api/post-now", { cookie, body: { channels: ["linkedin"], topic: "Testthema", format: "single" } });
    ok("Jetzt posten (bestehender Endpunkt) nimmt die Anfrage an", pn.res.status === 200 && (pn.json.customer?.postRequests || []).some((r) => r.channel === "linkedin"), pn.text.slice(0, 120));
    await call("POST", "/api/post-now/cancel", { cookie, body: {} });
  }

  console.log("\nSicherheitskopf auf der neuen Seite:");
  {
    const r = await call("GET", "/start/");
    ok("CSP + X-Frame-Options gesetzt (gleiche Middleware wie das klassische Panel)", Boolean(r.res.headers.get("content-security-policy")) && r.res.headers.get("x-frame-options") === "DENY");
  }
} catch (err) {
  fail++;
  failures.push(`Abbruch: ${err.message}`);
  console.error("Testlauf abgebrochen:", err);
} finally {
  unseed();
  if (customerId) {
    db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
    db.prepare("DELETE FROM start_previews WHERE customer_id = ?").run(customerId);
    console.log(`\n(Cleanup: Test-Kunde ${customerId} entfernt)`);
  }
  db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFehlgeschlagen:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
