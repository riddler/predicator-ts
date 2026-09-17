/**
 * The `::` conversion matrix: what one value becomes when an expression asks
 * for it as one of the seven scalar type names.
 *
 * The matrix is normative, and predicator-ex's `docs/isa.md` section 5 states
 * it at the tag `conformance/SOURCE.json` pins. Two rules generate every cell
 * of it, and both are total:
 *
 * 1. an absence converts to an absence, whatever the target;
 * 2. a conversion that cannot produce a value of the target type answers an
 *    absence rather than an error.
 *
 * Rule 2 is why nothing here refuses. `null` reaches it rather than rule 1 -
 * a null is a value, and it is a value no target can be produced from, so
 * `null::string` is an absence rather than the text `"null"`. Losing the
 * distinction between a null and an absence across a cast is the accepted
 * cost of asking for a typed value.
 *
 * Two of this package's own boundaries meet rule 2 rather than the refusal
 * they take elsewhere. An integer this package's safe range cannot hold and a
 * number the domain has no float for are both conversions that cannot produce
 * a value of the target type, so each answers an absence here. The first is
 * settled by the cast exemption in
 * `docs/adr/0002-the-value-domain-and-the-host-boundary.md`, which reads the
 * totality rule that way and records the reading as this package's rather than
 * as an observed behaviour of the reference; the second is the same reading
 * applied to the domain's other numeric bound.
 */

import { civilOf, daysFromCivil } from "./civil.js";
import type { CastType } from "./instructions.js";
import { formatDate, formatDateTime, readDate, readDateTime } from "./iso.js";
import {
  Duration,
  type DurationParts,
  Float,
  PDate,
  PDateTime,
  Undefined,
  type Value,
} from "./values.js";

const SECONDS_PER_DAY = 86400;

/** The whole text of an integer: an optional minus and decimal digits. */
const INTEGER_TEXT = /^-?[0-9]+$/;

/**
 * The whole text of a float: an optional minus, decimal digits, and an
 * optional fraction. There is no exponent form, matching the language's own
 * float literal grammar, and no bare fraction.
 */
const FLOAT_TEXT = /^-?[0-9]+(?:\.[0-9]+)?$/;

/**
 * Writes a number as text.
 *
 * An integer is its digits. A float keeps its point, so that the text still
 * says which member of the domain the number was: a trailing `.0` is appended
 * when the spelling carries neither a point nor an exponent, which is the same
 * rule the corpus encoding writes a float by. `add`'s concatenation splices in
 * the same spelling, and it does so by calling this: one rule for how a number
 * is written, in one place, rather than a cast and a concatenation that agree
 * until one of them is edited.
 */
export function numberText(value: number | Float): string {
  if (!(value instanceof Float)) return String(value);
  const spelling = String(value.valueOf());
  return POINT_OR_EXPONENT.test(spelling) ? spelling : `${spelling}.0`;
}

const POINT_OR_EXPONENT = /[.eE]/;

/**
 * Converts a value to the named type, answering an absence when it cannot.
 *
 * The target is one of the seven names by the time this is called: the
 * opcode's operand shape admits those names and no other string, so a type
 * name this matrix has no column for never reaches here and is a malformed
 * operand instead.
 */
export function castValue(value: Value, target: CastType): Value {
  if (value === Undefined) return Undefined;
  switch (target) {
    case "integer":
      return toInteger(value);
    case "float":
      return toFloat(value);
    case "string":
      return toText(value);
    case "boolean":
      return toBoolean(value);
    case "date":
      return toDate(value);
    case "datetime":
      return toDateTime(value);
    case "duration":
      return toDuration(value);
  }
}

/**
 * An integer is itself, a float truncates toward zero, and the text of an
 * integer parses.
 *
 * Truncation toward zero diverges from PostgreSQL's rounding deliberately, and
 * it is what the host language's own truncation does, which is the reason the
 * instruction set gives for choosing it.
 */
function toInteger(value: Value): Value {
  if (typeof value === "number") return value;
  if (value instanceof Float) return admitInteger(Math.trunc(value.valueOf()));
  if (typeof value === "string") {
    return INTEGER_TEXT.test(value) ? admitInteger(Number(value)) : Undefined;
  }
  return Undefined;
}

/** An integer the domain holds, or an absence when the magnitude is past it. */
function admitInteger(magnitude: number): Value {
  return Number.isSafeInteger(magnitude) ? magnitude : Undefined;
}

/**
 * A float is itself, an integer widens, and the text of a number parses.
 *
 * The widening is to the nearest representable double, which is exact below
 * 2^53 and rounds above it, so a round trip through a float is not identity
 * for a large integer.
 */
function toFloat(value: Value): Value {
  if (value instanceof Float) return value;
  if (typeof value === "number") return new Float(value);
  if (typeof value === "string") {
    if (!FLOAT_TEXT.test(value)) return Undefined;
    const magnitude = Number(value);
    return Number.isFinite(magnitude) ? new Float(magnitude) : Undefined;
  }
  return Undefined;
}

