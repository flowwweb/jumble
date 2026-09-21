// Offline breadth-first proof visits every shallower board, regardless of blank placement or word count.
import { createHash } from 'node:crypto';
import { BLANK_RULES_VERSION, normalizeBlankBoard, createBlankDictionary, evaluateBlankBoard } from './swap-blank.mjs';
const edges = [];
for (let from = 0; from < 15; from++) for (const to of [from + 1, from + 5]) if (to < 15 && (to === from + 5 || Math.floor(from / 5) === Math.floor(to / 5))) edges.push({ from, to });
export function solveBlankExact(input, words, { maxStates = 200000, maxMilliseconds = 10000 } = {}) {
  if (!Number.isInteger(maxStates) || maxStates < 1 || !Number.isFinite(maxMilliseconds) || maxMilliseconds <= 0) throw new TypeError('Invalid budget.');
  const started = performance.now(), dictionary = createBlankDictionary(words), start = normalizeBlankBoard(input).join('');
  const seen = new Map([[start, null]]), queue = [{ board: start, depth: 0 }];
  const hash = value => createHash('sha256').update(value).digest('hex');
  const binding = { rulesVersion: BLANK_RULES_VERSION, boardSha256: hash(start), dictionaryWordsSha256: hash(JSON.stringify(dictionary.words)), method: 'forward-board-bfs-v1' };
  let head = 0;
  while (head < queue.length) {
    if (performance.now() - started >= maxMilliseconds) break;
    const { board, depth } = queue[head++];
    const evaluated = evaluateBlankBoard(board, dictionary);
    if (evaluated.won) {
      const solution = []; let cursor = board;
      while (seen.get(cursor)) { const link = seen.get(cursor); solution.push(link.action); cursor = link.parent; }
      solution.reverse();
      return { status: 'PROVEN', minimum: depth, solution, words: evaluated.words, certificate: { ...binding, exhaustiveBelow: depth, discoveredStates: seen.size, evaluatedStates: head, elapsedMs: performance.now() - started } };
    }
    for (const action of edges) {
      if (board[action.from] === board[action.to]) continue;
      const next = [...board]; [next[action.from], next[action.to]] = [next[action.to], next[action.from]];
      const child = next.join(''); if (seen.has(child)) continue;
      if (seen.size >= maxStates) return { status: 'UNVERIFIED', reason: 'STATE_BUDGET', discoveredStates: seen.size };
      seen.set(child, { parent: board, action }); queue.push({ board: child, depth: depth + 1 });
    }
  }
  return { status: 'UNVERIFIED', reason: 'TIME_BUDGET', discoveredStates: seen.size };
}
