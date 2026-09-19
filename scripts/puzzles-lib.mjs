import { createDictionary, validatePartition } from '../engine/index.mjs';

const signature = (word) => [...word.toLowerCase()].sort().join('');
const countsOf = (word) => {
  const result = new Uint8Array(26);
  for (const letter of word) result[letter.charCodeAt(0) - 97]++;
  return result;
};

export function createPartitionIndex(words) {
  const dictionary = createDictionary(words);
  const signatures = new Map();
  for (const word of dictionary.words) {
    const key = signature(word);
    if (!signatures.has(key)) signatures.set(key, { key, counts: countsOf(word), words: [] });
    signatures.get(key).words.push(word);
  }
  return { dictionary, signatures };
}

/**
 * A valid <=3-word witness is an upper bound. Exhaustively checking every
 * dictionary signature for a one-word and two-word partition proves its minimum.
 * This certifier is deliberately restricted to <=3-word witnesses, not heuristic.
 */
export function certifyWitness(letters, witness, index) {
  const validation = validatePartition(letters, witness, index.dictionary);
  if (!validation.valid || witness.length > 3) throw new Error('Certification requires a valid witness of at most three words.');
  const key = signature(letters);
  const one = index.signatures.get(key);
  if (one) return { minimum: 1, solution: [one.words[0]], optimalSolutionCount: one.words.length };
  const remaining = countsOf(letters.toLowerCase());
  let solution = null;
  let optimalSolutionCount = 0;
  for (const entry of index.signatures.values()) {
    if (entry.key.length >= letters.length) continue;
    let complement = '';
    let compatible = true;
    for (let i = 0; i < 26; i++) {
      const count = remaining[i] - entry.counts[i];
      if (count < 0) { compatible = false; break; }
      complement += String.fromCharCode(97 + i).repeat(count);
    }
    if (!compatible || entry.key > complement) continue;
    const other = index.signatures.get(complement);
    if (!other) continue;
    solution ??= [entry.words[0], other.words[0]].sort();
    optimalSolutionCount += entry.key === complement
      ? entry.words.length * (entry.words.length + 1) / 2
      : entry.words.length * other.words.length;
  }
  return solution
    ? { minimum: 2, solution, optimalSolutionCount }
    : { minimum: 3, solution: validation.words };
}
