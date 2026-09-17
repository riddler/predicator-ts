/**
 * The numeric builtins.
 *
 * EVERY ONE OF THESE IS A TYPED DECISION, not a call through to the host's own
 * numeric library, because the domain has two numeric members where the host
 * has one. The rules are the reference's, function by function: absolute value
 * and the two extremum functions answer the argument's own type; a power is an
 * integer exactly when both operands are integers and the exponent is not
 * negative; a square root is an integer exactly for a non-negative integer with
 * an exact root; flooring, ceiling and rounding always answer an integer; and
 * randomness always answers a float. A result that is not a member of the
 * domain - an integer past the safe range, a number that is not finite - is
 * refused at the call boundary rather than here, which is what `floatResult`
 * in the support module exists to arrange.
 *
 * Rounding is HALF AWAY FROM ZERO, which is neither of the two roundings a
 * reader is likely to assume: the host's own rounding takes a half toward
 * positive infinity, so it answers minus two where the reference answers minus
 * three, and banker's rounding answers minus two as well. A conformance case
 * pins the negative half for exactly that reason.
 */

import type { HostFunction } from "../evaluator.js";
import { Float, type Value } from "../values.js";
import {
  builtin,
  floatResult,
  integerResult,
  isIntegral,
  isNumeric,
  numberOf,
  refuse,
} from "./support.js";

/** Answers the argument's own numeric type, which abs, min and max preserve. */
function sameNumericType(source: number | Float, n: number): Value {
  return source instanceof Float ? floatResult(n) : n;
}

const abs = builtin("Math.abs", [1], (args) => {
  const [value] = args;
  if (!isNumeric(value)) refuse("Math.abs expects a numeric argument");
  return sameNumericType(value, Math.abs(numberOf(value)));
});

const floor = builtin("Math.floor", [1], (args) => {
  const [value] = args;
  if (!isNumeric(value)) refuse("Math.floor expects a numeric argument");
  return integerResult(Math.floor(numberOf(value)));
});

const ceil = builtin("Math.ceil", [1], (args) => {
  const [value] = args;
  if (!isNumeric(value)) refuse("Math.ceil expects a numeric argument");
  return integerResult(Math.ceil(numberOf(value)));
});

const round = builtin("Math.round", [1], (args) => {
  const [value] = args;
  if (!isNumeric(value)) refuse("Math.round expects a numeric argument");
  const n = numberOf(value);
  // Rounding the magnitude and putting the sign back is what makes a half go
  // away from zero; the host's own rounding would take it toward positive
  // infinity.
  return integerResult(n < 0 ? -Math.round(-n) : Math.round(n));
});

const min = builtin("Math.min", [2], (args) => {
  const [left, right] = args;
  if (!isNumeric(left) || !isNumeric(right)) {
    refuse("Math.min expects two numeric arguments");
  }
  return numberOf(left) <= numberOf(right) ? left : right;
});

const max = builtin("Math.max", [2], (args) => {
  const [left, right] = args;
  if (!isNumeric(left) || !isNumeric(right)) {
    refuse("Math.max expects two numeric arguments");
  }
  return numberOf(left) >= numberOf(right) ? left : right;
});

const pow = builtin("Math.pow", [2], (args) => {
  const [base, exponent] = args;
  if (!isNumeric(base) || !isNumeric(exponent)) {
    refuse("Math.pow expects two numeric arguments");
  }
  if (isIntegral(base) && isIntegral(exponent) && exponent >= 0) {
    return base ** exponent;
  }
  return floatResult(numberOf(base) ** numberOf(exponent));
});

/**
 * The square root.
 *
 * The negative case is tested BEFORE any float is built, because the float
 * wrapper refuses a number that is not finite by throwing, and that throw would
 * reach the caller as its own message in place of the reason the corpus pins.
 *
 * The integer case rounds the host's square root and squares the answer back,
 * and a candidate that fails that test falls through to the float.
 *
 * SQUARING IT BACK ONLY SETTLES ANYTHING IF THE PRODUCT IS EXACT, and that
 * needs an argument rather than an assertion. The largest root this can reach
 * is the rounded root of the largest safe integer. That root is even, so its
 * square is one of the values still exactly representable just above two to
 * the fifty-third, where only the even integers are; and every smaller root
 * squares below that boundary, where every integer is. So no comparison here
 * is ever made against a product that was rounded to fit. Both ends of that
 * argument are asserted in the suite rather than left to this paragraph.
 *
 * NOTHING HERE IS A CLAIM ABOUT WHICH SHAPE THE REFERENCE CHOSE. It neither
 * rounds a floating root nor truncates one: it computes an integer square root
 * by Newton's method, entirely in integer arithmetic, and its own comment says
 * a truncated floating root would inherit float precision. It has to work that
 * way, because its integers are arbitrary precision and run far past the range
 * where the argument above holds. This package's integers stop at the safe
 * range, which is what makes the cheaper route sound here.
 */
const sqrt = builtin("Math.sqrt", [1], (args) => {
  const [value] = args;
  if (!isNumeric(value)) refuse("Math.sqrt expects a numeric argument");
  const n = numberOf(value);
  if (n < 0) refuse("Math.sqrt expects a non-negative number");
  if (isIntegral(value)) {
    const root = Math.round(Math.sqrt(n));
    if (root * root === n) return root;
  }
  return floatResult(Math.sqrt(n));
});

/**
 * Builds the randomness builtin over one evaluation's source of randomness.
 *
 * It cannot be a fixed entry in the builtin map the way every function above
 * is: a host function takes its arguments and nothing else, the map is built
 * once, and the source of randomness is a per-evaluation option. So the
 * evaluator builds this one when it resolves the options, which is also what
 * lets a host pin the answer.
 */
export function randomFunction(random: () => number): HostFunction {
  return builtin("Math.random", [0], () => floatResult(random()));
}

/** The deterministic numeric builtins, by the name a call reaches them under. */
export const mathFunctions: ReadonlyMap<string, HostFunction> = new Map<string, HostFunction>([
  ["Math.abs", abs],
  ["Math.ceil", ceil],
  ["Math.floor", floor],
  ["Math.max", max],
  ["Math.min", min],
  ["Math.pow", pow],
  ["Math.round", round],
  ["Math.sqrt", sqrt],
]);
