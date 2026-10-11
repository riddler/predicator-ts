/**
 * The numeric fields of the three value classes that hold a date, an instant
 * or a duration, and the test that every one of them is finite.
 *
 * This module is internal: neither entry point re-exports it. The value
 * classes' `instanceof` test in `./values.ts` names its fields from here, and
 * the two places a host's value enters the machine - the value boundary's
 * normalization and a literal operand's walk - test those same fields, so the
 * fields a test admits and the fields a boundary checks cannot drift apart.
 */

import { ownData } from "./maps.js";

/** The fields a civil date carries. */
export const DATE_FIELDS: readonly string[] = ["year", "month", "day"];

/** The fields an instant carries. */
export const DATETIME_FIELDS: readonly string[] = ["epochSeconds", "microsecond"];

/** The fields a duration carries, all eight of them. */
export const DURATION_FIELDS: readonly string[] = [
  "years",
  "months",
  "weeks",
  "days",
  "hours",
  "minutes",
  "seconds",
  "milliseconds",
];

/**
 * Whether any of the named fields of an object is not a finite number.
 *
 * Each field is read through its descriptor, as the `instanceof` test reads
 * it, so this runs no getter. The test asks only that a field be a number, and
 * `NaN` and an infinity are numbers, so an object a host built to a class's
 * shape - or built with the class's own constructor, which checks no part -
 * can carry either; the domain has no member for one.
 */
export function hasNonFiniteField(value: object, fields: readonly string[]): boolean {
  return fields.some((field) => !Number.isFinite(ownData(value, field)));
}
