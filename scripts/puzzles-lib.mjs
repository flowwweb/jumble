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
    optimalSolutionCount += entry.words.length * other.words.length;
  }
  return solution
    ? { minimum: 2, solution, optimalSolutionCount }
    : { minimum: 3, solution: validation.words };
}

export const DIVERSITY_GATE = Object.freeze({
  version: 'diversity-v1', minimumCompletePaths: 10, minimumFamiliarPaths: 2,
  maximumExtraWords: 2, minimumFamiliarLengthPatterns: 2, maxSearchNodes: 200_000,
});

/** Enumerates unordered word multisets; repeated words remain distinct multiplicities. */
export function enumeratePartitions(letters, index, {
  maxWords, limit, minimumLengthPatterns = 1, maxSearchNodes = DIVERSITY_GATE.maxSearchNodes, witnesses = [],
}) {
  if (typeof letters !== 'string' || !/^[a-z]{15}$/i.test(letters)) throw new TypeError('Expected 15 ASCII letter tiles.');
  if (!Number.isInteger(maxWords) || maxWords < 1 || maxWords > 15
      || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(minimumLengthPatterns) || minimumLengthPatterns < 1
      || !Number.isInteger(maxSearchNodes) || maxSearchNodes < 1) throw new TypeError('Invalid enumeration bounds.');
  const remaining = countsOf(letters.toLowerCase());
  const solutions = [], keys = new Set(), patterns = new Set();
  const add = (words) => {
    const normalized = [...words].sort();
    if (normalized.length > maxWords || !validatePartition(letters, normalized, index.dictionary).valid) {
      throw new Error('Invalid partition evidence.');
    }
    const key = normalized.join(',');
    if (!keys.has(key)) {
      keys.add(key); solutions.push(normalized);
      patterns.add(normalized.map((word) => word.length).sort((a, b) => a - b).join('+'));
    }
  };
  for (const witness of witnesses) add(witness);
  const enough = () => solutions.length >= limit && patterns.size >= minimumLengthPatterns;
  const candidates = [...index.signatures.values()]
    .filter(({ counts }) => counts.every((count, i) => count <= remaining[i]))
    .flatMap(({ counts, words }) => words.map((word) => ({ word, counts })))
    .sort((a, b) => b.word.length - a.word.length || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  let visitedNodes = 0, budgetExhausted = false;
  function search(start, size, path) {
    if (enough() || budgetExhausted) return;
    if (size === 0) { add(path); return; }
    const slots = maxWords - path.length;
    if (slots === 0 || start === candidates.length || candidates[start].word.length * slots < size) return;
    for (let i = start; i < candidates.length; i++) {
      if (visitedNodes >= maxSearchNodes) { budgetExhausted = true; return; }
      visitedNodes++;
      const { word, counts } = candidates[i];
      if (word.length * slots < size) break;
      if (word.length > size || !counts.every((count, j) => count <= remaining[j])) continue;
      for (let j = 0; j < 26; j++) remaining[j] -= counts[j];
      search(i, size - word.length, [...path, word]);
      for (let j = 0; j < 26; j++) remaining[j] += counts[j];
      if (enough() || budgetExhausted) return;
    }
  }
  search(0, letters.length, []);
  const proven = enough();
  return {
    status: proven ? 'PROVEN' : budgetExhausted ? 'UNVERIFIED' : 'INSUFFICIENT',
    atLeast: solutions.length, ...(proven || budgetExhausted ? {} : { exactCount: solutions.length }),
    capped: proven, exhaustive: !proven && !budgetExhausted, maxWords, visitedNodes, maxSearchNodes,
    wordLengthPatterns: [...patterns].sort(), solutions,
  };
}

export function certifyDiversity(letters, witness, minimum, index, familiarIndex, gate = DIVERSITY_GATE) {
  if (![2, 3].includes(minimum) || witness.length !== minimum) throw new TypeError('Expected a familiar two/three-word optimum.');
  const maxWords = minimum + gate.maximumExtraWords;
  const familiar = enumeratePartitions(letters, familiarIndex, {
    maxWords, limit: gate.minimumFamiliarPaths, minimumLengthPatterns: gate.minimumFamiliarLengthPatterns,
    maxSearchNodes: gate.maxSearchNodes, witnesses: [witness],
  });
  if (familiar.status !== 'PROVEN') return { status: familiar.status, gateVersion: gate.version, familiar };
  const total = enumeratePartitions(letters, index, {
    maxWords, limit: gate.minimumCompletePaths, maxSearchNodes: gate.maxSearchNodes, witnesses: familiar.solutions,
  });
  return { status: total.status, gateVersion: gate.version, total, familiar };
}
