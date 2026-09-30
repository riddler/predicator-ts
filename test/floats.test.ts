// How a float is written as text, asked of every place the package writes one.
//
// One table, and each row is asked of the string cast, of a concatenation in
// both orders, of the JSON serializer and of the tagged encoder, so that any
// one of them spelling a float differently from the others fails here. The
// grammar's refusal message, which names a decimal literal, is asked the
// non-negative rows, since a literal carries no sign.
//
// Every spelling in the table is the reference's, run at predicator-ex
// `v9.4.2` (Elixir 1.18.3, OTP 27) through its host language's float-to-string
// function, which is what its string cast, its concatenation and its JSON
// serializer write; the transcript rows whose ids begin `float-cast/`,
// `float-json/` and `float-concat/` in `conformance/transcript/` carry the
// reference's answer through the language itself for many of these values.

import { describe, expect, it } from "vitest";
import { evaluateToValue } from "../src/evaluator.js";
import { floatSpelling } from "../src/floats.js";
import type { Instruction, Program } from "../src/instructions.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { encodeTagged } from "../src/tagged.js";
import { type Float, float, type Value } from "../src/values.js";

/** Runs a program and answers the string it pushed. */
function text(program: Instruction[], context: { [key: string]: Value } = {}): string {
  const outcome = evaluateToValue(program as Program, context);
  if (!outcome.ok) throw new Error(`answered ${outcome.error.reason}`);
  if (typeof outcome.value !== "string") throw new Error("answered a value that is not a string");
  return outcome.value;
}

/** Every place the package writes a float, each answering the text it wrote. */
const SITES: readonly (readonly [string, (value: Float) => string])[] = [
  [
    "the string cast",
    (value) =>
      text([
        ["lit", value],
        ["cast", "string"],
      ]),
  ],
  [
    "a concatenation with the float on the right",
    (value) => text([["lit", "<"], ["lit", value], ["add"]]).slice(1),
  ],
  [
    "a concatenation with the float on the left",
    (value) => text([["lit", value], ["lit", ">"], ["add"]]).slice(0, -1),
  ],
  [
    "JSON.stringify",
    (value) =>
      text(
        [
          ["load", "x"],
          ["call", "JSON.stringify", 1],
        ],
        { x: value },
      ),
  ],
  [
    "the tagged encoder",
    (value) => {
      const encoded = encodeTagged(value);
      if (!encoded.ok) throw new Error(`refused with ${encoded.reason}`);
      return encoded.text;
    },
  ],
];

/**
 * What each float is written as, by the reference's rule: at a magnitude of
 * 2^53 or more the exponent form, and below it the shorter of the plain and
 * exponent forms, the plain one when the two are the same length.
 *
 * The rows sit either side of each place the choice turns. `100.0` and
 * `1.0e2` are the same length, so the plain form wins, and `1000.0` is longer
 * than `1.0e3`; `1234.0` is shorter than `1.234e3`, and `1500.0` longer than
 * `1.5e3`. At the small end `0.0001` and `1.0e-4` are the same length, and
 * `0.00001` is longer than `1.0e-5`; `0.001234` is shorter than `1.234e-3`,
 * and `0.00012` longer than `1.2e-4`. `9007199254740991.0` is 2^53 - 1, the
 * last integral float below the bound, written plain; 2^53 itself is written
 * with an exponent although its plain form is no longer. The rows the host's
 * own spelling wrote differently before this rule, at 1e21 and 1e-7, are kept.
 */
const POSITIVE: readonly (readonly [number, string])[] = [
  [0, "0.0"],
  [3, "3.0"],
  [1.5, "1.5"],
  [0.5, "0.5"],
  [0.1, "0.1"],
  [0.1 + 0.2, "0.30000000000000004"],
  [100, "100.0"],
  [100.5, "100.5"],
  [999, "999.0"],
  [1000, "1.0e3"],
  [1001, "1001.0"],
  [1234, "1234.0"],
  [1500, "1.5e3"],
  [10000, "1.0e4"],
  [12345, "12345.0"],
  [120000, "1.2e5"],
  [123456789012, "123456789012.0"],
  [1e14, "1.0e14"],
  [1e15, "1.0e15"],
  [1.23e15, "1.23e15"],
  [1234567890123456, "1234567890123456.0"],
  [9007199254740991, "9007199254740991.0"],
  [9007199254740992, "9.007199254740992e15"],
  [1e16, "1.0e16"],
  [1e20, "1.0e20"],
  [1e21, "1.0e21"],
  [1e22, "1.0e22"],
  [1.5e300, "1.5e300"],
  [1.7976931348623157e308, "1.7976931348623157e308"],
  [0.001, "0.001"],
  [0.001234, "0.001234"],
  [1e-4, "0.0001"],
  [1.2e-4, "1.2e-4"],
  [1.2345e-4, "1.2345e-4"],
  [2.5e-5, "2.5e-5"],
  [1e-5, "1.0e-5"],
  [1e-6, "1.0e-6"],
  [1e-7, "1.0e-7"],
  [1.5e-7, "1.5e-7"],
  [5e-324, "5.0e-324"],
];

