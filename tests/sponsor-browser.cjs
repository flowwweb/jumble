// Built UI regression, isolated HTTP fixtures only. No live API or payment writes.
// node tests/sponsor-browser.cjs <playwright module> <browser executable> [evidence directory]
const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);
const {createServer}=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const normal={mode:'swap-adjacent-v3',board:[...'HWILTWHAETPAIEN'],dictionaryVersion:'swap-accepted-v4-8bd88a6d2a71'};
const blank={mode:'swap-blank-v1',board:[...'INEATRBOADCL UD'],dictionaryVersion:'swap-blank-words-v1-396b3eafd38a'};
const today='2026-11-13',first='2026-09-20';
const evidence=process.argv[4],results=[];
const root=path.resolve('dist');
const server=createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://127.0.0.1'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!file.startsWith(root+path.sep))throw Error('Outside build');
  const type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com"});res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}
});

(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 if(evidence)await fs.mkdir(evidence,{recursive:true});
 const browser=await chromium.launch({executablePath:process.argv[3],headless:true});
 try{for(const width of [390,834,1440])for(const theme of ['light','dark'])for(const fixture of ['empty','funded','loading','error']){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme});const page=await context.newPage();
  let unavailable=fixture==='error';const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date(today+'T12:00:00Z')});
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),name=url.pathname.slice(5);requests.push({name,day:url.searchParams.get('day'),method:request.method()});
   const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(name==='puzzle'){const day=url.searchParams.get('day')||today;return json({...(day==='2026-09-24'?blank:normal),id:day});}
   if(name==='sponsors'){
    if(fixture==='loading')await new Promise(resolve=>setTimeout(resolve,450));
    if(unavailable)return json({error:'Preview sponsor service unavailable.'},503);
    const rows=['funded','loading'].includes(fixture)?[{name:'Preview sponsor with a deliberately long name for layout checks',url:'https://flowwweb.com/',cents:1200,rank:1},{name:'Second preview sponsor',url:'https://example.org/',cents:1200,rank:1},{name:'Third preview sponsor',url:'https://example.net/',cents:500,rank:3}]:[];
    return json({rows,topCents:rows[0]?.cents||0,...(url.searchParams.has('url')?{takeoverCents:rows.length&&url.searchParams.get('url')!=='https://flowwweb.com/'?1300:100}:{})});
   }
   if(name==='event')return route.fulfill({status:204});
   if(name==='session')return json({sessionId:'isolated-browser-session'});
   throw Error('Unexpected UI write: '+name);
  });
  await page.goto(`${origin}/?day=2026-11-12`,{waitUntil:'domcontentloaded'});
  await page.locator('#tile-14').waitFor();
  if(fixture==='loading')assert.match(await page.locator('#sponsor-spotlight').textContent(),/Loading/);
  await page.waitForFunction(()=>document.querySelector('#sponsor-spotlight').getAttribute('aria-busy')==='false');
  const funded=['funded','loading'].includes(fixture);
  assert.equal(await page.locator('#sponsor-spotlight article').count(),funded?3:0);
  if(funded){assert.equal(await page.locator('#sponsor-title').textContent(),'Top sponsors');assert.deepEqual(await page.locator('#sponsor-spotlight .sponsor-place').allTextContents(),['#1','#1','#3']);}
  else {assert.equal(await page.locator('#sponsor-title').textContent(),'Featured project');assert.match(await page.locator('#sponsor-spotlight').textContent(),/Go with Flowwweb/);assert.equal(await page.locator('#sponsor-spotlight .sponsor-place,#sponsor-spotlight .sponsor-total').count(),0);}
  await page.waitForFunction(()=>[...document.querySelectorAll('#sponsor-spotlight img')].every(i=>i.complete&&i.naturalWidth>0));
  assert.ok(await page.locator('#sponsor-spotlight img[src$="flowwweb.png"]').count());
  assert.equal(await page.getByLabel('Play a past day').inputValue(),'2026-11-12');
  assert.equal(await page.locator('#day').getAttribute('min'),first);assert.equal(await page.locator('#day').getAttribute('max'),today);
  const dateBox=await page.locator('#day').boundingBox();assert.ok(dateBox.height>=44);
  await page.locator('#day').focus();assert.equal(await page.locator('#day').evaluate(e=>e.matches(':focus-visible')),true);
  // A native invalid/empty change cannot request unpublished puzzles.
  for(const value of ['2026-11-14','2026-09-19','']){await page.locator('#day').evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('change'));},value);assert.equal(await page.locator('#day').inputValue(),'2026-11-12');}
  assert.ok(!requests.some(r=>r.name==='puzzle'&&r.day>'2026-11-13'));
  // Switching normal -> blank -> normal restores each mode/date's own saved moves.
  await page.locator('#tile-0').click();await page.locator('#tile-1').click();await page.waitForFunction(()=>document.querySelector('#moves').textContent==='1 swap');
  await page.getByLabel('Play a past day').fill('2026-09-24');await page.waitForURL('**/?day=2026-09-24');await page.locator('#tile-14').waitFor();assert.equal(await page.locator('#moves').textContent(),'0 swaps');assert.match(await page.locator('#headline').textContent(),/One blank/);
  await page.locator('#tile-0').click();await page.locator('#tile-1').click();await page.waitForFunction(()=>document.querySelector('#moves').textContent==='1 swap');
  await page.getByLabel('Play a past day').fill('2026-11-12');await page.waitForURL('**/?day=2026-11-12');await page.locator('#tile-14').waitFor();assert.equal(await page.locator('#moves').textContent(),'1 swap');
  await page.reload();await page.locator('#tile-14').waitFor();assert.equal(await page.locator('#moves').textContent(),'1 swap');
  await page.getByLabel('Play a past day').fill('2026-09-24');await page.waitForURL('**/?day=2026-09-24');await page.locator('#tile-14').waitFor();assert.equal(await page.locator('#moves').textContent(),'1 swap');
  await page.locator('#today-link').click();await page.waitForURL(origin+'/');await page.locator('#tile-14').waitFor();assert.equal(await page.locator('#day').inputValue(),today);assert.equal(await page.locator('#today-link').isVisible(),false);
  await page.clock.fastForward(43200100);assert.equal(await page.locator('#day').getAttribute('max'),'2026-11-14');assert.equal(await page.locator('#day').inputValue(),today);assert.equal(await page.locator('#today-link').isVisible(),true);
  if(evidence&&['empty','funded','error'].includes(fixture))await page.screenshot({path:path.join(evidence,`${width}-${theme}-home.png`),fullPage:true});
  assert.ok((await page.locator('#sponsors-link').boundingBox()).height>=44);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#sponsors-link').click();await page.waitForFunction(()=>document.querySelector('#sponsor-spotlight').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#sponsor-wall .featured').count(),funded?2:0);
  assert.equal(await page.locator('#sponsor-wall .project-card').count(),funded?9:10);assert.match(await page.locator('.featured-projects').textContent(),/Not paid sponsors/);assert.equal(await page.locator('#sponsor-wall .project-card .sponsor-place,#sponsor-wall .project-card .sponsor-total').count(),0);
  assert.deepEqual(await page.locator('#sponsor-wall .project-card strong').allTextContents(),[...(funded?[]:['flowwweb.com']),'nemoboat.app','boatpedia.co','rstrapp.com','unbake.ai','rightwork.me','whxtever.com','fontgoblin.ai','botlord.ai','glizz.me']);
  if(fixture==='empty')assert.match(await page.locator('#sponsor-wall').textContent(),/The wall is waiting for its first sponsor/);
  await page.locator('#sponsor-mode').selectOption('takeover');assert.equal(await page.locator('#sponsor-checkout').isDisabled(),true);
  if(fixture!=='error'){
   await page.locator('#sponsor-url').fill('https://new.com/');
   await page.waitForFunction(()=>!document.querySelector('#aim-top').disabled);
   assert.equal(await page.locator('#aim-top').textContent(),`Aim for #1 · $${funded?13:1}`);
   assert.equal(await page.locator('#sponsor-checkout').textContent(),`Aim for #1 · $${funded?13:1}`);
   if(funded){await page.locator('#sponsor-url').fill('https://flowwweb.com/');await page.waitForFunction(()=>document.querySelector('#aim-top').textContent==='Aim for #1 · $1');}
   await page.locator('#sponsor-url').fill('invalid');assert.equal(await page.locator('#aim-top').textContent(),'Aim for #1');assert.equal(await page.locator('#sponsor-checkout').isDisabled(),true);
  }else assert.equal(await page.locator('#sponsor-retry').isVisible(),true);
  await page.waitForFunction(()=>[...document.querySelectorAll('#sponsor-wall img')].every(i=>i.complete&&i.naturalWidth>0));
  assert.equal(await page.locator('#sponsor-wall img').count(),9);assert.equal(await page.locator('#sponsor-wall a[href="https://whxtever.com/"] img').getAttribute('src'),'/assets/sponsor-icons/whxtever.png');
  for(const [host,initials] of [['glizz.me','GL']]){const icon=page.locator(`#sponsor-wall a[href="https://${host}/"] .project-icon`);assert.equal(await icon.textContent(),initials);assert.equal(await icon.locator('img').count(),0);}
  await page.locator('#sponsor-dialog').evaluate(d=>{document.activeElement.blur();d.scrollTop=0;});
  if(evidence&&['empty','funded','error'].includes(fixture))await page.screenshot({path:path.join(evidence,`${width}-${theme}-${fixture}-wall.png`),fullPage:true});
  if(fixture==='error'){unavailable=false;await page.locator('#sponsor-retry').click();await page.waitForFunction(()=>document.querySelector('#sponsor-retry').hidden&&document.querySelector('#sponsor-spotlight').getAttribute('aria-busy')==='false');assert.match(await page.locator('#sponsor-wall').textContent(),/waiting for its first sponsor/);}
  assert.equal(await page.locator('#sponsor-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);assert.deepEqual(errors,[]);
  results.push({width,theme,fixture,status:'PASS'});console.log(width,theme,fixture,'PASS');await context.close();
 }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));if(evidence)await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(results,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
