export const SWAP_RULES_VERSION = 'swap-adjacent-v3';

export function normalizeBoard(input) {
  const board = typeof input === 'string' ? [...input] : input;
  if (!Array.isArray(board) || board.length !== 15 || Array.from(board).some(letter => typeof letter !== 'string' || !/^[a-z]$/i.test(letter))) throw new TypeError('Board must contain exactly 15 ASCII letters.');
  return board.map(letter => letter.toUpperCase());
}

export function createSwapDictionary(words) {
  if (!Array.isArray(words) || Array.from(words).some(word => typeof word !== 'string' || !/^[a-z]{5}$/i.test(word))) throw new TypeError('Vocabulary must contain five-letter ASCII words.');
  const accepted = new Set(words.map(word => word.toLowerCase()));
  return Object.freeze({ words: Object.freeze([...accepted].sort()), has: word => typeof word === 'string' && accepted.has(word.toLowerCase()) });
}

/** Swap distinct orthogonally adjacent tiles, without wrapping. */
export function applySwap(input, action) {
  const board = normalizeBoard(input);
  if (!action || typeof action !== 'object' || Array.isArray(action)
    || !Number.isInteger(action.from) || !Number.isInteger(action.to)
    || action.from < 0 || action.from >= 15 || action.to < 0 || action.to >= 15
    || action.from === action.to || board[action.from] === board[action.to]
    || (Math.abs(Math.floor(action.from / 5) - Math.floor(action.to / 5)) + Math.abs(action.from % 5 - action.to % 5) !== 1)) throw new TypeError('Invalid swap action.');
  [board[action.from], board[action.to]] = [board[action.to], board[action.from]];
  return board;
}

export function evaluateBoard(input, dictionary) {
  const board = normalizeBoard(input);
  const rows = Array.from({ length: 3 }, (_, i) => board.slice(i * 5, i * 5 + 5).join('').toLowerCase());
  const validRows = rows.map(word => dictionary.has(word) && rows.indexOf(word) === rows.lastIndexOf(word));
  return { rows, validRows, won: validRows.every(Boolean) };
}

/** Geometry only; the host owns move limits and locking a finished game. */
export function replaySwaps(board, actions) {
  if (!Array.isArray(actions)) throw new TypeError('Actions must be an array.');
  return Array.from(actions).reduce((state, action) => applySwap(state, action), normalizeBoard(board));
}

/** Ordered player history. Undo/reset never refund accepted forward swaps. */
export function replaySwapSession(initial, actions, dictionary) {
  if (!Array.isArray(actions) || actions.length > 1000) throw new TypeError('At most 1000 actions allowed.');
  const start = normalizeBoard(initial);
  let board = [...start], moves = 0;
  const undo = [];
  for (const action of Array.from(actions)) {
    if (evaluateBoard(board, dictionary).won) throw new TypeError('Actions after a win are not allowed.');
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new TypeError('Invalid session action.');
    if (action.type === 'swap') {
      let next;
      try { next = applySwap(board, action); } catch (error) { if (error instanceof TypeError) continue; throw error; }
      undo.push(board); board = next; moves++;
    } else if (action.type === 'undo') {
      if (undo.length) board = undo.pop();
    } else if (action.type === 'reset') {
      board = [...start]; undo.length = 0;
    } else throw new TypeError('Invalid session action type.');
  }
  return { board, moves, undoDepth: undo.length, ...evaluateBoard(board, dictionary) };
}
