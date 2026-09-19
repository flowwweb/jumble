export const TILE_COUNT = 15;
export const RULES_VERSION = 'partition-v1';

const normalizeWord = (word) => typeof word === 'string' && /^[a-z]{1,15}$/i.test(word)
  ? word.toLowerCase() : null;
const invalid = (code, details = {}) => ({ valid: false, code, ...details });

function normalizeTiles(tiles) {
  const letters = typeof tiles === 'string' ? [...tiles] : tiles;
  if (!Array.isArray(letters) || letters.length !== TILE_COUNT) return null;
  const normalized = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    if (typeof letters[i] !== 'string' || !/^[a-z]$/i.test(letters[i])) return null;
    normalized.push(letters[i].toLowerCase());
  }
  return normalized;
}

/** Caller supplies curated dictionary entries; there are no implicit additions. */
export function createDictionary(words) {
  if (!Array.isArray(words) && !(words instanceof Set)) throw new TypeError('Dictionary must be an array or Set.');
  const normalized = new Set();
  for (const word of words) {
    const value = normalizeWord(word);
    if (value === null) throw new TypeError('Dictionary entries must contain 1 to 15 ASCII letters.');
    normalized.add(value);
  }
  return Object.freeze({
    words: Object.freeze([...normalized].sort()),
    size: normalized.size,
    has: (word) => normalized.has(word),
  });
}

function indicesValid(indices) {
  return Array.isArray(indices) && indices.length <= TILE_COUNT
    && Array.from(indices).every((index) => Number.isInteger(index) && index >= 0 && index < TILE_COUNT)
    && new Set(indices).size === indices.length;
}

/** Ordered indices spell the word. Used indices are earlier, confirmed tiles. */
export function validateSelection(input, dictionary) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return invalid('INVALID_INPUT');
  const tiles = normalizeTiles(input.tiles);
  if (!tiles) return invalid('INVALID_TILES');
  const { selectedIndices, usedIndices = [] } = input;
  if (!indicesValid(selectedIndices) || selectedIndices.length === 0) return invalid('INVALID_SELECTION');
  if (!indicesValid(usedIndices)) return invalid('INVALID_USED_INDICES');
  const used = new Set(usedIndices);
  if (selectedIndices.some((index) => used.has(index))) return invalid('TILE_ALREADY_USED');
  const word = selectedIndices.map((index) => tiles[index]).join('');
  if (!dictionary.has(word)) return invalid('UNKNOWN_WORD');
  return { valid: true, word, indices: [...selectedIndices] };
}

/** Server-side final-result check; recomputes score from admitted words. */
export function validatePartition(tiles, words, dictionary) {
  const letters = normalizeTiles(tiles);
  if (!letters) return invalid('INVALID_TILES');
  if (!Array.isArray(words) || words.length === 0 || words.length > TILE_COUNT) return invalid('INVALID_WORDS');
  const remaining = countsOf(letters.join(''));
  const normalized = [];
  for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
    const word = normalizeWord(words[wordIndex]);
    if (word === null) return invalid('INVALID_WORD', { wordIndex });
    if (!dictionary.has(word)) return invalid('UNKNOWN_WORD', { wordIndex });
    for (const letter of word) {
      if (--remaining[letter.charCodeAt(0) - 97] < 0) return invalid('LETTER_OVERUSED', { wordIndex });
    }
    normalized.push(word);
  }
  if (remaining.some((count) => count !== 0)) return invalid('UNUSED_TILES');
  return { valid: true, words: normalized, wordCount: normalized.length, complete: true };
}

function countsOf(word) {
  const counts = Array(26).fill(0);
  for (const letter of word) counts[letter.charCodeAt(0) - 97]++;
  return counts;
}
const fits = (counts, remaining) => counts.every((count, index) => count <= remaining[index]);
const countKey = (counts) => counts.map((count) => count.toString(16)).join('');

/**
 * Exhaustive unordered partition DP. Every partition contains a word with the
 * chosen remaining letter; that restriction loses no solutions. Anagrams share
 * a count vector, represented by their alphabetically first dictionary word.
 * null means proven unsatisfiable for the supplied dictionary.
 */
export function solveOptimalPartition(tiles, dictionary) {
  const letters = normalizeTiles(tiles);
  if (!letters) throw new TypeError('Puzzle must contain exactly 15 ASCII letter tiles.');
  const initial = countsOf(letters.join(''));
  const signatures = new Map();
  for (const word of dictionary.words) {
    const counts = countsOf(word);
    if (!fits(counts, initial)) continue;
    const key = countKey(counts);
    const prior = signatures.get(key);
    if (!prior || word < prior.word) signatures.set(key, { word, counts });
  }
  const candidates = [...signatures.values()].sort((a, b) => b.word.length - a.word.length
    || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  const byLetter = Array.from({ length: 26 }, (_, index) => candidates.filter(({ counts }) => counts[index] > 0));
  const memo = new Map();
  function search(remaining, size) {
    if (size === 0) return [];
    const key = countKey(remaining);
    if (memo.has(key)) return memo.get(key);
    let pivot = -1;
    for (let i = 0; i < 26; i++) {
      if (remaining[i] > 0 && (pivot === -1 || byLetter[i].length < byLetter[pivot].length)) pivot = i;
    }
    let best = null;
    for (const candidate of byLetter[pivot]) {
      if (!fits(candidate.counts, remaining)) continue;
      const tail = search(remaining.map((count, index) => count - candidate.counts[index]), size - candidate.word.length);
      if (tail !== null && (best === null || tail.length + 1 < best.length)) {
        best = [candidate.word, ...tail];
        if (best.length === 1) break;
      }
    }
    memo.set(key, best);
    return best;
  }
  const words = search(initial, TILE_COUNT);
  return words === null ? null : { words: [...words].sort(), wordCount: words.length };
}

/** Inject an authoritative instant; this engine never reads an ambient clock. */
export function utcPuzzleId(instant) {
  if (typeof instant !== 'number' && !(instant instanceof Date)) throw new TypeError('Expected Date or epoch milliseconds.');
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid UTC instant.');
  const iso = date.toISOString();
  if (!/^\d{4}-/.test(iso)) throw new RangeError('Puzzle date must use a four-digit year.');
  return iso.slice(0, 10);
}
