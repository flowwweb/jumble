import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { solveSwapExact, enumerateSwapGoals } from '../engine/swap-solver.mjs';
import { applySwap, replaySwapSession, createSwapDictionary, evaluateBoard } from '../engine/swap.mjs';

test('exact adjacent proof covers every accepted goal, not only the scramble target', async () => {
  const words = JSON.parse(await readFile(new URL('../data/swap/words.json', import.meta.url))).words;
  const dictionary = createSwapDictionary(words), board = 'SRANEBLATECRICK';
  assert.ok(evaluateBoard(board, dictionary).rows.every(word => !dictionary.has(word)));
  const result = solveSwapExact(board, words, { maxStates: 10000, maxMilliseconds: 5000 });
  assert.equal(result.status, 'PROVEN'); assert.equal(result.minimum, 2);
  assert.equal(result.certificate.goalCount, 516);
  assert.equal(result.certificate.exhaustiveBelow, 2);
  assert.equal(replaySwapSession(board, result.solution.map(action => ({ type: 'swap', ...action })), dictionary).won, true);
  // Independent exhaustive depth-one lower bound.
  for (let from = 0; from < 15; from++) for (let to = from + 1; to < 15; to++) {
    if (Math.abs(Math.floor(from / 5) - Math.floor(to / 5)) + Math.abs(from % 5 - to % 5) !== 1 || board[from] === board[to]) continue;
    assert.equal(evaluateBoard(applySwap(board, { from, to }), dictionary).won, false);
  }
  const cutoff = solveSwapExact(board, words, { maxStates: 1 });
  assert.equal(cutoff.status, 'UNVERIFIED'); assert.equal('minimum' in cutoff, false);
  assert.equal(cutoff.certificate.phase, 'goal-enumeration');
  const timeout = solveSwapExact('CRANESLATEBRICK', words, { maxMilliseconds: Number.MIN_VALUE });
  assert.equal(timeout.status, 'UNVERIFIED'); assert.equal('minimum' in timeout, false);
});

test('bidirectional minima match independent forward BFS on small repeated-letter boards', () => {
  const words = ['aaaab', 'aaaba', 'aabaa'], dictionary = createSwapDictionary(words);
  const initial = 'AAAABAAABAAABAA';
  const pairs = [];
  for (let i = 0; i < 15; i++) for (let j = i + 1; j < 15; j++) if (Math.abs(Math.floor(i / 5) - Math.floor(j / 5)) + Math.abs(i % 5 - j % 5) === 1) pairs.push({ from: i, to: j });
  const boards = [initial, applySwap(initial, { from: 3, to: 4 }).join('')];
  boards.push(applySwap(boards[1], { from: 8, to: 13 }).join(''));
  for (const board of boards) {
    let frontier = [board], distance = 0; const seen = new Set(frontier);
    while (!frontier.some(state => evaluateBoard(state, dictionary).won)) {
      assert.ok(distance < 5); const next = [];
      for (const state of frontier) for (const action of pairs) {
        if (state[action.from] === state[action.to]) continue;
        const child = applySwap(state, action).join('');
        if (!seen.has(child)) { seen.add(child); next.push(child); }
      }
      frontier = next; distance++;
    }
    const result = solveSwapExact(board, words);
    assert.equal(result.status, 'PROVEN'); assert.equal(result.minimum, distance);
  }
});

test('goal enumeration includes alternate anagrams and row orders without repeated words', () => {
  const words = ['crane', 'slate', 'brick', 'trace', 'rates'];
  const goals = enumerateSwapGoals('CRANESLATEBRICK', words);
  assert.ok(goals.includes('BRICKSLATECRANE'));
  for (const goal of goals) assert.equal(new Set([goal.slice(0, 5), goal.slice(5, 10), goal.slice(10)]).size, 3);
  assert.equal(solveSwapExact('CRANESLATEBRICK', words).minimum, 0);
});
