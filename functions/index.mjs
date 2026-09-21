import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import Stripe from 'stripe';
import { createSwapDictionary } from '../engine/swap.mjs';
import { createBlankDictionary } from '../engine/swap-blank.mjs';
import { createDailyService } from './daily.mjs';
import { createGameService, GameError } from './game.mjs';
import { createSponsorService, SponsorError } from './sponsors.mjs';

initializeApp();
const db=getFirestore();
const cookieSecret=defineSecret('JUMBLE_COOKIE_SECRET');
const stripeKey=defineSecret('STRIPE_SECRET_KEY');
const stripeWebhook=defineSecret('STRIPE_WEBHOOK_SECRET');
const origin='https://jumbbble.web.app';
const publicOrigins=[origin,'https://jumble.flowwweb.com'];
const emulator=process.env.FUNCTIONS_EMULATOR==='true';
const allowedOrigins=new Set([...publicOrigins,...(emulator?['http://127.0.0.1:5000','http://localhost:5000']:[])]);
const readJson=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
let game, sponsors, stripe;
function gameService(){
  if(!game){
    const dictionary=readJson('../data/swap/words.json'),blankDictionary=readJson('../data/swap-blank/words.json');
    const blankPuzzles=readJson('../data/swap-blank/puzzles.json');
    const normal=createGameService({db,mode:'swap-adjacent-v3',dictionary:createSwapDictionary(dictionary.words),dictionaryVersion:dictionary.version,puzzles:readJson('../data/swap-adjacent/puzzles.json').map(puzzle=>({...puzzle,board:puzzle.letters}))});
    const blank=createGameService({db,mode:'swap-blank-v1',dictionary:createBlankDictionary(blankDictionary.words),dictionaryVersion:blankDictionary.version,puzzles:blankPuzzles.map(puzzle=>({...puzzle,board:puzzle.letters}))});
    game=createDailyService({normal,blank,blankDays:blankPuzzles.map(puzzle=>puzzle.id)});
  }
  return game;
}
function paymentServices(){
  if(!stripe){stripe=new Stripe(stripeKey.value());sponsors=createSponsorService({db,stripe,origin,allowedReturnOrigins:publicOrigins,livemode:!stripeKey.value().includes('_test_'),getPuzzle:day=>gameService().getPuzzle(day)});}
  return {sponsors,stripe};
}
function mac(value){return createHmac('sha256',cookieSecret.value()).update(value).digest('hex');}
function identity(req,res){
  const value=req.headers.cookie?.split(';').map(part=>part.trim()).find(part=>part.startsWith('__session='))?.slice(10)||'';
  const [uid,signature]=value.split('.');
  if(/^[a-f0-9]{64}$/.test(uid||'')&&/^[a-f0-9]{64}$/.test(signature||'')&&timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(mac(uid),'hex')))return uid;
  const next=randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie',`__session=${next}.${mac(next)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${emulator?'':'; Secure'}`);
  return next;
}
async function limit(req,route){
  const minute=Math.floor(Date.now()/60000);
  const hash=mac(`${minute}:${req.ip||'unknown'}:${['checkout','report'].includes(route)?route:'game'}`);
  const ref=db.doc(`rateLimits/${hash}`);
  await db.runTransaction(async tx=>{const doc=await tx.get(ref);const count=doc.exists?doc.data().count:0;if(count>=(['checkout','report'].includes(route)?5:120))throw new GameError('RATE_LIMITED',429);tx.set(ref,{count:count+1,expiresAt:new Date((minute+2)*60000)});});
}
const events=new Set(['puzzle_view','game_start','word_valid','word_invalid','puzzle_reset','puzzle_complete','share','theme_toggle','sponsor_open','checkout_start']);
async function countEvent(name,uid,puzzleDay){
  if(!events.has(name))return;
  const puzzle=gameService().getPuzzle(puzzleDay),day=puzzle.id;
  const collection=puzzle.mode==='swap-blank-v1'?'swapBlankV1Analytics':'swapAdjacentV3Analytics';
  const ref=db.doc(`${collection}/${day}`);
  if(name==='game_start'||name==='puzzle_complete'){
    const unique=db.doc(`${collection}/${day}/dedup/${mac(`${name}:${uid}`)}`);
    await db.runTransaction(async tx=>{if((await tx.get(unique)).exists)return;tx.set(unique,{event:name});tx.set(ref,{[name]:FieldValue.increment(1)},{merge:true});});
  }else await ref.set({[name]:FieldValue.increment(1)},{merge:true});
}
const messages={RATE_LIMITED:'Too many requests. Wait a minute and try again.',INVALID_PUZZLE_ID:'That puzzle date is not valid.',PUZZLE_NOT_AVAILABLE:'That puzzle is not available yet.',WORD_ALREADY_ACCEPTED:'That word is already accepted. Try it on the board.',REPORT_WORD_NOT_IN_PUZZLE:'That word needs letters outside this puzzle.',REPORT_RATE_LIMITED:'You have reported five words today. Try again tomorrow.',INVALID_REPORT_WORD:'Enter a word with a length allowed for this puzzle.',INVALID_REPORT_REASON:'Briefly explain the missing word using plain text.',INVALID_GAME_MODE:'Puzzle updated. Start fresh.',DICTIONARY_VERSION_MISMATCH:'Puzzle updated. Start fresh.',SESSION_NOT_FOUND:'Your session could not be verified. Reload and try again.',INVALID_SPONSOR_URL:'Enter a valid HTTPS website or X profile.',TAKEOVER_LIMIT_EXCEEDED:'The amount needed for #1 exceeds the $10,000 limit. Join the wall instead.',INVALID_SPONSOR_AMOUNT:'Choose a whole-dollar amount within the shown limits.',INVALID_SPONSOR_NAME:'Enter a name of up to 60 characters.'};

