/**
 * The shape every builtin function is built in, and the guards they share.
 *
 * HOW A BUILTIN REFUSES. A host function's type answers a value and has no
 * failing arm, and the evaluator's call dispatch already turns a thrown error
 * into an evaluation error whose reason is that error's message. That is the
 * mechanism the corpus's message-shaped reasons need, so a builtin that cannot
 * answer throws with the reason as its message. A throw is an outcome here
 * rather than a violated invariant, and it is that only because the dispatch
 * above turns it straight back into a value. Other modules under `src/` throw
 * and catch internally too, so this is not the only such place; what is
 * particular to it is WHAT gets thrown. Those raise a typed signal carrying a
 * reason token and convert it at their own boundary, while a builtin raises a
 * bare error whose MESSAGE becomes the reason - which is what a corpus reason
 * shaped as a message needs, having no token to carry. The rule stated in
 * CLAUDE.md is otherwise unchanged.
 *
 * HOW A BUILTIN REPORTS A NUMBER. It answers a plain number for an integer and
 * a `Float` for a float, and the call dispatch normalizes what comes back. So a
 * builtin never range-checks and never tests for a non-finite result: a number
 * outside the safe integer range and a number that is not finite are both
 * refused at that boundary, with the boundary's own reason, exactly as they are
 * for a host's own function. `floatResult` is what makes the second of those
 * work - it answers the raw number rather than a float when the number is not
 * finite, because the float wrapper throws on one and that throw would reach
 * the caller as a reason about wrapping instead of as the boundary's refusal.
 *
 * ARITY. There is no arity surface here and no table a host can read: a builtin
 * declares the argument counts it takes where it is built, and a call that
 * brings another number of arguments is refused with a message naming the
 * counts. No conformance case pins a wrong-arity call, so this is the smallest
 * thing that makes the corpus pass and keeps a mis-built instruction list from
 * reading as a type error about an argument that was never there.
 */

import type { HostFunction } from "../evaluator.js";
import { Float, float, type Value } from "../values.js";

/** Refuses with the text the evaluation error's reason carries verbatim. */
export function refuse(message: string): never {
  throw new Error(message);
}

/** How a refusal names the argument counts a builtin takes. */
function countPhrase(arities: readonly number[]): string {
  const [first, second] = arities;
  if (second !== undefined) return `${first} or ${second} arguments`;
  if (first === 0) return "no arguments";
  if (first === 1) return "exactly 1 argument";
  return `exactly ${first} arguments`;
}

/**
 * Builds one builtin from the counts it accepts and its body.
 *
 * `label` is how the function names itself in its own refusals, which follows
 * the reference rather than one spelling: its unnamespaced functions write a
 * pair of parentheses after the name and its namespaced ones do not.
 */
export function builtin(
  label: string,
  arities: readonly number[],
  body: (args: readonly Value[]) => Value,
): HostFunction {
  return (args) => {
    if (!arities.includes(args.length)) {
      refuse(`${label} expects ${countPhrase(arities)}`);
    }
    return body(args);
  };
}

/** Whether a value is the string member of the domain. */
export function isString(value: Value | undefined): value is string {
  return typeof value === "string";
}

/** Whether a value is the integer member of the domain rather than the float. */
export function isIntegral(value: Value | undefined): value is number {
  return typeof value === "number";
}

/** Whether a value is either numeric member of the domain. */
export function isNumeric(value: Value | undefined): value is number | Float {
  return typeof value === "number" || value instanceof Float;
}

/** The number a numeric value carries, whichever member it is. */
export function numberOf(value: number | Float): number {
  return value instanceof Float ? value.valueOf() : value;
}

/**
 * A float result, or the raw number when it is not one the domain admits.
 *
 * See the note at the top of this file: handing the boundary a non-finite
 * number is what gets the boundary's own refusal rather than the float
 * wrapper's invariant message.
 */
export function floatResult(n: number): Value {
  return Number.isFinite(n) ? float(n) : n;
}

/**
 * An integer result, with a negative zero answered as zero.
 *
 * JavaScript has two zeros and the domain has one, and rounding a small
 * negative number toward zero is the way the negative one arises here.
 */
export function integerResult(n: number): number {
  return n === 0 ? 0 : n;
}
