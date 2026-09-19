import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDictionary, solveOptimalPartition, validatePartition, utcPuzzleId } from '../engine/index.mjs';
import { createPartitionIndex, certifyWitness, enumeratePartitions, certifyDiversity, DIVERSITY_GATE } from '../scripts/puzzles-lib.mjs';
import { applyDictionaryOverrides } from '../scripts/puzzles-dictionary-policy.mjs';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await read('data/dictionary/manifest.json'));
const wordsRaw = await read('data/dictionary/words.json');
const words = JSON.parse(wordsRaw);
const puzzlesRaw = await read('data/puzzles.json');
const puzzles = JSON.parse(puzzlesRaw);
const receipt = JSON.parse(await read('data/dictionary/puzzle-manifest.json'));
const index = createPartitionIndex(words);

test('dictionary provenance and distributed notice/hash match the private accepted words', async () => {
  assert.equal(manifest.commit, '1e5b7d3a72f47a71da5d28686c1dd4b397178485');
  assert.equal(sha256(wordsRaw), manifest.sha256);
  assert.equal(sha256(await read('data/dictionary/overrides.json')), manifest.overridesSha256);
  assert.equal(words.length, manifest.wordCount);
  assert.deepEqual(words, [...new Set(words)].sort());
  assert.ok(words.every((word) => /^[a-z]{1,15}$/.test(word)));
  for (const word of ['a', 'i', 'color', 'colour', 'center', 'centre', 'cat', 'dog']) assert.ok(index.dictionary.has(word), word);
  for (const word of ['london', 'monday', 'september', 'etc']) assert.equal(index.dictionary.has(word), false, word);
  // Pinned ESDB distinguishes excluded John <n/person> from size40 john <n>.
  assert.equal(index.dictionary.has('john'), true);
  const copyright = await read('data/dictionary/Copyright');
  assert.equal(sha256(copyright), manifest.copyrightSha256);
  const publicRaw = await read(`public${manifest.publicFile}`);
  const publicData = JSON.parse(publicRaw);
  assert.equal(sha256(publicRaw), manifest.publicSha256);
  assert.deepEqual(Object.keys(publicData).sort(), ['copyright', 'version', 'words']);
  assert.equal(publicData.copyright, copyright);
  assert.equal(publicData.version, manifest.version);
  assert.deepEqual(publicData.words, words);
});

test('only a and i are playable one-letter words; alphabet-symbol completion is rejected', () => {
  assert.deepEqual(words.filter((word) => word.length === 1), ['a', 'i']);
  const board = puzzles[0].letters;
  assert.equal(validatePartition(board, [...board.toLowerCase()], index.dictionary).code, 'UNKNOWN_WORD');
});

test('reviewed overrides normalize words, exclusions win, and unreviewed dubious additions fail', () => {
  const addition = {
    word: ' CAT ', source: 'https://github.com/en-wl/wordlist',
    reason: 'Fixture uses a known upstream word.', approvedBy: 'Test fixture reviewer',
  };
  const overrides = { revision: 'test-v1', additions: [addition], exclusions: [] };
  assert.deepEqual(applyDictionaryOverrides(['dog'], overrides), ['cat', 'dog']);
  assert.deepEqual(applyDictionaryOverrides(['dog'], {
    ...overrides, exclusions: [{ word: 'CAT', reason: 'Exclusion takes precedence.' }],
  }), ['dog']);
  assert.equal(applyDictionaryOverrides(['dog'], { ...overrides, additions: [] }).includes('qzxqzx'), false);
  for (const candidate of [
    { word: 'qzxqzx' }, { ...addition, source: '' }, { ...addition, approvedBy: '' },
    { ...addition, reason: '' }, { ...addition, word: 'not-a-word' },
    { ...addition, word: 'a'.repeat(16) }, { ...addition, word: 'café' },
  ]) assert.throws(() => applyDictionaryOverrides([], { ...overrides, additions: [candidate] }), TypeError);
  assert.throws(() => applyDictionaryOverrides([], { ...overrides, exclusions: [{ word: 'cat' }] }), TypeError);
});

