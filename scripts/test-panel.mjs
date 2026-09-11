#!/usr/bin/env node
/**
 * Black-box HTTP test suite for the customer panel. Runs against a STAGING instance only
 * (never production) - set STAGING_URL / STAGING_DB to point elsewhere if needed.
 *
 * Deliberately avoids any codepath that calls a real external API (Instagram, LinkedIn,
 * fal.ai, Anthropic): signup/me/posts/health/admin auth checks all stay inside our own
 * server. /connect only builds a redirect URL, it does not call the provider. Endpoints
 * that DO call external APIs (OAuth callback, improve-briefing, style samples, publish)
 * are intentionally not exercised here - "no real calls" per session rules.
 */

const BASE = process.env.STAGING_URL ?? "http://127.0.0.1:3100";
const MOUNT = process.env.STAGING_MOUNT ?? "/panel";
const STAGING_DB = process.env.STAGING_DB ?? "data/panel-staging.db";

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok - ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` (${detail})` : ""}`);
    console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

function cookieHeader(setCookie) {
  if (!setCookie) return "";
  // Node's fetch exposes combined Set-Cookie via getSetCookie() on some versions; fall back to raw header.
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function waitForHealth(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // server still (re)starting, retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Staging-Server unter ${BASE} antwortet nicht (Timeout ${timeoutMs}ms)`);
}