async function handleRequest(req,res,payment=false){
  res.set('Cache-Control','private, no-store');res.set('X-Content-Type-Options','nosniff');
  const route=req.path.replace(/^\/api\/?/,'').replace(/^\//,'');
  if(['webhook','sponsors','checkout'].includes(route)!==payment){res.status(404).json({error:'Not found.'});return;}
  try{
    if(route==='webhook'){
      if(req.method!=='POST'){res.status(405).json({error:'Method not allowed.'});return;}
      if(req.rawBody.length>262144){res.status(413).json({error:'Request too large.'});return;}
      const {stripe,sponsors}=paymentServices();let event;
      try{event=stripe.webhooks.constructEvent(req.rawBody,req.get('stripe-signature')||'',stripeWebhook.value());}catch{res.status(400).json({error:'Invalid webhook signature.'});return;}
      await sponsors.handleEvent(event);res.json({received:true});return;
    }
    if(!['GET','POST'].includes(req.method)){res.status(405).json({error:'Method not allowed.'});return;}
    if(req.method==='POST'){
      if(!allowedOrigins.has(req.get('origin'))){res.status(403).json({error:'Open Jumble to make this request.'});return;}
      if(!req.is('application/json')){res.status(415).json({error:'Expected JSON.'});return;}
      if((req.rawBody?.length||0)>(route==='result'?65536:8192)){res.status(413).json({error:'Request too large.'});return;}
    }
    const uid=identity(req,res);await limit(req,route);
    const game=payment?null:gameService();
    const sponsors=payment?paymentServices().sponsors:null;
    if(route==='puzzle'&&req.method==='GET'){const puzzle=game.getPuzzle(req.query.day,req.query.mode);res.json(puzzle);return;}
    if(route==='sponsors'&&req.method==='GET'){res.json(await sponsors.list(req.query.url));return;}
    if(route==='session'&&req.method==='POST'){const result=await game.startSession(uid,req.body);await countEvent('game_start',uid,result.puzzleId);res.json(result);return;}
    if(route==='result'&&req.method==='POST'){const result=await game.submitResult(uid,req.body);await countEvent('puzzle_complete',uid,result.puzzleId);res.json(result);return;}
    if(route==='report'&&req.method==='POST'){res.json(await game.reportWord(uid,req.body));return;}
    if(route==='checkout'&&req.method==='POST'){const requestOrigin=req.get('origin');const returnOrigin=publicOrigins.includes(requestOrigin)?requestOrigin:origin;const result=await sponsors.checkout(uid,req.body,returnOrigin);await countEvent('checkout_start',uid,req.body.puzzleId);res.json(result);return;}
    if(route==='event'&&req.method==='POST'){if(typeof req.body?.puzzleId!=='string'||req.body.mode!==game.getPuzzle(req.body.puzzleId).mode||!events.has(req.body.name)||['game_start','puzzle_complete','checkout_start'].includes(req.body.name))throw new GameError('INVALID_EVENT');await countEvent(req.body.name,uid,req.body.puzzleId);res.status(204).end();return;}
    res.status(404).json({error:'Not found.'});
  }catch(error){const known=error instanceof GameError||error instanceof SponsorError;console.error(JSON.stringify({event:'api_error',route,code:known?error.code:'INTERNAL'}));res.status(known?error.status:503).json({error:messages[error.code]||(known?'That request could not be accepted. Check your input and try again.':'Jumble could not connect. Please try again.'),code:known?error.code:'UNAVAILABLE'});}
}
const options={region:'us-central1',memory:'512MiB',timeoutSeconds:30,maxInstances:3,concurrency:40};
export const api=onRequest({...options,secrets:[cookieSecret]},(req,res)=>handleRequest(req,res));
export const payments=onRequest({...options,secrets:[cookieSecret,stripeKey,stripeWebhook]},(req,res)=>handleRequest(req,res,true));
