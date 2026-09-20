// One authorized bounded retry of failed boards; reuse successful checkpoints.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { reproveSwapCorpus } from '../engine/swap-reproof.mjs';
import { generateSwapPuzzles } from './generate-swap-puzzles.mjs';
import { SWAP_RULES_VERSION, normalizeBoard, createSwapDictionary, evaluateBoard, applySwap, replaySwapSession } from '../engine/swap.mjs';
const root = new URL('../', import.meta.url), read = path => readFile(new URL(path, root), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const vocabularyRaw = await read('data/swap/words.json');
if (hash(vocabularyRaw) !== 'e5408a5c4f5223ac04a706b0c9ae52e030f4a956ceef5f65d758913beb93e856') throw new Error('Frozen vocabulary changed.');
const vocabulary = JSON.parse(vocabularyRaw), oldRaw = await read('.cache/swap-adjacent-v2-687ba81/puzzles.json'), old = JSON.parse(oldRaw);
if (hash(oldRaw) !== 'd7f31fbe571fa5fb40d388a2f7ba2d43ba509995ddd08d66c5deec3cdb24e2e0') throw new Error('Historical corpus changed.');
const dictionary = createSwapDictionary(vocabulary.words), dictionaryHash = hash(JSON.stringify(dictionary.words));
const oldIds = new Set(old.map(p => p.id));
if (old.length !== 730 || oldIds.size !== 730) throw new Error('Expected 730 unique historical dates.');
function validateCheckpoint(puzzle) {
  const board = normalizeBoard(puzzle.letters), receipt = puzzle.optimality;
  if (puzzle.rulesVersion !== SWAP_RULES_VERSION || puzzle.dictionaryVersion !== vocabulary.version
    || receipt?.status !== 'PROVEN' || receipt.rulesVersion !== SWAP_RULES_VERSION || receipt.dictionaryVersion !== vocabulary.version
    || receipt.boardSha256 !== hash(board.join('')) || receipt.dictionaryWordsSha256 !== dictionaryHash
    || !Number.isInteger(receipt.minimumMoves) || receipt.minimumMoves < 2
    || receipt.proof?.method !== 'multi-source-bidirectional-bfs-v1' || receipt.proof.exhaustiveBelow !== receipt.minimumMoves
    || !Array.isArray(receipt.optimalActions) || receipt.optimalActions.length !== receipt.minimumMoves
    || receipt.optimalActions.some(action => action?.type !== 'swap')) throw new Error(`Invalid checkpoint binding: ${puzzle.id}`);
  const optimal = replaySwapSession(board, receipt.optimalActions, dictionary);
  const witness = replaySwapSession(board, puzzle.solutionMoves.map(action => ({ ...action, type: 'swap' })), dictionary);
  if (!optimal.won || optimal.moves !== receipt.minimumMoves || JSON.stringify(optimal.rows) !== JSON.stringify(receipt.optimalWords)
    || !witness.won || JSON.stringify(witness.rows) !== JSON.stringify(puzzle.solutionWords)
    || evaluateBoard(board, dictionary).rows.some(word => dictionary.has(word))) throw new Error(`Invalid checkpoint witness: ${puzzle.id}`);
  for (let from = 0; from < 15; from++) for (let to = from + 1; to < 15; to++) {
    if (board[from] === board[to] || Math.abs(Math.floor(from / 5) - Math.floor(to / 5)) + Math.abs(from % 5 - to % 5) !== 1) continue;
    if (evaluateBoard(applySwap(board, { from, to }), dictionary).won) throw new Error(`One-swap checkpoint: ${puzzle.id}`);
  }
}
const proved = new Map();
for (let offset = 0; offset < 730; offset += 100) {
  let batch;
  try { batch = JSON.parse(await read(`.cache/swap-adjacent-v3-reproof/batch-${offset}.json`)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  for (const puzzle of batch.puzzles) {
    if (!oldIds.has(puzzle.id) || proved.has(puzzle.id)) throw new Error('Unknown or duplicate checkpoint date.');
    validateCheckpoint(puzzle);
    proved.set(puzzle.id, puzzle);
  }
}
let previousRetry;
try { previousRetry = JSON.parse(await read('.cache/swap-adjacent-v3-reproof/retry.json')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previousRetry) for (const puzzle of previousRetry.puzzles) {
  if (!oldIds.has(puzzle.id)) throw new Error('Unknown retry date.');
  validateCheckpoint(puzzle); proved.set(puzzle.id, puzzle);
}
const started = performance.now(), failures = [], retried = previousRetry?.retried || [];
const seeds = JSON.parse(await read('data/swap/familiar-v1.json')).words;
const seenBoards = new Set([...proved.values()].map(p => p.letters.join('')));
for (const puzzle of old.filter(p => !proved.has(p.id))) {
  const remaining = 60000 - (performance.now() - started);
  if (remaining <= 0) { failures.push({ id: puzzle.id, reason: 'TOTAL_BUDGET' }); continue; }
  let result = retried.includes(puzzle.id) || process.argv.includes('--replace-only')
    ? { status: 'UNVERIFIED' }
    : reproveSwapCorpus([puzzle], vocabulary, { maxStates: 1000000, maxMillisecondsPerPuzzle: Math.min(10000, remaining), maxTotalMilliseconds: remaining });
  if (!retried.includes(puzzle.id)) retried.push(puzzle.id);
  if (result.admissionConflicts?.some(conflict => conflict.code === 'VALID_START_ROWS' || conflict.minimum < 2)) result = { status: 'UNVERIFIED' };
  for (let attempt = 0; result.status !== 'PROVEN' && attempt < 100; attempt++) {
    const budget = Math.min(10000, 60000 - (performance.now() - started));
    if (budget <= 0) break;
    const candidate = generateSwapPuzzles(seeds, vocabulary.words, vocabulary.version, 1, 20400000 + old.findIndex(p => p.id === puzzle.id) * 100 + attempt, 6)[0];
    if (seenBoards.has(candidate.letters.join(''))) continue;
    const replacement = reproveSwapCorpus([{ ...candidate, id: puzzle.id }], vocabulary, { maxStates: 200000, maxMillisecondsPerPuzzle: budget, maxTotalMilliseconds: budget });
    if (replacement.status === 'PROVEN' && replacement.puzzles[0].optimality.minimumMoves >= 4) result = replacement;
  }
  if (result.status === 'PROVEN') { validateCheckpoint(result.puzzles[0]); proved.set(puzzle.id, result.puzzles[0]); seenBoards.add(result.puzzles[0].letters.join('')); }
  else failures.push({ id: puzzle.id, reason: 'SEARCH_BUDGET' });
  console.log(JSON.stringify({ id: puzzle.id, status: result.status, elapsedMs: performance.now() - started }));
}
await writeFile(new URL('.cache/swap-adjacent-v3-reproof/retry.json', root), JSON.stringify({ puzzles: [...proved.values()], failures, retried, elapsedMs: performance.now() - started }) + '\n');
if (proved.size !== old.length || failures.length) { console.log(JSON.stringify({ status: 'UNVERIFIED', proved: proved.size, failures })); process.exitCode = 1; }
else {
  const puzzles = old.map(p => proved.get(p.id)), corpus = JSON.stringify(puzzles) + '\n';
  const replacements = old.flatMap((p, i) => p.letters.join('') === puzzles[i].letters.join('') ? [] : [{ id: p.id, oldBoard: p.letters.join(''), newBoard: puzzles[i].letters.join('') }]);
  const distribution = {};
  for (const p of puzzles) distribution[p.optimality.minimumMoves] = (distribution[p.optimality.minimumMoves] || 0) + 1;
  const manifest = { rulesVersion: SWAP_RULES_VERSION, dictionaryVersion: vocabulary.version, dictionaryWordsSha256: puzzles[0].optimality.dictionaryWordsSha256, count: puzzles.length, start: puzzles[0].id, end: puzzles.at(-1).id, corpusSha256: hash(corpus), previousCorpusSha256: hash(oldRaw), retainedBoards: puzzles.length - replacements.length, replacements, distribution, initialStateLimit: 200000, retryStateLimit: 1000000, retriedIds: retried, maxMillisecondsPerPuzzle: 10000, maxRetryMilliseconds: 60000 };
  const preview = await read('.cache/swap-adjacent-v3-reproof/preview.json');
  validateCheckpoint(JSON.parse(preview));
  if (puzzles.length !== 730 || new Set(puzzles.map(p => p.id)).size !== 730 || puzzles.some(p => !oldIds.has(p.id))) throw new Error('Incomplete canonical date set.');
  for (const puzzle of puzzles) validateCheckpoint(puzzle);
  await writeFile(new URL('data/swap-adjacent/puzzles.json', root), corpus);
  await writeFile(new URL('data/swap-adjacent/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(new URL('data/swap-adjacent/preview.json', root), preview);
  console.log(JSON.stringify({ status: 'PROVEN', count: puzzles.length, replaced: replacements.length, distribution, corpusSha256: manifest.corpusSha256, retryElapsedMs: performance.now() - started }));
}
