import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin=process.argv[2]||'http://127.0.0.1:5000';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('This mutation smoke test is restricted to local emulators.');
let cookie='';
async function request(path,body,extra={}){
  const response=await fetch(`${origin}/api/${path}`,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json',origin}),...(cookie?{cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
  const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
  return {status:response.status,body:response.status===204?null:await response.json()};
}
const puzzle=await request('puzzle');assert.equal(puzzle.status,200);assert.equal(puzzle.body.letters.length,15);assert.equal('solution' in puzzle.body,false);assert.match(cookie,/^__session=/);
const rejected=await request('session',{puzzleId:puzzle.body.id},{origin:'https://untrusted.invalid'});assert.equal(rejected.status,403);
const session=await request('session',{puzzleId:puzzle.body.id});assert.equal(session.status,200);
const same=await request('session',{puzzleId:puzzle.body.id});assert.equal(same.body.sessionId,session.body.sessionId);
const wrong=await request('result',{puzzleId:puzzle.body.id,sessionId:session.body.sessionId,words:['fake'],dictionaryVersion:puzzle.body.dictionaryVersion});assert.equal(wrong.status,400);
const schedule=JSON.parse(await readFile('data/puzzles.json','utf8'));const witness=schedule.find(item=>item.id===puzzle.body.id);
const words=witness.solution||witness.witness;
assert.ok(Array.isArray(words),'schedule must include a witness');
const payload={puzzleId:puzzle.body.id,sessionId:session.body.sessionId,words,dictionaryVersion:puzzle.body.dictionaryVersion};
const result=await request('result',payload);assert.equal(result.status,200);assert.equal(result.body.wordCount,words.length);assert.equal(result.body.minimum,witness.minimum);assert.ok(result.body.elapsedMs>=0);
const replay=await request('result',payload);assert.deepEqual(replay.body,result.body);
const sponsors=await request('sponsors');assert.equal(sponsors.status,200);assert.deepEqual(sponsors.body.rows,[]);
const webhook=await request('webhook',{type:'charge.succeeded'});assert.equal(webhook.status,400);
console.log(JSON.stringify({surface:'local Firebase emulators',puzzleId:puzzle.body.id,checks:['puzzle hides answer','signed session cookie','CSRF rejected','stable timer','invalid partition rejected','validated result','idempotent result','empty genuine sponsors','invalid webhook rejected'],wordCount:result.body.wordCount,rank:result.body.rank,total:result.body.total},null,2));
