import { describe, expect, it } from "vitest";
import { durationToMilliseconds, parseDuration } from "../src/index.js";
import { Duration, type DurationParts } from "../src/values.js";

// The reference's weights, written out here as literals rather than read from
// the unit table, so a wrong weight in the table turns this file red instead of
// agreeing with itself. They are the factors of `Duration.to_milliseconds/1` in
// the reference at v9.4.2 (`lib/predicator/duration.ex`): a week of seven days,
// a month of thirty and a year of three hundred and sixty five.
const WEIGHTS: readonly (readonly [keyof DurationParts, number])[] = [
  ["milliseconds", 1],
  ["seconds", 1_000],
  ["minutes", 60_000],
  ["hours", 3_600_000],
  ["days", 86_400_000],
  ["weeks", 604_800_000],
  ["months", 2_592_000_000],
  ["years", 31_536_000_000],
];

// The reference's own `to_milliseconds/1` block at v9.4.2
// (`test/predicator/duration_test.exs`), one row per assertion, in order.
const REFERENCE_TABLE: readonly (readonly [DurationParts, number])[] = [
  [{ milliseconds: 500 }, 500],
  [{ seconds: 2 }, 2000],
  [{ seconds: 1, milliseconds: 500 }, 1500],
  [{ minutes: 1, seconds: 30, milliseconds: 250 }, 90250],
  [{ hours: 1 }, 3_600_000],
  [{ days: 1 }, 86_400_000],
  [{}, 0],
  [{ hours: 1, minutes: 30, seconds: 45, milliseconds: 123 }, 5_445_123],
];

describe("durationToMilliseconds", () => {
  // Sabotage: weighing a month as thirty-one days in the unit table turns the
  // months row red, and weighing a year as three hundred and sixty six turns
  // the years row red.
  it.each(WEIGHTS)("weighs one %s as %d milliseconds", (key, weight) => {
    expect(durationToMilliseconds(new Duration({ [key]: 1 }))).toBe(weight);
    expect(durationToMilliseconds(new Duration({ [key]: 7 }))).toBe(7 * weight);
  });

  // Sabotage: dropping any one unit from the sum turns its row here red.
  it("sums all eight units at once", () => {
    const every = new Duration({
      years: 1,
      months: 2,
      weeks: 3,
      days: 4,
      hours: 5,
      minutes: 6,
      seconds: 7,
      milliseconds: 8,
    });
    expect(durationToMilliseconds(every)).toBe(
      31_536_000_000 +
        2 * 2_592_000_000 +
        3 * 604_800_000 +
        4 * 86_400_000 +
        5 * 3_600_000 +
        6 * 60_000 +
        7 * 1_000 +
        8,
    );
  });

  // Sabotage: weighing a second as a hundred milliseconds turns rows here red.
  it.each(REFERENCE_TABLE)("answers %j as the reference does: %d", (parts, expected) => {
    expect(durationToMilliseconds(new Duration(parts))).toBe(expected);
  });

  // Sabotage: reading an absent key without a zero default turns this red.
  it("reads the parts shape, with an absent key weighing nothing, as the reference does", () => {
    expect(durationToMilliseconds({ seconds: 1, milliseconds: 500 })).toBe(1500);
    expect(durationToMilliseconds({})).toBe(0);
  });

  // Sabotage: weighing a year as three hundred and sixty six days turns this red.
  it("answers what parseDuration read, a fraction already spent into whole units", () => {
    const read = parseDuration("1.5y");
    if (!read.ok) throw new Error("1.5y is a duration");
    expect(durationToMilliseconds(read.value)).toBe(
      31_536_000_000 + 182 * 86_400_000 + 12 * 3_600_000,
    );
  });

  // A component a host built with a fraction is weighed as it stands: the
  // answer is the product, not rounded to a whole millisecond.
  // Sabotage: rounding each product to a whole millisecond turns this red.
  it("weighs a fractional component by the same factor, unrounded", () => {
    expect(durationToMilliseconds(new Duration({ months: 0.5 }))).toBe(1_296_000_000);
    expect(durationToMilliseconds(new Duration({ seconds: 1.5 }))).toBe(1500);
    expect(durationToMilliseconds(new Duration({ milliseconds: 0.25 }))).toBe(0.25);
  });

  // The reference sums with integers of any size; a JavaScript number past
  // the largest safe integer is the nearest double. This pins what the
  // conversion answers there: the double the arithmetic gives, which is not
  // the exact sum, and no refusal. It keeps a plain number (2026-10-01)
  // because the bound is enforced where a text is read: the cast and
  // parseDuration refuse a component past the safe range, so a duration that
  // reaches this conversion was built by a host and is weighed as it stands.
  // Sabotage: clamping the sum to the largest safe integer turns this red.
  it("answers the double arithmetic gives past the largest safe integer, never a throw", () => {
    const past = new Duration({ seconds: 1, milliseconds: Number.MAX_SAFE_INTEGER });
    const answer = durationToMilliseconds(past);
    expect(answer).toBe(9_007_199_254_741_992);
    expect(Number.isSafeInteger(answer)).toBe(false);
  });

  // Sabotage: removing the guard on a non-object argument turns this red on the
  // no-throw assertion.
  it("answers NaN rather than throwing for an argument that is not a duration", () => {
    for (const value of [null, undefined, 3, "1s"]) {
      const convert = () => durationToMilliseconds(value as unknown as DurationParts);
      expect(convert).not.toThrow();
      expect(convert()).toBeNaN();
    }
  });

  // A host that calls this from untyped code can hand over an object whose
  // component is not a number. Multiplying a bigint or a symbol by a weight
  // throws, so each component is checked before it is weighed.
  // Sabotage: removing the per-component check turns the bigint and symbol
  // rows into a throw, and the string row into 1000.
  it("answers NaN rather than throwing for a component that is not a number", () => {
    for (const component of [1n, Symbol("days"), "1", true]) {
      const parts = { seconds: component } as unknown as DurationParts;
      const convert = () => durationToMilliseconds(parts);
      expect(convert).not.toThrow();
      expect(convert()).toBeNaN();
    }
  });

  // Past the safe range the order of a sum decides which double it rounds to,
  // so the terms are added smallest first, as the reference's expression adds
  // them. The expected value is that expression transcribed term for term.
  // Sabotage: summing largest first answers 18921600000000000 here.
  it("adds the terms in the reference's order", () => {
    const parts = { milliseconds: 1, seconds: 0.001, minutes: 0.00002, years: 600_000 };
    const reference = 1 + 0.001 * 1_000 + 0.00002 * 60_000 + 600_000 * 31_536_000_000;
    expect(reference).toBe(18_921_600_000_000_004);
    expect(durationToMilliseconds(new Duration(parts))).toBe(reference);
  });
});
