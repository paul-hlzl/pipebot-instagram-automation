import Database from "better-sqlite3";
import fs from "node:fs";
const BASE = "https://mcp.pipebot.at", MOUNT = "/panel/sandbox";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const KEY = (() => { const j = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8")); return (Array.isArray(j.apps) ? j.apps[0] : j).env.PANEL_TEST_KEY; })();
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pp_session="));
db.prepare("DELETE FROM domain_cache WHERE domain='channoine-mayr.at'").run();
const ein = await fetch(`${BASE}${MOUNT}/start/test?key=${encodeURIComponent(KEY)}`, { redirect: "manual" });
const cookie = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status='test' ORDER BY created_at DESC").get().id;
const t0 = Date.now();
await fetch(`${BASE}${MOUNT}/api/start/preview`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ website: "channoine-mayr.at" }) });
const marken = {};
for (let i = 0; i < 250; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const st = await (await fetch(`${BASE}${MOUNT}/api/start/status`, { headers: { cookie } })).json();
  const ph = st.job?.phase ?? "idle";
  if (!marken[ph]) marken[ph] = Date.now() - t0;
  if (["done", "error", "idle"].includes(ph) && (st.posts || []).length) { marken.ende = Date.now() - t0; break; }
}
for (const [k, v] of Object.entries(marken)) console.log(`  ${k.padEnd(10)} ${(v / 1000).toFixed(1)} s`);
console.log("  Themen:", db.prepare("SELECT COUNT(*) n FROM content_pillars WHERE customer_id=?").get(id).n);
console.log("  about:", (db.prepare("SELECT about FROM customers WHERE id=?").get(id).about || "").length, "Zeichen");
console.log("  Kosten:", JSON.stringify(db.prepare("SELECT feature, ROUND(SUM(estimated_cost_usd),5) usd FROM usage_costs WHERE customer_id=? GROUP BY feature").all(id)));
await fetch(`${BASE}${MOUNT}/api/start/test/end`, { method: "POST", headers: { cookie } });
