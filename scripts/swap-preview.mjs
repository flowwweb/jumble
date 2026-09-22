// QA-only loopback adapter. No Firebase or payment SDK imports and no outbound calls.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameService, GameError } from '../functions/game.mjs';
import { createDailyService } from '../functions/daily.mjs';
import { createBlankDictionary } from '../engine/swap-blank.mjs';
import { createSwapDictionary } from '../engine/swap.mjs';
import { sponsorUrl, SponsorError, checkoutCents } from '../functions/sponsors.mjs';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
export const FIXTURE_DAY = '2099-01-01';
const allowedEvents = new Set(['puzzle_view','word_valid','word_invalid','puzzle_reset','share','theme_toggle','sponsor_open']);

function memoryDb() {
  const records = new Map();
  let pending = Promise.resolve();
  return { doc: path => path, runTransaction(work) {
    const result = pending.then(async () => {
      const writes = new Map();
      const value = await work({
        get: async path => ({exists:records.has(path),data:()=>structuredClone(records.get(path))}),
        set: (path,data) => writes.set(path,structuredClone(data)),
      });
      for (const [path,data] of writes) records.set(path,data);
      return value;
    });
    pending = result.catch(()=>{}); return result;
  }};
}

export function createSwapPreviewServer({dist=fileURLToPath(new URL('../dist/',import.meta.url)),now=Date.now}={}) {
  const vocabulary = readJson('../data/swap/words.json');
  const corpus = readJson('../data/swap-adjacent/puzzles.json');
  const sample = readJson('../data/swap-adjacent/preview.json');
  const clock = () => Math.max(now(),Date.parse('2026-09-20T12:00:00Z'));
  const db = memoryDb(), identities = new Set(), events = new Map();
  const daily = createGameService({db,now:clock,mode:'swap-adjacent-v3',dictionary:createSwapDictionary(vocabulary.words),
    dictionaryVersion:vocabulary.version,puzzles:corpus.map(p=>({...p,board:p.letters}))});
  const blankWords=readJson('../data/swap-blank/words.json'),blankPuzzles=readJson('../data/swap-blank/puzzles.json');
  const blank=createGameService({db,now:clock,mode:'swap-blank-v1',dictionary:createBlankDictionary(blankWords.words),dictionaryVersion:blankWords.version,puzzles:blankPuzzles.map(p=>({...p,board:p.letters}))});
  const assigned=createDailyService({normal:daily,blank,blankDays:blankPuzzles.map(p=>p.id),now:clock});
  const fixture = createGameService({db,now:()=>Math.max(clock(),Date.parse(`${FIXTURE_DAY}T12:00:00Z`)),mode:'swap-adjacent-v3',
    dictionary:createSwapDictionary(vocabulary.words),dictionaryVersion:vocabulary.version,
    puzzles:[{...sample,id:FIXTURE_DAY,board:sample.letters}]});
  const server = createServer(async(req,res)=>{
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Jumble-Preview':'isolated-memory'});res.end(JSON.stringify(data));};
    try {
      const expected=`127.0.0.1:${server.address().port}`;
      if(req.headers.host!==expected || (req.headers.origin && req.headers.origin!==`http://${expected}`))return json(403,{error:'Loopback preview only.'});
      const url=new URL(req.url,`http://${expected}`);
      const blankFiles={'/blank-fixture':'../scripts/blank-preview.html','/prototype/blank-preview.mjs':'../scripts/blank-preview.mjs','/prototype/swap-blank.mjs':'../engine/swap-blank.mjs','/prototype/words.json':'../docs/research/blank-prototype-words-v1.json','/prototype/fixtures.json':'../docs/research/blank-prototype-fixtures.json'};
      if(req.method==='GET'&&blankFiles[url.pathname]){res.writeHead(200,{'Content-Type':url.pathname==='/blank-fixture'?'text/html':url.pathname.endsWith('.mjs')?'text/javascript':'application/json','Cache-Control':'no-store'});return res.end(await readFile(new URL(blankFiles[url.pathname],import.meta.url)));}
      if(url.pathname==='/preview'&&req.method==='GET'){
        res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
        return res.end('<!doctype html><title>Isolated SWAP preview</title><h1>Isolated SWAP preview</h1><p>QA only. Rankings and events are in memory and disappear on restart. No Firestore connection. Payments are blocked.</p><p><a href="/">Daily corpus, exact built interface</a></p><p><a href="/?day=2099-01-01">Synthetic fixture 2099-01-01, separate from daily puzzles</a></p>');
      }
      if(url.pathname.startsWith('/api/')) {
        let uid=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('swap_preview='))?.slice(13);
        if(!identities.has(uid)){uid=randomBytes(32).toString('hex');identities.add(uid);res.setHeader('Set-Cookie',`swap_preview=${uid}; Path=/; HttpOnly; SameSite=Strict`);}
        const route=url.pathname.slice(5);
        if(route==='puzzle'&&req.method==='GET'){
          const day=url.searchParams.get('day')||undefined;
          return json(200,{...(day===FIXTURE_DAY?fixture:assigned).getPuzzle(day),preview:day===FIXTURE_DAY?'synthetic-fixture':'daily-corpus-memory'});
        }
        if(route==='sponsors'&&req.method==='GET'){
          const scenario=new URL(req.headers.referer||`http://${expected}`).searchParams.get('sponsor-fixture');
          if(scenario==='loading')await new Promise(resolve=>setTimeout(resolve,900));
          if(scenario==='error')return json(503,{error:'Preview sponsor service unavailable.'});
          if(url.searchParams.has('url'))sponsorUrl(url.searchParams.get('url'));
          const rows=['funded','loading'].includes(scenario)?[{name:'Preview sponsor with a deliberately long name for layout checks',url:'https://example.com/',cents:1200,rank:1},{name:'Second preview sponsor',url:'https://example.org/',cents:1200,rank:1},{name:'Third preview sponsor',url:'https://example.net/',cents:500,rank:3}]:[];
          return json(200,{rows,total:rows.length,totalCents:rows.reduce((sum,r)=>sum+r.cents,0),topCents:rows[0]?.cents||0,...(url.searchParams.has('url')?{takeoverCents:checkoutCents('takeover',rows[0]?.cents||0,rows.find(row=>row.url===sponsorUrl(url.searchParams.get('url')))?.cents||0)}:{}),preview:true});
        }
        if(route==='checkout'||route==='webhook')return json(403,{error:'Payments are disabled in this isolated preview.'});
        if(req.method!=='POST')return json(405,{error:'Method not allowed.'});
        if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(415,{error:'Expected JSON.'});
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)return json(413,{error:'Request too large.'});}
        const input=JSON.parse(body),game=input.puzzleId===FIXTURE_DAY?fixture:assigned;
        if(route==='session')return json(200,await game.startSession(uid,input));
        if(route==='result')return json(200,{...await game.submitResult(uid,input),preview:true});
        if(route==='report')return json(200,await game.reportWord(uid,input));
        if(route==='event'&&['swap-adjacent-v3','swap-blank-v1'].includes(input.mode)&&allowedEvents.has(input.name)){events.set(input.name,(events.get(input.name)||0)+1);res.writeHead(204);return res.end();}
        return json(400,{error:'Unsupported preview request.'});
      }
      if(!['GET','HEAD'].includes(req.method))return json(405,{error:'Method not allowed.'});
      const root=await realpath(dist);
      const path=await realpath(resolve(root,`.${decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)}`));
      const within=relative(root,path);
      if(within.startsWith('..')||isAbsolute(within))return json(403,{error:'Outside preview build.'});
      const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain'};
      res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store','X-Jumble-Preview':'isolated-memory'});
      res.end(req.method==='HEAD'?undefined:await readFile(path));
    }catch(error){json((error instanceof GameError||error instanceof SponsorError)?error.status:error instanceof SyntaxError?400:404,{error:(error instanceof GameError||error instanceof SponsorError)?error.code:'Preview request unavailable.',...((error instanceof GameError||error instanceof SponsorError)?{code:error.code}:{})});}
  });
  return server;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const today=process.argv.find(arg=>arg.startsWith('--today='))?.slice(8);
  createSwapPreviewServer(today?{now:()=>Date.parse(`${today}T12:00:00Z`)}:{}).listen(4181,'127.0.0.1',()=>console.log('ISOLATED SWAP PREVIEW: http://127.0.0.1:4181/ | synthetic fixture /?day=2099-01-01 | memory only; no Firestore; payments blocked; restart clears results'));
}
