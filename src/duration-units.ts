/**
 * The one table of duration units.
 *
 * Every place that reads a duration unit reads it from here: the scanner that
 * splits `3d8h` into numbers and units, the grammar that expands a fraction in
 * a duration literal, the `duration` opcode that turns a unit string into the
 * key it names, and the parse behind `::duration` and `parseDuration`. A unit
 * is added or removed here and nowhere else.
 *
 * The expansion of a fractional component lives here too, so the grammar and
 * the parse turn a fraction into whole units by one arithmetic rather than
 * two.
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

/** One whole-unit amount a fractional component expands into. */
export interface ExpandedAmount {
  readonly amount: number;
  readonly row: UnitRow;
}

/** The units a fraction's remainder is spent into, largest first. */
const REMAINDER_LADDER: readonly UnitRow[] = DURATION_UNIT_TABLE.filter((row) => row.remainder);

/**
 * The most decimal places a fraction of any unit in `table` can carry and still
 * be exact.
 *
 * A fraction is exact when the tens in its denominator all cancel against the
 * twos and fives in its unit's millisecond value and in its own digits, and
 * digits with no trailing zero cannot supply both. So a unit absorbs at most as
 * many places as the larger of its counts of twos and of fives, and past the
 * largest such count in the table nothing cancels and the fraction is a
 * sub-millisecond remainder whatever its digits say. Refusing there is also
 * what keeps every product in `expandFraction` inside the whole numbers this
 * language holds exactly. It is computed from the table, so a unit added with
 * more twos or fives raises it with no edit here.
 */
export function mostExactPlaces(table: readonly UnitRow[]): number {
  let most = 0;
  for (const row of table) {
    most = Math.max(most, factorCount(row.millis, 2), factorCount(row.millis, 5));
  }
  return most;
}

/** How many times `prime` divides `n`, a positive whole number. */
function factorCount(n: number, prime: number): number {
  let count = 0;
  let rest = n;
  while (rest > 0 && rest % prime === 0) {
    rest /= prime;
    count += 1;
  }
  return count;
}

/** The bound `expandFraction` refuses past, for the table above. */
const MOST_EXACT_PLACES = mostExactPlaces(DURATION_UNIT_TABLE);

/**
 * Expands a component written with a fraction into whole-unit amounts, or
 * answers nothing when the fraction is not an exact number of milliseconds.
 *
 * `whole` is the integer part and `digits` the run of digits after the decimal
 * point, as written. A millisecond is the domain's floor, so a fraction below
 * one is refused rather than rounded or truncated: `0.5ms` names no duration
 * this domain holds.
 *
 * The arithmetic is whole numbers throughout - the digits are read as an
 * integer and scaled by a power of ten, never as a binary fraction, which
 * answers whether a decimal remainder is zero wrongly - so the component is
 * exact or it is refused, and nothing is rounded on the way. The shared
 * factors of the unit's millisecond value and the power of ten are cancelled
 * before anything is multiplied, which is what keeps the products small enough
 * to stay exact.
 *
 * The integer part keeps its own unit, and is left out when it is zero; only
 * the remainder walks the ladder, which never spends back into a week, a month
 * or a year. So a fraction of a month or of a year commits that unit's
 * approximation at the moment the text is read: half a month is a count of
 * days and carries no month at all. A component that resolves to nothing at
 * all answers a zero amount of its own unit. The amounts come out largest
 * unit first, each unit at most once; what a caller does with a unit that
 * another component also names is the caller's rule, not this one's.
 */
export function expandFraction(
  whole: number,
  digits: string,
  row: UnitRow,
): readonly ExpandedAmount[] | undefined {
  // A trailing zero is a place that carries nothing: dropping it leaves the
  // fraction's value alone and its denominator smaller. The zeros are counted
  // back from the end rather than matched by a pattern anchored there, which
  // retries from every zero in a long run and takes time quadratic in it.
  let end = digits.length;
  while (end > 0 && digits[end - 1] === "0") end -= 1;
  const written = digits.slice(0, end);
  if (written.length > MOST_EXACT_PLACES) return undefined;

  const numerator = written === "" ? 0 : Number(written);
  const shared = greatestCommonDivisor(row.millis, 10 ** written.length);
  const denominator = 10 ** written.length / shared;
  if (numerator % denominator !== 0) return undefined;

  const amounts: ExpandedAmount[] = whole > 0 ? [{ amount: whole, row }] : [];
  let remainder = (numerator / denominator) * (row.millis / shared);
  for (const step of REMAINDER_LADDER) {
    const amount = Math.floor(remainder / step.millis);
    remainder -= amount * step.millis;
    if (amount > 0) amounts.push({ amount, row: step });
  }

  return amounts.length === 0 ? [{ amount: 0, row }] : amounts;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

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
 * Failure is a value, never a throw: an argument that is not an object, or one
 * carrying a component that is not a number, answers `NaN`.
 */
export function durationToMilliseconds(duration: DurationParts): number {
  if (typeof duration !== "object" || duration === null) return Number.NaN;
  let total = 0;
  for (const unit of SMALLEST_FIRST) {
    // An untyped caller can hand over any component, and weighing one that is
    // not a number either throws or coerces it, so it answers `NaN` instead.
    const amount: unknown = duration[unit.key] ?? 0;
    if (typeof amount !== "number") return Number.NaN;
    total += amount * unit.millis;
  }
  return total;
}
