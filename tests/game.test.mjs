import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameService } from '../functions/game.mjs';
import { createDictionary } from '../engine/index.mjs';
import { createSwapDictionary } from '../engine/swap.mjs';
import { createHash } from 'node:crypto';

function fixture(swap = false, optimality) {
  const records = new Map();
  let time = Date.parse('2026-09-19T10:00:00Z'), queue = Promise.resolve();
  const db = { doc: path => path, runTransaction(work) {
    const result = queue.then(async () => {
      const writes = new Map();
      const output = await work({ get: async path => ({ exists: records.has(path), data: () => structuredClone(records.get(path)) }),
        set: (path, value) => writes.set(path, structuredClone(value)) });
      for (const [path, value] of writes) records.set(path, value);
      return output;
    });
    queue = result.catch(() => {}); return result;
  } };
  const dictionary = swap ? createSwapDictionary(['apple', 'table', 'chair']) : createDictionary(['apple', 'table', 'chair', 'appletable']);
  const game = createGameService({ db, dictionary, dictionaryVersion: 'test-v1', now: () => time,
    ...(swap ? {mode:'swap-adjacent-v2'} : {}),
    puzzles: ['2026-09-18', '2026-09-19', '2026-09-20'].map(id => ({ id, letters: 'appletablechair', board: [...'papletablechair'], dictionaryVersion: 'test-v1', minimum: 2, optimality })) });
  return { game, dictionary, records, advance: milliseconds => { time += milliseconds; } };
}
const uid = 'anonymous-report-player';
const report = (changes = {}) => ({ puzzleId: '2026-09-19', dictionaryVersion: 'test-v1', word: 'plate', reason: 'Common English noun', ...changes });

test('SWAP replay counts forward swaps through undo/reset and preserves one authoritative best', async () => {
  const {game, records, advance} = fixture(true);
  const context = {puzzleId:'2026-09-19',mode:'swap-adjacent-v2',dictionaryVersion:'test-v1'};
  assert.deepEqual(Object.keys(game.getPuzzle()), ['id','mode','board','dictionaryVersion']);
  const session = await game.startSession(uid,context);
  const finish = {type:'swap',from:0,to:1};
  const extra = {type:'swap',from:5,to:6};
  advance(3000);
  const submit = actions => game.submitResult(uid,{...context,sessionId:session.sessionId,actions,moves:0,elapsedMs:0});
  const first = await submit([extra,{type:'undo'},extra,{type:'reset'},finish]);
  assert.equal(first.moves,3); assert.equal(first.elapsedMs,3000);
  assert.deepEqual(first.words,['apple','table','chair']);
  advance(2000);
  const noops = [{type:'swap',from:0,to:0},{type:'swap',from:0,to:6},{type:'swap',from:0,to:2},{type:'swap',from:0,to:3}];
  const [best,retry] = await Promise.all([submit([...noops,finish]),submit([finish])]);
  assert.deepEqual(best,retry); assert.equal(best.moves,1); assert.equal(best.total,1);
  assert.equal(best.elapsedMs,5000); assert.equal(best.firstCompletedAt,first.completedAt);
  assert.deepEqual(await submit([extra,{type:'undo'},finish]),best);
  assert.equal((await game.startSession(uid,context)).startedAt,session.startedAt);
  assert.ok([...records.keys()].every(path=>path.startsWith('swapAdjacentV2Days/')));
  const second = await game.startSession('second-anonymous-user',context);
  const tied = await game.submitResult('second-anonymous-user',{...context,sessionId:second.sessionId,actions:[finish]});
  assert.equal(tied.tied,2); assert.equal(tied.rank,1); assert.equal(tied.total,2);
});

test('SWAP accepted retries refresh current ranks without mutating best result or participant counts', async () => {
  const {game,records,advance}=fixture(true);
  const context={puzzleId:'2026-09-19',mode:'swap-adjacent-v2',dictionaryVersion:'test-v1'};
  const finish={type:'swap',from:0,to:1},extra={type:'swap',from:5,to:6};
  const slow=[extra,{type:'undo'},finish],fast=[finish];
  const session=await game.startSession(uid,context);
  const submit=actions=>game.submitResult(uid,{...context,sessionId:session.sessionId,actions});
  const initial=await submit(slow);
  assert.equal(initial.rank,1);assert.equal(initial.total,1);
  advance(1000);
  for(const [player,actions] of [['second-anonymous-user',fast],['third-anonymous-user',slow]]) {
    const other=await game.startSession(player,context);
    await game.submitResult(player,{...context,sessionId:other.sessionId,actions});
  }
  const before=structuredClone([...records]);
  advance(1000);
  const [equal,worse]=await Promise.all([submit(slow),submit([extra,{type:'undo'},...slow])]);
  assert.deepEqual(equal,worse);
  assert.equal(equal.rank,2);assert.equal(equal.total,3);assert.equal(equal.tied,2);
  assert.equal(equal.rankingAsOf,initial.rankingAsOf+2000);
  for(const field of ['moves','actions','board','words','elapsedMs','completedAt','firstCompletedAt']) assert.deepEqual(equal[field],initial[field]);
  assert.deepEqual([...records],before);
  const improved=await submit(fast);
  assert.equal(improved.rank,1);assert.equal(improved.total,3);assert.equal(improved.tied,2);
  assert.deepEqual(records.get('swapAdjacentV2Days/2026-09-19').counts,{1:2,2:1});
  advance(1000);
  const refreshed=await submit(slow);
  assert.equal(refreshed.moves,1);assert.equal(refreshed.rank,1);assert.equal(refreshed.total,3);
  assert.equal(refreshed.rankingAsOf,improved.rankingAsOf+1000);
  assert.deepEqual(refreshed.actions,fast);
});

