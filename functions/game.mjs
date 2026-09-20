import { createHash, randomUUID } from 'node:crypto';
import { validatePartition, utcPuzzleId } from '../engine/index.mjs';
import { replaySwapSession } from '../engine/swap.mjs';

export function validateSwapReplay(board, actions, dictionary) {
  try {
    for (const action of actions) {
      if (!action || typeof action !== 'object' || Array.isArray(action)) throw new TypeError();
      const keys = action.type === 'swap' ? ['type','from','to'] : ['type'];
      if (Object.keys(action).some(key => !keys.includes(key))) throw new TypeError();
      if (action.type === 'swap' && (!Number.isInteger(action.from) || !Number.isInteger(action.to))) throw new TypeError();
    }
    const result = replaySwapSession(board, actions, dictionary);
    return { valid: result.won, code: 'BOARD_NOT_SOLVED', words: result.rows, board: result.board, moves: result.moves };
  } catch { return { valid: false, code: 'INVALID_ACTION' }; }
}

export class GameError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new GameError(code, status); };
const dateId = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const ranking = (counts, score, rankingAsOf) => ({
  rank: 1 + Object.entries(counts).reduce((sum, [value,count]) => sum + (Number(value) < score ? count : 0), 0),
  total: Object.values(counts).reduce((sum, count) => sum + count, 0), tied: counts[score], rankingAsOf,
});

