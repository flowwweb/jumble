import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reproveSwapCorpus } from '../engine/swap-reproof.mjs';
import { createSwapDictionary, replaySwapSession } from '../engine/swap.mjs';

test('dictionary reproof preserves identity, replaces proof binding, and reports new valid starting rows', async () => {
  const source = [{ id: '2026-09-20', letters: [...'OVICELOUSSMAGES'], rulesVersion: 'swap-adjacent-v1', dictionaryVersion: 'previous-vocabulary', optimality: { dictionaryWordsSha256: 'previous-proof' } }];
  const old = JSON.stringify(source);
  const vocabulary = JSON.parse(await readFile(new URL('../data/swap/words.json', import.meta.url)));
  vocabulary.words = [...new Set([...vocabulary.words, 'souls', 'mages'])]; vocabulary.version = 'test-expanded';
  const result = reproveSwapCorpus(source, vocabulary);
  assert.equal(result.status, 'PROVEN'); assert.equal(JSON.stringify(source), old);
  assert.deepEqual(result.puzzles[0].letters, source[0].letters); assert.equal(result.puzzles[0].id, source[0].id);
  assert.equal(result.puzzles[0].optimality.minimumMoves, 3);
  assert.notEqual(result.puzzles[0].optimality.dictionaryWordsSha256, source[0].optimality.dictionaryWordsSha256);
  assert.ok(result.admissionConflicts.some(conflict => conflict.words?.includes('mages')));
  assert.equal(replaySwapSession(source[0].letters, result.puzzles[0].optimality.optimalActions, createSwapDictionary(vocabulary.words)).won, true);
  const cutoff = reproveSwapCorpus(source, vocabulary, { maxStates: 1 });
  assert.equal(cutoff.status, 'UNVERIFIED'); assert.equal(cutoff.puzzles.length, 0);
  assert.equal('minimum' in cutoff.failures[0], false);
});