test('optimal solution appears only after completion with an exact bound trusted receipt and legal witness', async () => {
  const hash=text=>createHash('sha256').update(text).digest('hex');
  const receipt={status:'PROVEN',rulesVersion:'swap-adjacent-v2',dictionaryVersion:'test-v1',
    boardSha256:hash('PAPLETABLECHAIR'),dictionaryWordsSha256:hash(JSON.stringify(['apple','chair','table'])),
    minimumMoves:1,optimalActions:[{type:'swap',from:0,to:1}],optimalWords:['apple','table','chair'],
    proof:{method:'multi-source-bidirectional-bfs-v1',exhaustiveBelow:1}};
  const context={puzzleId:'2026-09-19',mode:'swap-adjacent-v2',dictionaryVersion:'test-v1'};
  const {game}=fixture(true,receipt);
  assert.deepEqual(Object.keys(game.getPuzzle()),['id','mode','board','dictionaryVersion']);
  const session=await game.startSession(uid,context);
  assert.equal('optimal' in session,false);
  const input={...context,sessionId:session.sessionId,actions:receipt.optimalActions};
  const completed=await game.submitResult(uid,input);
  assert.deepEqual(completed.optimal,{moves:1,actions:receipt.optimalActions,words:receipt.optimalWords});
  assert.deepEqual((await game.submitResult(uid,input)).optimal,completed.optimal);
  for(const change of [{status:'UNVERIFIED'},{rulesVersion:'swap-v1'},{dictionaryVersion:'old'},
    {boardSha256:'wrong'},{dictionaryWordsSha256:'wrong'},{minimumMoves:0},
    {proof:{method:'known-solution',exhaustiveBelow:1}},{proof:{method:'multi-source-bidirectional-bfs-v1',exhaustiveBelow:0}},
    {optimalActions:[{from:0,to:1}]},{optimalActions:[{type:'swap',from:0,to:3}]},{optimalWords:['wrong']}]) {
    const {game:other}=fixture(true,{...receipt,...change});
    const attempt=await other.startSession(uid,context);
    const result=await other.submitResult(uid,{...input,sessionId:attempt.sessionId});
    assert.equal('optimal' in result,false);
  }
});

test('adjacent v2 ignores prior sessions/results and leaves every v1 record untouched', async () => {
  const {game,records}=fixture(true);
  const player=createHash('sha256').update(uid).digest('hex');
  const prior=[
    [`swapAdjacentV1Days/2026-09-19/sessions/${player}`,{sessionId:'old-session',puzzleId:'2026-09-19',startedAt:1}],
    [`swapAdjacentV1Days/2026-09-19/results/${player}`,{moves:1,total:99}],
    ['swapAdjacentV1Days/2026-09-19',{counts:{1:99}}],
    ['swapAdjacentV1Analytics/2026-09-19',{puzzle_complete:99}],
    ['swapAdjacentV1WordReports/retained',{status:'pending'}],
  ];
  for(const [path,value] of prior)records.set(path,structuredClone(value));
  const context={puzzleId:'2026-09-19',mode:'swap-adjacent-v2',dictionaryVersion:'test-v1'};
  await assert.rejects(game.startSession(uid,{...context,mode:'swap-adjacent-v1'}),{code:'INVALID_GAME_MODE'});
  const session=await game.startSession(uid,context);
  assert.notEqual(session.sessionId,'old-session');
  const input={...context,sessionId:session.sessionId,actions:[{type:'swap',from:0,to:1}]};
  await assert.rejects(game.submitResult(uid,{...input,sessionId:'old-session'}),{code:'SESSION_NOT_FOUND'});
  await assert.rejects(game.submitResult(uid,{...input,mode:'swap-adjacent-v1'}),{code:'INVALID_GAME_MODE'});
  const result=await game.submitResult(uid,input);
  assert.equal(result.total,1);assert.equal(result.rank,1);
  for(const [path,value] of prior)assert.deepEqual(records.get(path),value);
});

