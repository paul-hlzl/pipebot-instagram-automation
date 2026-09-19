import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:844}});
const page=await ctx.newPage();
await page.goto(`https://app.pipeflow.at/start/?t=${Date.now()}`,{waitUntil:"domcontentloaded"});
await page.waitForTimeout(1500);
await page.locator('[data-go="email"]').first().click().catch(()=>{});
await page.waitForSelector("#email",{timeout:10000});
await page.fill("#email", `p6-${Date.now()}@sandbox.invalid`);
await page.locator("form button[type=submit]").first().click();
await page.waitForSelector("#website",{timeout:15000});
await page.waitForTimeout(7000);
const tok = async () => page.evaluate(() => { try { return (window.turnstile?.getResponse() || ""); } catch { return ""; } });
console.log("Token vor dem Klick:", (await tok()).slice(0,12) || "(leer)");
await page.locator("#turnstile-slot").click({ position: { x: 34, y: 34 } }).catch(e=>console.log("Klick ging nicht:", e.message.slice(0,60)));
for (let i=0;i<8;i++){ await page.waitForTimeout(2500); const t=await tok(); if (t) { console.log(`Token nach ${(i+1)*2.5}s:`, t.slice(0,14)+"…"); break; } if(i===7) console.log("auch nach 20 s kein Token"); }
await page.locator("#turnstile-slot").screenshot({path:"/tmp/claude-0/-root/9d7c8207-27fd-4b05-84d9-cdef65867a28/scratchpad/turnstile2.png"}).catch(()=>{});
await b.close();
