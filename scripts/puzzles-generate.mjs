import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES_VERSION, utcPuzzleId } from '../engine/index.mjs';
import { createPartitionIndex, certifyWitness, certifyDiversity, DIVERSITY_GATE } from './puzzles-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name), 'utf8');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const started = performance.now();
const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
const days = daysArg ? Number(daysArg.slice(7)) : 730;
if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('--days must be an integer from 1 to 3650.');
const manifest = JSON.parse(await read('data/dictionary/manifest.json'));
const wordsRaw = await read('data/dictionary/words.json');
if (sha256(wordsRaw) !== manifest.sha256) throw new Error('Dictionary hash mismatch.');
const generationRaw = await read('data/dictionary/generation.json');
if (sha256(generationRaw) !== manifest.generationSha256) throw new Error('Generation dictionary hash mismatch.');
const generation = new Set(JSON.parse(generationRaw));
const index = createPartitionIndex(JSON.parse(wordsRaw));
const shortWordsPath = 'data/dictionary/familiar-short-words-v1.json';
const shortWordsRaw = (await read(shortWordsPath)).replaceAll('\r\n', '\n');
const shortWords = JSON.parse(shortWordsRaw);
const shortWordsSha256 = sha256(shortWordsRaw);
if (shortWordsSha256 !== 'f7329ac8a7e9f985497725969f4b50b6720c6bd5f1d044fa870fe0d7bfd084d9'
    || shortWords.status !== 'APPROVED_FOR_FAMILIAR_GENERATION'
    || shortWords.dictionaryVersion !== manifest.version || shortWords.dictionarySha256 !== manifest.sha256
    || !Array.isArray(shortWords.words) || new Set(shortWords.words).size !== shortWords.words.length
    || shortWords.words.some((word) => !/^[a-z]{2,4}$/.test(word) || !index.dictionary.has(word))) {
  throw new Error('Familiar short-word approval or dictionary binding failed.');
}

