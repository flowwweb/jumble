// node tests/header-browser.cjs <playwright module> <browser executable>
const assert=require('node:assert/strict'),{chromium}=require(process.argv[2]);
(async()=>{
 const browser=await chromium.launch({executablePath:process.argv[3],headless:true});
 try{for(const width of [390,834,1440])for(const colorScheme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme}),page=await context.newPage();
  await page.goto('http://127.0.0.1:4181/?day=2099-01-01');await page.locator('#tile-14').waitFor();
  const geometry=await page.evaluate(()=>{
   const logo=document.querySelector('#logo').getBoundingClientRect();
   // Pinned artwork's colored wordmark occupies y=116..239 of its 378px canvas.
   const center=logo.y+logo.height*(177.5/378);
   return {overflow:document.documentElement.scrollWidth>innerWidth,icons:['theme','help'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {width:r.width,height:r.height,offset:r.y+r.height/2-center};})};
  });
  assert.equal(geometry.overflow,false);for(const icon of geometry.icons){assert.ok(icon.width>=44&&icon.height>=44);assert.ok(Math.abs(icon.offset)<1);}
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'theme');
  assert.equal(await page.locator('#theme').evaluate(e=>e.matches(':focus-visible')),true);
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'help');
  console.log(width,colorScheme,'PASS');await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
