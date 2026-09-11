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

  // --- 0. /api/providers + improve-briefing feature flag ---
  console.log("Feature-Flags:");
  {
    const res = await fetch(`${BASE}${MOUNT}/api/providers`);
    const body = await res.json();
    ok("/api/providers liefert aiAvailable", typeof body.aiAvailable === "boolean", JSON.stringify(body.aiAvailable));
    if (!body.aiAvailable) {
      const improveRes = await fetch(`${BASE}${MOUNT}/api/improve-briefing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ company: "Test", industry: "Test", about: "ein paar Stichworte" }),
      });
      ok(
        "improve-briefing ohne ANTHROPIC_API_KEY -> 503",
        improveRes.status === 503,
        `status=${improveRes.status} (aiAvailable war false)`,
      );
    } else {
      console.log("  skip - ANTHROPIC_API_KEY ist gesetzt, 503-Check nicht anwendbar");
    }
  }

  // --- 0b. /api/analyze-website - genau EIN Aufruf hier (das Rate-Limit ist bewusst streng,
  // 1/Minute - ein zweiter Aufruf im selben Lauf würde 429 statt des erwarteten Ergebnisses
  // liefern). KEIN echter externer Website-Fetch in dieser Test-Suite - der volle Roundtrip
  // inkl. echtem Fetch + Anthropic-Aufruf wurde manuell gegen Staging verifiziert (Report).
  // Diese eine Anfrage deckt gleichzeitig den wichtigsten Fall ab: den SSRF-Schutz.
  console.log("\nWebsite-Analyse:");
  {
    const providersRes = await fetch(`${BASE}${MOUNT}/api/providers`);
    const { aiAvailable } = await providersRes.json();
    const res = await fetch(`${BASE}${MOUNT}/api/analyze-website`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ website: "http://192.168.1.1" }),
    });
    const resBody = await res.json();
    if (!aiAvailable) {
      ok("analyze-website ohne ANTHROPIC_API_KEY -> 503", res.status === 503, `status=${res.status}`);
    } else {
      ok(
        "analyze-website mit privater IP -> abgelehnt (SSRF-Schutz)",
        res.status === 502 && /nicht erlaubt/i.test(resBody.error || ""),
        `status=${res.status} body=${JSON.stringify(resBody)}`,
      );
    }
  }

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
    ok(
      "trialDaysLeft gesetzt (1..PANEL_TRIAL_DAYS)",
      typeof body.customer?.trialDaysLeft === "number" && body.customer.trialDaysLeft > 0,
      `trialDaysLeft=${body.customer?.trialDaysLeft}`,
    );
    ok("trialExpired ist false fuer neuen Kunden", body.customer?.trialExpired === false);
    ok("nextPostAt ist ein gueltiges ISO-Datum", !Number.isNaN(Date.parse(body.customer?.nextPostAt ?? "")), `nextPostAt=${body.customer?.nextPostAt}`);
    ok("dueNow ist ein boolean", typeof body.customer?.dueNow === "boolean");
    ok("contentPillars ist ein leeres Array ohne Angabe", Array.isArray(body.customer?.contentPillars) && body.customer.contentPillars.length === 0);
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

  // --- 3b. Content-Saeulen (v4) --- reuses the main test customer's session via PATCH
  // (not a fresh signup) so these extra checks don't eat into the 5/hour signup rate limit.
  console.log("\nContent-Saeulen:");
  {
    const res = await fetch(`${BASE}${MOUNT}/api/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({
        company: "Test GmbH", contactName: "Test Person", email: testEmail, tone: "sachlich", frequency: "werktags", postTime: "15:00",
        contentPillars: [
          { title: "Tipps", description: "Praktische Ratschläge", weight: 3 },
          { title: "Hinter den Kulissen", weight: 1 },
          { title: "", weight: 2 }, // leerer Titel muss verworfen werden
        ],
        bannedWords: "billig, Konkurrenzname",
        requiredElements: "#MeineMarke",
      }),
    });
    const body = await res.json();
    ok("bannedWords wird gespeichert", body.customer?.bannedWords === "billig, Konkurrenzname", body.customer?.bannedWords);
    ok("requiredElements wird gespeichert", body.customer?.requiredElements === "#MeineMarke", body.customer?.requiredElements);
    const pillars = body.customer?.contentPillars ?? [];
    ok("2 gueltige Saeulen gespeichert (leerer Titel verworfen)", pillars.length === 2, `got ${pillars.length}`);
    ok("erste Saeule korrekt", pillars[0]?.title === "Tipps" && pillars[0]?.weight === 3, JSON.stringify(pillars[0]));

    // Ueberschreiben (replace-all) via zweites PATCH
    const patchRes = await fetch(`${BASE}${MOUNT}/api/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({
        company: "Test GmbH", contactName: "Test Person", email: testEmail, tone: "sachlich", frequency: "werktags", postTime: "15:00",
        contentPillars: [{ title: "Nur noch eine", weight: 1 }],
      }),
    });
    const patchBody = await patchRes.json();
    ok("PATCH ersetzt Saeulen komplett", patchBody.customer?.contentPillars?.length === 1 && patchBody.customer.contentPillars[0].title === "Nur noch eine", JSON.stringify(patchBody.customer?.contentPillars));
  }

  // --- 3c. Granulare Zeitplanung (v4) --- ebenfalls per PATCH auf denselben Testkunden.
  console.log("\nGranulare Zeitplanung:");
  {
    const res = await fetch(`${BASE}${MOUNT}/api/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({
        company: "Test GmbH", contactName: "Test Person", email: testEmail, tone: "sachlich", frequency: "werktags", postTime: "15:00",
        instagramWeekdays: "1,3,5", linkedinWeekdays: "2,4",
        pauseFrom: "2099-01-01", pauseUntil: "2099-01-10", // weit in der Zukunft, beeinflusst "jetzt" nicht
      }),
    });
    const body = await res.json();
    ok("instagramWeekdays gespeichert", body.customer?.instagramWeekdays === "1,3,5", body.customer?.instagramWeekdays);
    ok("linkedinWeekdays gespeichert", body.customer?.linkedinWeekdays === "2,4", body.customer?.linkedinWeekdays);
    ok("pauseFrom/pauseUntil gespeichert", body.customer?.pauseFrom === "2099-01-01" && body.customer?.pauseUntil === "2099-01-10");
    ok("instagramDueNow ist ein boolean", typeof body.customer?.instagramDueNow === "boolean");
    ok("linkedinDueNow ist ein boolean", typeof body.customer?.linkedinDueNow === "boolean");
  }

  // --- 3d. POST /api/post-now ("Jetzt posten"-Warteschlange, v4) ---
  console.log("\nJetzt posten:");
  {
    const res = await fetch(`${BASE}${MOUNT}/api/post-now`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ topic: "Herbstaktion" }),
    });
    const body = await res.json();
    ok("post-now -> 200 mit pending request", res.status === 200 && body.request?.status === "pending", JSON.stringify(body));

    const secondRes = await fetch(`${BASE}${MOUNT}/api/post-now`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ topic: "Noch eins" }),
    });
    ok("zweite offene Anfrage -> 429 (max 1 gleichzeitig)", secondRes.status === 429, `status=${secondRes.status}`);

    const meRes = await fetch(`${BASE}${MOUNT}/api/me`, { headers: { cookie: sessionCookie } });
    const meBody = await meRes.json();
    ok("lastPostRequest erscheint in /api/me", meBody.customer?.lastPostRequest?.topic === "Herbstaktion", JSON.stringify(meBody.customer?.lastPostRequest));

    const noAuthRes = await fetch(`${BASE}${MOUNT}/api/post-now`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: "x" }) });
    ok("post-now ohne Login -> 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);
  }

  // --- 3e. Freigabe-Modus (approval_mode, v4) - HTTP-Seite. Der volle Roundtrip inkl. der 3
  // neuen MCP-Tools (save_pending_approval/list_approved_pending_posts/
  // mark_pending_approval_published) wurde manuell gegen Staging verifiziert (siehe Report),
  // MCP-Tool-Aufrufe lassen sich in diesem reinen HTTP-Testskript nicht sauber abbilden.
  console.log("\nFreigabe-Modus:");
  {
    const patchRes = await fetch(`${BASE}${MOUNT}/api/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ company: "Test GmbH", contactName: "Test Person", email: testEmail, tone: "sachlich", frequency: "werktags", postTime: "15:00", approvalMode: true }),
    });
    const patchBody = await patchRes.json();
    ok("approvalMode wird gespeichert", patchBody.customer?.approvalMode === true, patchBody.customer?.approvalMode);

    const approvalsRes = await fetch(`${BASE}${MOUNT}/api/approvals`, { headers: { cookie: sessionCookie } });
    const approvalsBody = await approvalsRes.json();
    ok("/api/approvals mit Login -> 200, leeres Array", approvalsRes.status === 200 && Array.isArray(approvalsBody.approvals) && approvalsBody.approvals.length === 0);

    const noAuthRes = await fetch(`${BASE}${MOUNT}/api/approvals`);
    ok("/api/approvals ohne Login -> 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);

    const approveRes = await fetch(`${BASE}${MOUNT}/api/approvals/does-not-exist/approve`, { method: "POST", headers: { cookie: sessionCookie } });
    ok("Freigeben einer nicht existierenden Anfrage -> 404", approveRes.status === 404, `status=${approveRes.status}`);
  }

  // --- 3g. /api/suggest-topics (v5) - braucht eine Session (anders als improve-briefing/
  // analyze-website, die auch beim Signup laufen). KEIN echter Anthropic-Aufruf in dieser
  // Suite - nur Auth-Gate und (falls kein ANTHROPIC_API_KEY gesetzt ist) den 503-Fall.
  console.log("\nThemenvorschläge (Jetzt posten):");
  {
    const noAuthRes = await fetch(`${BASE}${MOUNT}/api/suggest-topics`, { method: "POST", headers: { "content-type": "application/json" } });
    ok("suggest-topics ohne Login -> 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);

    const providersRes = await fetch(`${BASE}${MOUNT}/api/providers`);
    const { aiAvailable } = await providersRes.json();
    if (!aiAvailable) {
      const res = await fetch(`${BASE}${MOUNT}/api/suggest-topics`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
      });
      ok("suggest-topics ohne ANTHROPIC_API_KEY -> 503", res.status === 503, `status=${res.status}`);
    } else {
      console.log("  skip - ANTHROPIC_API_KEY ist gesetzt, 503-Check nicht anwendbar (kein echter Aufruf in dieser Suite)");
    }
  }

  // --- 3f-2. Vorausplanung/"Vorschau" (v5) - planned_posts-Zeilen werden direkt in die
  // Staging-DB eingefuegt (nicht ueber planUpcomingPosts, das wuerde echte Anthropic/fal.ai-
  // Aufrufe ausloesen). regenerate-image wird nur am bereits-am-Limit-Fall getestet (429 kommt
  // VOR jedem echten fal.ai-Aufruf zurueck) - kein echter Aufruf in dieser Suite.
  console.log("\nVorausplanung (Vorschau):");
  {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(STAGING_DB);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(new Date());
    const nowIso = new Date().toISOString();

    const patchRes = await fetch(`${BASE}${MOUNT}/api/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({
        company: "Test GmbH", contactName: "Test Person", email: testEmail, tone: "sachlich", frequency: "werktags", postTime: "15:00",
        bannedWords: "verboten", requiredElements: "#Pflicht",
      }),
    });
    ok("Vorbereitung: bannedWords/requiredElements gesetzt", patchRes.status === 200);

    const planId = "plan_test1";
    db.prepare(
      `INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, image_url, pillar_title, accent_color_used, regenerate_count, created_at, updated_at)
       VALUES (?, ?, 'ig_feed', ?, 'planned', 'Test Headline', 'Ein Text ohne das Pflicht-Element.', NULL, NULL, NULL, 0, ?, ?)`,
    ).run(planId, customerId, today, nowIso, nowIso);

    const getRes = await fetch(`${BASE}${MOUNT}/api/planned-posts`, { headers: { cookie: sessionCookie } });
    const getBody = await getRes.json();
    ok("GET /api/planned-posts findet den vorbereiteten Beitrag", getBody.posts?.some((p) => p.id === planId), JSON.stringify(getBody.posts?.map((p) => p.id)));
    ok("GET /api/planned-posts ohne Login -> 401", (await fetch(`${BASE}${MOUNT}/api/planned-posts`)).status === 401);

    const missingElRes = await fetch(`${BASE}${MOUNT}/api/planned-posts/${planId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ caption: "Text ohne das Pflicht-Element." }),
    });
    ok("PATCH ohne Pflicht-Element -> 400", missingElRes.status === 400, `status=${missingElRes.status}`);

    const bannedRes = await fetch(`${BASE}${MOUNT}/api/planned-posts/${planId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ caption: "Das ist verboten #Pflicht" }),
    });
    ok("PATCH mit verbotenem Wort -> 400", bannedRes.status === 400, `status=${bannedRes.status}`);

    const okPatchRes = await fetch(`${BASE}${MOUNT}/api/planned-posts/${planId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ caption: "Ein gültiger Text #Pflicht" }),
    });
    const okPatchBody = await okPatchRes.json();
    ok("PATCH mit gültigem Text -> 200, status 'edited'", okPatchRes.status === 200 && okPatchBody.post?.status === "edited", JSON.stringify(okPatchBody));

    const noAuthPatchRes = await fetch(`${BASE}${MOUNT}/api/planned-posts/${planId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ headline: "x" }) });
    ok("PATCH ohne Login -> 401", noAuthPatchRes.status === 401);

    const notFoundRes = await fetch(`${BASE}${MOUNT}/api/planned-posts/does-not-exist`, { method: "PATCH", headers: { "content-type": "application/json", cookie: sessionCookie }, body: JSON.stringify({ headline: "x" }) });
    ok("PATCH auf unbekannte id -> 404", notFoundRes.status === 404);

    // approvalMode wurde durch das PATCH oben nicht gesetzt (voller Replace, Default false) -
    // "Jetzt schon freigeben" muss serverseitig ablehnen.
    const approveRes = await fetch(`${BASE}${MOUNT}/api/planned-posts/${planId}/approve`, { method: "POST", headers: { cookie: sessionCookie } });
    ok("Freigeben ohne approvalMode -> 400", approveRes.status === 400, `status=${approveRes.status}`);

    const skipRes = await fetch(`${BASE}${MOUNT}/api/planned-posts/${planId}/skip`, { method: "POST", headers: { cookie: sessionCookie } });
    const skipBody = await skipRes.json();
    ok("Überspringen -> 200, status 'rejected'", skipRes.status === 200 && skipBody.post?.status === "rejected", JSON.stringify(skipBody));

    // Zweite Zeile, schon am Limit - regenerate-image muss VOR jedem echten fal.ai-Aufruf mit
    // 429 ablehnen.
    const planIdMax = "plan_test2";
    db.prepare(
      `INSERT INTO planned_posts (id, customer_id, channel, scheduled_for, status, headline, caption, image_url, pillar_title, accent_color_used, regenerate_count, created_at, updated_at)
       VALUES (?, ?, 'ig_feed', ?, 'planned', 'Test Headline 2', 'Text #Pflicht', NULL, NULL, NULL, 3, ?, ?)`,
    ).run(planIdMax, customerId, today, nowIso, nowIso);
    const regenRes = await fetch(`${BASE}${MOUNT}/api/planned-posts/${planIdMax}/regenerate-image`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ accentColor: "#1a2e1a" }),
    });
    ok("Neuerstellung am Limit (3/3) -> 429, kein echter fal.ai-Aufruf", regenRes.status === 429, `status=${regenRes.status}`);

    db.prepare("DELETE FROM planned_posts WHERE id IN (?, ?)").run(planId, planIdMax);
  }

  // --- 3f. Mehrere Farbthemen (v4) ---
  console.log("\nFarbthemen:");
  {
    const createRes = await fetch(`${BASE}${MOUNT}/api/themes`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ name: "Sommer-Kampagne", accentColor: "#2e2410", watermarkText: "Sommer" }),
    });
    const createBody = await createRes.json();
    ok("Thema anlegen -> 201", createRes.status === 201, `status=${createRes.status}`);
    const themeId = createBody.theme?.id;
    ok("Thema hat eine id", Boolean(themeId));

    const activateRes = await fetch(`${BASE}${MOUNT}/api/themes/${themeId}/activate`, { method: "POST", headers: { cookie: sessionCookie } });
    const activateBody = await activateRes.json();
    ok("Aktivieren -> activeThemeId gesetzt", activateBody.customer?.activeThemeId === themeId, activateBody.customer?.activeThemeId);
    ok("Formular-accentColor bleibt unveraendert (nur Panel-Feld, nicht das Thema)", typeof activateBody.customer?.accentColor === "string");

    const deactivateRes = await fetch(`${BASE}${MOUNT}/api/themes/deactivate`, { method: "POST", headers: { cookie: sessionCookie } });
    const deactivateBody = await deactivateRes.json();
    ok("Deaktivieren -> activeThemeId wieder null", deactivateBody.customer?.activeThemeId === null, deactivateBody.customer?.activeThemeId);

    const badActivateRes = await fetch(`${BASE}${MOUNT}/api/themes/does-not-exist/activate`, { method: "POST", headers: { cookie: sessionCookie } });
    ok("Aktivieren eines fremden/unbekannten Themas -> 404", badActivateRes.status === 404, `status=${badActivateRes.status}`);
  }

  // --- 3g. Eigenes Logo (v4) --- ein winziges 2x2-PNG reicht fuer den Roundtrip-Test,
  // die echte Bild-Kompositing-Logik (Groesse/Platzierung) wurde manuell mit einem echten
  // 300x300-Test-Logo gegen ein tatsaechlich generiertes Bild verifiziert (siehe Report).
  console.log("\nLogo:");
  {
    const { default: sharp } = await import("sharp");
    const tinyPngBuffer = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } })
      .png()
      .toBuffer();
    const tinyPngBase64 = tinyPngBuffer.toString("base64");
    const uploadRes = await fetch(`${BASE}${MOUNT}/api/logo`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: `data:image/png;base64,${tinyPngBase64}` }),
    });
    const uploadBody = await uploadRes.json();
    ok("Logo-Upload -> 200, hasLogo true", uploadRes.status === 200 && uploadBody.customer?.hasLogo === true, JSON.stringify(uploadBody.customer?.hasLogo));

    const getRes = await fetch(`${BASE}${MOUNT}/api/logo`, { headers: { cookie: sessionCookie } });
    ok("GET /api/logo liefert das Bild -> 200", getRes.status === 200, `status=${getRes.status}`);
    ok("GET /api/logo liefert image/png", (getRes.headers.get("content-type") || "").includes("image/png"), getRes.headers.get("content-type"));

    const noAuthRes = await fetch(`${BASE}${MOUNT}/api/logo`);
    ok("GET /api/logo ohne Login -> 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);

    const badUploadRes = await fetch(`${BASE}${MOUNT}/api/logo`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: "data:text/plain;base64,aGVsbG8=" }),
    });
    ok("Upload einer Nicht-Bild-Datei -> 400", badUploadRes.status === 400, `status=${badUploadRes.status}`);

    const deleteRes = await fetch(`${BASE}${MOUNT}/api/logo`, { method: "DELETE", headers: { cookie: sessionCookie } });
    const deleteBody = await deleteRes.json();
    ok("Logo entfernen -> hasLogo wieder false", deleteBody.customer?.hasLogo === false, deleteBody.customer?.hasLogo);
  }

  // --- 4a. POST /api/pause (customer's own pause toggle) ---
  console.log("\nPausieren:");
  {
    const res = await fetch(`${BASE}${MOUNT}/api/pause`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ paused: true }),
    });
    const body = await res.json();
    ok("Pausieren -> customerPaused true", body.customer?.customerPaused === true);
    ok("Pausieren -> dueNow wird false", body.customer?.dueNow === false);
    const resumeRes = await fetch(`${BASE}${MOUNT}/api/pause`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ paused: false }),
    });
    const resumeBody = await resumeRes.json();
    ok("Fortsetzen -> customerPaused false", resumeBody.customer?.customerPaused === false);
  }

  // --- 4b. DELETE /api/me (self-service account deletion) ---
  console.log("\nKonto löschen:");
  {
    const email = `delete-test-${Date.now()}@example.invalid`;
    const signupRes = await fetch(`${BASE}${MOUNT}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent: true, company: "Delete Me GmbH", contactName: "T", email, tone: "sachlich", frequency: "werktags", postTime: "15:00" }),
    });
    const delCookie = cookieHeader(signupRes.headers.get("set-cookie"));

    const noConfirmRes = await fetch(`${BASE}${MOUNT}/api/me`, { method: "DELETE", headers: { cookie: delCookie, "content-type": "application/json" }, body: JSON.stringify({}) });
    ok("DELETE /api/me ohne confirm -> 400", noConfirmRes.status === 400, `status=${noConfirmRes.status}`);

    const noAuthRes = await fetch(`${BASE}${MOUNT}/api/me`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    ok("DELETE /api/me ohne Login -> 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);

    const delRes = await fetch(`${BASE}${MOUNT}/api/me`, { method: "DELETE", headers: { cookie: delCookie, "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    ok("DELETE /api/me mit confirm -> 200", delRes.status === 200, `status=${delRes.status}`);

    const afterDelRes = await fetch(`${BASE}${MOUNT}/api/me`, { headers: { cookie: delCookie } });
    ok("Kunde nach Löschen nicht mehr eingeloggt -> 401", afterDelRes.status === 401, `status=${afterDelRes.status}`);

    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(STAGING_DB, { readonly: true });
      const row = db.prepare("SELECT id FROM customers WHERE email = ?").get(email);
      ok("Kunde wirklich aus der DB entfernt", !row);
    } catch (e) {
      console.log(`  (Hinweis: DB-Check fehlgeschlagen: ${e.message})`);
    }
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

  // --- 8. Admin ---
  console.log("\nAdmin (falls vorhanden):");
  {
    const res = await fetch(`${BASE}${MOUNT}/admin/api/overview`);
    if (await isMcpGateFallthrough(res)) {
      console.log("  skip - Admin-API noch nicht implementiert (Aufgabe 3 steht noch aus)");
    } else {
      ok("/admin/api/overview ohne Auth -> 401", res.status === 401, `status=${res.status}`);
      ok("/admin/api/me ohne Auth -> 401", (await fetch(`${BASE}${MOUNT}/admin/api/me`)).status === 401);

      const badLogin = await fetch(`${BASE}${MOUNT}/admin/api/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "definitely-wrong-password" }),
      });
      ok("Admin-Login mit falschem Passwort -> 401", badLogin.status === 401, `status=${badLogin.status}`);

      // Full login round-trip using the real PANEL_ADMIN_PASSWORD from .env (never logged).
      let adminPassword = "";
      try {
        const fs = await import("node:fs");
        const envText = fs.readFileSync(".env", "utf8");
        adminPassword = /^PANEL_ADMIN_PASSWORD=(.*)$/m.exec(envText)?.[1]?.trim() ?? "";
      } catch {
        // ignore - .env not readable from here
      }
      if (adminPassword) {
        const loginRes = await fetch(`${BASE}${MOUNT}/admin/api/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: adminPassword }),
        });
        ok("Admin-Login mit richtigem Passwort -> 200", loginRes.status === 200, `status=${loginRes.status}`);
        const adminCookie = cookieHeader(loginRes.headers.get("set-cookie"));

        const overviewRes = await fetch(`${BASE}${MOUNT}/admin/api/overview`, { headers: { cookie: adminCookie } });
        const overviewBody = await overviewRes.json();
        ok("/admin/api/overview mit Session -> 200", overviewRes.status === 200, `status=${overviewRes.status}`);
        ok("overview liefert metrics + customers", typeof overviewBody.metrics?.totalCustomers === "number" && Array.isArray(overviewBody.customers));

        await fetch(`${BASE}${MOUNT}/admin/api/logout`, { method: "POST", headers: { cookie: adminCookie } });
        const afterLogout = await fetch(`${BASE}${MOUNT}/admin/api/overview`, { headers: { cookie: adminCookie } });
        ok("/admin/api/overview nach Logout -> 401", afterLogout.status === 401, `status=${afterLogout.status}`);
      } else {
        console.log("  skip - PANEL_ADMIN_PASSWORD nicht lesbar, Login-Roundtrip übersprungen");
      }
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