// Editorial familiarity candidates are admitted only when present in the pinned
// size35 export. This list never adds a word to the accepted dictionary.
const candidates = `
apple beach bread brick brush chair chalk charm chest cloud coast coral cream crown
dance dream dress drink earth field flame floor flour flute frame fresh frost fruit
glass glove grape grass green group guest happy heart honey horse house icing image
juice knife laugh lemon light lunch magic maple medal melon metal money mouse music
night ocean olive onion paint paper peach pearl piano piece pilot pizza place plant
plate point puppy queen quiet radio rainy river roast robot round salad scale scarf
scene shape sheep shelf shell shirt shoes shore smile snail snake snowy space spoon
sport stack stage stamp stand steam steel stone store storm story sugar sunny sweet
table tiger toast tooth towel tower train treat truck tulip uncle video voice water
whale wheat wheel white whole windy wings woman world write zebra
blanket blossom brother cabinet captain carrots cartoon ceiling chicken chimney
clothes coconut country crystal cupcake dolphin drawing evening feather flowers
freedom friends gardens giraffe glasses grocery harvest holiday journey kitchen
lantern library machine morning musical mystery natural oranges outdoor pancake
picture pillows playing popcorn rainbow reading recipe ribbons sandals science
seaside seasons shelter singing sisters skating smiling sparkle spinach station
student sunrise teacher theatre thunder tonight traffic village waiting walking
weather welcome windows writing
backpack balloons birthday biscuits bookcase building butterfly calendar campsite
children climbing clothing cookies cupboard cushions daughter daylight dinosaur
doorbell earrings elephant exercise football forehead fountain friendly gardener
goldfish grateful handmade homework hospital indoors journey keyboard learning
lemonade lighthouse memories mountain mushroom necklace notebook outdoors painting
pancakes paradise peaceful playroom presents princess pumpkin question raincoat
rainfall sandwich scissors seashore shipping shopping shoulder sideways snowball
snowflake speaking squirrel starting sunshine surprise swimming teaching teamwork
teaspoon together tomorrow treasure triangle tropical trousers umbrella vacation
vegetable visitors watching weekend woodland workshop wrapping
`.trim().split(/\s+/);
const familiar = [...new Set([...candidates.filter((word) => generation.has(word)), ...shortWords.words])].sort();
const familiarIndex = createPartitionIndex(familiar);
const gateSha256 = sha256(JSON.stringify(DIVERSITY_GATE));
const familiarPoolSha256 = sha256(JSON.stringify(familiar));
const groups = new Map([5, 7, 8].map((length) => [length, familiar.filter((word) => word.length === length)]));
for (const [length, pool] of groups) if (pool.length < 20) throw new Error(`Insufficient familiar ${length}-letter words.`);
const seed = 0x4a554d42;
let state = seed;
const random = (n) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
const pick = (length) => { const pool = groups.get(length); return pool[random(pool.length)]; };
const shuffle = (letters) => {
  const result = [...letters];
  for (let i = result.length - 1; i > 0; i--) { const j = random(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result.join('').toUpperCase();
};
const start = Date.UTC(2026, 8, 19);
const puzzles = [];
const seen = new Set();
const lastUse = new Map();
let proposals = 0;
const diversityRejections = { INSUFFICIENT: 0, UNVERIFIED: 0 };
while (puzzles.length < days) {
  if (++proposals > days * 1000) throw new Error('Candidate pool exhausted; extend reviewed familiarity candidates.');
  const target = puzzles.length % 2 === 0 ? 2 : 3;
  const solution = target === 2 ? [pick(7), pick(8)] : [pick(5), pick(5), pick(5)];
  if (new Set(solution).size !== solution.length) continue;
  if (solution.some((word) => puzzles.length - (lastUse.get(word) ?? -1000) < 14)) continue;
  const letters = solution.join('');
  const key = [...letters].sort().join('');
  if (seen.has(key)) continue;
  const vowels = [...letters].filter((letter) => 'aeiou'.includes(letter)).length;
  const maxRepeat = Math.max(...[...new Set(letters)].map((letter) => [...letters].filter((item) => item === letter).length));
  if (vowels < 4 || vowels > 8 || maxRepeat > 4) continue;
  const certificate = certifyWitness(letters, solution, index);
  if (certificate.minimum !== target) continue;
  const diversity = certifyDiversity(letters, solution, target, index, familiarIndex);
  if (diversity.status !== 'PROVEN') { diversityRejections[diversity.status]++; continue; }
  const puzzle = {
    id: utcPuzzleId(start + puzzles.length * 86400000), letters: shuffle(letters),
    dictionaryVersion: manifest.version, minimum: certificate.minimum, solution: [...solution].sort(),
    diversity: { ...diversity, gateSha256, familiarPoolSha256 },
  };
  if (certificate.optimalSolutionCount !== undefined) puzzle.optimalSolutionCount = certificate.optimalSolutionCount;
  puzzles.push(puzzle);
  seen.add(key);
  for (const word of solution) lastUse.set(word, puzzles.length - 1);
  if (puzzles.length % 100 === 0) console.log(`Certified ${puzzles.length}/${days}`);
}
const puzzlesJson = `${JSON.stringify(puzzles, null, 2)}\n`;
try {
  const existing = JSON.parse(await read('data/puzzles.json'));
  if (!process.argv.includes('--replace-unreleased')) {
    if (existing.length > puzzles.length) throw new Error('Refusing to shorten the existing schedule.');
    for (let i = 0; i < existing.length; i++) {
      if (JSON.stringify(existing[i]) !== JSON.stringify(puzzles[i])) throw new Error(`Refusing to replace published/frozen puzzle ${existing[i].id}.`);
    }
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const receipt = {
  corpusVersion: 'j2-diversity-v1',
  dictionaryVersion: manifest.version, dictionarySha256: manifest.sha256, rulesVersion: RULES_VERSION,
  solver: 'exhaustive-short-partition-v1', solverSha256: sha256(await read('scripts/puzzles-lib.mjs')),
  generatorSha256: sha256(await read('scripts/puzzles-generate.mjs')), seed, start: puzzles[0].id,
  end: puzzles.at(-1).id, count: puzzles.length, distinctMultisets: seen.size, proposals,
  minimumCounts: { 2: puzzles.filter((p) => p.minimum === 2).length, 3: puzzles.filter((p) => p.minimum === 3).length },
  sha256: sha256(puzzlesJson), familiarPool: familiar, familiarPoolCount: familiar.length,
  omittedNonSize35Candidates: [...new Set(candidates)].filter((word) => !generation.has(word)).sort(),
  witnessVocabulary: [...new Set(puzzles.flatMap((puzzle) => puzzle.solution))].sort(),
  witnessReview: {
    source: 'Every witness word is in pinned ESDB size35, with tagged vulgar-1/2/3 and offensive-1/2/3 excluded.',
    editorial: 'Build Lab selected everyday objects, nature, activities, places, and ordinary descriptive words; complete used vocabulary is included for Product review.',
    independentHumanAcceptance: false,
  },
  diversityGate: DIVERSITY_GATE, gateSha256, familiarPoolSha256,
  familiarExpansion: { path: shortWordsPath, version: shortWords.version, sha256: shortWordsSha256,
    reviewedBy: shortWords.reviewedBy, wordCount: shortWords.words.length },
  diversitySummary: {
    provenBoards: puzzles.length, rejectedProposals: diversityRejections,
    minimumTotalPathsLowerBound: Math.min(...puzzles.map((puzzle) => puzzle.diversity.total.atLeast)),
    minimumFamiliarPathsLowerBound: Math.min(...puzzles.map((puzzle) => puzzle.diversity.familiar.atLeast)),
    minimumFamiliarLengthPatterns: Math.min(...puzzles.map((puzzle) => puzzle.diversity.familiar.wordLengthPatterns.length)),
    maximumSearchNodesVisited: Math.max(...puzzles.flatMap((puzzle) => [puzzle.diversity.total.visitedNodes, puzzle.diversity.familiar.visitedNodes])),
  },
  constraints: { minimumWordReuseGapDays: 14, vowelRange: [4, 8], maxRepeatedLetter: 4 },
  claimLimits: 'Exact minima against all accepted words. Diversity receipts prove capped lower bounds, not exact totals. Familiarity uses Product-inspected editorial candidates and the explicitly approved short-word expansion, not blanket size35 or human playtest acceptance.',
};
if (process.argv.includes('--check')) {
  if (await read('data/puzzles.json') !== puzzlesJson) throw new Error('Schedule reproducibility failed.');
} else {
  await writeFile(path.join(root, 'data/puzzles.json'), puzzlesJson);
  await writeFile(path.join(root, 'data/dictionary/puzzle-manifest.json'), `${JSON.stringify(receipt, null, 2)}\n`);
}
console.log(JSON.stringify({ count: receipt.count, start: receipt.start, end: receipt.end, minimumCounts: receipt.minimumCounts, sha256: receipt.sha256,
  diversity: receipt.diversitySummary, durationMs: Math.round(performance.now() - started) }));
