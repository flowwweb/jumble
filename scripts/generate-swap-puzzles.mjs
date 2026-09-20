import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { SWAP_RULES_VERSION, normalizeBoard, createSwapDictionary, applySwap, evaluateBoard, replaySwapSession } from '../engine/swap.mjs';

export const SWAP_START = '2026-09-20';
const actions = Array.from({ length: 15 }, (_, from) => Array.from({ length: 15 }, (_, to) => ({ from, to }))).flat().filter(({from,to}) => from < to && (Math.floor(from / 5) === Math.floor(to / 5) || from % 5 === to % 5));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function generateSwapPuzzles(seedWords, admittedWords, dictionaryVersion, days = 730, seed = 20260920) {
  if (!Number.isInteger(days) || days < 1 || days > 3650 || !Number.isInteger(seed)) throw new TypeError('Invalid generation settings.');
  const dictionary = createSwapDictionary(admittedWords);
  const seeds = createSwapDictionary(seedWords).words;
  if (seeds.length < 3 || seeds.some(word => !dictionary.has(word))) throw new TypeError('At least three distinct admitted seed words required.');
  let state = seed >>> 0;
  const random = limit => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % limit; };
  const boards = new Set(), puzzles = [];
  for (let attempt = 0; puzzles.length < days && attempt < days * 1000; attempt++) {
    const chosen = new Set();
    while (chosen.size < 3) chosen.add(seeds[random(seeds.length)]);
    const solutionWords = [...chosen], scramble = [];
    let letters = normalizeBoard(solutionWords.join(''));
    for (let i = 0; i < 12; i++) {
      const action = actions[random(actions.length)];
      if (letters[action.from] === letters[action.to]) { i--; continue; }
      if (scramble.length && action.from === scramble.at(-1).from && action.to === scramble.at(-1).to) { i--; continue; }
      letters = applySwap(letters, action); scramble.push(action);
    }
    const key = letters.join('');
    if (boards.has(key) || evaluateBoard(letters, dictionary).rows.some(word => dictionary.has(word)) || actions.some(action => letters[action.from] !== letters[action.to] && evaluateBoard(applySwap(letters, action), dictionary).won)) continue;
    const solutionMoves = scramble.slice().reverse().map(action => ({ ...action }));
    // The same terminal lock as gameplay rejects witnesses that win before their last move.
    try {
      if (!replaySwapSession(letters, solutionMoves.map(action => ({ type: 'swap', ...action })), dictionary).won) continue;
    } catch (error) { if (error instanceof TypeError) continue; throw error; }
    const id = new Date(Date.parse(`${SWAP_START}T00:00:00Z`) + puzzles.length * 86400000).toISOString().slice(0, 10);
    puzzles.push({ id, letters, dictionaryVersion, rulesVersion: SWAP_RULES_VERSION, solutionWords, solutionMoves }); boards.add(key);
  }
  if (puzzles.length !== days) throw new Error('Generation budget exhausted.');
  return puzzles;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url);
  const familiarRaw = await readFile(new URL('data/swap/familiar-v1.json', root), 'utf8');
  const seedWords = createSwapDictionary(JSON.parse(familiarRaw).words).words;
  const reviewRaw = await readFile(new URL('data/swap/accepted-v2.json', root));
  if (hash(reviewRaw) !== 'b2ded12e871ee1cc9b51993e1db0df1b2638c2c715121ebb21592c3ef9491b17') throw new Error('Approved vocabulary hash mismatch.');
  const review = JSON.parse(reviewRaw);
  const words = createSwapDictionary(review.words).words;
  const source = JSON.parse(await readFile(new URL('data/dictionary/manifest.json', root), 'utf8'));
  const acceptedRaw = await readFile(new URL('data/dictionary/words.json', root), 'utf8');
  if (hash(acceptedRaw) !== source.sha256) throw new Error('Source dictionary hash mismatch.');
  const accepted = new Set(JSON.parse(acceptedRaw));
  if (review.status !== 'APPROVED_FOR_SWAP_ROW_VALIDATION_AND_GENERATION' || review.dictionaryVersion !== source.version || review.dictionarySha256 !== source.sha256) throw new Error('Approved vocabulary source mismatch.');
  if (words.some(word => !accepted.has(word))) throw new Error('Vocabulary is outside licensed source.');
  const version = `swap-common-v2-${hash(JSON.stringify(words)).slice(0, 12)}`;
  const copyright = await readFile(new URL('data/dictionary/Copyright', root), 'utf8');
  const vocabulary = JSON.stringify({ version, words, source: { version: source.version, commit: source.commit }, copyright }) + '\n';
  const puzzles = generateSwapPuzzles(seedWords, words, version);
  const corpus = JSON.stringify(puzzles) + '\n';
  await mkdir(new URL('data/swap/', root), { recursive: true });
  await writeFile(new URL(`public/data/swap-words-${version}.json`, root), vocabulary);
  await writeFile(new URL('data/swap/words.json', root), vocabulary);
  await writeFile(new URL('data/swap/puzzles.json', root), corpus);
  const manifest = { version, rulesVersion: SWAP_RULES_VERSION, seed: 20260920, start: SWAP_START, count: puzzles.length, wordCount: words.length, seedWordCount: seedWords.length, vocabularySha256: hash(vocabulary), corpusSha256: hash(corpus), familiarSha256: hash(familiarRaw), acceptedReviewSha256: hash(reviewRaw), sourceVersion: source.version, sourceCommit: source.commit, admission: 'Distinct familiar seed words, legal 12-move witness without early win, unique board with zero dictionary rows at start including duplicate words, no one-move solution against full admitted vocabulary. Witness length is not an optimum or par.' };
  await writeFile(new URL('data/swap/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest));
}