test('short-partition proof finds improvements outside the generation vocabulary', () => {
  const board = 'aaaaabbbbbccccc';
  const familiar = ['aaaaa', 'bbbbb', 'ccccc'];
  assert.equal(certifyWitness(board, familiar, createPartitionIndex(familiar)).minimum, 3);
  assert.equal(certifyWitness(board, familiar, createPartitionIndex([...familiar, 'aaaaabbbbb'])).minimum, 2);
  assert.equal(certifyWitness(board, familiar, createPartitionIndex([...familiar, board])).minimum, 1);
  assert.throws(() => certifyWitness(board, ['missing'], index));
});

test('alternative count uses unordered word combinations, including distinct anagrams', () => {
  const board = 'aaaaabbbbbccccc';
  const dict = createPartitionIndex(['aaaaa', 'bbbbbccccc', 'ccccbbbbbc']);
  const first = certifyWitness(board, ['aaaaa', 'bbbbbccccc'], dict);
  assert.equal(first.minimum, 2);
  assert.equal(first.optimalSolutionCount, 2);
  assert.deepEqual(certifyWitness(board, ['bbbbbccccc', 'aaaaa'], dict), first);
});

test('partition enumeration agrees with independent integer partitions and preserves repeated multiplicity', () => {
  const vocabulary = Array.from({ length: 8 }, (_, i) => 'a'.repeat(i + 1));
  const found = enumeratePartitions('a'.repeat(15), createPartitionIndex(vocabulary), { maxWords: 5, limit: 1000 });
  const expected = [];
  function integerPartitions(remaining, least, parts) {
    if (remaining === 0) { expected.push(parts.map((length) => 'a'.repeat(length)).sort().join(',')); return; }
    if (parts.length === 5) return;
    for (let n = least; n <= Math.min(8, remaining); n++) integerPartitions(remaining - n, n, [...parts, n]);
  }
  integerPartitions(15, 1, []);
  assert.equal(found.status, 'INSUFFICIENT');
  assert.equal(found.exhaustive, true);
  assert.equal(found.exactCount, expected.length);
  assert.deepEqual(found.solutions.map((path) => path.join(',')).sort(), expected.sort());
  assert.ok(found.solutions.some((path) => path.join(',') === 'aaaaa,aaaaa,aaaaa'));
});

test('anagram spellings count distinctly but word permutations and tile assignments do not', () => {
  const dict = createPartitionIndex(['abc', 'cba']);
  const found = enumeratePartitions('abcabcabcabcabc', dict, { maxWords: 5, limit: 20 });
  assert.equal(found.exactCount, 6);
  assert.equal(found.wordLengthPatterns.length, 1);
  const samePattern = createPartitionIndex(['abcde', 'edcba']);
  const rejected = certifyDiversity('abcdeabcdeabcde', ['abcde', 'abcde', 'abcde'], 3, samePattern, samePattern);
  assert.equal(rejected.status, 'INSUFFICIENT');
  assert.ok(rejected.familiar.atLeast >= 2);
  assert.deepEqual(rejected.familiar.wordLengthPatterns, ['5+5+5']);
});

test('caps prove lower bounds; exhausted search budgets never admit a board', () => {
  const dict = createPartitionIndex(Array.from({ length: 5 }, (_, i) => ['a', 'b', 'c'].map((letter) => letter.repeat(i + 1))).flat());
  const proof = certifyDiversity('aaaaabbbbbccccc', ['aaaaa', 'bbbbb', 'ccccc'], 3, dict, dict);
  assert.equal(proof.status, 'PROVEN');
  assert.ok(proof.total.atLeast >= 10);
  assert.ok(proof.familiar.atLeast >= 2);
  assert.ok(proof.familiar.wordLengthPatterns.length >= 2);
  assert.equal(proof.total.capped, true);
  assert.equal(proof.total.exactCount, undefined);
  const cutoff = certifyDiversity('aaaaabbbbbccccc', ['aaaaa', 'bbbbb', 'ccccc'], 3, dict, dict, { ...DIVERSITY_GATE, maxSearchNodes: 1 });
  assert.equal(cutoff.status, 'UNVERIFIED');
  assert.equal(cutoff.familiar.exhaustive, false);
  assert.equal(cutoff.familiar.exactCount, undefined);
  assert.ok(cutoff.familiar.visitedNodes <= 1);
});

