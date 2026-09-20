/**
 * How a float is written as text.
 *
 * This module is internal: neither entry point re-exports it. The string cast,
 * the concatenation `add` performs, the tagged encoder and the JSON serializer
 * each write a float through `floatText` rather than keeping a copy of the
 * rule, so that the package spells a float one way wherever it writes one.
 */

import { ownData } from "./maps.js";
import type { Float } from "./values.js";

/**
 * Writes a float so that the text still says it was a float.
 *
 * The spelling starts from the host's own, with the sign of negative zero
 * written rather than dropped, as the reference writes it. A `.0` is appended
 * when that spelling carries neither a point nor an exponent: an integral
 * float's host spelling is bare digits, which would read as an integer.
 *
 * THE TEST IS ON THE SPELLING AND NOT ON THE NUMBER. Past a large enough
 * magnitude, and below a small enough one, the host writes a float in exponent
 * form, so a number can be integral while its spelling already ends in an
 * exponent, and a point glued onto that would make text no JSON parser reads
 * back.
 *
 * THE DIGITS ARE THE HOST'S, AND THE REFERENCE'S DIFFER. Apart from the two
 * departures above - the sign of negative zero written, and a `.0` appended to
 * a spelling with neither a point nor an exponent - this spelling is the
 * host's own, and the reference writes many floats otherwise. What the reference writes through the string cast and
 * through `JSON.stringify` is vendored in `conformance/transcript/`, the rows
 * whose ids begin `float-cast/` and `float-json/`, and
 * `test/reference-transcript.test.ts` declares each row where this spelling
 * differs, with both answers.
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
 * output in place of the field the test read. Reading the field through its
 * descriptor makes what a writer emits a function of what was checked. It is
 * not a defence, and there is nothing here to defend: a host that builds such
 * an object is already inside the process.
 *
 * The answer is a number, because that is what the test read. It is not
 * necessarily finite, because the test does not ask that, so a writer whose
 * output has no text for a non-finite number checks before it spells one.
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
 */
export function floatSpelling(n: number): string {
  const spelling = Object.is(n, -0) ? "-0" : String(n);
  return POINT_OR_EXPONENT.test(spelling) ? spelling : `${spelling}.0`;
}

const POINT_OR_EXPONENT = /[.eE]/;
