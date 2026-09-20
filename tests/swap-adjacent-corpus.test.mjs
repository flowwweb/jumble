import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSwapDictionary, evaluateBoard, replaySwapSession } from '../engine/swap.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
test('adjacent corpus binds each private certificate and legal optimum to the full vocabulary', async () => {
  const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
  const raw = await read('data/swap-adjacent/puzzles.json'), puzzles = JSON.parse(raw);
  const manifest = JSON.parse(await read('data/swap-adjacent/manifest.json'));
  const vocabulary = JSON.parse(await read('data/swap/words.json')), dictionary = createSwapDictionary(vocabulary.words);
  assert.equal(puzzles.length, 730); assert.equal(hash(raw), manifest.corpusSha256);
  assert.equal(new Set(puzzles.map(puzzle => puzzle.letters.join(''))).size, 730);
  for (const [index, puzzle] of puzzles.entries()) {
    const receipt = puzzle.optimality;
    assert.equal(puzzle.id, new Date(Date.UTC(2026, 8, 20 + index)).toISOString().slice(0, 10));
    assert.equal(receipt.status, 'PROVEN'); assert.equal(receipt.rulesVersion, 'swap-adjacent-v1');
    assert.equal(receipt.dictionaryVersion, vocabulary.version);
    assert.equal(receipt.boardSha256, hash(puzzle.letters.join('')));
    assert.equal(receipt.dictionaryWordsSha256, hash(JSON.stringify(dictionary.words)));
    assert.ok(evaluateBoard(puzzle.letters, dictionary).rows.every(word => !dictionary.has(word)));
    assert.ok(receipt.minimumMoves >= 4); assert.equal(receipt.minimumMoves, receipt.optimalActions.length);
    assert.equal(receipt.proof.method, 'multi-source-bidirectional-bfs-v1');
    assert.equal(receipt.proof.exhaustiveBelow, receipt.minimumMoves);
    assert.ok(receipt.optimalActions.every(action => action.type === 'swap'));
    const result = replaySwapSession(puzzle.letters, receipt.optimalActions, dictionary);
    assert.equal(result.won, true); assert.deepEqual(result.rows, receipt.optimalWords);
    assert.equal(replaySwapSession(puzzle.letters, puzzle.solutionMoves.map(action => ({ type: 'swap', ...action })), dictionary).won, true);
  }
});
