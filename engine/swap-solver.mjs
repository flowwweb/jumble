// Offline exact search only. Never imported by the browser or production service.
import { createHash } from 'node:crypto';
import { SWAP_RULES_VERSION, normalizeBoard, createSwapDictionary } from './swap.mjs';
const signature = text => [...text].sort().join('');
const edges = Array.from({ length: 15 }, (_, from) => Array.from({ length: 15 }, (_, to) => ({ from, to }))).flat().filter(({ from, to }) => from < to && (Math.abs(Math.floor(from / 5) - Math.floor(to / 5)) + Math.abs(from % 5 - to % 5) === 1));
function subtract(letters, word) {
  const rest = [...letters];
  for (const letter of word) { const at = rest.indexOf(letter); if (at < 0) return null; rest.splice(at, 1); }
  return rest.join('');
}

/** Exhaustive goal set: every distinct-word triple and every row ordering. */
export function enumerateSwapGoals(input, words, checkBudget = () => {}) {
  const letters = normalizeBoard(input).join('').toLowerCase();
  const candidates = createSwapDictionary(words).words.filter(word => { checkBudget(0); return subtract(letters, word) !== null; });
  const bySignature = new Map();
  for (const word of candidates) { const key = signature(word); if (!bySignature.has(key)) bySignature.set(key, []); bySignature.get(key).push(word); }
  const goals = new Set();
  for (const first of candidates) {
    const remaining = subtract(letters, first);
    for (const second of candidates) {
      checkBudget(goals.size);
      if (first === second) continue;
      const rest = subtract(remaining, second);
      if (rest === null) continue;
      for (const third of bySignature.get(signature(rest)) || []) if (third !== first && third !== second) { goals.add((first + second + third).toUpperCase()); checkBudget(goals.size); }
    }
  }
  return [...goals].sort();
}

/** Multi-source bidirectional BFS. A budget exit never reports an optimum. */
export function solveSwapExact(input, words, { maxStates = 200000, maxMilliseconds = 10000 } = {}) {
  if (!Number.isInteger(maxStates) || maxStates < 1 || !Number.isFinite(maxMilliseconds) || maxMilliseconds <= 0) throw new TypeError('Invalid search budget.');
  const started = performance.now(), start = normalizeBoard(input).join('');
  const budgetExceeded = Symbol('budget exceeded');
  let goals;
  try {
    goals = enumerateSwapGoals(start, words, count => { if (count + 1 > maxStates || performance.now() - started >= maxMilliseconds) throw budgetExceeded; });
  } catch (error) {
    if (error !== budgetExceeded) throw error;
    return { status: 'UNVERIFIED', reason: 'SEARCH_BUDGET', certificate: { phase: 'goal-enumeration', elapsedMs: performance.now() - started } };
  }
  const maps = [new Map([[start, null]]), new Map(goals.map(goal => [goal, null]))];
  let frontiers = [[start], goals], depths = [0, 0], expanded = 0;
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  const binding = { rulesVersion: SWAP_RULES_VERSION, boardSha256: sha256(start), dictionaryWordsSha256: sha256(JSON.stringify(createSwapDictionary(words).words)) };
  const stats = () => ({ ...binding, algorithm: 'multi-source-bidirectional-bfs-v1', goalCount: goals.length, discoveredStates: maps[0].size + maps[1].size, expandedStates: expanded, completedRadii: [...depths], elapsedMs: performance.now() - started });
  const proven = meeting => {
    const halves = maps.map(map => { const path = []; let state = meeting; while (map.get(state)) { const link = map.get(state); path.push(link.action); state = link.parent; } return path; });
    const solution = [...halves[0].reverse(), ...halves[1]];
    return { status: 'PROVEN', minimum: solution.length, solution, certificate: { ...stats(), exhaustiveBelow: solution.length } };
  };
  if (maps[1].has(start)) return proven(start);
  if (!goals.length) return { status: 'UNSOLVABLE', certificate: stats() };
  while (frontiers[0].length && frontiers[1].length) {
    const side = frontiers[0].length <= frontiers[1].length ? 0 : 1;
    const next = [];
    for (const state of frontiers[side]) {
      if (maps[0].size + maps[1].size >= maxStates || performance.now() - started >= maxMilliseconds) return { status: 'UNVERIFIED', reason: 'SEARCH_BUDGET', certificate: stats() };
      expanded++;
      for (const action of edges) {
        if (state[action.from] === state[action.to]) continue;
        const letters = [...state]; [letters[action.from], letters[action.to]] = [letters[action.to], letters[action.from]];
        const child = letters.join('');
        if (maps[side].has(child)) continue;
        if (maps[0].size + maps[1].size >= maxStates) return { status: 'UNVERIFIED', reason: 'SEARCH_BUDGET', certificate: stats() };
        maps[side].set(child, { parent: state, action });
        if (maps[1 - side].has(child)) return proven(child);
        next.push(child);
      }
    }
    frontiers[side] = next; depths[side]++;
  }
  return { status: 'UNSOLVABLE', certificate: stats() };
}
