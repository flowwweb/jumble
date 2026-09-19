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
        const previous = resultDoc.exists ? resultDoc.data() : null;
        // Equal scores are not improvements. Replays keep one participant and one stable session timer.
        if (previous && validated.wordCount >= previous.wordCount) return previous;
        const completedAt = now();
        if (!Number.isFinite(session.startedAt) || completedAt < session.startedAt) fail('INVALID_SESSION_TIME', 409);
        const counts = statsDoc.exists ? [...statsDoc.data().counts] : Array(16).fill(0);
        const wordCount = validated.wordCount;
        if (previous) counts[previous.wordCount]--;
        counts[wordCount]++;
        const result = {
          puzzleId: puzzle.id, dictionaryVersion: puzzle.dictionaryVersion,
          words: validated.words, wordCount, minimum: puzzle.minimum,
          elapsedMs: completedAt - session.startedAt,
          rank: 1 + counts.slice(1, wordCount).reduce((sum, count) => sum + count, 0),
          total: counts.reduce((sum, count) => sum + count, 0), tied: counts[wordCount],
          rankingAsOf: completedAt, rankingMetric: 'wordCount', completedAt,
          firstCompletedAt: previous?.firstCompletedAt ?? previous?.completedAt ?? completedAt,
        };
        transaction.set(refs.result, result);
        transaction.set(refs.stats, { counts });
        return result;
      });
    },
    async reportWord(uid, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || !dateId(input.puzzleId)) fail('INVALID_WORD_REPORT');
      const puzzle = puzzleFor(input.puzzleId);
      references(uid, puzzle.id); // Apply the same authenticated-identity contract as play.
      if (input.dictionaryVersion !== puzzle.dictionaryVersion) fail('DICTIONARY_VERSION_MISMATCH', 409);
      if (typeof input.word !== 'string' || !/^[a-z]{1,15}$/i.test(input.word)) fail('INVALID_REPORT_WORD');
      const word = input.word.toLowerCase();
      if (dictionary.has(word)) fail('WORD_ALREADY_ACCEPTED', 409);
      const letters = [...puzzle.letters].map(letter => letter.toLowerCase());
      for (const letter of word) {
        const index = letters.indexOf(letter);
        if (index < 0) fail('REPORT_WORD_NOT_IN_PUZZLE');
        letters.splice(index, 1);
      }
      if (typeof input.reason !== 'string' || input.reason.length > 280 || !input.reason.trim()
        || /[<>\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(input.reason)) fail('INVALID_REPORT_REASON');
      const player = createHash('sha256').update(uid).digest('hex');
      const id = createHash('sha256').update(JSON.stringify([puzzle.id, puzzle.dictionaryVersion, word, player])).digest('hex');
      const report = db.doc(`wordReports/${id}`);
      const limit = db.doc(`wordReportLimits/${utcPuzzleId(now())}/players/${player}`);
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
