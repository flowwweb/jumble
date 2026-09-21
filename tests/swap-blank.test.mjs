import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeBlankBoard, createBlankDictionary, evaluateBlankBoard, applyBlankSwap, replayBlankSession } from '../engine/swap-blank.mjs';
import { solveBlankExact } from '../engine/swap-blank-solver.mjs';
const dictionary = createBlankDictionary(['a', 'i', 'at', 'on', 'cat', 'cats', 'crane', 'slate', 'brick']);
test('blank runs support edges, splits, consecutive blanks, and globally unique words', () => {
  assert.equal(evaluateBlankBoard(' CATSCRANEBRICK', dictionary).won, true);
  assert.deepEqual(evaluateBlankBoard('AT ONCRANEBRICK', dictionary).words, ['at', 'on', 'crane', 'brick']);
  assert.equal(evaluateBlankBoard('AT ONCRANEBRICK', dictionary).won, true);
  assert.equal(evaluateBlankBoard('A CATCRANEBRICK', dictionary).won, true);
  assert.equal(evaluateBlankBoard('C ATSCRANEBRICK', dictionary).won, false);
  assert.equal(evaluateBlankBoard('  CATCRANEBRICK', dictionary).won, true);
  assert.deepEqual(evaluateBlankBoard('AT ATCRANEBRICK', dictionary).runs.slice(0, 2).map(run => run.valid), [false, false]);
  assert.throws(() => normalizeBlankBoard('     CRANEBRICK'), TypeError);
  assert.throws(() => createBlankDictionary(['c']), TypeError);
});

test('pinned full dictionary proves edge and split fixtures against every shallower endpoint', async () => {
  const raw = await readFile(new URL('../docs/research/blank-prototype-words-v1.json', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), '427a77f8ce57ed174cec1c0af5fc51613565d35322717934682b1d91c73c6abb');
  const vocabulary = JSON.parse(raw), lexicon = createBlankDictionary(vocabulary.words);
  assert.equal(lexicon.words.length, 11395);
  const fixtureSet = JSON.parse(await readFile(new URL('../docs/research/blank-prototype-fixtures.json', import.meta.url)));
  assert.equal(fixtureSet.dictionaryVersion, vocabulary.version);
  assert.deepEqual(fixtureSet.fixtures.map(f => f.id), ['edge', 'split', 'moving-blank']);
  for (const fixture of fixtureSet.fixtures) {
    assert.equal(fixture.board.filter(tile => tile === ' ').length, 1);
    assert.ok(evaluateBlankBoard(fixture.board, lexicon).runs.every(run => !run.admitted));
    const proof = solveBlankExact(fixture.board, vocabulary.words);
    assert.equal(proof.status, 'PROVEN'); assert.equal(proof.minimum, 3);
    assert.equal(proof.certificate.boardSha256, fixture.proof.certificate.boardSha256);
    assert.equal(proof.certificate.dictionaryWordsSha256, fixture.proof.certificate.dictionaryWordsSha256);
    assert.deepEqual(proof.solution, fixture.proof.solution);
    if (fixture.id === 'moving-blank') {
      let board = fixture.board, movedBlank = false;
      for (const action of proof.solution) { movedBlank ||= board[action.from] === ' ' || board[action.to] === ' '; board = applyBlankSwap(board, action); }
      assert.equal(movedBlank, true);
    }
    const result = replayBlankSession(fixture.board, proof.solution.map(action => ({ type: 'swap', ...action })), lexicon);
    assert.equal(result.won, true); assert.deepEqual(result.words, fixture.proof.words);
    for (let from = 0; from < 15; from++) for (let to = from + 1; to < 15; to++) {
      if (Math.abs(Math.floor(from / 5) - Math.floor(to / 5)) + Math.abs(from % 5 - to % 5) !== 1) continue;
      assert.equal(evaluateBlankBoard(applyBlankSwap(fixture.board, { from, to }), lexicon).won, false);
    }
  }
});
test('adjacent swaps preserve blank multiset, equal tiles are no-ops, effort survives undo/reset', () => {
  const board = '  CATCRANEBRICK';
  assert.deepEqual(applyBlankSwap(board, { from: 0, to: 1 }), [...board]);
  assert.throws(() => applyBlankSwap(board, { from: 4, to: 5 }), TypeError);
  const start = applyBlankSwap(' CATSCRANEBRICK', { from: 0, to: 5 });
  const moved = applyBlankSwap(start, { from: 5, to: 10 });
  assert.deepEqual([...moved].sort(), [...start].sort());
  const replay = replayBlankSession(start, [{ type: 'swap', from: 5, to: 10 }, { type: 'undo' }, { type: 'swap', from: 5, to: 10 }, { type: 'reset' }], dictionary);
  assert.equal(replay.moves, 2); assert.deepEqual(replay.board, start); assert.equal(replay.undoDepth, 0);
});
test('forward BFS proves shortest any-endpoint path and withholds minimum on cutoff', () => {
  const start = applyBlankSwap(applyBlankSwap(' CATSCRANEBRICK', { from: 1, to: 6 }), { from: 6, to: 11 });
  const result = solveBlankExact(start, dictionary.words);
  assert.equal(result.status, 'PROVEN'); assert.equal(result.minimum, 2);
  assert.equal(replayBlankSession(start, result.solution.map(action => ({ type: 'swap', ...action })), dictionary).won, true);
  const cutoff = solveBlankExact(start, dictionary.words, { maxStates: 1 });
  assert.equal(cutoff.status, 'UNVERIFIED'); assert.equal('minimum' in cutoff, false);
});
