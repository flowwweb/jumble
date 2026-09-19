import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDictionary, validateSelection, validatePartition, solveOptimalPartition, utcPuzzleId,
} from '../engine/index.mjs';

const tiles = 'catdogbirdhorse';
const dictionary = createDictionary(['cat', 'dog', 'bird', 'horse', 'catdog', 'birdhorse']);

test('dictionary normalization is strict, deduplicated, and immutable', () => {
  const source = ['CAT', 'cat', 'dog'];
  const dict = createDictionary(source);
  source.push('bird');
  assert.deepEqual(dict.words, ['cat', 'dog']);
  assert.equal(dict.size, 2);
  assert.equal(dict.has('bird'), false);
  assert.throws(() => dict.words.push('bird'), TypeError);
  for (const bad of [null, {}, 'cat', [null], [''], [' cat'], ['café'], ['a'.repeat(16)], ['can\'t']]) {
    assert.throws(() => createDictionary(bad), TypeError);
  }
  assert.equal(createDictionary(new Set(['a'])).has('a'), true);
});

test('ordered indices select a dictionary word and do not mutate input', () => {
  const selectedIndices = Object.freeze([0, 1, 2]);
  const input = Object.freeze({ tiles: Object.freeze([...tiles.toUpperCase()]), selectedIndices, usedIndices: Object.freeze([]) });
  const result = validateSelection(input, dictionary);
  assert.deepEqual(result, { valid: true, word: 'cat', indices: [0, 1, 2] });
  assert.notEqual(result.indices, selectedIndices);
  assert.equal(validateSelection({ tiles, selectedIndices: [2, 1, 0] }, dictionary).code, 'UNKNOWN_WORD');
});

test('duplicate letters require distinct tile indices and confirmed tiles cannot be reused', () => {
  const board = 'aaaaabbbbbccccc';
  const dict = createDictionary(['aa']);
  assert.equal(validateSelection({ tiles: board, selectedIndices: [0, 1] }, dict).valid, true);
  assert.equal(validateSelection({ tiles: board, selectedIndices: [0, 0] }, dict).code, 'INVALID_SELECTION');
  assert.equal(validateSelection({ tiles: board, selectedIndices: [0, 1], usedIndices: [1] }, dict).code, 'TILE_ALREADY_USED');
});

test('malformed, sparse, out of range, and coerced selection payloads are rejected', () => {
  for (const input of [null, undefined, [], 4, 'cat']) assert.equal(validateSelection(input, dictionary).valid, false);
  for (const selectedIndices of [undefined, null, {}, [], [-1], [15], [NaN], [Infinity], [0.5], ['0'], [true], new Array(1), Array(16).fill(0)]) {
    assert.equal(validateSelection({ tiles, selectedIndices }, dictionary).code, 'INVALID_SELECTION');
  }
  for (const usedIndices of [null, {}, [1, 1], ['1'], new Array(1)]) {
    assert.equal(validateSelection({ tiles, selectedIndices: [0], usedIndices }, dictionary).code, 'INVALID_USED_INDICES');
  }
  for (const board of [null, undefined, {}, '', 'a'.repeat(14), 'a'.repeat(16), 'a'.repeat(14) + '1', new Array(15), Array(15).fill('ab')]) {
    assert.equal(validateSelection({ tiles: board, selectedIndices: [0] }, dictionary).code, 'INVALID_TILES');
    assert.equal(validatePartition(board, ['cat'], dictionary).code, 'INVALID_TILES');
    assert.throws(() => solveOptimalPartition(board, dictionary), TypeError);
  }
});

test('server partition validation derives score and enforces the full exact multiset', () => {
  assert.deepEqual(validatePartition(tiles, ['CAT', 'dog', 'bird', 'horse'], dictionary), {
    valid: true, words: ['cat', 'dog', 'bird', 'horse'], wordCount: 4, complete: true,
  });
  assert.equal(validatePartition(tiles, ['catdog', 'birdhorse'], dictionary).wordCount, 2);
  assert.equal(validatePartition(tiles, ['cat'], dictionary).code, 'UNUSED_TILES');
  assert.equal(validatePartition(tiles, ['cat', 'cat'], dictionary).code, 'LETTER_OVERUSED');
  assert.equal(validatePartition(tiles, ['nonsense'], dictionary).code, 'UNKNOWN_WORD');
  for (const words of [null, {}, 'cat', [], Array(16).fill('cat')]) {
    assert.equal(validatePartition(tiles, words, dictionary).code, 'INVALID_WORDS');
  }
  for (const word of [null, {}, 3, '', ' cat', 'cat ', 'cát', 'a'.repeat(16)]) {
    assert.deepEqual(validatePartition(tiles, [word], dictionary), { valid: false, code: 'INVALID_WORD', wordIndex: 0 });
  }
  assert.equal(validatePartition(tiles, new Array(1), dictionary).code, 'INVALID_WORD');
});

