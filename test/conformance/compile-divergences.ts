/**
 * Every row of the compile transcript where this package and the reference
 * differ, with BOTH answers, in one place.
 *
 * WHY A MODULE OF ITS OWN. The transcript has three readers - the diff in
 * `test/reference-compile.test.ts`, the emitting stage's rows in
 * `test/emitter.test.ts`, and the parsing stage's in `test/parser.test.ts` -
 * and each of them states something about every row it reads. A difference
 * declared in one of those files would leave the other two asserting what is
 * no longer true, and the repair each would reach for is an exemption, which
 * is how a difference stops being checked. Declared here, one entry answers
 * all three: the diff holds both answers, and the two stage suites read the
 * entry and hold this package to the answer it declares instead of to the
 * reference's.
 *
 * DIVERGENCES ARE DECLARED, NEVER NARROWED. An entry is added here, never by
 * editing the transcript and never by dropping a row from an enumeration. A
 * declared row fails when either side moves and when the two come to agree,
 * since a declaration of a difference that no longer exists is as false as a
 * missing one.
 */

import type { ParseReason } from "../../src/index.js";

/**
 * One row where this package and the reference differ, with BOTH answers.
 *
 * There are two ways to differ and they need different shapes, because a
 * refusal is not an answer of the same kind: the two can answer differently,
 * or the reference can answer where this package refuses. An `answers` entry
 * holds two renderings to compare; a `refusal` entry holds the reference's
 * rendering and the reason this package answers instead, which is a member of
 * the closed union rather than a rendering of anything.
 */
export type Declared = DeclaredAnswers | DeclaredRefusal;

/** Both sides answered, and the two answers are not the same. */
export interface DeclaredAnswers {
  readonly kind: "answers";
  /** The reference's answer, as the transcript records it. */
  readonly reference: string;
  /** This package's answer. */
  readonly ours: string;
  /** Where in `src/` the difference is declared. */
  readonly declaredBy: string;
}

/** The reference answered; this package refuses, with a reason it declares. */
export interface DeclaredRefusal {
  readonly kind: "refusal";
  /** The reference's answer, as the transcript records it. */
  readonly reference: string;
  /** The member of the closed union this package refuses under. */
  readonly reason: ParseReason;
  /** Where in `src/` the difference is declared. */
  readonly declaredBy: string;
}

/**
 * Every row where this package and the reference differ.
 *
 * ONE ENTRY, and it is the only place this package does not accept what the
 * reference accepts. This package declares how deep a source may nest and
 * refuses one past that depth; the reference declares no such bound and
 * compiles the same source. That difference used to be held by prose alone,
 * because the vendored corpus cannot reach it - the deepest expression there
 * nests four levels, two orders of magnitude short of the bound - so no corpus
 * case says anything about it and no later refresh of the corpus will. The row
 * below holds both answers and is re-checked whenever the reference or the
 * corpus moves, which is the shape every other difference from the reference
 * in this package is held in.
 *
 * The row's source is authored beside the others in the script that runs the
 * reference, and the reference's answer to it was recorded by the same run
 * that recorded every other row.
 *
 * Sabotage, each run and reverted: raising `SOURCE_DEPTH_LIMIT` in
 * src/nesting.ts past the depth this row's source nests to makes this package
 * compile that source, which turns the diff red on the assertion that this
 * package still refuses, turns the depth case red on its comparison with the
 * bound, and turns both stage suites red on the reason they expect; respelling
 * the reference half of the entry turns the diff red on the assertion that the
 * reference's program has not moved.
 */
export const DECLARED: ReadonlyMap<string, Declared> = new Map<string, Declared>([
  [
    "compile/nesting/parentheses-past-the-source-depth-bound",
    {
      kind: "refusal",
      reference: '[["load","charge"],["access","amount"]]',
      reason: "nesting_depth_exceeded",
      declaredBy: "src/nesting.ts, SOURCE_DEPTH_LIMIT",
    },
  ],
]);

/** What is declared for a row, or `undefined` when the two agree on it. */
export function declaredOf(id: string): Declared | undefined {
  return DECLARED.get(id);
}

/**
 * How deep a source's brackets nest, the outermost counting as one.
 *
 * This is the source's own written nesting, counted off the text rather than
 * taken from the depth the row was authored at, so a case resting on it rests
 * on the structure and not on a number repeated from somewhere else. It counts
 * bracket characters and would miscount a source carrying one inside a string
 * literal; the rows it is applied to carry no string literal, and it is used
 * nowhere else.
 */
export function writtenNestingDepth(source: string): number {
  let open = 0;
  let deepest = 0;
  for (const character of source) {
    if (character === "(" || character === "[" || character === "{") {
      open += 1;
      if (open > deepest) deepest = open;
    } else if (character === ")" || character === "]" || character === "}") {
      open -= 1;
    }
  }
  return deepest;
}
