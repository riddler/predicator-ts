/**
 * The one table of duration units.
 *
 * Every place that reads a duration unit reads it from here: the scanner that
 * splits `3d8h` into numbers and units, the grammar that expands a fraction in
 * a duration literal, the `duration` opcode that turns a unit string into the
 * key it names, and the parse behind `::duration` and `parseDuration`. A unit
 * is added or removed here and nowhere else.
 */

import type { DurationParts } from "./values.js";

/** One of the eight keys a duration carries. */
export type DurationKey = keyof DurationParts;

/** A duration unit: what it is written as, what it weighs, and what it names. */
export interface UnitRow {
  readonly key: DurationKey;
  /** The spelling a duration literal writes the unit in. */
  readonly suffix: string;
  /**
   * The longer spellings the `duration` opcode's operand admits beside the
   * suffix. Section 5 of the reference's instruction-set document lists them.
   * They are not part of the literal grammar: the opcode carries unit names a
   * compiler chose, and a literal is what an author writes.
   */
  readonly names: readonly string[];
  readonly millis: number;
  /** Whether a fraction's remainder may be spent back into this unit. */
  readonly remainder: boolean;
}

/**
 * The units, largest first.
 *
 * The order is the order `::string` writes components in, and the order a
 * fraction's remainder is spent in. A month weighs thirty days and a year three
 * hundred and sixty five, the two approximations the reference converts a
 * duration by.
 *
 * A remainder is not spent back into a week, a month or a year. A month and a
 * year are the approximate units, and spending a remainder into one of them
 * would re-commit an approximation the fraction had just resolved; a week is
 * left out with them, so half a year reads as a day count and an hour count.
 */
export const DURATION_UNIT_TABLE: readonly UnitRow[] = [
  { key: "years", suffix: "y", names: ["year", "years"], millis: 31536000000, remainder: false },
  { key: "months", suffix: "mo", names: ["month", "months"], millis: 2592000000, remainder: false },
  { key: "weeks", suffix: "w", names: ["week", "weeks"], millis: 604800000, remainder: false },
  { key: "days", suffix: "d", names: ["day", "days"], millis: 86400000, remainder: true },
  { key: "hours", suffix: "h", names: ["hour", "hours"], millis: 3600000, remainder: true },
  {
    key: "minutes",
    suffix: "m",
    names: ["min", "minute", "minutes"],
    millis: 60000,
    remainder: true,
  },
  {
    key: "seconds",
    suffix: "s",
    names: ["sec", "second", "seconds"],
    millis: 1000,
    remainder: true,
  },
  {
    key: "milliseconds",
    suffix: "ms",
    names: ["millisecond", "milliseconds"],
    millis: 1,
    remainder: true,
  },
];

/** The units smallest first: the order the reference adds a duration's terms in. */
const SMALLEST_FIRST: readonly UnitRow[] = [...DURATION_UNIT_TABLE].reverse();

/**
 * A duration's length in milliseconds, by the reference's weights.
 *
 * Each of the eight components is multiplied by its unit's weight in the table
 * above and the products are summed, smallest unit first, as the reference's
 * `Duration.to_milliseconds/1` sums them: a week is seven days, a month thirty
 * days and a year three hundred and sixty five, so the answer for a month or a
 * year is the same approximation the reference converts by, with no calendar
 * behind it. A key the argument does not carry weighs nothing, so a `Duration`
 * and the parts it was built from answer alike.
 *
 * A component is weighed as it stands. A `Duration` that `parseDuration` or a
 * literal produced holds whole numbers, and its answer is a whole number; a
 * component a host built with a fraction contributes the unrounded product. A
 * sum past the largest safe integer is the nearest double to it rather than
 * the exact count, since the reference's integers have no such bound.
 *
 * Failure is a value, never a throw: an argument that is not an object answers
 * `NaN`.
 */
export function durationToMilliseconds(duration: DurationParts): number {
  if (typeof duration !== "object" || duration === null) return Number.NaN;
  let total = 0;
  for (const unit of SMALLEST_FIRST) total += (duration[unit.key] ?? 0) * unit.millis;
  return total;
}
