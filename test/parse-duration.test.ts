import { describe, expect, it } from "vitest";
import { compile } from "../src/compile.js";
import { evaluateToValue } from "../src/evaluator.js";
import { parseDuration } from "../src/index.js";
import { Duration, type DurationParts, Undefined, type Value } from "../src/values.js";
import { sameValue } from "./conformance/runner.js";

// The fixture table of the reference's duration parse, copied from the
// `parse/1` block of its duration tests at v9.4.2
// (`test/predicator/duration_test.exs`). Each row is one assertion there, in
// the order it is written, and a row with `null` is one the reference answers
// `:error` for. The six rows under the round-trip heading are the durations the
// reference writes out with its own formatter and reads back; their spellings
// are what that formatter writes, which its own formatter tests pin.
const REFERENCE_TABLE: readonly (readonly [string, DurationParts | null])[] = [
  // parses each of the eight units alone
  ["1y", { years: 1 }],
  ["1mo", { months: 1 }],
  ["1w", { weeks: 1 }],
  ["1d", { days: 1 }],
  ["1h", { hours: 1 }],
  ["1m", { minutes: 1 }],
  ["1s", { seconds: 1 }],
  ["1ms", { milliseconds: 1 }],
  // parses a multi-unit string
  ["3d8h30m", { days: 3, hours: 8, minutes: 30 }],
  // disambiguates mo from m and ms from m
  ["1mo", { months: 1 }],
  ["1m", { minutes: 1 }],
  ["1ms", { milliseconds: 1 }],
  ["2mo3m4ms", { months: 2, minutes: 3, milliseconds: 4 }],
  // accumulates on a repeated unit
  ["1d2d", { days: 3 }],
  ["1h1h1h", { hours: 3 }],
  // round-trips through to_string/1, including the 0s case
  ["0s", {}],
  ["0s", { seconds: 0 }],
  ["3d8h30m", { days: 3, hours: 8, minutes: 30 }],
  ["2w", { weeks: 2 }],
  ["1y2mo3w4d5h6m7s", { years: 1, months: 2, weeks: 3, days: 4, hours: 5, minutes: 6, seconds: 7 }],
  ["500ms", { milliseconds: 500 }],
  // rejects the empty string
  ["", null],
  // rejects a negative value
  ["-1d", null],
  // accepts a fractional value and expands it to whole units
  ["1.5d", { days: 1, hours: 12 }],
  // accepts a fractional component on every unit
  ["1.5s", { seconds: 1, milliseconds: 500 }],
  ["0.5s", { milliseconds: 500 }],
  ["0.25s", { milliseconds: 250 }],
  ["0.1s", { milliseconds: 100 }],
  ["1.0s", { seconds: 1 }],
  ["0.0s", { seconds: 0 }],
  ["1.5m", { minutes: 1, seconds: 30 }],
  ["1.5h", { hours: 1, minutes: 30 }],
  ["0.5w", { days: 3, hours: 12 }],
  ["0.5mo", { days: 15 }],
  ["1.5y", { years: 1, days: 182, hours: 12 }],
  ["1.0ms", { milliseconds: 1 }],
  // accumulates a mixed fractional and integer literal
  ["1.5s200ms", { seconds: 1, milliseconds: 700 }],
  // rejects an unknown unit
  ["1x", null],
  // rejects trailing junk
  ["1dabc", null],
  // rejects leading whitespace
  [" 1d", null],
  // rejects embedded whitespace
  ["1d 2h", null],
  // rejects a sub-millisecond remainder
  ["0.5ms", null],
  // rejects an inexact fraction
  ["1.0005s", null],
  // rejects a leading-dot fraction
  [".5s", null],
  // rejects a trailing-dot fraction
  ["1.s", null],
  // rejects a bare unit
  ["s", null],
  // rejects a double dot
  ["1..5s", null],
  // rejects a fraction with no unit
  ["1.5", null],
  // rejects a bare number with no unit
  ["42", null],
  // rejects trailing whitespace
  ["1d ", null],
  // rejects a trailing newline
  ["1d\n", null],
  // rejects a leading newline
  ["\n1d", null],
];

/** What `::duration` answers for the same text, through the evaluator. */
function cast(text: string): Value {
  const outcome = evaluateToValue([
    ["lit", text],
    ["cast", "duration"],
  ]);
  if (!outcome.ok) throw new Error(`the cast refused with ${outcome.error.reason}`);
  return outcome.value;
}

describe("parseDuration, over the reference's fixture table", () => {
  // Sabotage: reading every whole component as one unit rather than its written
  // value turns rows of this table red.
  it.each(REFERENCE_TABLE.filter(([, parts]) => parts !== null))(
    "reads %j as the reference does",
    (text, parts) => {
      const result = parseDuration(text);
      expect(result).toStrictEqual({ ok: true, value: new Duration(parts as DurationParts) });
    },
  );

  // Sabotage: dropping the leading anchor from the parse's whole-text pattern
  // turns the leading-space and leading-newline rows red.
  it.each(REFERENCE_TABLE.filter(([, parts]) => parts === null))(
    "refuses %j as a value, never a throw",
    (text) => {
      expect(parseDuration(text)).toStrictEqual({ ok: false, reason: "invalid_duration_format" });
    },
  );
});

describe("parseDuration and the cast share one parse", () => {
  // Sabotage: giving the export its own reading of a text, trimming it before
  // the parse the cast runs, makes the two disagree on the whitespace rows.
  it.each(REFERENCE_TABLE)("answers what ::duration answers for %j", (text) => {
    const result = parseDuration(text);
    const casted = cast(text);
    if (result.ok) {
      expect(sameValue(result.value, casted)).toBe(true);
    } else {
      expect(casted).toBe(Undefined);
    }
  });
});

/**
 * The rows the compiled literal answers differently by design: a unit written
 * twice accumulates in this parse and keeps the last pair in the `duration`
 * opcode, and a fraction that expands onto a unit written beside it is a
 * compile refusal. The reference documents both divergences.
 */
const LITERAL_DIVERGES = new Set(["1d2d", "1h1h1h", "1.5s200ms"]);

describe("parseDuration and the compiled duration literal share one unit table", () => {
  // Sabotage: giving the grammar its own weight for a day, in place of the one
  // the shared table carries, makes the compiled literal disagree on the
  // fractional-day row.
  it.each(REFERENCE_TABLE.filter(([text, parts]) => parts !== null && !LITERAL_DIVERGES.has(text)))(
    "compiles %j to the duration the export reads",
    (text) => {
      const compiled = compile(text);
      if (!compiled.ok) throw new Error(`${text} did not compile: ${compiled.error.reason}`);
      const outcome = evaluateToValue(compiled.instructions);
      if (!outcome.ok) throw new Error(`${text} did not evaluate: ${outcome.error.reason}`);
      const result = parseDuration(text);
      if (!result.ok) throw new Error(`${text} was refused`);
      expect(sameValue(outcome.value, result.value)).toBe(true);
    },
  );
});

describe("parseDuration from an untyped caller", () => {
  // Sabotage: handing a value that is not a string straight to the parse turns
  // the row whose string form spells a duration into a throw.
  it.each([5, null, undefined, { toString: () => "1d" }])(
    "refuses %j as a value rather than throwing",
    (value) => {
      let result: unknown;
      expect(() => {
        result = parseDuration(value as unknown as string);
      }).not.toThrow();
      expect(result).toStrictEqual({ ok: false, reason: "invalid_duration_format" });
    },
  );
});
