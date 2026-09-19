import { chromium } from "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
for (const [name, url] of [["Produktion (echter Schluessel)","https://app.pipeflow.at/start/"],["Sandbox (Testschluessel)","https://mcp.pipebot.at/panel/sandbox/start/"]]) {
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  await page.goto(`${url}?t=${Date.now()}`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(1500);
  await page.locator('[data-go="email"]').first().click().catch(()=>{});
  await page.waitForSelector("#email",{timeout:10000}).catch(()=>{});
  await page.fill("#email", `p4-${Date.now()}@sandbox.invalid`).catch(()=>{});
  await page.locator("form button[type=submit]").first().click().catch(()=>{});
  await page.waitForSelector("#website",{timeout:15000}).catch(()=>{});
  await page.waitForTimeout(10000);
  const d = await page.evaluate(() => {
    const slot = document.querySelector("#turnstile-slot");
    const iframes = slot ? slot.querySelectorAll("iframe") : [];
    return {
      html: slot ? slot.innerHTML.slice(0, 220) : "(kein Slot)",
      iframes: iframes.length,
      quelle: iframes[0]?.src?.slice(0, 80) ?? "-",
      hoehe: slot ? Math.round(slot.getBoundingClientRect().height) : 0,
    };
  });
  console.log(`\n${name}`); console.log("  iframes:", d.iframes, "| Hoehe:", d.hoehe, "| src:", d.quelle); console.log("  DOM:", d.html);
  await b.close();
}
