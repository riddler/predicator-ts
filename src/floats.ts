/**
 * How a float is written as text.
 *
 * This module is internal: neither entry point re-exports it. The string cast,
 * the concatenation `add` performs, the tagged encoder and the JSON serializer
 * each write a float through `floatText` rather than keeping a copy of the
 * rule, so that the package spells a float one way wherever it writes one.
 */

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
 * THE DIGITS ARE THE HOST'S, AND THE REFERENCE'S DIFFER. Apart from the sign of
 * negative zero this spelling is the host's own, and the reference writes many
 * floats otherwise. What the reference writes through the string cast and
 * through `JSON.stringify` is vendored in `conformance/transcript/`, the rows
 * whose ids begin `float-cast/` and `float-json/`, and
 * `test/reference-transcript.test.ts` declares each row where this spelling
 * differs, with both answers.
 */
export function floatText(value: Float): string {
  const n = value.valueOf();
  const spelling = Object.is(n, -0) ? "-0" : String(n);
  return POINT_OR_EXPONENT.test(spelling) ? spelling : `${spelling}.0`;
}

const POINT_OR_EXPONENT = /[.eE]/;
