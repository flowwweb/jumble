import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createSwapPreviewServer } from '../scripts/swap-preview.mjs';
import { applySwap, evaluateBoard, createSwapDictionary } from '../engine/swap.mjs';

test('isolated HTTP preview uses real SWAP replay, per-browser sessions, exact assets and no payments', async t=>{
  const server=createSwapPreviewServer({now:()=>Date.parse('2026-09-20T12:00:00Z')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(`${origin}/api/puzzle?day=2099-01-01`);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const puzzle=await response.json();
  assert.equal(puzzle.preview,'synthetic-fixture');
  const vocabulary=JSON.parse(await readFile(new URL('../data/swap/words.json',import.meta.url),'utf8'));
  assert.equal(puzzle.dictionaryVersion,vocabulary.version);
  const dictionary=createSwapDictionary(vocabulary.words);
  for(const word of ['slick','souls','mages','birds','boats','cakes','baked','liked','asked','takes','heads'])assert.equal(dictionary.has(word),true,word);
  const publicWords=await (await fetch(`${origin}/data/swap-words-${puzzle.dictionaryVersion}.json`)).json();
  assert.deepEqual(publicWords.words,vocabulary.words);
  assert.deepEqual(evaluateBoard(puzzle.board,dictionary).validRows,[false,false,false]);
  for(let from=0;from<15;from++)for(let to=from+1;to<15;to++) {
    if((Math.abs(Math.floor(from/5)-Math.floor(to/5))+Math.abs(from%5-to%5)===1)&&puzzle.board[from]!==puzzle.board[to]) {
      assert.equal(evaluateBoard(applySwap(puzzle.board,{from,to}),dictionary).won,false);
    }
  }
  assert.equal(puzzle.board.join(''),'MOULSVAGESSOICE');
  const post=(route,input,identity=cookie)=>fetch(`${origin}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:identity},body:JSON.stringify(input)});
  const context={mode:'swap-adjacent-v3',puzzleId:puzzle.id,dictionaryVersion:puzzle.dictionaryVersion};
  const report={...context,word:'mouls',reason:'Preview-only review flow check'};
  assert.deepEqual(await (await post('report',report)).json(),{received:true,status:'pending',duplicate:false});
  assert.equal((await (await post('report',report)).json()).duplicate,true);
  assert.equal((await (await post('report',{...report,word:'souls'})).json()).code,'WORD_ALREADY_ACCEPTED');
  assert.equal((await (await post('report',{...report,word:'zzzzz'})).json()).code,'REPORT_WORD_NOT_IN_PUZZLE');
  assert.equal(dictionary.has('mouls'),false);
  const session=await (await post('session',context)).json();
  assert.equal((await (await post('session',context)).json()).sessionId,session.sessionId);
  const actions=[[5,10],[0,5]]
    .map(([from,to])=>({type:'swap',from,to}));
  const input={...context,sessionId:session.sessionId,actions};
  assert.equal((await post('result',{...input,actions:[]})).status,400);
  assert.equal((await post('result',input,'')).status,403);
  const result=await (await post('result',input)).json();
  assert.equal(result.moves,2);assert.equal(result.total,1);
  assert.deepEqual(result.words,['souls','mages','voice']);assert.equal(result.optimal.moves,2);assert.deepEqual(result.optimal.actions,actions);assert.equal('optimal' in puzzle,false);assert.equal('optimality' in puzzle,false);
  assert.deepEqual(await (await post('result',input)).json(),result);
  assert.equal((await post('checkout',{})).status,403);
  assert.equal((await post('event',{mode:'swap-adjacent-v3',name:'share'})).status,204);
  const daily=await (await fetch(`${origin}/api/puzzle?day=2026-09-20`)).json();
  assert.equal(daily.preview,'daily-corpus-memory');
  assert.equal('solutionMoves' in daily,false);assert.equal('solutionWords' in daily,false);
  const corpus=JSON.parse(await readFile(new URL('../data/swap-adjacent/puzzles.json',import.meta.url),'utf8'));
  const dayContext={mode:'swap-adjacent-v3',puzzleId:daily.id,dictionaryVersion:daily.dictionaryVersion};
  const daySession=await (await post('session',dayContext)).json();
  const solved=await post('result',{...dayContext,sessionId:daySession.sessionId,actions:corpus[0].solutionMoves.map(a=>({type:'swap',...a}))});
  assert.equal(solved.status,200);assert.equal((await solved.json()).moves,corpus[0].solutionMoves.length);
  const module=await fetch(`${origin}/engine/swap.mjs`);
  assert.match(module.headers.get('content-type'),/^text\/javascript/);
  assert.equal(await module.text(),await readFile(new URL('../dist/engine/swap.mjs',import.meta.url),'utf8'));
  assert.equal(await (await fetch(origin)).text(),await readFile(new URL('../dist/index.html',import.meta.url),'utf8'));
  assert.equal((await fetch(`${origin}/api/puzzle`,{headers:{Origin:'https://evil.com'}})).status,403);
  assert.notEqual((await fetch(`${origin}/%2e%2e%2ffunctions/index.mjs`)).status,200);
});

// The same licensed acceptance list drives browser, server and optimality proofs.
test('SWAP vocabulary retains source-supported inflections and matches its approved source',async()=>{
  const read=path=>readFile(new URL(path,import.meta.url),'utf8');
  const review=JSON.parse(await read('../data/swap/accepted-v4.json'));
  const previous=JSON.parse(await read('../data/swap/accepted-v3.json'));
  const raw=await read('../data/swap/words.json'),words=JSON.parse(raw);
  assert.equal(review.status,'APPROVED_FOR_ROW_VALIDATION_NOT_GENERATOR_SEEDS');
  assert.equal(words.words.length,7039);
  assert.deepEqual(words.words,review.words);
  assert.deepEqual(words.words,[...new Set(words.words)].sort());
  assert.equal(words.words.every(word=>/^[a-z]{5}$/.test(word)),true);
  assert.equal(previous.words.every(word=>words.words.includes(word)),true);
  assert.equal(createHash('sha256').update(JSON.stringify(words.words)).digest('hex'),review.wordsSha256);
  assert.equal(words.version,`swap-accepted-v4-${review.wordsSha256.slice(0,12)}`);
  assert.equal(words.source.commit,review.sourceCommit);
  assert.equal(words.source.exportSha256,review.sourceExportSha256);
  assert.equal(words.copyright,review.copyright);
  assert.equal(createHash('sha256').update(words.copyright).digest('hex'),review.copyrightSha256);
  assert.equal(await read(`../public/data/swap-words-${words.version}.json`),raw);
});
