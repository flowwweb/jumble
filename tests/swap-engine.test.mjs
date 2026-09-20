import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBoard, applySwap, replaySwaps, replaySwapSession, evaluateBoard, createSwapDictionary } from '../engine/swap.mjs';
import { generateSwapPuzzles } from '../scripts/generate-swap-puzzles.mjs';
import { readFile } from 'node:fs/promises';
const dictionary = createSwapDictionary(['apple', 'beach', 'bread', 'chair']);
const solved = 'APPLEBEACHBREAD';

test('all legal swaps preserve tiles, reverse themselves, and never mutate input', () => {
  const board = normalizeBoard(solved);
  for (let from = 0; from < 15; from++) for (let to = 0; to < 15; to++) {
    const action = { from, to };
    if (from !== to && board[from] !== board[to] && (Math.floor(from / 5) === Math.floor(to / 5) || from % 5 === to % 5)) {
      const next = applySwap(board, action);
      assert.deepEqual([...next].sort(), [...board].sort());
      assert.deepEqual(applySwap(next, action), board);
      assert.deepEqual(replaySwaps(board, [action, action]), board);
    } else assert.throws(() => applySwap(board, action), TypeError);
  }
  assert.equal(board.join(''), solved);
});
test('any three distinct vocabulary rows win; valid rows remain movable', () => {
  assert.equal(evaluateBoard(solved, dictionary).won, true);
  assert.equal(evaluateBoard('BREADAPPLEBEACH', dictionary).won, true);
  assert.equal(evaluateBoard('APPLEAPPLEBREAD', dictionary).won, false);
  assert.deepEqual(evaluateBoard('APPLEAPPLEBREAD', dictionary).validRows, [false, false, true]);
  assert.deepEqual(evaluateBoard('APPLEBREADAPPLE', dictionary).validRows, [false, true, false]);
  assert.deepEqual(evaluateBoard('APPLEAPPLEAPPLE', dictionary).validRows, [false, false, false]);
  assert.equal(evaluateBoard('APPLEBEACHZZZZZ', dictionary).won, false);
  assert.notDeepEqual(applySwap(solved, { from: 0, to: 4 }), normalizeBoard(solved));
});
test('malformed boards, actions and vocabulary are rejected', () => {
  for (const board of [null, [], new Array(15), 'TOOSHORT', 'APPLEBEACHBREA1']) assert.throws(() => normalizeBoard(board), TypeError);
  for (const action of [null, [], {}, { from: 0, to: 15 }, { from: '0', to: 1 }, { from: 0.5, to: 1 }, { from: 0, to: 6 }]) assert.throws(() => applySwap(solved, action), TypeError);
  assert.throws(() => replaySwaps(solved, new Array(1)), TypeError);
  assert.throws(() => createSwapDictionary(['four']), TypeError);
});
test('daily generation is deterministic, solvable, unique and never solved or one swap away', async () => {
  const words = JSON.parse(await readFile(new URL('../data/swap/familiar-v1.json', import.meta.url))).words;
  const admitted = JSON.parse(await readFile(new URL('../data/swap/accepted-v2.json', import.meta.url))).words;
  const lexicon = createSwapDictionary(admitted);
  assert.equal(lexicon.words.length, 1478);
  assert.equal(evaluateBoard('CHEAPPETALGATES', lexicon).won, true);
  assert.equal(lexicon.has('slick'), true);
  assert.equal(evaluateBoard('SLICKPETALGATES', lexicon).won, true);
  assert.equal(words.includes('cheap'), false);
  const alternate = applySwap('CHEAPPETALGATES', { from: 0, to: 4 });
  assert.equal(replaySwapSession(alternate, [{ type: 'swap', from: 0, to: 4 }], lexicon).won, true);
  const puzzles = generateSwapPuzzles(words, admitted, 'test', 730);
  assert.deepEqual(generateSwapPuzzles(words, admitted, 'test', 730), puzzles);
  assert.equal(new Set(puzzles.map(p => p.letters.join(''))).size, 730);
  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    assert.ok(p.solutionWords.every(word => words.includes(word)));
    assert.equal(p.id, new Date(Date.UTC(2026,8,20+i)).toISOString().slice(0,10));
    assert.equal(evaluateBoard(p.letters, lexicon).won, false);
    assert.ok(evaluateBoard(p.letters, lexicon).rows.every(word => !lexicon.has(word)));
    assert.equal(evaluateBoard(replaySwaps(p.letters, p.solutionMoves), lexicon).won, true);
    assert.equal(replaySwapSession(p.letters, p.solutionMoves.map(action => ({ type: 'swap', ...action })), lexicon).won, true);
    for (let from = 0; from < 15; from++) for (let to = from + 1; to < 15; to++) if (p.letters[from] !== p.letters[to] && (Math.floor(from / 5) === Math.floor(to / 5) || from % 5 === to % 5)) assert.equal(evaluateBoard(applySwap(p.letters, { from, to }), lexicon).won, false);
  }
});

test('session undo/reset preserve forward score; invalid swaps are no-ops; terminal locks', () => {
  const initial = applySwap(solved, { from: 0, to: 4 });
  const forward = { type: 'swap', from: 5, to: 9 };
  const result = replaySwapSession(initial, [forward, { type: 'undo' }, forward, { type: 'reset' }, { type: 'swap', from: 0, to: 6 }, { type: 'swap', from: 1, to: 2 }], dictionary);
  assert.deepEqual(result.board, initial); assert.equal(result.moves, 2); assert.equal(result.undoDepth, 0);
  const win = { type: 'swap', from: 0, to: 4 };
  assert.equal(replaySwapSession(initial, [win], dictionary).won, true);
  assert.throws(() => replaySwapSession(initial, [win, { type: 'undo' }], dictionary), TypeError);
  assert.throws(() => replaySwapSession(initial, new Array(1001), dictionary), TypeError);
  assert.throws(() => replaySwapSession(initial, [{ type: 'unknown' }], dictionary), TypeError);
});