test('exact solver finds optimum, permits 15-letter words, and reports unsatisfiable puzzles', () => {
  assert.deepEqual(solveOptimalPartition(tiles, dictionary), { words: ['birdhorse', 'catdog'], wordCount: 2 });
  const full = createDictionary([...dictionary.words, tiles]);
  assert.deepEqual(solveOptimalPartition(tiles, full), { words: [tiles], wordCount: 1 });
  assert.equal(solveOptimalPartition(tiles, createDictionary(['cat', 'dog'])), null);
  assert.equal(solveOptimalPartition(tiles, createDictionary([])), null);
  assert.equal(solveOptimalPartition('aaaaabbbbbccccc', createDictionary(['aaaaa', 'bbbbb', 'ccccc', 'abc'])).wordCount, 3);
  assert.equal(solveOptimalPartition('a'.repeat(15), createDictionary(['a'])).wordCount, 15);
});

test('solver backtracks past a tempting longer word and handles repeated dictionary words', () => {
  const dict = createDictionary(['aaaaa', 'bbbbb', 'ccccc', 'aaaabbbb']);
  assert.equal(solveOptimalPartition('aaaaabbbbbccccc', dict).wordCount, 3);
  assert.deepEqual(solveOptimalPartition('a'.repeat(15), createDictionary(['aaa', 'aaaa'])), {
    words: ['aaa', 'aaaa', 'aaaa', 'aaaa'], wordCount: 4,
  });
});

test('dictionary order, tile order, and anagram alternatives cannot alter the representative result', () => {
  const words = ['abc', 'cba', 'aaaaa', 'bbbbb', 'ccccc', 'bca'];
  const first = solveOptimalPartition('aaaaabbbbbccccc', createDictionary(words));
  assert.deepEqual(solveOptimalPartition('cbacbacbacbacba', createDictionary(words.reverse())), first);
  const onlyAnagrams = createDictionary(['cba', 'abc']);
  assert.deepEqual(solveOptimalPartition('abcabcabcabcabc', onlyAnagrams).words, Array(5).fill('abc'));
});

// Independent forward count-grid DP, with neither recursive pivoting nor anagram dedup.
function referenceMinimum(board, words) {
  const cap = [...'abc'].map((letter) => [...board].filter((x) => x === letter).length);
  const counts = words.map((word) => [...'abc'].map((letter) => [...word].filter((x) => x === letter).length));
  const dp = new Map([['0,0,0', 0]]);
  for (let a = 0; a <= cap[0]; a++) for (let b = 0; b <= cap[1]; b++) for (let c = 0; c <= cap[2]; c++) {
    const score = dp.get(`${a},${b},${c}`);
    if (score === undefined) continue;
    for (const count of counts) {
      const next = [a + count[0], b + count[1], c + count[2]];
      if (next.some((n, i) => n > cap[i])) continue;
      const key = next.join(',');
      dp.set(key, Math.min(dp.get(key) ?? Infinity, score + 1));
    }
  }
  return dp.get(cap.join(',')) ?? null;
}

test('exact optimum agrees with independent forward DP on 64 reproducible dictionaries', () => {
  let seed = 123456789;
  const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let sample = 0; sample < 64; sample++) {
    const board = Array.from({ length: 15 }, () => 'abc'[random(3)]).join('');
    const words = sample % 2 === 0 ? ['a', 'b', 'c'] : [];
    for (let j = 0; j < 18; j++) words.push(Array.from({ length: 1 + random(8) }, () => 'abc'[random(3)]).join(''));
    const dict = createDictionary(words);
    const actual = solveOptimalPartition(board, dict);
    assert.equal(actual?.wordCount ?? null, referenceMinimum(board, dict.words), `sample ${sample}`);
    if (actual) assert.equal(validatePartition(board, actual.words, dict).valid, true);
  }
});

test('UTC day identity crosses midnight independently of local offset and rejects invalid instants', () => {
  assert.equal(utcPuzzleId(new Date('2026-09-19T06:59:59.999+07:00')), '2026-09-18');
  assert.equal(utcPuzzleId(Date.parse('2026-09-19T07:00:00+07:00')), '2026-09-19');
  for (const bad of [undefined, null, '2026-09-19', NaN, Infinity, new Date('bad')]) assert.throws(() => utcPuzzleId(bad), TypeError);
  assert.throws(() => utcPuzzleId(new Date('+010000-01-01T00:00:00.000Z')), RangeError);
});
