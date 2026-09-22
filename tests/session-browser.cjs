// Local preview only. Force the initial sponsor response to arrive after session creation.
const assert=require('node:assert/strict');const {chromium}=require(process.argv[2]);
(async()=>{const browser=await chromium.launch({executablePath:process.argv[3],headless:true});try{
 const page=await browser.newPage({reducedMotion:'reduce'});let release;const gate=new Promise(r=>release=r);
 await page.route('**/api/sponsors',async route=>{const response=await fetch(route.request().url(),{headers:await route.request().allHeaders()}),body=await response.text();await gate;await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});});
 await page.goto('http://127.0.0.1:4181/?day=2099-01-01',{waitUntil:'domcontentloaded'});await page.locator('#tile-14').waitFor();
 const session=page.waitForResponse(r=>r.url().endsWith('/api/session'));await page.locator('#tile-5').click();await page.locator('#tile-10').click();assert.equal((await session).status(),200);
 release();await page.waitForFunction(()=>document.querySelector('#sponsor-spotlight').getAttribute('aria-busy')==='false');await page.waitForTimeout(360);
 const completion=page.waitForResponse(r=>r.url().endsWith('/api/result'));await page.locator('#tile-0').click();await page.locator('#tile-5').click();const response=await completion;const body=await response.json();assert.equal(response.status(),200,body.code);assert.ok(body.optimal);console.log('PASS late sponsor response preserves gameplay session');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