/** Every source the matrix gives a `::string` cell, written as the cell says. */
function toText(value: Value): Value {
  if (typeof value === "string") return value;
  if (typeof value === "number" || value instanceof Float) return numberText(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof PDate) return formatDate(value);
  if (value instanceof PDateTime) return formatDateTime(value);
  if (value instanceof Duration) return durationText(value);
  return Undefined;
}

/**
 * A boolean is itself, and the two lowercase words parse.
 *
 * The parse is case-sensitive and admits no other spelling. There is no
 * truthiness rule in this language and no cell bridges a number to a boolean,
 * so a cast is not a side door into one.
 */
function toBoolean(value: Value): Value {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return Undefined;
}

/** A date is itself, an instant answers its calendar date, and a date parses. */
function toDate(value: Value): Value {
  if (value instanceof PDate) return value;
  if (value instanceof PDateTime) return civilOf(value);
  if (typeof value === "string") return readDate(value) ?? Undefined;
  return Undefined;
}

/**
 * An instant is itself, a date lands at midnight UTC, and a datetime carrying
 * a UTC offset parses.
 *
 * Midnight UTC is the same coercion a comparison and a subtraction already
 * apply to a mixed date and instant pair. A date-shaped string has no offset
 * to read, so it does not parse here; the spelling for that conversion is a
 * cast to a date followed by a cast to a datetime.
 */
function toDateTime(value: Value): Value {
  if (value instanceof PDateTime) return value;
  if (value instanceof PDate) {
    return new PDateTime(daysFromCivil(value.year, value.month, value.day) * SECONDS_PER_DAY, 0);
  }
  if (typeof value === "string") return readDateTime(value) ?? Undefined;
  return Undefined;
}

/** A duration is itself, and a duration literal parses. */
function toDuration(value: Value): Value {
  if (value instanceof Duration) return value;
  if (typeof value === "string") return readDuration(value) ?? Undefined;
  return Undefined;
}

// ---------------------------------------------------------------------------
// The duration literal
// ---------------------------------------------------------------------------

/** One of the eight keys a duration carries. */
type DurationKey = keyof DurationParts;

/** A unit of the duration literal: what it is written as, and what it weighs. */
interface UnitRow {
  readonly key: DurationKey;
  readonly suffix: string;
  readonly millis: number;
  /** Whether a fraction's remainder may be spent back into this unit. */
  readonly remainder: boolean;
}

/**
 * The units the duration literal is written in, largest first.
 *
 * One table drives the whole literal: the order `::string` writes components
 * in, the suffixes the parse accepts, the weight a fraction is resolved by,
 * and which units a remainder may be spent into. The patterns below are built
 * from it too, so a unit is added or removed here and nowhere else.
 *
 * The longer spellings the `duration` opcode's operand admits are not part of
 * this grammar: the opcode carries unit names a compiler chose, and this is
 * what an author writes inside a string.
 *
 * A month weighs thirty days and a year three hundred and sixty five, the two
 * approximations the reference converts a duration by.
 */
const UNITS: readonly UnitRow[] = [
  { key: "years", suffix: "y", millis: 31536000000, remainder: false },
  { key: "months", suffix: "mo", millis: 2592000000, remainder: false },
  { key: "weeks", suffix: "w", millis: 604800000, remainder: false },
  { key: "days", suffix: "d", millis: 86400000, remainder: true },
  { key: "hours", suffix: "h", millis: 3600000, remainder: true },
  { key: "minutes", suffix: "m", millis: 60000, remainder: true },
  { key: "seconds", suffix: "s", millis: 1000, remainder: true },
  { key: "milliseconds", suffix: "ms", millis: 1, remainder: true },
];

const ROW_OF_SUFFIX: ReadonlyMap<string, UnitRow> = new Map(UNITS.map((row) => [row.suffix, row]));

/**
 * The units a fraction's remainder decomposes through, largest first.
 *
 * A remainder is not spent back into a week, a month or a year. A month and a
 * year are the approximate units, and spending a remainder into one of them
 * would re-commit an approximation the fraction had just resolved; a week is
 * left out with them, so half a year reads as a day count and an hour count.
 */
const REMAINDER_LADDER: readonly UnitRow[] = UNITS.filter((row) => row.remainder);

/**
 * The suffixes as a pattern alternation, longest first.
 *
 * Length order is what makes `"1mo"` one month rather than one minute followed
 * by a stray letter, and it comes off the table rather than being written out,
 * so a suffix that shares a prefix with another cannot be ordered wrongly here.
 */
const SUFFIXES = UNITS.map((row) => row.suffix)
  .sort((left, right) => right.length - left.length)
  .join("|");

/**
 * The whole duration literal: a run of components, each a number with an
 * optional fraction followed by a unit. There is no whitespace in it, no sign,
 * and no empty literal.
 */
const DURATION_TEXT = new RegExp(`^(?:[0-9]+(?:\\.[0-9]+)?(?:${SUFFIXES}))+$`);

