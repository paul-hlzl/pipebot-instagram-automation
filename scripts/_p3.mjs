import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
for (const [name, url] of [["Produktion","https://app.pipeflow.at/start/"],["Sandbox","https://mcp.pipebot.at/panel/sandbox/start/"]]) {
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  const meldungen=[];
  page.on("console", m => meldungen.push(`${m.type()}: ${m.text().slice(0,120)}`));
  await page.goto(`${url}?t=${Date.now()}`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(1500);
  await page.locator('[data-go="email"]').first().click().catch(()=>{});
  await page.waitForSelector("#email",{timeout:10000}).catch(()=>{});
  await page.fill("#email", `p3-${Date.now()}@sandbox.invalid`).catch(()=>{});
  await page.locator("form button[type=submit]").first().click().catch(()=>{});
  await page.waitForSelector("#website",{timeout:15000}).catch(()=>{});
  await page.waitForTimeout(9000);
  const token = await page.evaluate(() => { try { return (window.turnstile && window.turnstile.getResponse) ? (window.turnstile.getResponse() || "").slice(0,10) : "kein turnstile"; } catch(e){ return "Fehler: "+e.message; } });
  console.log(`\n${name}: Token nach 9 s = ${token ? JSON.stringify(token) : "(leer)"}`);
  const auffaellig = meldungen.filter(m => /turnstile|1102|invalid|domain|error code|refused|blocked/i.test(m));
  console.log("  auffaellige Meldungen:", auffaellig.length ? auffaellig.slice(0,5) : "keine");
  await b.close();
}
