// Local preview only: node tests/sponsor-browser.cjs <playwright module> <browser executable>
const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);
(async()=>{
 const browser=await chromium.launch({executablePath:process.argv[3],headless:true});
 try{for(const width of [390,1440])for(const theme of ['light','dark'])for(const fixture of ['empty','funded','loading','error']){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme});const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:4181/?day=2099-01-01&sponsor-fixture=${fixture}`,{waitUntil:'domcontentloaded'});
  if(fixture==='loading')assert.match(await page.locator('#sponsor-spotlight').textContent(),/Loading/);
  await page.waitForFunction(()=>document.querySelector('#sponsor-spotlight').getAttribute('aria-busy')==='false');
  const funded=['funded','loading'].includes(fixture);
  assert.equal(await page.locator('#sponsor-spotlight article').count(),funded?3:0);
  if(funded){assert.equal(await page.locator('#sponsor-title').textContent(),'Top sponsors');assert.deepEqual(await page.locator('#sponsor-spotlight .sponsor-place').allTextContents(),['#1','#1','#3']);}
  else assert.match(await page.locator('#sponsor-spotlight').textContent(),fixture==='error'?/could not load/:/first.*\$1/);
  assert.ok((await page.locator('#sponsors-link').boundingBox()).height>=44);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#sponsors-link').click();await page.waitForFunction(()=>document.querySelector('#sponsor-spotlight').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#sponsor-wall .featured').count(),funded?2:0);
  await page.locator('#sponsor-mode').selectOption('takeover');assert.equal(await page.locator('#sponsor-checkout').isDisabled(),true);
  if(fixture!=='error'){
   await page.locator('#sponsor-url').fill('https://new.com/');
   await page.waitForFunction(()=>!document.querySelector('#aim-top').disabled);
   assert.equal(await page.locator('#aim-top').textContent(),`Aim for #1 · $${funded?13:1}`);
   assert.equal(await page.locator('#sponsor-checkout').textContent(),`Aim for #1 · $${funded?13:1}`);
   if(funded){await page.locator('#sponsor-url').fill('https://example.com/');await page.waitForFunction(()=>document.querySelector('#aim-top').textContent==='Aim for #1 · $1');}
   await page.locator('#sponsor-url').fill('invalid');assert.equal(await page.locator('#aim-top').textContent(),'Aim for #1');assert.equal(await page.locator('#sponsor-checkout').isDisabled(),true);
  }else assert.equal(await page.locator('#sponsor-retry').isVisible(),true);
  assert.equal(await page.locator('#sponsor-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);assert.deepEqual(errors,[]);
  console.log(width,theme,fixture,'PASS');await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
