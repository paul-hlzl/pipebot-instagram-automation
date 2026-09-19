import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const BASE="https://app.pipeflow.at";
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:844}});
const page=await ctx.newPage();
page.on("response", async r => { if (r.url().includes("/api/start/preview")||r.url().includes("/api/start/status")) console.log("  HTTP", r.status(), r.url().replace(BASE,"").slice(0,40), (await r.text().catch(()=>"")).slice(0,200)); });
await page.goto(`${BASE}/start/?t=${Date.now()}`,{waitUntil:"domcontentloaded"});
await page.waitForTimeout(1800);
await page.locator('[data-go="email"]').first().click().catch(()=>{});
await page.waitForSelector("#email",{timeout:10000});
await page.fill("#email", `probe2-${Date.now()}@sandbox.invalid`);
await page.locator("form button[type=submit]").first().click();
await page.waitForSelector("#website",{timeout:15000});
await page.waitForTimeout(6000);   // Turnstile Zeit geben
await page.fill("#website","pipeflow.at");
await page.locator("#btn-vorschau").click();
for (let i=0;i<8;i++){ await page.waitForTimeout(5000); const t=(await page.locator("#stage").innerText()).replace(/\n+/g," | ").slice(0,150); console.log(`  +${(i+1)*5}s: ${t}`); }
await b.close();
