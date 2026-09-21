// Blank-day rules; ordinary-day rules and saves do not use this module.
export const BLANK_RULES_VERSION = 'swap-blank-v1';
export function normalizeBlankBoard(input) {
  const board = typeof input === 'string' ? [...input] : input;
  if (!Array.isArray(board) || board.length !== 15 || Array.from(board).some(tile => typeof tile !== 'string' || !/^[a-z ]$/i.test(tile))) throw new TypeError('Expected 15 ASCII letters or literal spaces.');
  const blanks = board.filter(tile => tile === ' ').length;
  if (blanks < 1 || blanks > 2) throw new TypeError('Expected one or two blanks.');
  return board.map(tile => tile.toUpperCase());
}
export function createBlankDictionary(words) {
  if (!Array.isArray(words) || Array.from(words).some(word => typeof word !== 'string' || !/^[a-z]{1,5}$/i.test(word) || (word.length === 1 && !/^[ai]$/i.test(word)))) throw new TypeError('Expected 1–5 letter words, only A/I singletons.');
  const accepted = new Set(words.map(word => word.toLowerCase()));
  return Object.freeze({ words: Object.freeze([...accepted].sort()), has: word => accepted.has(word.toLowerCase()) });
}
export function applyBlankSwap(input, action) {
  const board = normalizeBlankBoard(input);
  if (!action || typeof action !== 'object' || !Number.isInteger(action.from) || !Number.isInteger(action.to)
    || action.from < 0 || action.from >= 15 || action.to < 0 || action.to >= 15
    || Math.abs(Math.floor(action.from / 5) - Math.floor(action.to / 5)) + Math.abs(action.from % 5 - action.to % 5) !== 1) throw new TypeError('Expected adjacent tile indices.');
  [board[action.from], board[action.to]] = [board[action.to], board[action.from]];
  return board; // Equal letters or two blanks are unchanged; caller must not count them.
}
export function evaluateBlankBoard(input, dictionary) {
  const board = normalizeBlankBoard(input), runs = [];
  for (let row = 0; row < 3; row++) {
    let start = row * 5;
    for (let end = start; end <= row * 5 + 5; end++) {
      if (end === row * 5 + 5 || board[end] === ' ') {
        if (end > start) runs.push({ row, indices: Array.from({ length: end - start }, (_, i) => start + i), word: board.slice(start, end).join('').toLowerCase() });
        start = end + 1;
      }
    }
  }
  for (const run of runs) {
    run.admitted = (run.word.length > 1 || ['a', 'i'].includes(run.word)) && dictionary.has(run.word);
    run.valid = run.admitted && runs.filter(other => other.word === run.word).length === 1;
  }
  return { runs, words: runs.map(run => run.word), won: [0, 1, 2].every(row => runs.some(run => run.row === row)) && runs.every(run => run.valid) };
}
export function replayBlankSession(initial, actions, dictionary) {
  if (!Array.isArray(actions) || actions.length > 1000) throw new TypeError('At most 1000 actions allowed.');
  const start = normalizeBlankBoard(initial), undo = [];
  let board = [...start], moves = 0;
  for (const action of Array.from(actions)) {
    if (evaluateBlankBoard(board, dictionary).won) throw new TypeError('Actions after a win.');
    if (action?.type === 'swap') {
      const next = applyBlankSwap(board, action);
      if (next.join('') !== board.join('')) { undo.push(board); board = next; moves++; }
    } else if (action?.type === 'undo') { if (undo.length) board = undo.pop(); }
    else if (action?.type === 'reset') { board = [...start]; undo.length = 0; }
    else throw new TypeError('Invalid action.');
  }
  return { board, moves, undoDepth: undo.length, ...evaluateBlankBoard(board, dictionary) };
}