const DURATION_COMPONENT = new RegExp(`([0-9]+)(?:\\.([0-9]+))?(${SUFFIXES})`, "g");

/**
 * Reads a duration literal, or answers nothing when the text is not one.
 *
 * The parse is a canonicalizer rather than the inverse of the format: it
 * imposes no order on the components and a repeated unit accumulates rather
 * than replacing what came before, so `"30m3d"` and `"3d30m"` read as the same
 * duration and `"1s2s"` reads as three seconds. Writing a duration out and
 * reading it back recovers the duration, because what `::string` writes is
 * already ordered and carries each unit at most once.
 *
 * The accumulation is this parse's rule rather than the `duration` opcode's: a
 * repeated unit in that opcode's operand keeps the last pair, which a corpus
 * case pins. The parse's half is stated by the language reference rather than
 * by a corpus case, so a unit test pins it here.
 */
function readDuration(text: string): Duration | undefined {
  if (!DURATION_TEXT.test(text)) return undefined;
  const parts: { [key in DurationKey]?: number } = {};
  for (const [, whole, digits, suffix] of text.matchAll(DURATION_COMPONENT)) {
    // The pattern's alternation is built from the same table this looks the
    // suffix up in, and neither group it reads is optional, so this arm
    // narrows the types rather than answering a text the pattern admitted.
    const row = suffix === undefined ? undefined : ROW_OF_SUFFIX.get(suffix);
    if (row === undefined || whole === undefined) return undefined;
    if (digits === undefined) {
      add(parts, row.key, Number(whole));
      continue;
    }
    const expanded = expand(Number(whole), digits, row);
    if (expanded === undefined) return undefined;
    for (const [amount, key] of expanded) add(parts, key, amount);
  }
  return new Duration(parts);
}

function add(parts: { [key in DurationKey]?: number }, key: DurationKey, amount: number): void {
  parts[key] = (parts[key] ?? 0) + amount;
}

/**
 * Expands a component carrying a fraction into whole-unit amounts, or answers
 * nothing when the fraction is not an exact number of milliseconds.
 *
 * A millisecond is the domain's floor, so a fraction below one is refused
 * rather than rounded or truncated: `"0.5ms"` names no duration this domain
 * holds. What the test asks is whether a remainder is zero, and a binary float
 * answers that about a decimal fraction wrongly, so the scaling below is done
 * over the written digits and the test reads the digits it shifted past. A
 * literal is written by an author and its digit run has no bound, while the
 * answer is smaller than the unit's own weight, so the shift is where the
 * arithmetic has to stay exact and the answer is an ordinary number.
 *
 * A fraction of a month or of a year commits that unit's approximation at the
 * moment the text is read, so half a month is a count of days and carries no
 * month at all.
 */
function expand(whole: number, digits: string, row: UnitRow): [number, DurationKey][] | undefined {
  const scaled = scale(digits, row.millis);
  const shifted = scaled.length - digits.length;
  if (NON_ZERO_DIGIT.test(scaled.slice(shifted))) return undefined;
  const amounts: [number, DurationKey][] = [];
  if (whole > 0) amounts.push([whole, row.key]);
  let remaining = Number(scaled.slice(0, shifted) || "0");
  for (const step of REMAINDER_LADDER) {
    const amount = Math.floor(remaining / step.millis);
    if (amount > 0) amounts.push([amount, step.key]);
    remaining %= step.millis;
  }
  if (amounts.length === 0) amounts.push([0, row.key]);
  return amounts;
}

const NON_ZERO_DIGIT = /[1-9]/;

/**
 * Multiplies a run of decimal digits by a whole number, answering the product
 * as a run of decimal digits.
 *
 * It is long multiplication by a single factor, one written digit at a time.
 * A carry is smaller than the factor, because it is a tenth of a step and a
 * step is a digit times the factor plus a carry, so an intermediate stays
 * below ten times the factor however long the run of digits is. The product
 * keeps at least as many digits as it was given, which is what lets the caller
 * read the fraction off its tail.
 */
function scale(digits: string, factor: number): string {
  const product: number[] = [];
  const zero = "0".charCodeAt(0);
  let carry = 0;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const step = (digits.charCodeAt(index) - zero) * factor + carry;
    product.push(step % 10);
    carry = Math.floor(step / 10);
  }
  while (carry > 0) {
    product.push(carry % 10);
    carry = Math.floor(carry / 10);
  }
  return product.reverse().join("");
}

/**
 * Writes a duration in the literal grammar, largest unit first.
 *
 * A component that is not positive is left out, and a duration with nothing
 * left to write is `"0s"`. A duration measured by subtracting a date from an
 * earlier one carries a negative component, and this writes such a duration as
 * `"0s"`: that is the rule the reference's own formatter applies, read at the
 * tag, rather than a choice made here.
 */
function durationText(value: Duration): string {
  const parts: string[] = [];
  for (const row of UNITS) {
    const amount = value[row.key];
    if (amount > 0) parts.push(`${amount}${row.suffix}`);
  }
  return parts.length === 0 ? "0s" : parts.join("");
}
