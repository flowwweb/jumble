import test from 'node:test';
import assert from 'node:assert/strict';
import { createDictionary } from '../engine/index.mjs';
import { createGameService } from '../functions/game.mjs';

// Serial transaction fake exercises service state, not Firestore deployment behavior.
function store() {
  const records = new Map();
  let pending = Promise.resolve();
  return {
    doc: path => path,
    runTransaction(fn) {
      const operation = pending.then(async () => {
        const writes = new Map();
        const value = await fn({
          get: async path => ({ exists: records.has(path), data: () => structuredClone(records.get(path)) }),
          set: (path, data) => writes.set(path, structuredClone(data)),
        });
        for (const [path, data] of writes) records.set(path, data);
        return value;
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
const day = '2026-09-19';
const uid = 'player-one-anonymous';
const words = ['apple', 'table', 'chair'];
function fixture() {
  let time = Date.parse(`${day}T10:00:00Z`);
  const game = createGameService({ db: store(), now: () => time,
    dictionary: createDictionary([...words, 'appletable', 'z']), dictionaryVersion: 'test-v1',
    puzzles: [day, '2026-09-18', '2026-09-20'].map(id => ({ id, letters: words.join(''), dictionaryVersion: 'test-v1', minimum: 2 })),
  });
  return { game, advance: ms => { time += ms; } };
}
async function submission(game, player = uid, solution = words) {
  const session = await game.startSession(player, { puzzleId: day });
  return { puzzleId: day, sessionId: session.sessionId, dictionaryVersion: 'test-v1', words: solution };
}
test('public puzzle has no answer; UTC archive works and future/date abuse fails', () => {
  const { game } = fixture();
  assert.deepEqual(Object.keys(game.getPuzzle()), ['id', 'letters', 'dictionaryVersion']);
  assert.equal(game.getPuzzle('2026-09-18').id, '2026-09-18');
  for (const id of ['2026-09-20', '2026-02-30', '../../users', '2026-01-01']) assert.throws(() => game.getPuzzle(id));
});
test('session persists across refresh/reset; elapsed time and score are server owned', async () => {
  const { game, advance } = fixture();
  const input = await submission(game);
  advance(12345);
  assert.equal((await game.startSession(uid, { puzzleId: day })).sessionId, input.sessionId);
  const result = await game.submitResult(uid, { ...input, elapsedMs: 1, wordCount: 1 });
  assert.equal(result.elapsedMs, 12345);
  assert.equal(result.wordCount, 3);
  assert.equal(result.rank, 1);
  assert.equal(result.total, 1);
});
test('reject invalid words, incomplete/overused tiles, version and cross-user session', async () => {
  const { game } = fixture();
  const input = await submission(game);
  for (const update of [{ words: ['nonsense'] }, { words: ['apple'] }, { words: [...words, 'apple'] },
    { puzzleId: undefined },
    { dictionaryVersion: 'other' }, { sessionId: 'fake' }, { words: Array(16).fill('z') }]) {
    await assert.rejects(game.submitResult(uid, { ...input, ...update }));
  }
  await assert.rejects(game.submitResult('player-two-anonymous', input), { code: 'SESSION_NOT_FOUND' });
  assert.equal((await game.submitResult(uid, input)).total, 1);
});
test('concurrent retries produce one immutable result and honest tied count', async () => {
  const { game, advance } = fixture();
  const input = await submission(game);
  const [first, retry] = await Promise.all([game.submitResult(uid, input), game.submitResult(uid, input)]);
  assert.deepEqual(first, retry);
  advance(20000);
  const secondInput = await submission(game, 'player-two-anonymous');
  const second = await game.submitResult('player-two-anonymous', secondInput);
  assert.equal(second.total, 2);
  assert.equal(second.rank, 1);
  assert.equal(second.tied, 2);
  assert.deepEqual(await game.submitResult(uid, { ...input, words: ['appletable', 'chair'] }), first);
  const thirdInput = await submission(game, 'player-three-anonymous', ['appletable', 'chair']);
  const third = await game.submitResult('player-three-anonymous', thirdInput);
  assert.equal(third.rank, 1);
  assert.equal(third.total, 3);
  const fourthInput = await submission(game, 'player-four-anonymous');
  assert.equal((await game.submitResult('player-four-anonymous', fourthInput)).rank, 2);
});
test('historical completion remains bound to its puzzle after UTC rollover', async () => {
  const { game, advance } = fixture();
  const input = await submission(game);
  advance(24 * 60 * 60 * 1000);
  assert.equal(game.getPuzzle().id, '2026-09-20');
  const result = await game.submitResult(uid, input);
  assert.equal(result.puzzleId, day);
  assert.equal(result.total, 1);
});
