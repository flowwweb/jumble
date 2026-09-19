import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameService } from '../functions/game.mjs';
import { createDictionary } from '../engine/index.mjs';

function fixture() {
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
  const dictionary = createDictionary(['apple', 'table', 'chair', 'appletable']);
  const game = createGameService({ db, dictionary, dictionaryVersion: 'test-v1', now: () => time,
    puzzles: ['2026-09-18', '2026-09-19', '2026-09-20'].map(id => ({ id, letters: 'appletablechair', dictionaryVersion: 'test-v1', minimum: 2 })) });
  return { game, dictionary, records, advance: milliseconds => { time += milliseconds; } };
}
const uid = 'anonymous-report-player';
const report = (changes = {}) => ({ puzzleId: '2026-09-19', dictionaryVersion: 'test-v1', word: 'plate', reason: 'Common English noun', ...changes });

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
