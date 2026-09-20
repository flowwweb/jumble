import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { generateSwapPuzzles, SWAP_START } from './generate-swap-puzzles.mjs';
import { solveSwapExact } from '../engine/swap-solver.mjs';
import { SWAP_RULES_VERSION, createSwapDictionary, evaluateBoard, replaySwaps } from '../engine/swap.mjs';

const root = new URL('../', import.meta.url);
const requestedCount = 730;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const dictionary = JSON.parse(await readFile(new URL('data/swap/words.json', root), 'utf8'));
const seeds = JSON.parse(await readFile(new URL('data/swap/familiar-v1.json', root), 'utf8')).words;
const lexicon = createSwapDictionary(dictionary.words);
const started = performance.now(), puzzles = [], seen = new Set();
const rejections = { unverified: 0, tooEasy: 0, duplicate: 0 };
let proposals = 0;
while (puzzles.length < requestedCount && performance.now() - started < 90000) {
  const proposal = generateSwapPuzzles(seeds, dictionary.words, dictionary.version, 1, 20260920 + proposals++, 6)[0];
  const key = proposal.letters.join('');
  if (seen.has(key)) { rejections.duplicate++; continue; }
  seen.add(key);
  const remaining = 90000 - (performance.now() - started);
  if (remaining <= 0) break;
  const result = solveSwapExact(proposal.letters, dictionary.words, { maxStates: 200000, maxMilliseconds: Math.min(10000, remaining) });
  if (result.status !== 'PROVEN') { rejections.unverified++; continue; }
  if (result.minimum < 4) { rejections.tooEasy++; continue; }
  const { rulesVersion, boardSha256, dictionaryWordsSha256, algorithm, elapsedMs, ...proof } = result.certificate;
  const optimalWords = evaluateBoard(replaySwaps(proposal.letters, result.solution), lexicon).rows;
  const optimality = { status: 'PROVEN', rulesVersion, dictionaryVersion: dictionary.version, boardSha256, dictionaryWordsSha256, minimumMoves: result.minimum, optimalActions: result.solution.map(action => ({ type: 'swap', ...action })), optimalWords, proof: { method: algorithm, ...proof } };
  puzzles.push({ ...proposal, id: new Date(Date.parse(`${SWAP_START}T00:00:00Z`) + puzzles.length * 86400000).toISOString().slice(0, 10), optimality });
}
const corpus = JSON.stringify(puzzles) + '\n';
const distribution = {};
for (const puzzle of puzzles) distribution[puzzle.optimality.minimumMoves] = (distribution[puzzle.optimality.minimumMoves] || 0) + 1;
const manifest = { rulesVersion: SWAP_RULES_VERSION, dictionaryVersion: dictionary.version, dictionaryWordsSha256: hash(JSON.stringify(lexicon.words)), seed: 20260920, start: SWAP_START, count: puzzles.length, requestedCount, scrambleLength: 6, minimumAdmission: 4, maxStatesPerProposal: 200000, maxMillisecondsPerProposal: 10000, maxTotalMilliseconds: 90000, proposals, rejections, distribution, corpusSha256: hash(corpus), admission: 'Zero dictionary rows initially; no one-swap win; strict legal scramble witness; globally minimal solution proven across every admitted distinct-word triple and row order.' };
await mkdir(new URL('data/swap-adjacent/', root), { recursive: true });
await writeFile(new URL('data/swap-adjacent/puzzles.json', root), corpus);
await writeFile(new URL('data/swap-adjacent/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ ...manifest, elapsedMs: performance.now() - started }));
