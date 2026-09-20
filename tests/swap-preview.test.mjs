import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(dictionary.has('slick'),true);
  const publicWords=await (await fetch(`${origin}/data/swap-words-${puzzle.dictionaryVersion}.json`)).json();
  assert.deepEqual(publicWords.words,vocabulary.words);
  assert.deepEqual(evaluateBoard(puzzle.board,dictionary).validRows,[false,false,false]);
  for(let from=0;from<15;from++)for(let to=from+1;to<15;to++) {
    if((Math.floor(from/5)===Math.floor(to/5)||from%5===to%5)&&puzzle.board[from]!==puzzle.board[to]) {
      assert.equal(evaluateBoard(applySwap(puzzle.board,{from,to}),dictionary).won,false);
    }
  }
  assert.equal(puzzle.board.join(''),'ACIRKBRTCENAESL');
  const post=(route,input,identity=cookie)=>fetch(`${origin}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:identity},body:JSON.stringify(input)});
  const context={mode:'swap-v1',puzzleId:puzzle.id,dictionaryVersion:puzzle.dictionaryVersion};
  const session=await (await post('session',context)).json();
  assert.equal((await (await post('session',context)).json()).sessionId,session.sessionId);
  const actions=[[5,7],[10,13],[1,4],[5,7],[1,3],[11,12],[7,8],[0,5],[8,13],[3,4],[11,14],[5,7]]
    .map(([from,to])=>({type:'swap',from,to}));
  const input={...context,sessionId:session.sessionId,actions};
  assert.equal((await post('result',{...input,actions:[]})).status,400);
  assert.equal((await post('result',input,'')).status,403);
  const result=await (await post('result',input)).json();
  assert.equal(result.moves,12);assert.equal(result.total,1);
  assert.deepEqual(result.words,['brick','crane','slate']);
  assert.deepEqual(await (await post('result',input)).json(),result);
  assert.equal((await post('checkout',{})).status,403);
  assert.equal((await post('event',{mode:'swap-v1',name:'share'})).status,204);
  const daily=await (await fetch(`${origin}/api/puzzle?day=2026-09-20`)).json();
  assert.equal(daily.preview,'daily-corpus-memory');
  assert.equal('solutionMoves' in daily,false);assert.equal('solutionWords' in daily,false);
  const corpus=JSON.parse(await readFile(new URL('../data/swap/puzzles.json',import.meta.url),'utf8'));
  const dayContext={mode:'swap-v1',puzzleId:daily.id,dictionaryVersion:daily.dictionaryVersion};
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
