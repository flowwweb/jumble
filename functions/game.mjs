import { createHash, randomUUID } from 'node:crypto';
import { validatePartition, utcPuzzleId } from '../engine/index.mjs';

export class GameError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new GameError(code, status); };
const dateId = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** db uses the Admin Firestore doc/runTransaction interface. Authentication belongs to the HTTP wrapper. */
export function createGameService({ db, dictionary, dictionaryVersion, puzzles, now = Date.now }) {
  const manifest = new Map((puzzles instanceof Map ? [...puzzles.values()] : puzzles).map(puzzle => [puzzle.id, puzzle]));
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
      session: db.doc(`gameDays/${puzzleId}/sessions/${player}`),
      result: db.doc(`gameDays/${puzzleId}/results/${player}`),
      stats: db.doc(`gameDays/${puzzleId}`),
    };
  }
  return {
    getPuzzle(day) {
      const { id, letters, dictionaryVersion: version } = puzzleFor(day);
      return { id, letters: typeof letters === 'string' ? letters : [...letters], dictionaryVersion: version };
    },
    async startSession(uid, input) {
      if (!dateId(input?.puzzleId)) fail('INVALID_PUZZLE_ID');
      const puzzle = puzzleFor(input?.puzzleId);
      const refs = references(uid, puzzle.id);
      return db.runTransaction(async transaction => {
        const existing = await transaction.get(refs.session);
        if (existing.exists) return existing.data();
        const session = { sessionId: randomUUID(), puzzleId: puzzle.id, startedAt: now() };
        transaction.set(refs.session, session);
        return session;
      });
    },
    async submitResult(uid, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_RESULT');
      if (!dateId(input.puzzleId)) fail('INVALID_PUZZLE_ID');
      const puzzle = puzzleFor(input.puzzleId);
      if (input.dictionaryVersion !== puzzle.dictionaryVersion) fail('DICTIONARY_VERSION_MISMATCH', 409);
      if (typeof input.sessionId !== 'string' || input.sessionId.length > 100) fail('INVALID_SESSION');
      const validated = validatePartition(puzzle.letters, input.words, dictionary);
      if (!validated.valid) fail(validated.code);
      const refs = references(uid, puzzle.id);
      return db.runTransaction(async transaction => {
        const [sessionDoc, resultDoc, statsDoc] = await Promise.all([
          transaction.get(refs.session), transaction.get(refs.result), transaction.get(refs.stats),
        ]);
        const session = sessionDoc.exists ? sessionDoc.data() : null;
        if (!session || session.sessionId !== input.sessionId || session.puzzleId !== puzzle.id) fail('SESSION_NOT_FOUND', 403);
        if (resultDoc.exists) return resultDoc.data();
        const completedAt = now();
        if (!Number.isFinite(session.startedAt) || completedAt < session.startedAt) fail('INVALID_SESSION_TIME', 409);
        const counts = statsDoc.exists ? [...statsDoc.data().counts] : Array(16).fill(0);
        const wordCount = validated.wordCount;
        counts[wordCount]++;
        const result = {
          puzzleId: puzzle.id, dictionaryVersion: puzzle.dictionaryVersion,
          words: validated.words, wordCount, minimum: puzzle.minimum,
          elapsedMs: completedAt - session.startedAt,
          rank: 1 + counts.slice(1, wordCount).reduce((sum, count) => sum + count, 0),
          total: counts.reduce((sum, count) => sum + count, 0), tied: counts[wordCount],
          rankingAsOf: completedAt, rankingMetric: 'wordCount', completedAt,
        };
        transaction.set(refs.result, result);
        transaction.set(refs.stats, { counts });
        return result;
      });
    },
  };
}