test('SWAP rejects legacy/version/session forgery, unsolved and terminal trailing replay', async () => {
  const {game,records} = fixture(true);
  const context = {puzzleId:'2026-09-19',mode:'swap-adjacent-v2',dictionaryVersion:'test-v1'};
  const session = await game.startSession(uid,context);
  const finish = {type:'swap',from:0,to:1};
  const input = {...context,sessionId:session.sessionId,actions:[finish]};
  for (const change of [{mode:undefined},{mode:'swap-v1'},{mode:'shift-v1'},{dictionaryVersion:'old'},{sessionId:'fake'},
    {actions:[]},{actions:[finish,{type:'undo'}]},{actions:[finish,{type:'reset'}]},
    {actions:[{type:'cheat'}]},{actions:[{type:'swap',from:'0',to:1},finish]},
    {actions:[{type:'reset',secret:'payload'},finish]},{actions:Array(1001).fill({type:'reset'})}]) {
    await assert.rejects(game.submitResult(uid,{...input,...change}));
  }
  await assert.rejects(game.submitResult('another-anonymous-user',input));
  assert.equal([...records.keys()].filter(path=>path.includes('/results/')).length,0);
});

test('word reports are pending, deduplicated, context-bound and never admit words', async () => {
  const { game, dictionary, records } = fixture();
  const replies = await Promise.all([game.reportWord(uid, report()), game.reportWord(uid, report({ word: 'PLATE' }))]);
  assert.deepEqual(replies.map(reply => reply.duplicate), [false, true]);
  assert.equal(replies[0].status, 'pending');
  assert.equal(dictionary.has('plate'), false);
  const saved = [...records].filter(([path]) => path.startsWith('wordReports/'));
  assert.equal(saved.length, 1);
  assert.deepEqual(Object.keys(saved[0][1]).sort(), ['createdAt', 'dictionaryVersion', 'puzzleId', 'reason', 'status', 'word']);
  assert.equal(saved[0][1].puzzleId, '2026-09-19');
});
test('malformed reports, mismatched versions, unavailable puzzles and irrelevant words cannot queue', async () => {
  const { game, records } = fixture();
  for (const changes of [{ puzzleId: '2026-09-20' }, { puzzleId: '2026-02-30' }, { puzzleId: '2026-01-01' },
    { dictionaryVersion: 'fake' }, { word: 'apple' }, { word: 'zebra' }, { word: '../../user' }, { word: 'x'.repeat(16) },
    { reason: '' }, { reason: '<script>' }, { reason: 'a\nb' }, { reason: 'a'.repeat(281) }]) {
    await assert.rejects(game.reportWord(uid, report(changes)));
  }
  await assert.rejects(game.reportWord('short', report()), { code: 'AUTH_REQUIRED' });
  assert.equal(records.size, 0);
});
test('five unique reports per player/UTC day, duplicate retries free, next day budget separate', async () => {
  const { game, advance } = fixture();
  for (const word of ['plate', 'pleat', 'late', 'tale', 'tire']) await game.reportWord(uid, report({ word }));
  assert.equal((await game.reportWord(uid, report())).duplicate, true);
  await assert.rejects(game.reportWord(uid, report({ word: 'pair' })), { code: 'REPORT_RATE_LIMITED' });
  advance(86400000);
  assert.equal((await game.reportWord(uid, report({ word: 'pair' }))).duplicate, false);
});
test('concurrent better replays move one score bucket, preserve first completion and never restart timing', async () => {
  const { game, advance, records } = fixture();
  const session = await game.startSession(uid, { puzzleId: '2026-09-19' });
  const input = { puzzleId: '2026-09-19', sessionId: session.sessionId, dictionaryVersion: 'test-v1', words: ['apple', 'table', 'chair'] };
  const first = await game.submitResult(uid, input);
  advance(5000);
  const better = { ...input, words: ['appletable', 'chair'] };
  const [one, two] = await Promise.all([game.submitResult(uid, better), game.submitResult(uid, better)]);
  assert.deepEqual(one, two);
  assert.equal(one.wordCount, 2);
  assert.equal(one.total, 1);
  assert.equal(one.elapsedMs, 5000);
  assert.equal(one.firstCompletedAt, first.completedAt);
  assert.equal((await game.startSession(uid, { puzzleId: input.puzzleId })).startedAt, session.startedAt);
  assert.deepEqual(await game.submitResult(uid, input), one);
  assert.deepEqual(records.get(`gameDays/${input.puzzleId}`).counts.slice(2, 4), [1, 0]);
});
