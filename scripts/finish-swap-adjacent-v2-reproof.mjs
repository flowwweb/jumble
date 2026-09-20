// One authorized bounded retry of failed boards; reuse successful checkpoints.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { reproveSwapCorpus } from '../engine/swap-reproof.mjs';
import { SWAP_RULES_VERSION, normalizeBoard, createSwapDictionary, evaluateBoard, applySwap, replaySwapSession } from '../engine/swap.mjs';
const root = new URL('../', import.meta.url), read = path => readFile(new URL(path, root), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const vocabularyRaw = await read('data/swap/words.json');
if (hash(vocabularyRaw) !== 'e3707d9abcfe55278fc3067042a0ee66971970af20b564b2ebeb787c9da40f04') throw new Error('Frozen vocabulary changed.');
const vocabulary = JSON.parse(vocabularyRaw), oldRaw = await read('.cache/swap-adjacent-v1-0a68eba/puzzles.json'), old = JSON.parse(oldRaw);
if (hash(oldRaw) !== '9e2d86e6f9daf539cdb65d755eb4a29f34c024c5c9cb8c291e2dfd00107af0c2') throw new Error('Historical corpus changed.');
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
for (let offset = 0; offset < 730; offset += 100) for (const puzzle of JSON.parse(await read(`.cache/swap-adjacent-v2-reproof/batch-${offset}.json`)).puzzles) {
  if (!oldIds.has(puzzle.id) || proved.has(puzzle.id)) throw new Error('Unknown or duplicate checkpoint date.');
  validateCheckpoint(puzzle);
  proved.set(puzzle.id, puzzle);
}
const started = performance.now(), failures = [], retried = [];
for (const puzzle of old.filter(p => !proved.has(p.id))) {
  const remaining = 60000 - (performance.now() - started);
  if (remaining <= 0) { failures.push({ id: puzzle.id, reason: 'TOTAL_BUDGET' }); continue; }
  const result = reproveSwapCorpus([puzzle], vocabulary, { maxStates: 1000000, maxMillisecondsPerPuzzle: Math.min(10000, remaining), maxTotalMilliseconds: remaining });
  retried.push(puzzle.id);
  if (result.status === 'PROVEN') { validateCheckpoint(result.puzzles[0]); proved.set(puzzle.id, result.puzzles[0]); }
  else failures.push({ id: puzzle.id, reason: 'SEARCH_BUDGET' });
  console.log(JSON.stringify({ id: puzzle.id, status: result.status, elapsedMs: performance.now() - started }));
}
await writeFile(new URL('.cache/swap-adjacent-v2-reproof/retry.json', root), JSON.stringify({ puzzles: [...proved.values()], failures, retried, elapsedMs: performance.now() - started }) + '\n');
if (proved.size !== old.length || failures.length) { console.log(JSON.stringify({ status: 'UNVERIFIED', proved: proved.size, failures })); process.exitCode = 1; }
else {
  const puzzles = old.map(p => proved.get(p.id)), corpus = JSON.stringify(puzzles) + '\n';
  const replacements = old.flatMap((p, i) => p.letters.join('') === puzzles[i].letters.join('') ? [] : [{ id: p.id, oldBoard: p.letters.join(''), newBoard: puzzles[i].letters.join('') }]);
  const distribution = {};
  for (const p of puzzles) distribution[p.optimality.minimumMoves] = (distribution[p.optimality.minimumMoves] || 0) + 1;
  const manifest = { rulesVersion: SWAP_RULES_VERSION, dictionaryVersion: vocabulary.version, dictionaryWordsSha256: puzzles[0].optimality.dictionaryWordsSha256, count: puzzles.length, start: puzzles[0].id, end: puzzles.at(-1).id, corpusSha256: hash(corpus), previousCorpusSha256: hash(oldRaw), retainedBoards: puzzles.length - replacements.length, replacements, distribution, initialStateLimit: 200000, retryStateLimit: 1000000, retriedIds: retried, maxMillisecondsPerPuzzle: 10000, maxRetryMilliseconds: 60000 };
  const preview = await read('.cache/swap-adjacent-v2-reproof/preview.json');
  validateCheckpoint(JSON.parse(preview));
  if (puzzles.length !== 730 || new Set(puzzles.map(p => p.id)).size !== 730 || puzzles.some(p => !oldIds.has(p.id))) throw new Error('Incomplete canonical date set.');
  for (const puzzle of puzzles) validateCheckpoint(puzzle);
  await writeFile(new URL('data/swap-adjacent/puzzles.json', root), corpus);
  await writeFile(new URL('data/swap-adjacent/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(new URL('data/swap-adjacent/preview.json', root), preview);
  console.log(JSON.stringify({ status: 'PROVEN', count: puzzles.length, replaced: replacements.length, distribution, corpusSha256: manifest.corpusSha256, retryElapsedMs: performance.now() - started }));
}
