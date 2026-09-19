import Database from "better-sqlite3";
import fs from "node:fs";
const BASE = "https://mcp.pipebot.at", MOUNT = "/panel/sandbox";
const db = new Database("/root/mcp-server/data/panel-staging.db");
const j = JSON.parse(fs.readFileSync("/root/staging.ecosystem.json", "utf8"));
const KEY = (Array.isArray(j.apps) ? j.apps[0] : j).env.PANEL_TEST_KEY;
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const call = (m, p, o = {}) => fetch(`${BASE}${MOUNT}${p}`, { method: m, redirect: "manual", body: o.body ? JSON.stringify(o.body) : undefined, headers: { ...(o.body ? { "content-type": "application/json" } : {}), ...(o.cookie ? { cookie: o.cookie } : {}) } });

db.prepare("DELETE FROM domain_cache WHERE domain = 'channoine-mayr.at'").run();
const ein = await call("GET", `/start/test?key=${encodeURIComponent(KEY)}`);
const cookie = cookieOf(ein);
const id = db.prepare("SELECT id FROM customers WHERE status = 'test' ORDER BY created_at DESC").get().id;
await call("POST", "/api/start/preview", { cookie, body: { website: "channoine-mayr.at" } });
let st;
for (let i = 0; i < 100; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  st = await (await call("GET", "/api/start/status", { cookie })).json();
  if (["done", "error", "idle"].includes(st.job?.phase ?? "idle") && (st.posts || []).length) break;
}
const c = db.prepare("SELECT company, industry, about, accent_color, gradient_color2, gradient_enabled, watermark_text FROM customers WHERE id = ?").get(id);
console.log("=== ANALYSE ===");
console.log(JSON.stringify(c, null, 2));
console.log("Saeulen:", JSON.stringify(db.prepare("SELECT title, description FROM content_pillars WHERE customer_id = ?").all(id), null, 2));
console.log("\n=== DIE ZEHN BEITRAEGE ===");
const posts = db.prepare("SELECT scheduled_for, channel, pillar_title, headline, substr(caption,1,90) k FROM planned_posts WHERE customer_id = ? ORDER BY scheduled_for, channel").all(id);
posts.forEach((p, i) => console.log(`${String(i + 1).padStart(2)} [${p.pillar_title}] ${p.headline}`));
console.log("\n=== VERTEILUNG AUF SAEULEN ===");
const z = {}; posts.forEach((p) => { z[p.pillar_title] = (z[p.pillar_title] || 0) + 1; });
console.log(JSON.stringify(z));
console.log("\n=== KOSTEN ===", JSON.stringify(db.prepare("SELECT feature, COUNT(*) n, ROUND(SUM(estimated_cost_usd),5) usd FROM usage_costs WHERE customer_id = ? GROUP BY feature").all(id)));
const cache = db.prepare("SELECT payload_json FROM domain_cache WHERE domain = 'channoine-mayr.at'").get();
if (cache) { const a = JSON.parse(cache.payload_json); console.log("\n=== FARBEN ROH ===", JSON.stringify(a.colors, null, 2)); }
fs.writeFileSync("/tmp/claude-0/-root/9d7c8207-27fd-4b05-84d9-cdef65867a28/scratchpad/befund.json", JSON.stringify({ c, posts, cookie, id }, null, 2));
console.log("\nKunde bleibt vorerst stehen:", id);