test('every board meets the exact versioned diversity gate with directly validated witness evidence', async () => {
  assert.deepEqual(receipt.diversityGate, {
    version: 'diversity-v1', minimumCompletePaths: 10, minimumFamiliarPaths: 2,
    maximumExtraWords: 2, minimumFamiliarLengthPatterns: 2, maxSearchNodes: 200_000,
  });
  assert.deepEqual(receipt.diversityGate, DIVERSITY_GATE);
  assert.equal(receipt.gateSha256, sha256(JSON.stringify(DIVERSITY_GATE)));
  assert.equal(receipt.familiarPoolSha256, sha256(JSON.stringify(receipt.familiarPool)));
  assert.equal(receipt.solverSha256, sha256(await read('scripts/puzzles-lib.mjs')));
  assert.equal(receipt.generatorSha256, sha256(await read('scripts/puzzles-generate.mjs')));
  const shortRaw = (await read('data/dictionary/familiar-short-words-v1.json')).replaceAll('\r\n', '\n');
  const short = JSON.parse(shortRaw);
  assert.equal(sha256(shortRaw), 'f7329ac8a7e9f985497725969f4b50b6720c6bd5f1d044fa870fe0d7bfd084d9');
  assert.equal(receipt.familiarExpansion.sha256, sha256(shortRaw));
  assert.equal(short.status, 'APPROVED_FOR_FAMILIAR_GENERATION');
  assert.equal(short.dictionaryVersion, manifest.version);
  assert.equal(short.dictionarySha256, manifest.sha256);
  assert.equal(short.words.length, 528);
  assert.ok(short.words.every((word) => index.dictionary.has(word)));
  assert.deepEqual(receipt.familiarPool.filter((word) => word.length <= 4), short.words);
  const familiar = new Set(receipt.familiarPool);
  for (const puzzle of puzzles) {
    const proof = puzzle.diversity;
    assert.equal(proof.status, 'PROVEN', puzzle.id);
    assert.equal(proof.gateVersion, DIVERSITY_GATE.version);
    assert.equal(proof.gateSha256, receipt.gateSha256);
    assert.equal(proof.familiarPoolSha256, receipt.familiarPoolSha256);
    for (const [kind, threshold] of [['total', 10], ['familiar', 2]]) {
      const evidence = proof[kind];
      assert.equal(evidence.status, 'PROVEN');
      assert.ok(evidence.atLeast >= threshold);
      assert.equal(evidence.atLeast, evidence.solutions.length);
      assert.equal(evidence.capped, true);
      assert.equal(evidence.exhaustive, false);
      assert.equal(evidence.exactCount, undefined);
      assert.equal(evidence.maxWords, puzzle.minimum + 2);
      assert.equal(evidence.maxSearchNodes, DIVERSITY_GATE.maxSearchNodes);
      assert.ok(evidence.visitedNodes <= evidence.maxSearchNodes);
      const keys = new Set(), patterns = new Set();
      for (const path of evidence.solutions) {
        assert.deepEqual(path, [...path].sort());
        assert.ok(path.length <= puzzle.minimum + 2);
        assert.equal(validatePartition(puzzle.letters, path, index.dictionary).valid, true, `${puzzle.id}: ${path}`);
        const key = path.join(',');
        assert.equal(keys.has(key), false);
        keys.add(key);
        patterns.add(path.map((word) => word.length).sort((a, b) => a - b).join('+'));
        if (kind === 'familiar') assert.ok(path.every((word) => familiar.has(word)));
      }
      assert.deepEqual([...patterns].sort(), evidence.wordLengthPatterns);
      if (kind === 'familiar') {
        assert.ok(patterns.size >= 2);
        assert.ok(keys.has([...puzzle.solution].sort().join(',')));
      }
    }
  }
  assert.equal(receipt.diversitySummary.provenBoards, puzzles.length);
  assert.equal(receipt.diversitySummary.minimumTotalPathsLowerBound, 10);
  assert.ok(receipt.diversitySummary.minimumFamiliarPathsLowerBound >= 2);
  assert.ok(receipt.diversitySummary.minimumFamiliarLengthPatterns >= 2);
});