/** The table: every positive row, then its negative, which only gains a sign. */
const TABLE: readonly (readonly [number, string])[] = [
  ...POSITIVE,
  ...POSITIVE.map(([number, spelled]) =>
    number === 0 ? ([-0, "-0.0"] as const) : ([-number, `-${spelled}`] as const),
  ),
];

/**
 * A non-negative number's decimal literal, written out in plain digits so the
 * grammar reads it: the grammar has no exponent form, so `1e21` is written as
 * twenty-two digits and a point.
 */
function literal(n: number): string {
  const host = String(n);
  const marker = host.indexOf("e");
  if (marker === -1) return host.includes(".") ? host : `${host}.0`;
  const [whole = "", fraction = ""] = host.slice(0, marker).split(".");
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(host.slice(marker + 1));
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${digits}${"0".repeat(point - digits.length)}.0`;
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** What the grammar's refusal names a decimal literal as, found where a token trails. */
function namedByTheGrammar(n: number): string {
  const tokens = tokenize(`1 ${literal(n)}`);
  if (!tokens.ok) throw new Error(`scanner refused: ${tokens.error.message}`);
  const outcome = parse(tokens.tokens);
  if (outcome.ok) throw new Error("parsed a trailing token");
  const found = /^Unexpected token number '(.*)' after expression$/.exec(outcome.error.message);
  if (found === null) throw new Error(`refused with ${outcome.error.message}`);
  return found[1] as string;
}

describe("the one spelling of a float", () => {
  // The rule these pin is the reference's: the shortest digits that read back
  // as the same number; at 2^53 or more the exponent form; below it the
  // shorter of the plain and exponent forms, the plain one on a tie; a point
  // in either form, a fraction digit in the exponent form's mantissa, no plus
  // sign in its exponent; the sign of negative zero written.
  // Sabotage (each run and reverted, recorded with the change that brought
  // this rule): preferring the exponent form on a tie turns the 100 and 1e-4
  // rows red; dropping the 2^53 bound turns the 2^53 row red; writing the
  // exponent form's mantissa without a fraction digit turns the 1000 row red;
  // rewiring the JSON serializer, or the grammar's refusal, to the host's own
  // spelling turns that site's rows red.
  for (const [name, write] of SITES) {
    for (const [number, spelled] of TABLE) {
      const label = Object.is(number, -0) ? "-0" : String(number);
      it(`${name} writes the float ${label} as ${spelled}`, () => {
        expect(write(float(number))).toBe(spelled);
      });
    }
  }

  // The grammar names a decimal literal in a refusal before any float exists,
  // and names it as the reference does: run at `v9.4.2`, `1 1000.0` is
  // refused with "Unexpected token number '1.0e3' after expression".
  for (const [number, spelled] of POSITIVE) {
    // Sabotage: rewiring the grammar's refusal to the host's own spelling turns
    // these rows red. It was run and reverted.
    it(`the grammar's refusal names the literal for ${String(number)} as ${spelled}`, () => {
      expect(namedByTheGrammar(number)).toBe(spelled);
    });
  }

  // No float this package builds is not finite, and the tagged encoder refuses
  // one a host forged; what the rule answers for such a number is the host's
  // spelling with `.0` appended, as it was before the rule was the reference's,
  // rather than digits read out of text that has none.
  //
  // Sabotage: dropping the guard for a number that is not finite turns this
  // red. It was run and reverted.
  it("keeps a number that is not finite to the host's spelling", () => {
    expect(floatSpelling(Number.NaN)).toBe("NaN.0");
    expect(floatSpelling(Number.POSITIVE_INFINITY)).toBe("Infinity.0");
    expect(floatSpelling(Number.NEGATIVE_INFINITY)).toBe("-Infinity.0");
  });
});
