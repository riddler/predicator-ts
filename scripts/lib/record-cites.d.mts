/**
 * Types for the record cite check, so a test runs the same implementation the
 * gate stage runs.
 */

export interface ReadAtCite {
  readonly commit: string;
  readonly line: number;
}

export interface LandedAs {
  readonly cited: string;
  readonly landed: string;
}

export interface RecordText {
  readonly name: string;
  readonly text: string;
}

export function readAtCites(text: string): ReadAtCite[];
export function landedAs(text: string): LandedAs[];
export function citeFaults(
  records: readonly RecordText[],
  isAncestor: (commit: string) => boolean,
): string[];
