// How a float is written as text, asked of every place the package writes one.
//
// One table, and each row is asked of the string cast, of a concatenation in
// both orders, of the JSON serializer and of the tagged encoder, so that any
// one of them spelling a float differently from the others fails here.

import { describe, expect, it } from "vitest";
import { evaluateToValue } from "../src/evaluator.js";
import type { Instruction, Program } from "../src/instructions.js";
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
 * What each float is written as. Integral and fractional magnitudes, negative
 * zero, and a value either side of each point where the host switches to
 * exponent form, 1e21 at the large end and 1e-7 at the small, with their
 * negatives.
 */
const TABLE: readonly (readonly [number, string])[] = [
  [3, "3.0"],
  [-3, "-3.0"],
  [1.5, "1.5"],
  [-1.5, "-1.5"],
  [0, "0.0"],
  [-0, "-0.0"],
  [1e20, "100000000000000000000.0"],
  [-1e20, "-100000000000000000000.0"],
  [1e21, "1e+21"],
  [-1e21, "-1e+21"],
  [1e-6, "0.000001"],
  [-1e-6, "-0.000001"],
  [1e-7, "1e-7"],
  [-1e-7, "-1e-7"],
];

describe("the one spelling of a float", () => {
  // The rule these pin: a float's spelling is the host's own with the sign of
  // negative zero kept, and a `.0` is appended exactly when that spelling
  // carries neither a point nor an exponent.
  // Sabotage (scripts/sabotage.mjs): dropping the sign of negative zero,
  // dropping the exponent from the test for a point, and appending the `.0`
  // unconditionally each turn rows red; so does rewiring any one site to the
  // host's own spelling. Each was run and reverted.
  for (const [name, write] of SITES) {
    for (const [number, spelled] of TABLE) {
      const label = Object.is(number, -0) ? "-0" : String(number);
      it(`${name} writes the float ${label} as ${spelled}`, () => {
        expect(write(float(number))).toBe(spelled);
      });
    }
  }
});
