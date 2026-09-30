/**
 * Types for the enumeration of the scanner suite's sources, so that the token
 * transcript's generator and the suite that diffs the transcript apply one
 * implementation of the rule.
 */

export const LEXER_SUITE: string;
export function decodeLiteral(literal: string): string;
export function enumerateSources(text: string): string[];
export function lexerSuiteSources(): string[];
