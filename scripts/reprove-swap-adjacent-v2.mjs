import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSwapDictionary, evaluateBoard, applySwap, SWAP_RULES_VERSION } from '../engine/swap.mjs';
import { reproveSwapCorpus } from '../engine/swap-reproof.mjs';
import { generateSwapPuzzles } from './generate-swap-puzzles.mjs';
const root = new URL('../', import.meta.url), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFile(new URL(path, root), 'utf8');
const vocabularyRaw = await read('data/swap/words.json');
if (hash(vocabularyRaw) !== 'e5408a5c4f5223ac04a706b0c9ae52e030f4a956ceef5f65d758913beb93e856') throw new Error('Frozen vocabulary changed.');
const vocabulary = JSON.parse(vocabularyRaw), dictionary = createSwapDictionary(vocabulary.words);
const oldRaw = await read('.cache/swap-adjacent-v2-687ba81/puzzles.json'), old = JSON.parse(oldRaw);
if (hash(oldRaw) !== 'd7f31fbe571fa5fb40d388a2f7ba2d43ba509995ddd08d66c5deec3cdb24e2e0') throw new Error('Historical corpus changed.');
const seeds = JSON.parse(await read('data/swap/familiar-v1.json')).words;
const edges = [];
for (let from = 0; from < 15; from++) for (let to = from + 1; to < 15; to++) if (Math.abs(Math.floor(from / 5) - Math.floor(to / 5)) + Math.abs(from % 5 - to % 5) === 1) edges.push({ from, to });
const conflict = board => evaluateBoard(board, dictionary).rows.some(word => dictionary.has(word)) || edges.some(action => board[action.from] !== board[action.to] && evaluateBoard(applySwap(board, action), dictionary).won);
const started = performance.now(), puzzles = [], replacements = [], failures = [], seen = new Set(old.filter(p => !conflict(p.letters)).map(p => p.letters.join('')));
await mkdir(new URL('.cache/swap-adjacent-v3-reproof/', root), { recursive: true });
for (let offset = 0; offset < old.length && performance.now() - started < 300000; offset += 100) {
  const batchStart = performance.now();
  for (let index = offset; index < Math.min(offset + 100, old.length); index++) {
    const remaining = Math.min(60000 - (performance.now() - batchStart), 300000 - (performance.now() - started));
    if (remaining <= 0) { failures.push({ id: old[index].id, reason: 'BATCH_BUDGET' }); break; }
    let candidate = old[index], replace = conflict(candidate.letters), proved;
    for (let attempt = 0; attempt < (replace ? 100 : 1); attempt++) {
      if (replace) {
        candidate = generateSwapPuzzles(seeds, vocabulary.words, vocabulary.version, 1, 20300000 + index * 100 + attempt, 6)[0];
        if (seen.has(candidate.letters.join(''))) continue;
      }
      const budget = Math.min(10000, 60000 - (performance.now() - batchStart), 300000 - (performance.now() - started));
      if (budget <= 0) break;
      const result = reproveSwapCorpus([{ ...candidate, id: old[index].id }], vocabulary, { maxStates: 200000, maxMillisecondsPerPuzzle: budget, maxTotalMilliseconds: budget });
      if (result.status !== 'PROVEN') { if (!replace) failures.push({ id: old[index].id, reason: 'SEARCH_BUDGET' }); continue; }
      if (replace && result.puzzles[0].optimality.minimumMoves < 4) continue;
      proved = result.puzzles[0]; break;
    }
    if (!proved) { if (!failures.some(x => x.id === old[index].id)) failures.push({ id: old[index].id, reason: 'UNVERIFIED' }); continue; }
    puzzles.push(proved); seen.add(proved.letters.join(''));
    if (replace) replacements.push({ id: proved.id, oldBoard: old[index].letters.join(''), newBoard: proved.letters.join('') });
  }
  await writeFile(new URL(`.cache/swap-adjacent-v3-reproof/batch-${offset}.json`, root), JSON.stringify({ puzzles: puzzles.filter(p => old.slice(offset, offset + 100).some(x => x.id === p.id)), failures, elapsedMs: performance.now() - started }) + '\n');
  console.log(JSON.stringify({ batch: offset, proved: puzzles.length, failures: failures.length, elapsedMs: performance.now() - started }));
}
if (puzzles.length !== old.length || failures.length) { console.log(JSON.stringify({ status: 'UNVERIFIED', proved: puzzles.length, failures })); process.exitCode = 1; }
else {
  let preview = JSON.parse(await read('.cache/swap-adjacent-v2-687ba81/preview.json'));
  if (conflict(preview.letters)) preview = { ...puzzles[0], id: '2099-01-01' };
  else { const proof = reproveSwapCorpus([preview], vocabulary); if (proof.status !== 'PROVEN') throw new Error('Preview unverified.'); preview = proof.puzzles[0]; }
  const corpus = JSON.stringify(puzzles) + '\n', distribution = {};
  for (const p of puzzles) distribution[p.optimality.minimumMoves] = (distribution[p.optimality.minimumMoves] || 0) + 1;
  const manifest = { rulesVersion: SWAP_RULES_VERSION, dictionaryVersion: vocabulary.version, dictionaryWordsSha256: puzzles[0].optimality.dictionaryWordsSha256, count: puzzles.length, start: puzzles[0].id, end: puzzles.at(-1).id, corpusSha256: hash(corpus), previousCorpusSha256: hash(oldRaw), retainedBoards: puzzles.length - replacements.length, replacements, distribution, maxStatesPerPuzzle: 200000, maxMillisecondsPerPuzzle: 10000, maxBatchMilliseconds: 60000, maxTotalMilliseconds: 300000 };
  await writeFile(new URL('data/swap-adjacent/puzzles.json', root), corpus);
  await writeFile(new URL('data/swap-adjacent/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(new URL('data/swap-adjacent/preview.json', root), JSON.stringify(preview, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PROVEN', count: puzzles.length, retained: manifest.retainedBoards, replaced: replacements.length, distribution, corpusSha256: manifest.corpusSha256, elapsedMs: performance.now() - started }));
}
