/**
 * How a float is written as text.
 *
 * This module is internal: neither entry point re-exports it. The string cast,
 * the concatenation `add` performs, the tagged encoder and the JSON serializer
 * each write a float through `floatText` rather than keeping a copy of the
 * rule, and the grammar names a decimal literal in a refusal through
 * `floatSpelling`, so that the package spells a float one way wherever it
 * writes one. What a float carries is read through `floatMagnitude`, by those
 * writers and by every place the machine reads a float's number.
 */

import { ownData } from "./maps.js";
import type { Float } from "./values.js";

/**
 * Writes a float so that the text still says it was a float.
 *
 * The spelling is the reference's: `floatSpelling` below states the rule. A
 * float is written with a point, or in exponent form with a fraction digit, so
 * the text never reads as an integer, and the sign of negative zero is
 * written rather than dropped.
 *
 * What the reference writes through the string cast, `JSON.stringify` and a
 * concatenation is vendored in `conformance/transcript/`, the rows whose ids
 * begin `float-cast/`, `float-json/` and `float-concat/`, and every one of them
 * agrees with this spelling.
 */
export function floatText(value: Float): string {
  return floatSpelling(floatMagnitude(value));
}

/**
 * Reads the number a float carries, from the field the class's `instanceof`
 * test checked rather than from the instance's `valueOf`.
 *
 * `valueOf` is a method, and a method answers whatever the object it belongs
 * to was built to answer. The test admits any object carrying the shape a
 * constructor gives an instance, so an object a host built to that shape is
 * taken for a float - host code impersonating a class of this package's, which
 * the value-domain record puts outside what this package promises - and a
 * writer that called its `valueOf` would put that method's answer into its
 * output in place of the field the test read. A reader that called it would
 * do worse than write something malformed: equality, the test for zero,
 * arithmetic, negation, the integer cast and a builtin's argument would each
 * answer from the method, and a method that answers a different number on
 * each call makes equality between a float and itself false. Reading the
 * field through its descriptor makes what a writer emits and what the machine
 * decides a function of what was checked. It is not a defence, and there is
 * nothing here to defend: a host that builds such an object is already inside
 * the process.
 *
 * The answer is a number, because that is what the test read. It is not
 * necessarily finite, because the test does not ask that, so a writer whose
 * output has no text for a non-finite number checks before it spells one, and
 * a reader that builds a new float from it goes through the check that
 * refuses a non-finite result. The two places a host's float enters the
 * machine, context normalization and a literal operand, refuse one whose
 * field is not finite, so these checks are reached only by a float handed to
 * a writer or a reader some other way.
 * The field is the one `shareAcrossCopies` names for `Float` in `./values.ts`.
 */
export function floatMagnitude(value: Float): number {
  return ownData(value, "n") as number;
}

/**
 * The same spelling, for a number that is not a domain float yet.
 *
 * The grammar names a decimal literal in a refusal's message before anything
 * has built a domain value out of it, and it has to spell that literal the way
 * the rest of the package spells a float or the message says the wrong number.
 * It is the one caller that has a bare number rather than a `Float`, which is
 * why the rule sits here and `floatText` delegates to it rather than the other
 * way around.
 *
 * THE RULE IS THE REFERENCE'S. The reference writes a float with its host
 * language's shortest form, which that language's runtime documents this way
 * (the power written here as `^`):
 * "When the float is inside the range (-2^53, 2^53), the notation that yields
 * the smallest number of characters is used (scientific notation or normal
 * decimal notation). Floats outside the range (-2^53, 2^53) are always
 * formatted using scientific notation". So this writes the shortest digits
 * that read back as the same number, then:
 *
 * - at a magnitude of 2^53 or more, the exponent form;
 * - below it, whichever of the plain and exponent forms is shorter, and the
 *   plain form when the two are the same length.
 *
 * The plain form carries a point, and a `.0` when the number is integral:
 * `1234.0`, `0.001`. The exponent form is one digit, a point, at least one
 * further digit, an `e`, and the exponent with a minus sign when it is
 * negative and no sign otherwise: `1.0e3`, `1.5e-7`. A negative number writes
 * a minus in front of either form, which leaves the comparison of their
 * lengths as it was. Zero is `0.0`, and negative zero `-0.0`.
 *
 * The digits come from the host's own shortest spelling, which reads back as
 * the same number with as few digits as that allows, as the reference's does;
 * only where the point and the exponent go is this rule's.
 *
 * A number that is not finite has no spelling in the reference and is kept to
 * the host's with a `.0` appended, as it was written before this rule; no
 * float this package builds carries one, and the tagged encoder refuses one
 * before it gets here.
 */
export function floatSpelling(n: number): string {
  if (!Number.isFinite(n)) return `${String(n)}.0`;
  if (n === 0) return Object.is(n, -0) ? "-0.0" : "0.0";
  const sign = n < 0 ? "-" : "";
  const magnitude = Math.abs(n);
  const { digits, exponent } = shortestDigits(magnitude);
  const scientific = `${digits[0]}.${digits.length > 1 ? digits.slice(1) : "0"}e${exponent}`;
  if (magnitude >= EXPONENT_ONLY_FROM) return sign + scientific;
  const plain = plainForm(digits, exponent);
  return sign + (scientific.length < plain.length ? scientific : plain);
}

/** The magnitude from which a float is written in exponent form only: 2^53. */
const EXPONENT_ONLY_FROM = 2 ** 53;

/**
 * The significant digits of a positive finite number's shortest spelling,
 * with no leading or trailing zero, and the decimal exponent of the first of
 * them: `1500` is the digits `15` at exponent 3, `0.00012` the digits `12` at
 * exponent -4.
 */
function shortestDigits(magnitude: number): { digits: string; exponent: number } {
  const host = String(magnitude);
  const marker = host.indexOf("e");
  if (marker !== -1) {
    const mantissa = host.slice(0, marker).replace(".", "");
    return { digits: mantissa.replace(/0+$/, ""), exponent: Number(host.slice(marker + 1)) };
  }
  const point = host.indexOf(".");
  const whole = point === -1 ? host : host.slice(0, point);
  const all = point === -1 ? host : whole + host.slice(point + 1);
  const leading = all.length - all.replace(/^0+/, "").length;
  const digits = all.slice(leading).replace(/0+$/, "");
  return { digits, exponent: whole.length - leading - 1 };
}

/** Writes significant digits at a decimal exponent in plain form, with a point. */
function plainForm(digits: string, exponent: number): string {
  if (exponent < 0) return `0.${"0".repeat(-exponent - 1)}${digits}`;
  const width = exponent + 1;
  if (digits.length <= width) return `${digits}${"0".repeat(width - digits.length)}.0`;
  return `${digits.slice(0, width)}.${digits.slice(width)}`;
}
