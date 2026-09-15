#!/usr/bin/env node
/**
 * Pure unit test for src/linkedin-analytics.ts - no real LinkedIn API access needed/attempted
 * (we don't have Community Management API access yet, see docs/LINKEDIN_COMMUNITY_API.md), so
 * this mocks global fetch with fixture responses in BOTH documented metricType shapes (pre- and
 * post-202605) and checks the client parses both correctly and builds the right request URLs.
 * Run with: node scripts/test-linkedin-analytics.mjs (after `npm run build`).
 */
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ""}`); }
}

const requestedUrls = [];
const originalFetch = global.fetch;

function mockFetch(shape) {
  global.fetch = async (url) => {
    requestedUrls.push(url.toString());
    const metricType =
      shape === "string"
        ? "REACTION"
        : { "com.linkedin.adsexternalapi.memberanalytics.v1.CreatorPostAnalyticsMetricTypeV1": "REACTION" };
    return {
      ok: true,
      status: 200,
      json: async () => ({ elements: [{ count: 7, metricType }] }),
      text: async () => "",
    };
  };
}

async function main() {
  const { parseMetricType, fetchMemberAggregatePostAnalytics, fetchMemberSinglePostAnalytics } = await import("../dist/linkedin-analytics.js");

  console.log("parseMetricType:");
  ok("parses the pre-202605 nested-object shape", parseMetricType({ "com.linkedin.x.MetricTypeV1": "REACTION" }) === "REACTION");
  ok("parses the 202605+ plain-string shape", parseMetricType("REACTION") === "REACTION");

  console.log("\nfetchMemberAggregatePostAnalytics (q=me):");
  mockFetch("object");
  const agg = await fetchMemberAggregatePostAnalytics("fake-token", ["REACTION", "IMPRESSION"]);
  ok("issues exactly one request PER metric (no combined call)", requestedUrls.length === 2, `${requestedUrls.length}`);
  ok("every request targets memberCreatorPostAnalytics with q=me", requestedUrls.every((u) => u.includes("memberCreatorPostAnalytics") && u.includes("q=me")));
  ok("each request's queryType matches the metric requested", requestedUrls.some((u) => u.includes("queryType=REACTION")) && requestedUrls.some((u) => u.includes("queryType=IMPRESSION")));
  ok("aggregates count correctly from the (object-shape) response", agg.REACTION === 7 && agg.IMPRESSION === 7, JSON.stringify(agg));
  ok("un-requested default metrics are not included", agg.COMMENT === undefined);

  console.log("\nfetchMemberSinglePostAnalytics (q=entity), share URN:");
  requestedUrls.length = 0;
  mockFetch("string");
  const single = await fetchMemberSinglePostAnalytics("fake-token", "urn:li:share:7325786486870552578", ["REACTION"]);
  ok("q=entity with correctly-encoded share URN, unencoded parens (Rest.li structured param)", requestedUrls[0]?.includes("q=entity&entity=(share:urn%3Ali%3Ashare%3A7325786486870552578)"), requestedUrls[0]);
  ok("aggregates count correctly from the (string-shape) response", single.REACTION === 7, JSON.stringify(single));

  console.log("\nfetchMemberSinglePostAnalytics (q=entity), ugcPost URN:");
  requestedUrls.length = 0;
  await fetchMemberSinglePostAnalytics("fake-token", "urn:li:ugcPost:123", ["REACTION"]);
  ok("ugcPost URN uses the 'ugc' entity key, not 'share'", requestedUrls[0]?.includes("entity=(ugc:urn%3Ali%3AugcPost%3A123)"), requestedUrls[0]);

  console.log("\nError handling:");
  global.fetch = async () => ({ ok: false, status: 403, text: async () => "Forbidden - Community Management API required" });
  let threw = false;
  try {
    await fetchMemberAggregatePostAnalytics("fake-token", ["REACTION"]);
  } catch (err) {
    threw = /403/.test(err.message);
  }
  ok("a 403 (no Community Management API access yet) throws a clear ToolError, not a silent empty result", threw);

  global.fetch = originalFetch;
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((err) => { console.error("TEST SCRIPT FAILED:", err); process.exit(1); });
