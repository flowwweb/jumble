import { utcPuzzleId } from '../engine/index.mjs';
import { GameError } from './game.mjs';

/** Dates alone select rules; client modes never select a service. */
export function createDailyService({normal,blank,blankDays,now=Date.now}) {
  const assigned = new Set(blankDays);
  function select(day = utcPuzzleId(now())) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new GameError('INVALID_PUZZLE_ID');
    if (day > utcPuzzleId(now())) throw new GameError('PUZZLE_NOT_AVAILABLE',404);
    return {day,service:assigned.has(day)?blank:normal};
  }
  return {
    getPuzzle(day,mode) {
      const selected=select(day),puzzle=selected.service.getPuzzle(selected.day);
      if(mode!==undefined&&mode!==puzzle.mode)throw new GameError('INVALID_GAME_MODE');
      return puzzle;
    },
    startSession(uid,input) { return select(input?.puzzleId).service.startSession(uid,input); },
    submitResult(uid,input) { return select(input?.puzzleId).service.submitResult(uid,input); },
    reportWord(uid,input) { return select(input?.puzzleId).service.reportWord(uid,input); },
  };
}