/** db uses the Admin Firestore doc/runTransaction interface. Authentication belongs to the HTTP wrapper. */
export function createGameService({ db, dictionary, dictionaryVersion, puzzles, now = Date.now, mode, validateReplay = validateSwapReplay }) {
  if (mode !== undefined && mode !== 'swap-adjacent-v1') fail('INVALID_GAME_MODE');
  const swap = mode === 'swap-adjacent-v1';
  const days = swap ? 'swapAdjacentV1Days' : 'gameDays';
  const metric = swap ? 'moves' : 'wordCount';
  const checkMode = input => { if (input?.mode !== mode) fail('INVALID_GAME_MODE'); };
  const manifest = new Map((puzzles instanceof Map ? [...puzzles.values()] : puzzles).map(puzzle => [puzzle.id, puzzle]));
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  const dictionaryHash = swap ? sha256(JSON.stringify([...new Set(dictionary.words.map(word => word.toLowerCase()))].sort())) : null;
  const optimal = new Map();
  // Receipts are trusted offline solver artifacts. Here we check binding and witness,
  // never interpret a client assertion or a known solution as a global minimum proof.
  if (swap) for (const puzzle of manifest.values()) {
    const receipt = puzzle.optimality;
    if (!receipt || receipt.status !== 'PROVEN' || receipt.rulesVersion !== mode
      || receipt.dictionaryVersion !== dictionaryVersion || receipt.dictionaryWordsSha256 !== dictionaryHash
      || receipt.boardSha256 !== sha256([...puzzle.board].join('').toUpperCase())
      || !Number.isInteger(receipt.minimumMoves) || receipt.minimumMoves < 0 || receipt.minimumMoves > 1000
      || receipt.proof?.method !== 'multi-source-bidirectional-bfs-v1' || receipt.proof.exhaustiveBelow !== receipt.minimumMoves
      || !Array.isArray(receipt.optimalActions) || receipt.optimalActions.length !== receipt.minimumMoves
      || receipt.optimalActions.some(action => action?.type !== 'swap')) continue;
    const replay = validateSwapReplay(puzzle.board, receipt.optimalActions, dictionary);
    if (replay.valid && replay.moves === receipt.minimumMoves && JSON.stringify(replay.words) === JSON.stringify(receipt.optimalWords)) {
      optimal.set(puzzle.id, {moves:receipt.minimumMoves,actions:structuredClone(receipt.optimalActions),words:[...replay.words]});
    }
  }
  const completion = (puzzle, result) => optimal.has(puzzle.id) ? {...result,optimal:structuredClone(optimal.get(puzzle.id))} : result;
  function puzzleFor(day = utcPuzzleId(now())) {
    if (!dateId(day)) fail('INVALID_PUZZLE_ID');
    if (day > utcPuzzleId(now())) fail('PUZZLE_NOT_AVAILABLE', 404);
    const puzzle = manifest.get(day);
    if (!puzzle) fail('PUZZLE_NOT_AVAILABLE', 404);
    if (!dictionaryVersion || puzzle.dictionaryVersion !== dictionaryVersion) fail('DICTIONARY_UNAVAILABLE', 503);
    return puzzle;
  }
  function references(uid, puzzleId) {
    if (typeof uid !== 'string' || uid.length < 16 || uid.length > 256) fail('AUTH_REQUIRED', 401);
    const player = createHash('sha256').update(uid).digest('hex');
    return {
      session: db.doc(`${days}/${puzzleId}/sessions/${player}`),
      result: db.doc(`${days}/${puzzleId}/results/${player}`),
      stats: db.doc(`${days}/${puzzleId}`),
    };
  }
  return {
    getPuzzle(day) {
      if (swap) { const puzzle = puzzleFor(day); return { id: puzzle.id, mode, board: [...puzzle.board], dictionaryVersion: puzzle.dictionaryVersion }; }
      const { id, letters, dictionaryVersion: version } = puzzleFor(day);
      return { id, letters: typeof letters === 'string' ? letters : [...letters], dictionaryVersion: version };
    },
    async startSession(uid, input) {
      checkMode(input);
      if (!dateId(input?.puzzleId)) fail('INVALID_PUZZLE_ID');
      const puzzle = puzzleFor(input?.puzzleId);
      const refs = references(uid, puzzle.id);
      return db.runTransaction(async transaction => {
        const existing = await transaction.get(refs.session);
        if (existing.exists) return existing.data();
        const session = { sessionId: randomUUID(), puzzleId: puzzle.id, startedAt: now(), ...(swap ? {mode} : {}) };
        transaction.set(refs.session, session);
        return session;
      });
    },
    async submitResult(uid, input) {
      checkMode(input);
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_RESULT');
      if (!dateId(input.puzzleId)) fail('INVALID_PUZZLE_ID');
      const puzzle = puzzleFor(input.puzzleId);
      if (input.dictionaryVersion !== puzzle.dictionaryVersion) fail('DICTIONARY_VERSION_MISMATCH', 409);
      if (typeof input.sessionId !== 'string' || input.sessionId.length > 100) fail('INVALID_SESSION');
      let validated;
      if (swap) {
        if (!Array.isArray(input.actions) || input.actions.length > 1000) fail('INVALID_ACTIONS');
        validated = validateReplay(puzzle.board, input.actions, dictionary);
      } else validated = validatePartition(puzzle.letters, input.words, dictionary);
      if (!validated.valid) fail(validated.code);
      const refs = references(uid, puzzle.id);
      return db.runTransaction(async transaction => {
        const [sessionDoc, resultDoc, statsDoc] = await Promise.all([
          transaction.get(refs.session), transaction.get(refs.result), transaction.get(refs.stats),
        ]);
        const session = sessionDoc.exists ? sessionDoc.data() : null;
        if (!session || session.sessionId !== input.sessionId || session.puzzleId !== puzzle.id) fail('SESSION_NOT_FOUND', 403);
        const previous = resultDoc.exists ? resultDoc.data() : null;
        // Equal scores are not improvements. Replays keep one participant and one stable session timer.
        const score = swap ? validated.moves : validated.wordCount;
        if (previous && score >= previous[metric]) {
          if (!swap) return previous;
          return completion(puzzle, { ...previous, ...ranking(statsDoc.data().counts, previous.moves, now()) });
        }
        const completedAt = now();
        if (!Number.isFinite(session.startedAt) || completedAt < session.startedAt) fail('INVALID_SESSION_TIME', 409);
        const counts = statsDoc.exists ? {...statsDoc.data().counts} : {};
        if (previous) counts[previous[metric]]--;
        counts[score] = (counts[score] || 0) + 1;
        const result = {
          puzzleId: puzzle.id, dictionaryVersion: puzzle.dictionaryVersion,
          words: validated.words,
          ...(swap ? { mode, moves: score, board: validated.board, actions: structuredClone(input.actions) } : { wordCount: score, minimum: puzzle.minimum }),
          elapsedMs: completedAt - session.startedAt,
          ...ranking(counts, score, completedAt), rankingMetric: metric, completedAt,
          firstCompletedAt: previous?.firstCompletedAt ?? previous?.completedAt ?? completedAt,
        };
        transaction.set(refs.result, result);
        transaction.set(refs.stats, { counts: swap ? counts : Array.from({length:16}, (_,index) => counts[index] || 0) });
        return completion(puzzle, result);
      });
    },
    async reportWord(uid, input) {
      checkMode(input);
      if (!input || typeof input !== 'object' || Array.isArray(input) || !dateId(input.puzzleId)) fail('INVALID_WORD_REPORT');
      const puzzle = puzzleFor(input.puzzleId);
      references(uid, puzzle.id); // Apply the same authenticated-identity contract as play.
      if (input.dictionaryVersion !== puzzle.dictionaryVersion) fail('DICTIONARY_VERSION_MISMATCH', 409);
      if (typeof input.word !== 'string' || !/^[a-z]{1,15}$/i.test(input.word)) fail('INVALID_REPORT_WORD');
      const word = input.word.toLowerCase();
      if (swap && word.length !== 5) fail('INVALID_REPORT_WORD');
      if (dictionary.has(word)) fail('WORD_ALREADY_ACCEPTED', 409);
      const letters = [...(swap ? puzzle.board : puzzle.letters)].map(letter => letter.toLowerCase());
      for (const letter of word) {
        const index = letters.indexOf(letter);
        if (index < 0) fail('REPORT_WORD_NOT_IN_PUZZLE');
        letters.splice(index, 1);
      }
      if (typeof input.reason !== 'string' || input.reason.length > 280 || !input.reason.trim()
        || /[<>\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(input.reason)) fail('INVALID_REPORT_REASON');
      const player = createHash('sha256').update(uid).digest('hex');
      const id = createHash('sha256').update(JSON.stringify([puzzle.id, puzzle.dictionaryVersion, word, player])).digest('hex');
      const report = db.doc(`${swap ? 'swapAdjacentV1WordReports' : 'wordReports'}/${id}`);
      const limit = db.doc(`${swap ? 'swapAdjacentV1WordReportLimits' : 'wordReportLimits'}/${utcPuzzleId(now())}/players/${player}`);
      return db.runTransaction(async transaction => {
        const existing = await transaction.get(report);
        if (existing.exists) return { received: true, status: 'pending', duplicate: true };
        const budget = await transaction.get(limit);
        const count = budget.exists ? budget.data().count : 0;
        if (count >= 5) fail('REPORT_RATE_LIMITED', 429);
        transaction.set(report, { puzzleId: puzzle.id, dictionaryVersion: puzzle.dictionaryVersion,
          word, reason: input.reason.trim(), status: 'pending', createdAt: now() });
        transaction.set(limit, { count: count + 1 });
        return { received: true, status: 'pending', duplicate: false };
      });
    },
  };
}