async function main() {
  console.log(`Testing panel at ${BASE}${MOUNT} ...\n`);
  await waitForHealth();

  // --- 1. Signup validation errors ---
  console.log("Signup - Validierung:");
  {
    const res = await fetch(`${BASE}${MOUNT}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    ok("kein consent -> 400", res.status === 400, `status=${res.status}`);
    ok("fields.consent gesetzt", Boolean(body.fields?.consent), JSON.stringify(body));
  }
  {
    const res = await fetch(`${BASE}${MOUNT}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent: true, company: "", contactName: "", email: "not-an-email" }),
    });
    const body = await res.json();
    ok("ungueltige Pflichtfelder -> 400", res.status === 400, `status=${res.status}`);
    ok("fields.company gesetzt", Boolean(body.fields?.company), JSON.stringify(body));
    ok("fields.email gesetzt", Boolean(body.fields?.email), JSON.stringify(body));
  }

  // --- 2. Successful signup ---
  console.log("\nSignup - Erfolg:");
  const testEmail = `test-${Date.now()}@example.invalid`;
  let sessionCookie = "";
  let customerId = "";
  {
    const res = await fetch(`${BASE}${MOUNT}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        consent: true,
        company: "Test GmbH",
        contactName: "Test Person",
        email: testEmail,
        tone: "sachlich",
        frequency: "werktags",
        postTime: "15:00",
      }),
    });
    const body = await res.json();
    ok("erfolgreicher Signup -> 201", res.status === 201, `status=${res.status} body=${JSON.stringify(body)}`);
    ok("Firma im Response", body.customer?.company === "Test GmbH");
    sessionCookie = cookieHeader(res.headers.get("set-cookie"));
    ok("Session-Cookie gesetzt", sessionCookie.includes("pp_session="));
  }

  // --- 3. /api/me ---
  console.log("\n/api/me:");
  {
    const res = await fetch(`${BASE}${MOUNT}/api/me`, { headers: { cookie: sessionCookie } });
    const body = await res.json();
    ok("/api/me mit Session -> 200", res.status === 200, `status=${res.status}`);
    ok("/api/me liefert Firma", body.customer?.company === "Test GmbH");
  }
  {
    const res = await fetch(`${BASE}${MOUNT}/api/me`);
    ok("/api/me ohne Session -> 401", res.status === 401, `status=${res.status}`);
  }

  // --- 4. PATCH /api/me ---
  console.log("\nPATCH /api/me:");
  {
    const res = await fetch(`${BASE}${MOUNT}/api/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({
        company: "Test GmbH (geaendert)",
        contactName: "Test Person",
        email: testEmail,
        tone: "locker",
        frequency: "taeglich",
        postTime: "09:00",
      }),
    });
    const body = await res.json();
    ok("PATCH /api/me -> 200", res.status === 200, `status=${res.status}`);
    ok("Aenderung uebernommen", body.customer?.company === "Test GmbH (geaendert)", JSON.stringify(body.customer));
  }

  // Find the customerId directly from the DB for cleanup (not exposed via API by design).
  try {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(STAGING_DB, { readonly: true });
    const row = db.prepare("SELECT id FROM customers WHERE email = ?").get(testEmail);
    customerId = row?.id ?? "";
  } catch (e) {
    console.log(`  (Hinweis: konnte customerId fuer Cleanup nicht ermitteln: ${e.message})`);
  }

  // --- 5. /api/posts ohne Login ---
  console.log("\n/api/posts:");
  {
    const res = await fetch(`${BASE}${MOUNT}/api/posts`);
    ok("/api/posts ohne Login -> 401", res.status === 401, `status=${res.status}`);
  }
  {
    const res = await fetch(`${BASE}${MOUNT}/api/posts`, { headers: { cookie: sessionCookie } });
    const body = await res.json();
    ok("/api/posts mit Login -> 200", res.status === 200, `status=${res.status}`);
    ok("posts ist ein Array", Array.isArray(body.posts));
  }

  // --- 6. /connect ohne Session ---
  console.log("\n/connect:");
  {
    const res = await fetch(`${BASE}${MOUNT}/connect/instagram`, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    ok("/connect ohne Session -> redirect", res.status >= 300 && res.status < 400, `status=${res.status}`);
    ok("redirect enthaelt error=session", location.includes("error=session"), `location=${location}`);
  }

  // --- 7. /mcp ohne Bearer ---
  console.log("\n/mcp:");
  {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    ok("/mcp ohne Bearer -> 401", res.status === 401, `status=${res.status}`);
  }

  // Panel routes that don't exist yet fall through to the global MCP bearer-token gate
  // (mounted after the panel router in http-server.ts), which also answers 401 with the
  // same generic body - so a bare status check can't tell "not built yet" apart from
  // "built and correctly protected". Detect the gate's exact fallthrough body instead.
  async function isMcpGateFallthrough(res) {
    if (res.status !== 401) return false;
    try {
      const body = await res.clone().json();
      return body?.error === "Unauthorized";
    } catch {
      return false;
    }
  }

  // --- 8. Admin-Endpunkte ohne Auth (nur falls schon gebaut) ---
  console.log("\nAdmin (falls vorhanden):");
  {
    const res = await fetch(`${BASE}${MOUNT}/admin/api/customers`);
    if (await isMcpGateFallthrough(res)) {
      console.log("  skip - Admin-API noch nicht implementiert (Aufgabe 3 steht noch aus)");
    } else {
      ok("/admin/api/customers ohne Auth -> 401", res.status === 401, `status=${res.status}`);
    }
  }

  // --- 9. Health ---
  console.log("\nHealth (falls vorhanden):");
  {
    const res = await fetch(`${BASE}${MOUNT}/api/health`);
    if (await isMcpGateFallthrough(res)) {
      console.log("  skip - /panel/api/health noch nicht implementiert (Aufgabe 10 steht noch aus)");
    } else {
      ok("/panel/api/health -> 200", res.status === 200, `status=${res.status}`);
    }
  }

  // --- Cleanup: remove the test customer created above ---
  if (customerId) {
    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(STAGING_DB);
      db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
      console.log(`\n(Cleanup: Test-Kunde ${customerId} entfernt)`);
    } catch (e) {
      console.log(`\n(Cleanup fehlgeschlagen: ${e.message})`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFehlgeschlagen:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Testlauf abgebrochen:", err);
  process.exit(1);
});