test('every frozen puzzle has an exact complete witness and minimum against the entire accepted dictionary', async () => {
  assert.ok(puzzles.length >= 365);
  assert.equal(puzzles.length, receipt.count);
  assert.equal(sha256(puzzlesRaw), receipt.sha256);
  assert.equal(manifest.version, receipt.dictionaryVersion);
  const multisets = new Set();
  const lastUse = new Map();
  const familiar = new Set(receipt.familiarPool);
  const sourceGeneration = new Set(JSON.parse(await read('data/dictionary/generation.json')));
  assert.ok(manifest.generationExport.includes('--wo-usage-notes=vulgar-1,vulgar-2,vulgar-3,offensive-1,offensive-2,offensive-3'));
  assert.deepEqual(receipt.witnessVocabulary, [...new Set(puzzles.flatMap((puzzle) => puzzle.solution))].sort());
  for (let day = 0; day < puzzles.length; day++) {
    const puzzle = puzzles[day];
    assert.equal(puzzle.id, utcPuzzleId(Date.UTC(2026, 8, 19) + day * 86400000));
    assert.match(puzzle.letters, /^[A-Z]{15}$/);
    const letters = [...puzzle.letters.toLowerCase()];
    const vowels = letters.filter((letter) => 'aeiou'.includes(letter)).length;
    assert.ok(vowels >= 4 && vowels <= 8);
    assert.ok([...new Set(letters)].every((letter) => letters.filter((item) => item === letter).length <= 4));
    assert.equal(puzzle.dictionaryVersion, manifest.version);
    assert.ok(puzzle.minimum === 2 || puzzle.minimum === 3);
    assert.equal(validatePartition(puzzle.letters, puzzle.solution, index.dictionary).valid, true);
    assert.equal(puzzle.solution.length, puzzle.minimum);
    const certificate = certifyWitness(puzzle.letters, puzzle.solution, index);
    assert.equal(certificate.minimum, puzzle.minimum, puzzle.id);
    assert.equal(certificate.optimalSolutionCount, puzzle.optimalSolutionCount, puzzle.id);
    const signature = [...puzzle.letters].sort().join('');
    assert.equal(multisets.has(signature), false, puzzle.id);
    multisets.add(signature);
    for (const word of puzzle.solution) {
      assert.ok(familiar.has(word), word);
      assert.ok(sourceGeneration.has(word), `${word}: outside filtered size35 vocabulary`);
      assert.ok(day - (lastUse.get(word) ?? -1000) >= 14, `${puzzle.id}: ${word}`);
      lastUse.set(word, day);
    }
  }
  assert.equal(multisets.size, receipt.distinctMultisets);
});

test('general exhaustive solver independently agrees across the frozen schedule', () => {
  const dictionary = createDictionary(words);
  for (const day of [0, 1, 60, 61, 120, 121, 240, 241, 364, 365, puzzles.length - 2, puzzles.length - 1]) {
    if (day >= puzzles.length) continue;
    const puzzle = puzzles[day];
    const result = solveOptimalPartition(puzzle.letters, dictionary);
    assert.equal(result?.wordCount, puzzle.minimum, puzzle.id);
    assert.equal(validatePartition(puzzle.letters, result.words, dictionary).valid, true);
  }
});
