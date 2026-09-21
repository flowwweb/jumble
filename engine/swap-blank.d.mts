export const BLANK_RULES_VERSION: string;
export type BlankAction = { type: 'swap'; from: number; to: number } | { type: 'undo' } | { type: 'reset' };
export type BlankDictionary = { has(word: string): boolean };
export type BlankRun = { row: number; indices: number[]; word: string; admitted: boolean; valid: boolean };
export function normalizeBlankBoard(input: string | readonly string[]): string[];
export function createBlankDictionary(words: string[]): BlankDictionary & { readonly words: readonly string[] };
export function applyBlankSwap(input: string | readonly string[], action: { from: number; to: number }): string[];
export function evaluateBlankBoard(input: string | readonly string[], dictionary: BlankDictionary): { runs: BlankRun[]; words: string[]; won: boolean };
export function replayBlankSession(initial: string | readonly string[], actions: BlankAction[], dictionary: BlankDictionary): { board: string[]; moves: number; undoDepth: number; runs: BlankRun[]; words: string[]; won: boolean };
