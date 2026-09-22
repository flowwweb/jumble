// Run against the isolated preview: node tests/modal-browser.cjs <playwright module> <browser executable>
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.argv[2]);
(async()=>{
 const browser=await chromium.launch({executablePath:process.argv[3],headless:true});
 try{
  for(const mode of ['normal','blank'])for(const motion of ['reduce','no-preference']){
   const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:motion});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4181/?day='+(mode==='normal'?'2099-01-01':'2026-09-24'));
   await page.locator('#tile-14').waitFor();
   if(mode==='normal'){
    const before=await page.evaluate(()=>JSON.stringify(localStorage));
    await page.locator('#tile-4').click();
    assert.equal(await page.locator('#tile-9').getAttribute('aria-label'),'S, row 2, column 5, available to swap');
    assert.ok((await page.locator('#tile-9').getAttribute('class')).includes('partner'));
    await page.locator('#tile-9').click();
    assert.equal(await page.locator('#moves').textContent(),'0 swaps');
    assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)),before);
    assert.equal(await page.locator('#undo').isDisabled(),true);
   }
   const actions=mode==='normal'?[{from:5,to:10},{from:0,to:5}]:JSON.parse(fs.readFileSync('data/swap-blank/puzzles.json'))[0].optimality.optimalActions;
   for(const {from,to} of actions){await page.locator('#tile-'+from).click();await page.locator('#tile-'+to).click();await page.waitForTimeout(360);}
   await page.locator('#result[open]').waitFor();await page.locator('#show-solution').waitFor();
   assert.equal(await page.locator('dialog[open]').count(),1);
   assert.equal(await page.locator('#victory-visual').evaluate(img=>img.complete&&img.naturalWidth>0),true);
   assert.equal(await page.locator('#result-heading').textContent(),'Perfectly swapped.');
   if(motion==='reduce')assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
   for(const [button,dialog] of [['share','share-dialog'],['show-solution','solution-dialog']]){
    await page.locator('#'+button).click();assert.equal(await page.locator('dialog[open]').count(),1);
    await page.locator('#'+dialog+' .close').click();await page.locator('#result[open]').waitFor();
    assert.equal(await page.locator('dialog[open]').count(),1);assert.equal(await page.evaluate(()=>document.activeElement.id),button);
   }
   await page.keyboard.press('Escape');await page.locator('#result[open]').waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>document.activeElement.id),'view-result');
   await page.locator('#view-result').click();assert.equal(await page.locator('.confetti').count(),0);
   await page.reload();await page.locator('#result[open]').waitFor();assert.equal(await page.locator('.confetti').count(),0);
   assert.deepEqual(errors,[]);console.log(mode,motion,'PASS');await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
