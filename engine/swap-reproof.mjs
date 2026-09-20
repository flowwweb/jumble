// Offline only: preserve published boards/dates and report conflicts with newer admission rules.
import { createSwapDictionary, evaluateBoard, replaySwaps } from './swap.mjs';
import { solveSwapExact } from './swap-solver.mjs';

export function reproveSwapCorpus(puzzles, vocabulary, { maxStates = 200000, maxMillisecondsPerPuzzle = 10000, maxTotalMilliseconds = 90000 } = {}) {
  if (!Array.isArray(puzzles) || typeof vocabulary?.version !== 'string' || !Number.isFinite(maxTotalMilliseconds) || maxTotalMilliseconds <= 0) throw new TypeError('Invalid reproof input.');
  const dictionary = createSwapDictionary(vocabulary.words);
  const started = performance.now(), proved = [], failures = [], admissionConflicts = [];
  for (const puzzle of puzzles) {
    const remaining = maxTotalMilliseconds - (performance.now() - started);
    if (remaining <= 0) break;
    const validStartWords = evaluateBoard(puzzle.letters, dictionary).rows.filter(word => dictionary.has(word));
    if (validStartWords.length) admissionConflicts.push({ id: puzzle.id, code: 'VALID_START_ROWS', words: validStartWords });
    const result = solveSwapExact(puzzle.letters, vocabulary.words, { maxStates, maxMilliseconds: Math.min(maxMillisecondsPerPuzzle, remaining) });
    if (result.status !== 'PROVEN') { failures.push({ id: puzzle.id, ...result }); continue; }
    const { rulesVersion, boardSha256, dictionaryWordsSha256, algorithm, elapsedMs, ...proof } = result.certificate;
    const optimalWords = evaluateBoard(replaySwaps(puzzle.letters, result.solution), dictionary).rows;
    if (result.minimum < 4) admissionConflicts.push({ id: puzzle.id, code: 'MINIMUM_BELOW_FOUR', minimum: result.minimum });
    proved.push({ ...puzzle, rulesVersion, dictionaryVersion: vocabulary.version, solutionMoves: result.solution, solutionWords: optimalWords, optimality: {
      status: 'PROVEN', rulesVersion, dictionaryVersion: vocabulary.version, boardSha256, dictionaryWordsSha256,
      minimumMoves: result.minimum, optimalActions: result.solution.map(action => ({ type: 'swap', ...action })), optimalWords,
      proof: { method: algorithm, ...proof },
    } });
  }
  return { status: proved.length === puzzles.length ? 'PROVEN' : 'UNVERIFIED', puzzles: proved, failures, admissionConflicts,
    unprocessedIds: puzzles.slice(proved.length + failures.length).map(puzzle => puzzle.id), elapsedMs: performance.now() - started };
}
