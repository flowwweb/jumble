// Pure candidate helper. Only generate-swap-adjacent-puzzles.mjs writes the active corpus.
import { SWAP_RULES_VERSION, normalizeBoard, createSwapDictionary, applySwap, evaluateBoard, replaySwapSession } from '../engine/swap.mjs';

export const SWAP_START = '2026-09-20';
const actions = Array.from({ length: 15 }, (_, from) => Array.from({ length: 15 }, (_, to) => ({ from, to }))).flat().filter(({from,to}) => from < to && (Math.abs(Math.floor(from / 5) - Math.floor(to / 5)) + Math.abs(from % 5 - to % 5) === 1));

export function generateSwapPuzzles(seedWords, admittedWords, dictionaryVersion, days = 730, seed = 20260920, scrambleLength = 12) {
  if (!Number.isInteger(days) || days < 1 || days > 3650 || !Number.isInteger(seed)) throw new TypeError('Invalid generation settings.');
  if (!Number.isInteger(scrambleLength) || scrambleLength < 2 || scrambleLength > 100) throw new TypeError('Invalid scramble length.');
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
    for (let i = 0; i < scrambleLength; i++) {
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
