/**
 * The civil calendar arithmetic two parts of this package share.
 *
 * The evaluator's date opcodes move a date by a duration, and the date
 * builtins read a year, a month and a day out of an instant. Both need the
 * same conversion between a civil date and a day number, and a module of its
 * own is what keeps one copy of it: a second copy would be a second place for
 * a leap year to be wrong.
 */

import { PDate, type PDateTime } from "./values.js";

/** The seconds in one day, with no leap second. */
const SECONDS_PER_DAY = 86400;

/**
 * The day number of a civil date, counting 1970-01-01 as zero.
 *
 * This is plain arithmetic rather than a host date object, for two reasons.
 * The host's UTC constructor reads a year below one hundred as that year plus
 * 1900, which would move a date this domain admits; and arithmetic depends on
 * nothing a constrained JavaScript engine might leave out. The algorithm is
 * the standard days-from-civil pair, exact over the proleptic Gregorian
 * calendar, with March taken as the first month of the year so that the leap
 * day lands at the end.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The inverse of `daysFromCivil`. */
export function civilFromDays(days: number): PDate {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthsFromMarch = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthsFromMarch + 2) / 5) + 1;
  const month = monthsFromMarch + (monthsFromMarch < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return new PDate(year, month, day);
}

/**
 * The civil date an instant falls on, in UTC.
 *
 * The instant carries no zone, so there is no offset to apply and the only
 * work is flooring toward the past: a negative epoch second belongs to the day
 * that contains it rather than to the day after.
 */
export function civilOf(instant: PDateTime): PDate {
  return civilFromDays(Math.floor(instant.epochSeconds / SECONDS_PER_DAY));
}
